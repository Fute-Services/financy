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
    this.registry.register('notification.budget_threshold', (payload) =>
      this.budgetThreshold(payload),
    );
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

    const subject = await this.subjectOf(
      payload.organizationId,
      step.instance.subjectType,
      step.instance.subjectId,
    );

    if (subject === null) return;

    const rendered = templates.approvalRequested({
      requesterName: subject.requesterName,
      amount: subject.amount,
      purpose: subject.purpose,
      reference: subject.reference,
      path: subject.path,
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
      resourceType: subject.resourceType,
      resourceId: subject.id,
      metadata: { reference: subject.reference, amount: subject.amount, stepId: step.id },
    });
  }

  private async approvalDecided(
    payload: JobPayload<'notification.approval_decided'>,
  ): Promise<void> {
    const subject = await this.subjectOf(
      payload.organizationId,
      payload.subjectType,
      payload.subjectId,
    );

    if (subject === null) {
      throw new PermanentJobError(`${payload.subjectType} ${payload.subjectId} no longer exists.`);
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
      path: subject.path,
    });

    await this.notifications.deliver({
      organizationId: payload.organizationId,
      // A return is its own event, so somebody can be told about decisions and
      // not about their own drafts coming back — and because the two ask for
      // different next actions.
      eventType:
        payload.outcome === 'CHANGES_REQUESTED' ? 'spend_request.returned' : 'approval.decided',
      recipientMembershipIds: [subject.requesterMembershipId],
      dedupeKey: `${payload.subjectType}:${subject.id}:${payload.outcome}`,
      ...rendered,
      resourceType: subject.resourceType,
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

    const subject = await this.subjectOf(
      payload.organizationId,
      step.instance.subjectType,
      step.instance.subjectId,
    );

    if (subject === null) return;

    const rendered = templates.approvalReminder({
      requesterName: subject.requesterName,
      amount: subject.amount,
      purpose: subject.purpose,
      reference: subject.reference,
      path: subject.path,
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
      resourceType: subject.resourceType,
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

    const subject = await this.subjectOf(
      payload.organizationId,
      step.instance.subjectType,
      step.instance.subjectId,
    );

    if (subject === null) return;

    const rendered = templates.approvalEscalated({
      requesterName: subject.requesterName,
      amount: subject.amount,
      purpose: subject.purpose,
      reference: subject.reference,
      path: subject.path,
      dueAt: (step.dueAt ?? step.createdAt).toISOString(),
    });

    await this.notifications.deliver({
      organizationId: payload.organizationId,
      eventType: 'approval.escalated',
      recipientMembershipIds: payload.addedMembershipIds,
      dedupeKey: `step:${step.id}:escalated`,
      ...rendered,
      resourceType: subject.resourceType,
      resourceId: subject.id,
      metadata: { reference: subject.reference, stepId: step.id },
    });
  }

  /**
   * A budget crossed a threshold (FR-BDG-006, FR-NOT-001).
   *
   * **Recipients are the people who can do something about it**, which is
   * whoever holds `budget:manage` — not everyone who can see the budget.
   * Telling twenty people a number went up produces twenty people who filter
   * budget mail.
   *
   * The alert row already exists and is unique per threshold per period, so
   * this job cannot be the thing that duplicates the message. The dedupe key
   * is the second guard, for the case where the job itself is redelivered.
   */
  private async budgetThreshold(
    payload: JobPayload<'notification.budget_threshold'>,
  ): Promise<void> {
    const line = await this.database.unscoped.budgetLine.findFirst({
      where: { id: payload.budgetLineId, organizationId: payload.organizationId },
      include: { budget: { select: { id: true, name: true, currency: true } } },
    });

    if (line === null) {
      throw new PermanentJobError(`Budget line ${payload.budgetLineId} no longer exists.`);
    }

    const remaining = Money.of(line.allocatedAmount, line.currency)
      .subtract(Money.of(line.committedAmount, line.currency))
      .subtract(Money.of(line.actualAmount, line.currency));

    const managers = await this.database.unscoped.membership.findMany({
      where: {
        organizationId: payload.organizationId,
        status: 'ACTIVE',
        role: { permissions: { some: { permission: { key: 'budget:manage' } } } },
      },
      select: { id: true },
    });

    if (managers.length === 0) return;

    const rendered = templates.budgetThreshold({
      budgetName: line.budget.name,
      threshold: payload.threshold,
      utilization: payload.utilization,
      remaining: `${remaining.toJSON().amount} ${line.currency}`,
      period: formatPeriod(line.periodStart, line.periodEnd),
      path: `/budgets/${line.budget.id}`,
    });

    await this.notifications.deliver({
      organizationId: payload.organizationId,
      eventType: 'budget.threshold',
      recipientMembershipIds: managers.map((manager) => manager.id),
      dedupeKey: `budget-line:${line.id}:threshold:${String(payload.threshold)}`,
      ...rendered,
      resourceType: 'budget',
      resourceId: line.budget.id,
      metadata: { threshold: payload.threshold, utilization: payload.utilization },
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
   * What a chain is about, reduced to the four things a sentence needs.
   *
   * **Two subject types, one shape.** A spend request and an expense are
   * different records with different words for their fields — `purpose`
   * against a merchant and a memo — and the templates want neither: they want
   * a reference, a line of text, a formatted amount, and whose it is. Mapping
   * both onto that here means the wording is written once and the day a bill
   * arrives it is a third case in one switch rather than a third template.
   *
   * `null` when the record has gone. The caller treats that as nothing to do,
   * because a notification about a deleted record is not worth an alert.
   */
  private async subjectOf(
    organizationId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<Subject | null> {
    if (subjectType === 'expense') {
      const expense = await this.database.unscoped.expense.findFirst({
        where: { id: subjectId, organizationId },
        select: {
          id: true,
          reference: true,
          merchantName: true,
          memo: true,
          amount: true,
          currency: true,
          submitterMembershipId: true,
          submitter: { select: { user: { select: { fullName: true } } } },
        },
      });

      if (expense === null) return null;

      return {
        id: expense.id,
        resourceType: 'expense',
        path: `/expenses/${expense.id}`,
        reference: expense.reference,
        // The merchant is what an approver recognises; the memo is why. A
        // claim with no memo still reads as a sentence.
        purpose:
          expense.memo === null || expense.memo === ''
            ? expense.merchantName
            : `${expense.merchantName} — ${expense.memo}`,
        amount: Money.of(expense.amount, expense.currency).format(),
        requesterMembershipId: expense.submitterMembershipId,
        requesterName: expense.submitter.user.fullName,
      };
    }

    if (subjectType === 'bill') {
      const bill = await this.database.unscoped.bill.findFirst({
        where: { id: subjectId, organizationId },
        select: {
          id: true,
          reference: true,
          billNumber: true,
          memo: true,
          totalAmount: true,
          currency: true,
          submittedByMembershipId: true,
          submittedBy: { select: { user: { select: { fullName: true } } } },
          vendor: { select: { name: true } },
        },
      });

      if (bill === null || bill.submittedByMembershipId === null) return null;

      return {
        id: bill.id,
        resourceType: 'bill',
        path: `/bills/${bill.id}`,
        reference: bill.reference,
        // The supplier and their invoice number, which is what an approver
        // recognises — our own reference means nothing to them.
        purpose: `${bill.vendor.name} — invoice ${bill.billNumber}`,
        amount: Money.of(bill.totalAmount, bill.currency).format(),
        requesterMembershipId: bill.submittedByMembershipId,
        requesterName: bill.submittedBy?.user.fullName ?? 'Somebody',
      };
    }

    if (subjectType === 'purchase_order') {
      const order = await this.database.unscoped.purchaseOrder.findFirst({
        where: { id: subjectId, organizationId },
        select: {
          id: true,
          poNumber: true,
          memo: true,
          totalAmount: true,
          currency: true,
          requesterMembershipId: true,
          requester: { select: { user: { select: { fullName: true } } } },
          vendor: { select: { name: true } },
        },
      });

      if (order === null) return null;

      return {
        id: order.id,
        resourceType: 'purchase_order',
        path: `/procurement/${order.id}`,
        reference: order.poNumber,
        purpose:
          order.memo === null || order.memo === ''
            ? `Order from ${order.vendor.name}`
            : `${order.vendor.name} — ${order.memo}`,
        amount: Money.of(order.totalAmount, order.currency).format(),
        requesterMembershipId: order.requesterMembershipId,
        requesterName: order.requester.user.fullName,
      };
    }

    const request = await this.database.unscoped.spendRequest.findFirst({
      where: { id: subjectId, organizationId },
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
      resourceType: 'spend_request',
      path: `/spend/${request.id}`,
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

/** The shape every subject is reduced to before a template sees it. */
interface Subject {
  readonly id: string;
  /** What the in-app row links to, which the screen resolves per type. */
  readonly resourceType: string;
  /** Where the notification points, which differs per subject type. */
  readonly path: string;
  readonly reference: string;
  readonly purpose: string;
  readonly amount: string;
  readonly requesterMembershipId: string;
  readonly requesterName: string;
}

/**
 * "March 2026", or a range when the period is not one month.
 *
 * A notification that said `2026-03-01T00:00:00.000Z – 2026-03-31T00:00:00.000Z`
 * would be accurate and unreadable, and the reader has to know which period
 * overspent before anything else in the message means anything.
 */
function formatPeriod(start: Date, end: Date): string {
  const month = (date: Date): string =>
    date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const from = month(start);
  const to = month(end);

  return from === to ? from : `${from} – ${to}`;
}
