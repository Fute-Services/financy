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
import { ApprovalService, type ActionResult } from '../approvals/index.js';
import { SpendRequestService } from './spend-request.service.js';

/**
 * `/v1/approvals` — the queue, the timeline, and acting on a step (docs/10 §5.6).
 *
 * **It lives in the spend module rather than the approvals module, and that is
 * temporary.** Acting on an approval settles the chain, and settling has to
 * tell the *subject* — a spend request today, an expense or a bill from
 * Phase 3. The approval machinery deliberately knows nothing about any of
 * them, so something has to join the two, and today that is one dependency in
 * one direction. When the second subject type arrives this becomes a
 * dispatcher registered per subject, and the controller moves back.
 *
 * Writing it the other way — the approvals module importing every subject —
 * is the arrangement that does not survive the second subject.
 */
@Controller('approvals')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly spend: SpendRequestService,
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

        if (outcome.settled !== null && outcome.settled.subjectType === 'spend_request') {
          // The subject is told inside the same transaction. A chain that
          // settled without its request moving is a request stuck in
          // `PENDING_APPROVAL` with nothing left to approve it.
          await this.spend.onApprovalSettled(
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
    if (result.settled !== null && result.settled.subjectType === 'spend_request') {
      await this.jobs.enqueue(
        'notification.approval_decided',
        {
          organizationId,
          spendRequestId: result.settled.subjectId,
          // `RETURNED` is the chain's word for it and `CHANGES_REQUESTED` is
          // the request's; the notification is about the request, so it uses
          // the request's.
          outcome:
            result.settled.outcome === 'RETURNED' ? 'CHANGES_REQUESTED' : result.settled.outcome,
          actedByMembershipId: getContext()?.membershipId ?? null,
          comment,
        },
        { idempotencyKey: `request:${result.settled.subjectId}:${result.settled.outcome}` },
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
