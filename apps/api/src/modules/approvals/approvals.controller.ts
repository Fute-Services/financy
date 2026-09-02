import {
  actOnApprovalSchema,
  type ActOnApproval,
  type ApprovalInstance,
  type QueueItem,
  type Resource,
} from '@financy/contracts';
import { ForbiddenError, NotFoundError, StepNotActionableError } from '@financy/core';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { isWriteConflict } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { QUEUE_PORT, type QueuePort } from '../../platform/queue/index.js';
import {
  callerHas,
  getContext,
  getCorrelationId,
  getOrganizationId,
} from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { ApprovalService, type ActionResult } from './approval.service.js';
import { ApprovalSubjectRegistry } from './approval-subjects.js';

/**
 * `/v1/approvals` — the queue, the timeline, and acting on a step (docs/10 §5.6).
 *
 * **It lived in the spend module until expenses arrived, and now it does not.**
 * Acting on an approval settles the chain, and settling has to tell the
 * *subject* — which was a spend request and is now also an expense. While
 * there was one subject the controller called that module directly and a
 * comment said what would happen when a second appeared; this is that, and the
 * dependency now runs through `ApprovalSubjectRegistry` instead.
 *
 * The alternative — the approvals module importing every subject — is the
 * arrangement that does not survive the third.
 */
@Controller('approvals')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly database: DatabaseService,
    @Inject(QUEUE_PORT) private readonly jobs: QueuePort,
  ) {}

  /**
   * What is waiting for the caller.
   *
   * Each row carries enough of its subject to decide without opening it —
   * amount, purpose, who asked. A queue that showed only ids would make every
   * approval two page loads, which is how approval queues stop being used.
   */
  @Get('queue')
  @RequirePermission('approval:read')
  async queue(): Promise<Resource<QueueItem[]>> {
    const organizationId = getOrganizationId();
    const items = await this.approvals.queue();

    const spendIds = items
      .filter((item) => item.subjectType === 'spend_request')
      .map((item) => item.subjectId);

    const subjects =
      spendIds.length === 0 || organizationId === undefined
        ? []
        : await this.database.unscoped.spendRequest.findMany({
            where: { organizationId, id: { in: spendIds } },
            select: {
              id: true,
              reference: true,
              purpose: true,
              amount: true,
              currency: true,
              requester: { select: { user: { select: { fullName: true } } } },
            },
          });

    const byId = new Map(subjects.map((subject) => [subject.id, subject]));

    return {
      data: items.map((item) => {
        const subject = byId.get(item.subjectId);

        return {
          ...item,
          subject:
            subject === undefined
              ? null
              : {
                  reference: subject.reference,
                  purpose: subject.purpose,
                  amount: subject.amount,
                  currency: subject.currency,
                  requester: subject.requester.user.fullName,
                },
        };
      }),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * One chain, with every step and everything anybody did to it.
   *
   * Declared after `queue` and before nothing else that could shadow it. The
   * requester reads this as much as the approvers do — "where has it got to,
   * and who is it with" is the question a pending request generates, and the
   * alternative to answering it here is that they ask in a chat message the
   * record never sees.
   */
  @Get(':instanceId')
  @RequirePermission('approval:read')
  async instance(@Param('instanceId') instanceId: string): Promise<Resource<ApprovalInstance>> {
    const instance = await this.approvals.instance(instanceId);

    if (instance === null) throw new NotFoundError('Approval');

    return { data: instance, meta: { correlationId: getCorrelationId() } };
  }

  /**
   * Approve, reject, return for changes, or override.
   *
   * No `If-Match`. The precondition that matters here is the step's *status*,
   * re-read and re-checked inside the transaction — two approvers pressing at
   * the same instant is the ordinary case in a parallel step, and a version on
   * the instance would refuse the second one for the wrong reason.
   *
   * **The route is gated on `approval:act`; an override needs
   * `approval:override` on top.** They are different powers: acting is being
   * one of the people the chain named, overriding is settling a chain that
   * named somebody who cannot act any more. Checking the second here rather
   * than in the service keeps the authorization decision at the boundary,
   * where the rest of this application's permission checks live.
   */
  @Post(':instanceId/act')
  @HttpCode(200)
  @RequirePermission('approval:act')
  async act(
    @Param('instanceId') instanceId: string,
    @Body(new ZodValidationPipe(actOnApprovalSchema)) body: ActOnApproval,
  ): Promise<Resource<{ settled: boolean; outcome: string | null }>> {
    const organizationId = getOrganizationId();

    if (organizationId === undefined) {
      throw new Error('An approval cannot be acted on without a tenant context.');
    }

    if (body.action === 'OVERRIDE' && !callerHas('approval:override')) {
      throw new ForbiddenError(
        'Overriding an approval chain is a finance power. You can approve, reject, or return this instead.',
      );
    }

    const result = await this.settle(organizationId, instanceId, body);

    // Enqueued **after** the commit, never inside it (docs/14 §1). A job
    // scheduled inside a transaction that then rolled back would tell somebody
    // "your request was approved" about an approval that did not happen — and
    // an email, unlike a database row, does not roll back.
    await this.announce(organizationId, result, body.comment ?? null);

    // Same reasoning, a different consequence: a budget committed inside the
    // transaction would reserve money against a decision that could still roll
    // back, and nothing would ever notice. The ledger is idempotent by source,
    // so the retry costs nothing and a job that never ran leaves the budget
    // reading low rather than wrong.
    await this.moveBudget(organizationId, result);

    return {
      data: { settled: result.settled !== null, outcome: result.settled?.outcome ?? null },
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * The action and the subject, in one transaction.
   *
   * **A write conflict here is not a failure; it is the answer.** MongoDB
   * aborts one of two transactions touching the same step at the same instant,
   * and the approver who lost that race did not encounter a fault — somebody
   * else completed the step a millisecond earlier. Reported as a `500` it
   * reads as "the system broke and I do not know whether my approval
   * counted", which is the worst thing to tell somebody about an approval.
   * Reported as `STEP_NOT_ACTIONABLE` it says exactly what happened, and it is
   * what FR-APR-011 asks for.
   *
   * The general mapping in the exception filter turns a conflict anywhere into
   * a `409`; this narrows it, because on this path the meaning is not merely
   * "retry" but "it is already decided".
   */
  private async settle(
    organizationId: string,
    instanceId: string,
    body: ActOnApproval,
  ): Promise<ActionResult> {
    try {
      return await this.database.unscoped.$transaction(async (tx) => {
        const outcome = await this.approvals.act(
          tx,
          organizationId,
          instanceId,
          body.action,
          body.comment ?? null,
        );

        if (outcome.settled !== null) {
          const handler = this.subjects.resolve(outcome.settled.subjectType);

          if (handler === undefined) {
            /**
             * A chain whose subject nobody owns.
             *
             * Refused rather than skipped: skipping would settle the
             * *instance* and leave the record in `PENDING_APPROVAL` forever
             * with an approved chain beside it and nothing saying why — the
             * exact stuck state this module exists to prevent. Throwing rolls
             * the whole action back, which is recoverable.
             */
            throw new Error(
              `No module owns approval subject "${outcome.settled.subjectType}". Register one with ApprovalSubjectRegistry.`,
            );
          }

          // The subject moves inside the same transaction as the step. A chain
          // that settled without its subject moving is a record stuck in
          // `PENDING_APPROVAL` with nothing left to approve it.
          await handler.onApprovalSettled(
            tx,
            organizationId,
            outcome.settled.subjectId,
            outcome.settled.outcome,
          );
        }

        return outcome;
      });
    } catch (error) {
      if (isWriteConflict(error)) throw new StepNotActionableError();

      throw error;
    }
  }

  /**
   * Move the budget the settled record draws on (FR-SPD-007).
   *
   * **A spend request commits; an expense actualises.** A request is a promise
   * to spend and the money has not left, so approving it reserves budget. An
   * expense is a report that the money already went, so approving it records a
   * spend — there is nothing left to reserve. Treating both as commitments
   * would leave every reimbursed claim sitting in `committed` forever, and a
   * budget whose committed balance only grows is a number people learn to
   * ignore.
   *
   * A rejection moves nothing, because nothing was committed: budget is
   * reserved when a chain settles in favour, not when it opens.
   */
  private async moveBudget(organizationId: string, result: ActionResult): Promise<void> {
    const settled = result.settled;

    if (settled === null) return;
    if (settled.outcome !== 'APPROVED' && settled.outcome !== 'OVERRIDDEN') return;

    const operation = settled.subjectType === 'expense' ? 'ACTUALIZE' : 'COMMIT';
    const sourceType = settled.subjectType === 'expense' ? 'EXPENSE' : 'SPEND_REQUEST';

    await this.jobs.enqueue(
      'budget.apply',
      { organizationId, operation, sourceType, sourceId: settled.subjectId },
      { idempotencyKey: `budget:${sourceType}:${settled.subjectId}:${operation}` },
    );
  }

  /**
   * Tell the people the action concerns.
   *
   * Two audiences and they never overlap: the requester learns the chain
   * settled, and the next step's approvers learn there is something waiting.
   * A chain that advanced settles nothing, so exactly one of the two branches
   * fires per action.
   *
   * **The idempotency keys name the record, not the moment.** `step:{id}:
   * requested` delivered twice is one notification; a key with a timestamp in
   * it would make every redelivery a new message, which is the failure the
   * queue's guarantee is supposed to absorb.
   */
  private async announce(
    organizationId: string,
    result: ActionResult,
    comment: string | null,
  ): Promise<void> {
    if (result.settled !== null) {
      await this.jobs.enqueue(
        'notification.approval_decided',
        {
          organizationId,
          subjectType: result.settled.subjectType as 'spend_request' | 'expense',
          subjectId: result.settled.subjectId,
          // `RETURNED` is the chain's word for it and `CHANGES_REQUESTED` is
          // the request's; the notification is about the request, so it uses
          // the request's.
          outcome:
            result.settled.outcome === 'RETURNED' ? 'CHANGES_REQUESTED' : result.settled.outcome,
          actedByMembershipId: getContext()?.membershipId ?? null,
          comment,
        },
        {
          idempotencyKey: `${result.settled.subjectType}:${result.settled.subjectId}:${result.settled.outcome}`,
        },
      );

      return;
    }

    if (result.activatedStepId !== null) {
      await this.jobs.enqueue(
        'notification.approval_requested',
        { organizationId, approvalStepId: result.activatedStepId },
        { idempotencyKey: `step:${result.activatedStepId}:requested` },
      );
    }
  }
}
