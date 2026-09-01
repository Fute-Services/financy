import { Money } from '@financy/core';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';
import { JobRegistry, PermanentJobError, type JobPayload } from '../../platform/queue/index.js';
import { NotificationsService } from './notifications.service.js';
import { templates } from './templates.js';

/**
 * The jobs that turn an approval event into notifications (docs/14 §4.1).
 *
 * ## The handler reads the record; the payload only names it
 *
 * A payload carrying the rendered text would be a snapshot that was true when
 * it was enqueued. This runs on a retry ten minutes later and, in production,
 * in another process — so it reads the step, the request, and the requester,
 * which is what it would have to do to be correct anyway.
 *
 * ## A record that has moved on is a success, not a failure
 *
 * A step approved between the enqueue and the run needs no "please approve
 * this" notification. That is not an error: the job's work was to make sure
 * nobody is asked to act on something already settled. Treating it as a
 * failure would fill the dead-letter queue with jobs that behaved correctly.
 *
 * ## A missing record is permanent
 *
 * A step that does not exist will not exist in eight seconds either. It
 * dead-letters on the first attempt rather than spending five to reach the
 * same conclusion.
 */
@Injectable()
export class NotificationJobs implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('notification.approval_requested', (payload) =>
      this.approvalRequested(payload),
    );
    this.registry.register('notification.approval_decided', (payload) =>
      this.approvalDecided(payload),
    );
    this.registry.register('approval.reminder', (payload) => this.approvalReminder(payload));
    this.registry.register('notification.approval_escalated', (payload) =>
      this.approvalEscalated(payload),
    );
  }

  private async approvalRequested(
    payload: JobPayload<'notification.approval_requested'>,
  ): Promise<void> {
    const step = await this.step(payload.organizationId, payload.approvalStepId);

    if (step === null) {
      throw new PermanentJobError(`Approval step ${payload.approvalStepId} no longer exists.`);
    }

    if (step.status !== 'ACTIVE' && step.status !== 'ESCALATED') return;

    const subject = await this.subjectOf(payload.organizationId, step.instance.subjectId);

    if (subject === null) return;

    const rendered = templates.approvalRequested({
      requesterName: subject.requesterName,
      amount: subject.amount,
      purpose: subject.purpose,
      reference: subject.reference,
      spendRequestId: subject.id,
      dueAt: step.dueAt?.toISOString() ?? null,
    });

    await this.notifications.deliver({
      organizationId: payload.organizationId,
      eventType: 'approval.requested',
      // Everybody who can act on the step. The requester is already absent
      // from the eligible set (INV-02), so this is the resolver's answer
      // rather than a second opinion about it.
      recipientMembershipIds: step.eligibleMembershipIds,
      dedupeKey: `step:${step.id}:requested`,
      ...rendered,
      resourceType: 'spend_request',
      resourceId: subject.id,
      metadata: { reference: subject.reference, amount: subject.amount, stepId: step.id },
    });
  }

  private async approvalDecided(
    payload: JobPayload<'notification.approval_decided'>,
  ): Promise<void> {
    const subject = await this.subjectOf(payload.organizationId, payload.spendRequestId);

    if (subject === null) {
      throw new PermanentJobError(`Spend request ${payload.spendRequestId} no longer exists.`);
    }

    const decider =
      payload.actedByMembershipId === null
        ? null
        : await this.database.unscoped.membership.findFirst({
            where: { id: payload.actedByMembershipId, organizationId: payload.organizationId },
            select: { user: { select: { fullName: true } } },
          });

    const rendered = templates.approvalDecided({
      reference: subject.reference,
      purpose: subject.purpose,
      amount: subject.amount,
      outcome: payload.outcome,
      deciderName: decider?.user.fullName ?? null,
      comment: payload.comment,
      spendRequestId: subject.id,
    });

    await this.notifications.deliver({
      organizationId: payload.organizationId,
      // A return is its own event, so somebody can be told about decisions and
      // not about their own drafts coming back — and because the two ask for
      // different next actions.
      eventType:
        payload.outcome === 'CHANGES_REQUESTED' ? 'spend_request.returned' : 'approval.decided',
      recipientMembershipIds: [subject.requesterMembershipId],
      dedupeKey: `request:${subject.id}:${payload.outcome}`,
      ...rendered,
      resourceType: 'spend_request',
      resourceId: subject.id,
      metadata: { reference: subject.reference, outcome: payload.outcome },
    });
  }

  private async approvalReminder(payload: JobPayload<'approval.reminder'>): Promise<void> {
    const step = await this.step(payload.organizationId, payload.approvalStepId);

    if (step === null) {
      throw new PermanentJobError(`Approval step ${payload.approvalStepId} no longer exists.`);
    }

    // The ordinary outcome: somebody acted between the sweep and the job.
    if (step.status !== 'ACTIVE' && step.status !== 'ESCALATED') return;

    const subject = await this.subjectOf(payload.organizationId, step.instance.subjectId);

    if (subject === null) return;

    const rendered = templates.approvalReminder({
      requesterName: subject.requesterName,
      amount: subject.amount,
      purpose: subject.purpose,
      reference: subject.reference,
      spendRequestId: subject.id,
      waitingSince: (step.activatedAt ?? step.createdAt).toISOString(),
    });

    await this.notifications.deliver({
      organizationId: payload.organizationId,
      eventType: 'approval.reminder',
      recipientMembershipIds: step.eligibleMembershipIds,
      // `nth` is in the key. Without it the second reminder is swallowed as a
      // duplicate of the first and nobody is chased again.
      dedupeKey: `step:${step.id}:reminder:${String(payload.nth)}`,
      ...rendered,
      resourceType: 'spend_request',
      resourceId: subject.id,
      metadata: { reference: subject.reference, nth: payload.nth },
    });
  }

  /**
   * The step went past its deadline and came to somebody new.
   *
   * **Only the people newly brought in are told.** The original approvers were
   * asked when the step opened and chased at 50% and 80% of the window; a
   * fourth message saying it has been escalated *away from* them adds nothing
   * they can act on that the queue does not already show.
   */
  private async approvalEscalated(
    payload: JobPayload<'notification.approval_escalated'>,
  ): Promise<void> {
    const step = await this.step(payload.organizationId, payload.approvalStepId);

    if (step === null) {
      throw new PermanentJobError(`Approval step ${payload.approvalStepId} no longer exists.`);
    }

    // Settled between the escalation and this job. The people it escalated to
    // do not need telling about something already decided.
    if (step.status !== 'ACTIVE' && step.status !== 'ESCALATED') return;

    const subject = await this.subjectOf(payload.organizationId, step.instance.subjectId);

    if (subject === null) return;

    const rendered = templates.approvalEscalated({
      requesterName: subject.requesterName,
      amount: subject.amount,
      purpose: subject.purpose,
      reference: subject.reference,
      spendRequestId: subject.id,
      dueAt: (step.dueAt ?? step.createdAt).toISOString(),
    });

    await this.notifications.deliver({
      organizationId: payload.organizationId,
      eventType: 'approval.escalated',
      recipientMembershipIds: payload.addedMembershipIds,
      dedupeKey: `step:${step.id}:escalated`,
      ...rendered,
      resourceType: 'spend_request',
      resourceId: subject.id,
      metadata: { reference: subject.reference, stepId: step.id },
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async step(organizationId: string, stepId: string) {
    return this.database.unscoped.approvalStep.findFirst({
      where: { id: stepId, organizationId },
      select: {
        id: true,
        status: true,
        dueAt: true,
        activatedAt: true,
        createdAt: true,
        eligibleMembershipIds: true,
        instance: { select: { subjectType: true, subjectId: true, status: true } },
      },
    });
  }

  /**
   * The request a chain is about, formatted for a sentence.
   *
   * `null` when the subject is not a spend request. Every subject type shares
   * the approval machinery (docs/09), and expenses and bills arrive in later
   * phases; a template guessing at their wording now would be written against
   * a shape nobody has built.
   */
  private async subjectOf(organizationId: string, spendRequestId: string) {
    const request = await this.database.unscoped.spendRequest.findFirst({
      where: { id: spendRequestId, organizationId },
      select: {
        id: true,
        reference: true,
        purpose: true,
        amount: true,
        currency: true,
        requesterMembershipId: true,
        requester: { select: { user: { select: { fullName: true } } } },
      },
    });

    if (request === null) return null;

    return {
      id: request.id,
      reference: request.reference,
      purpose: request.purpose,
      // Formatted once, here, with the currency's own rules. A template
      // reaching for `toFixed(2)` would be wrong for JPY and KWD in opposite
      // directions.
      amount: Money.of(request.amount, request.currency).format(),
      requesterMembershipId: request.requesterMembershipId,
      requesterName: request.requester.user.fullName,
    };
  }
}
