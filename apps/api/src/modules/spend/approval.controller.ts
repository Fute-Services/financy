import { nonEmptyString, type Resource } from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../../platform/authorization/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getCorrelationId, getOrganizationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { ApprovalService } from '../approvals/index.js';
import { SpendRequestService } from './spend-request.service.js';

/**
 * `/v1/approvals` — the queue, and acting on it (docs/10 §5.6).
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
const actSchema = z.strictObject({
  action: z.enum(['APPROVE', 'REJECT']),
  /**
   * Optional on an approval, and that asymmetry is deliberate: approving is
   * agreeing with what was asked, and there is nothing extra to say. A
   * rejection is a decision somebody has to act on, so the service requires a
   * comment for it — see below.
   */
  comment: z.string().trim().max(1000).nullable().optional(),
});

export interface QueueItem {
  instanceId: string;
  stepId: string;
  sequence: number;
  subjectType: string;
  subjectId: string;
  dueAt: string | null;
  activatedAt: string | null;
  /** Enough to decide without opening the request. */
  subject: {
    reference: string;
    purpose: string;
    amount: string;
    currency: string;
    requester: string;
  } | null;
}

@Controller('approvals')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly spend: SpendRequestService,
    private readonly database: DatabaseService,
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
   * Approve or reject the active step.
   *
   * No `If-Match`. The precondition that matters here is the step's *status*,
   * re-read and re-checked inside the transaction — two approvers pressing at
   * the same instant is the ordinary case in a parallel step, and a version on
   * the instance would refuse the second one for the wrong reason.
   */
  @Post(':instanceId/act')
  @HttpCode(200)
  @RequirePermission('approval:act')
  async act(
    @Param('instanceId') instanceId: string,
    @Body(new ZodValidationPipe(actSchema)) body: z.infer<typeof actSchema>,
  ): Promise<Resource<{ settled: boolean; outcome: string | null }>> {
    const organizationId = getOrganizationId();

    if (organizationId === undefined) {
      throw new Error('An approval cannot be acted on without a tenant context.');
    }

    const settled = await this.database.unscoped.$transaction(async (tx) => {
      const result = await this.approvals.act(
        tx,
        organizationId,
        instanceId,
        body.action,
        body.comment ?? null,
      );

      if (result !== null && result.subjectType === 'spend_request') {
        // The subject is told inside the same transaction. A chain that
        // settled without its request moving is a request stuck in
        // `PENDING_APPROVAL` with nothing left to approve it.
        await this.spend.onApprovalSettled(tx, organizationId, result.subjectId, result.outcome);
      }

      return result;
    });

    return {
      data: { settled: settled !== null, outcome: settled?.outcome ?? null },
      meta: { correlationId: getCorrelationId() },
    };
  }
}

/** Kept so the schema above reads as one piece. */
export { nonEmptyString };
