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
};
