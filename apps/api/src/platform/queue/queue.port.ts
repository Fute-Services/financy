import type { JobName, JobPayload } from './job-catalogue.js';

export const QUEUE_PORT = Symbol('QueuePort');

export interface EnqueueOptions {
  /**
   * What makes a duplicate delivery a no-op.
   *
   * **Required in practice, optional in the type only because a handful of
   * jobs are genuinely once-per-clock-tick.** A queue guarantees at-least-once
   * delivery; without a key, a redelivery sends the notification twice, and
   * the second one arrives looking exactly as legitimate as the first.
   */
  idempotencyKey?: string;
  maxAttempts?: number;
  delayMs?: number;
}

export interface JobHandle {
  id: string;
  name: JobName;
  /** `RESERVED` on a first enqueue; anything else means it was already known. */
  status: JobStatus;
  /** True when this call created nothing because the key had been seen. */
  deduplicated: boolean;
}

export type JobStatus = 'RESERVED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTERED';

/**
 * How the queue is reached from the rest of the application (ADR-0006).
 *
 * **Everything enqueues; nothing constructs a queue.** The port exists because
 * the development host has no Redis and CI must not need one, so the same code
 * runs against an in-process adapter locally and BullMQ in production. That is
 * the stated reason. The better reason is that a module which imported BullMQ
 * directly could not be tested without a broker, and the tests that matter
 * here — "does a redelivery send the notification twice?" — are exactly the
 * ones nobody writes when they need a broker to run.
 *
 * **Enqueue after the transaction commits, never inside it.** A job scheduled
 * inside a transaction that then rolls back processes a record that does not
 * exist; the handler's first query returns nothing and the failure reads as a
 * missing row rather than as a job that should never have been created
 * (docs/14 §1).
 */
export interface QueuePort {
  enqueue<T extends JobName>(
    name: T,
    payload: JobPayload<T>,
    options?: EnqueueOptions,
  ): Promise<JobHandle>;

  schedule<T extends JobName>(
    name: T,
    payload: JobPayload<T>,
    runAt: Date,
    options?: EnqueueOptions,
  ): Promise<JobHandle>;

  /**
   * Wait for everything currently in flight.
   *
   * Present on the port rather than only on the inline adapter, because a test
   * that asserts "after submitting, the approver has a notification" needs a
   * way to say "when the work is done" that does not involve sleeping and
   * hoping. Against a real broker this waits for the jobs this process
   * enqueued; it is not a distributed barrier and does not pretend to be.
   */
  drain(timeoutMs?: number): Promise<void>;
}

/**
 * A failure that must not be retried.
 *
 * Retrying a validation error five times is pure waste and delays the alert
 * (docs/14 §3, requirement 6). Throwing this dead-letters on the first
 * attempt.
 */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

export interface JobContext {
  readonly jobName: JobName;
  readonly attempt: number;
  readonly executionId: string;
}

export type JobHandler<T extends JobName> = (
  payload: JobPayload<T>,
  context: JobContext,
) => Promise<void>;
