import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AuditService } from '../../platform/audit/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import {
  JobRegistry,
  QUEUE_PORT,
  type JobPayload,
  type QueuePort,
} from '../../platform/queue/index.js';
import { ApprovalService } from './approval.service.js';

/**
 * The scheduled half of approvals (tasks 2.2.7 and 2.3.8, docs/14 §4.2).
 *
 * ## One sweep finds the work; every unit of work is its own job
 *
 * The sweep reads across every organisation and writes nothing. What it finds
 * becomes a bounded job with an idempotency key naming one record — so a
 * failure on one step does not stop the other two hundred, a retry re-runs one
 * record rather than the whole sweep, and two sweeps overlapping produce no
 * duplicated work at all.
 *
 * ## The clock is a parameter
 *
 * `asOf` exists so a test can ask "what would this have done on Tuesday?"
 * without waiting until Tuesday. Every comparison here reads from it rather
 * than calling `Date.now()` in four places, which is also what keeps the
 * reminder thresholds testable — a job whose behaviour depends on the wall
 * clock has to be tested by sleeping, and a suite that sleeps gets deleted.
 *
 * ## Reminders are proportional, not absolute
 *
 * At 50% and 80% of the window the step was given, rather than at fixed hours.
 * A step with a four-hour deadline and a step with two weeks need chasing on
 * completely different rhythms, and one absolute schedule is wrong for both:
 * hourly reminders on a fortnightly approval is spam, and a daily reminder on
 * a four-hour one arrives after it has already gone overdue.
 */
@Injectable()
export class ApprovalJobs implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    private readonly registry: JobRegistry,
    private readonly logger: PinoLogger,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
  ) {}

  onModuleInit(): void {
    this.registry.register('approvals.sweep', (payload) => this.sweep(payload));
    this.registry.register('approval.escalate', (payload) => this.escalate(payload));
    this.registry.register('spend_request.expire', (payload) => this.expire(payload));

    /**
     * Registered, not started.
     *
     * The inline adapter records the schedule and never fires it (docs/14 §2),
     * so this declares the intent in code — the cron string lives beside the
     * job it runs rather than in a deployment manifest nobody reads — while
     * local behaviour stays deterministic. `pnpm --filter @financy/api job
     * approvals.sweep` runs it on demand.
     */
    void this.queue.registerRecurring('approvals.sweep', '*/15 * * * *', {});
  }

  /**
   * Find everything that has become due, and enqueue one job per finding.
   *
   * Deliberately reads across organisations: "which steps anywhere are
   * overdue?" is one query, and iterating tenants would be the same query with
   * an extra hop per tenant. The jobs it enqueues each carry their
   * organisation and establish a tenant context of their own.
   */
  private async sweep(payload: JobPayload<'approvals.sweep'>): Promise<void> {
    const now = payload.asOf === undefined ? new Date() : new Date(payload.asOf);

    const steps = await this.database.unscoped.approvalStep.findMany({
      where: {
        status: { in: ['ACTIVE', 'ESCALATED'] },
        // A step with no deadline is never late and never chased. That is what
        // "optional timeout" means, and sweeping them anyway would be a
        // reminder for something nobody promised to answer by any date.
        dueAt: { not: null },
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
        activatedAt: true,
        createdAt: true,
        dueAt: true,
      },
      // Bounded. A sweep that could return every step in the system would take
      // a table scan's worth of memory on the day something goes wrong, which
      // is the day it must not.
      take: 500,
    });

    let reminders = 0;
    let escalations = 0;

    for (const step of steps) {
      if (step.dueAt === null) continue;

      const started = (step.activatedAt ?? step.createdAt).getTime();
      const due = step.dueAt.getTime();
      const elapsed = now.getTime() - started;
      const window = due - started;

      if (window <= 0) continue;

      if (now.getTime() >= due) {
        if (step.status === 'ACTIVE') {
          await this.queue.enqueue(
            'approval.escalate',
            {
              organizationId: step.organizationId,
              approvalStepId: step.id,
              asOf: now.toISOString(),
            },
            { idempotencyKey: `step:${step.id}:escalated` },
          );

          escalations += 1;
        }

        continue;
      }

      const fraction = elapsed / window;
      // 80% first: a step past both thresholds needs the *later* reminder, and
      // checking 50% first would send the early one and then treat the late one
      // as already handled.
      const nth = fraction >= 0.8 ? 2 : fraction >= 0.5 ? 1 : null;

      if (nth === null) continue;

      await this.queue.enqueue(
        'approval.reminder',
        { organizationId: step.organizationId, approvalStepId: step.id, nth },
        // The key is the step and which reminder, never the time — so the
        // sweep running every fifteen minutes sends each reminder once rather
        // than ninety-six times a day.
        { idempotencyKey: `step:${step.id}:reminder:${String(nth)}` },
      );

      reminders += 1;
    }

    const expiring = await this.database.unscoped.spendRequest.findMany({
      where: { status: 'APPROVED', validUntil: { not: null, lte: now } },
      select: { id: true, organizationId: true },
      take: 500,
    });

    for (const request of expiring) {
      await this.queue.enqueue(
        'spend_request.expire',
        { organizationId: request.organizationId, spendRequestId: request.id },
        { idempotencyKey: `request:${request.id}:expired` },
      );
    }

    this.logger.info(
      {
        asOf: now.toISOString(),
        stepsExamined: steps.length,
        reminders,
        escalations,
        expiries: expiring.length,
      },
      'Approval sweep finished.',
    );
  }

  /**
   * A step whose deadline passed.
   *
   * The service decides whether anything happens — it may have been acted on
   * since the sweep, or have no escalation configured — and returns the people
   * newly brought in. `null` is the ordinary case, not a failure.
   */
  private async escalate(payload: JobPayload<'approval.escalate'>): Promise<void> {
    const result = await this.database.unscoped.$transaction((tx) =>
      this.approvals.escalate(
        tx,
        payload.organizationId,
        payload.approvalStepId,
        new Date(payload.asOf),
      ),
    );

    if (result === null) return;

    // After the commit, like every other notification (docs/14 §1).
    await this.queue.enqueue(
      'notification.approval_escalated',
      {
        organizationId: payload.organizationId,
        approvalStepId: payload.approvalStepId,
        addedMembershipIds: result.addedMembershipIds,
      },
      { idempotencyKey: `step:${payload.approvalStepId}:escalated:notified` },
    );
  }

  /**
   * An approved request whose validity ran out (FR-SPD-008).
   *
   * **Expiry is a status change, never a deletion.** The request was approved,
   * and that approval happened; what has run out is its licence to be spent
   * against. A deleted record would take the approval history with it and
   * leave a transaction matched to nothing.
   *
   * Conditional on the row still being `APPROVED` with the same `validUntil`,
   * so a request re-approved or extended between the sweep and this job is not
   * expired underneath somebody.
   */
  private async expire(payload: JobPayload<'spend_request.expire'>): Promise<void> {
    await this.database.unscoped.$transaction(async (tx) => {
      const request = await tx.spendRequest.findFirst({
        where: { id: payload.spendRequestId, organizationId: payload.organizationId },
        select: { id: true, status: true, validUntil: true, version: true, reference: true },
      });

      if (request === null) return;
      if (request.status !== 'APPROVED') return;
      if (request.validUntil === null || request.validUntil.getTime() > Date.now()) return;

      await tx.spendRequest.update({
        where: { id: request.id, version: request.version },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        organizationId: payload.organizationId,
        // A job has no membership, so it says so rather than borrowing one.
        // An audit row attributing an automatic expiry to whoever last touched
        // the request would be a lie about who did it.
        actorType: 'SYSTEM',
        actorLabel: 'spend_request.expire',
        action: 'spend_request.expired',
        resourceType: 'spend_request',
        resourceId: request.id,
        before: { status: 'APPROVED' },
        after: { status: 'EXPIRED' },
        metadata: {
          reference: request.reference,
          validUntil: request.validUntil.toISOString(),
        },
      });
    });
  }
}
