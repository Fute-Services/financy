import { idSchema } from '@financy/contracts';
import { z } from 'zod';

/**
 * Every job the system can enqueue, with the shape of its payload.
 *
 * **One closed catalogue, not a string and a `Record<string, unknown>`.** A
 * queue whose names are free-form strings has two failure modes that both
 * arrive in production: a typo in a job name enqueues something no worker
 * listens for — nothing errors, nothing runs, and the notification simply
 * never goes out — and a payload that drifted from what the handler reads
 * throws deep inside a worker where the stack says nothing about who enqueued
 * it. Naming and shape are both checked here, at the point of enqueue.
 *
 * Payloads are **identifiers, not objects.** A payload carrying a rendered
 * notification, or a copy of the spend request, is a snapshot that was true
 * when it was enqueued; the handler reads the record itself, which is what it
 * would have to do anyway to be correct after a retry ten minutes later.
 */
export const JOB_PAYLOADS = {
  /**
   * A step opened and somebody can act on it (docs/14 §4.1).
   *
   * Fans out to every eligible approver rather than taking a recipient,
   * because "who can act on this step?" is a question with one answer that the
   * handler can look up, and enqueuing one job per approver would make the
   * idempotency key per approver too — so adding an approver to a step would
   * silently re-notify the others.
   */
  'notification.approval_requested': z.strictObject({
    organizationId: idSchema,
    approvalStepId: idSchema,
  }),

  /** A chain settled. Goes to the requester (docs/14 §4.1). */
  'notification.approval_decided': z.strictObject({
    organizationId: idSchema,
    spendRequestId: idSchema,
    /** `APPROVED`, `REJECTED`, `CHANGES_REQUESTED`, `OVERRIDDEN`. */
    outcome: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'OVERRIDDEN']),
    actedByMembershipId: idSchema.nullable(),
    comment: z.string().max(2000).nullable(),
  }),

  /**
   * A step has been waiting and nobody has acted (docs/14 §4.2).
   *
   * `nth` is in the payload and in the idempotency key, because the reminder
   * at 50% of the timeout and the one at 80% are two different jobs about the
   * same step — a key without it would deliver the first and silently swallow
   * the second.
   */
  'approval.reminder': z.strictObject({
    organizationId: idSchema,
    approvalStepId: idSchema,
    nth: z.int().min(1).max(5),
  }),

  /**
   * A step passed its deadline (docs/14 §4.2, FR-APR-008).
   *
   * `asOf` is the moment the sweep judged it late, carried forward rather than
   * re-read here. The two must agree: a job that re-read the clock would
   * disagree with the sweep that enqueued it whenever the sweep was run
   * against a simulated time, and the escalation would silently do nothing —
   * which is exactly how this was found.
   */
  'approval.escalate': z.strictObject({
    organizationId: idSchema,
    approvalStepId: idSchema,
    asOf: z.iso.datetime({ offset: true }),
  }),

  /**
   * A step was escalated, and the people it went to need telling.
   *
   * Separate from `approval.escalate`, which does the escalating. The two are
   * split for the same reason every other notification is its own job: the
   * escalation is a database transition that must not be undone by a mail
   * server being down, and the notification is a delivery that must be
   * retryable without re-running the transition.
   *
   * `addedMembershipIds` is in the payload rather than re-derived, because by
   * the time this runs the step's eligible set contains the original approvers
   * too and there would be no way to tell who was just brought in.
   */
  'notification.approval_escalated': z.strictObject({
    organizationId: idSchema,
    approvalStepId: idSchema,
    addedMembershipIds: z.array(idSchema).min(1),
  }),

  /**
   * An approved request whose validity has run out (FR-SPD-008, task 2.3.8).
   *
   * One request per job rather than a sweep that expires everything it finds:
   * the work is bounded, the idempotency key names one record, and a failure
   * on one request does not stop the other four hundred expiring.
   */
  'spend_request.expire': z.strictObject({
    organizationId: idSchema,
    spendRequestId: idSchema,
  }),

  /**
   * A stored receipt, checked for malware (docs/14 §4.3).
   *
   * Enqueued after the file has landed and never before: a scan of an object
   * that does not exist yet reports clean, which is the worst possible
   * outcome.
   */
  'receipt.scan': z.strictObject({
    organizationId: idSchema,
    receiptId: idSchema,
  }),

  /**
   * Reading fields off a receipt (FR-EXP-011).
   *
   * Separate from the scan because they fail independently and mean different
   * things: a receipt that could not be scanned is a risk, and a receipt that
   * could not be read is an inconvenience.
   */
  'receipt.ocr': z.strictObject({
    organizationId: idSchema,
    receiptId: idSchema,
  }),

  /**
   * The sweep that finds work for the three jobs above.
   *
   * **Cross-tenant by design**, which is why there is no `organizationId`: it
   * asks "which steps anywhere are overdue?" in one query and enqueues one
   * bounded job per answer. A per-organisation sweep would need a list of
   * organisations to iterate first — the same query with an extra hop, run
   * once per tenant.
   *
   * It writes nothing itself. Everything it finds becomes a job with its own
   * idempotency key, so a sweep running twice in one minute — two instances, a
   * manual trigger during a scheduled run — produces no duplicated work.
   */
  'approvals.sweep': z.strictObject({
    /** Present only in tests, which need a fixed clock to assert against. */
    asOf: z.iso.datetime({ offset: true }).optional(),
  }),
} as const satisfies Record<string, z.ZodType>;

export type JobName = keyof typeof JOB_PAYLOADS;

export type JobPayload<T extends JobName> = z.infer<(typeof JOB_PAYLOADS)[T]>;

export const JOB_NAMES = Object.keys(JOB_PAYLOADS) as JobName[];

/**
 * How long a job may run before it is abandoned (docs/14 §3, requirement 4).
 *
 * A job that can run indefinitely blocks a worker indefinitely. The values are
 * deliberately generous — these are ceilings that indicate something is wrong,
 * not deadlines anything should approach.
 */
export const JOB_TIMEOUT_MS: Readonly<Record<JobName, number>> = {
  'notification.approval_requested': 30_000,
  'notification.approval_decided': 30_000,
  'approval.reminder': 30_000,
  'approval.escalate': 30_000,
  'notification.approval_escalated': 30_000,
  'spend_request.expire': 30_000,
  'receipt.scan': 60_000,
  'receipt.ocr': 120_000,
  // Longer, because it reads across every organisation. Still bounded: a
  // sweep that can run indefinitely holds the only scheduled worker there is.
  'approvals.sweep': 120_000,
};

/**
 * Retry ceilings per job (docs/14 §4).
 *
 * A notification retries five times because a transient mail failure should
 * not lose it. The sweep retries twice because it runs again on a schedule
 * anyway, and a sweep piling up retries behind a database problem is how a
 * queue fills with work that has already been superseded.
 */
export const JOB_MAX_ATTEMPTS: Readonly<Record<JobName, number>> = {
  'notification.approval_requested': 5,
  'notification.approval_decided': 5,
  'approval.reminder': 3,
  'approval.escalate': 3,
  'notification.approval_escalated': 5,
  'spend_request.expire': 3,
  'receipt.scan': 3,
  // Three, and then it dead-letters rather than failing the receipt: OCR
  // produces suggestions, and a receipt with none is still a receipt.
  'receipt.ocr': 3,
  // Two, because it runs again on its schedule anyway. A sweep piling up
  // retries behind a database problem fills the queue with work that has
  // already been superseded by the next sweep.
  'approvals.sweep': 2,
};
