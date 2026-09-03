import { randomInt } from 'node:crypto';

import { AppError, newId } from '@financy/core';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../database/index.js';
import { getCorrelationId, runWithContext } from '../request-context/index.js';
import {
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  JOB_TIMEOUT_MS,
  type JobName,
  type JobPayload,
} from './job-catalogue.js';
import { JobRegistry } from './job-registry.js';
import {
  PermanentJobError,
  type EnqueueOptions,
  type JobHandle,
  type JobStatus,
  type QueuePort,
} from './queue.port.js';

/**
 * The queue, in-process (ADR-0006).
 *
 * The development host has no Redis and CI must not require one, so this is
 * the adapter that runs everywhere except staging and production — where a
 * missing `REDIS_URL` fails startup rather than quietly falling back to this
 * one, because a queue that loses everything on restart is a development
 * convenience and not a deployment.
 *
 * ## What it does not pretend to be
 *
 * There is no separate worker process, no cross-instance locking, and no
 * durable retry across a restart: a job waiting on a backoff timer when the
 * process stops is a job that never runs again. Its `job_executions` row stays
 * `RESERVED`, which is deliberately visible rather than tidy — a sweep can
 * find it, and a status that lied would be worse than one that is stuck.
 *
 * ## What it does guarantee, and shares with the Redis adapter
 *
 * - **Idempotency is a unique index**, `(jobName, idempotencyKey)`, and the
 *   row is reserved *before* the handler runs. Checking first and inserting
 *   afterwards would let two simultaneous deliveries both find nothing, both
 *   run, and only then collide.
 * - **The payload is validated at enqueue.** A malformed payload is the
 *   caller's bug, and finding out inside a handler — after a retry, in a
 *   worker log — costs an hour to trace back to the line that enqueued it.
 * - **Failures are classified.** Permanent failures dead-letter on the first
 *   attempt; retryable ones back off exponentially with full jitter.
 * - **Every job runs in a request context** carrying its organisation, so the
 *   tenant-scoped Prisma client works exactly as it does in a request, and a
 *   job that forgot its organisation fails closed.
 */
@Injectable()
export class InlineQueueAdapter implements QueuePort {
  /**
   * Everything currently running or waiting on a timer.
   *
   * Tracked so `drain()` can be honest. Without it a test asserting on a
   * notification would have to sleep, and a sleep long enough to be reliable
   * is long enough to make the suite unbearable.
   */
  private readonly inFlight = new Set<Promise<void>>();

  /** Registered schedules. Recorded, never fired — see `registerRecurring`. */
  private readonly schedules = new Map<JobName, { cron: string; payload: unknown }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly registry: JobRegistry,
    private readonly logger: PinoLogger,
  ) {}

  async enqueue<T extends JobName>(
    name: T,
    payload: JobPayload<T>,
    options: EnqueueOptions = {},
  ): Promise<JobHandle> {
    const parsed = JOB_PAYLOADS[name].safeParse(payload);

    if (!parsed.success) {
      // Thrown rather than dead-lettered: this is a programming error in the
      // code that enqueued it, and the stack here names that line. A
      // dead-letter row would name the queue.
      throw new Error(
        `Payload for job "${name}" is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
      );
    }

    const validated = parsed.data as JobPayload<T>;
    const key = options.idempotencyKey ?? `${name}:${newId()}`;
    const maxAttempts = options.maxAttempts ?? JOB_MAX_ATTEMPTS[name];
    const delayMs = Math.max(0, options.delayMs ?? 0);
    const organizationId = organizationOf(validated);

    const existing = await this.database.unscoped.jobExecution.findFirst({
      where: { jobName: name, idempotencyKey: key },
      select: { id: true, status: true },
    });

    if (existing !== null) {
      this.logger.debug(
        { jobName: name, idempotencyKey: key, executionId: existing.id },
        'Job skipped: this idempotency key has been seen.',
      );

      return {
        id: existing.id,
        name,
        status: existing.status as JobStatus,
        deduplicated: true,
      };
    }

    const executionId = newId();

    try {
      await this.database.unscoped.jobExecution.create({
        data: {
          id: executionId,
          jobName: name,
          idempotencyKey: key,
          organizationId: organizationId ?? null,
          status: 'RESERVED',
          attempts: 0,
          maxAttempts,
          payload: validated as never,
          scheduledFor: delayMs === 0 ? null : new Date(Date.now() + delayMs),
        },
      });
    } catch (error) {
      // The index refused it, which means another delivery reserved the same
      // key between the read above and this write. That is the race the index
      // exists for, and losing it is a successful outcome.
      const raced = await this.database.unscoped.jobExecution.findFirst({
        where: { jobName: name, idempotencyKey: key },
        select: { id: true, status: true },
      });

      if (raced === null) throw error;

      return { id: raced.id, name, status: raced.status as JobStatus, deduplicated: true };
    }

    this.start(name, validated, executionId, maxAttempts, delayMs);

    return { id: executionId, name, status: 'RESERVED', deduplicated: false };
  }

  async schedule<T extends JobName>(
    name: T,
    payload: JobPayload<T>,
    runAt: Date,
    options: EnqueueOptions = {},
  ): Promise<JobHandle> {
    return this.enqueue(name, payload, {
      ...options,
      delayMs: Math.max(0, runAt.getTime() - Date.now()),
    });
  }

  /**
   * Record a schedule without running it (docs/14 §2).
   *
   * A timer firing in every developer's terminal and every test process would
   * make behaviour depend on how long the process had been up — the one thing
   * a test cannot control for. The schedule is kept so `recurring` can list
   * what *would* run, and `trigger` runs one on demand.
   */
  registerRecurring<T extends JobName>(
    name: T,
    cron: string,
    payload: JobPayload<T>,
  ): Promise<void> {
    this.schedules.set(name, { cron, payload });

    this.logger.debug(
      { jobName: name, cron },
      'Recurring job registered. The inline adapter does not run it; trigger it explicitly.',
    );

    return Promise.resolve();
  }

  /** What is registered, for the CLI that triggers them and for the tests. */
  get recurring(): Array<{ name: JobName; cron: string }> {
    return [...this.schedules.entries()].map(([name, entry]) => ({ name, cron: entry.cron }));
  }

  /**
   * Run a registered recurring job once, now.
   *
   * The idempotency key carries the minute, so triggering it twice in the same
   * minute is one run — which is what makes a developer leaning on the key
   * harmless — while the next minute is genuinely a new sweep.
   */
  async trigger(name: JobName): Promise<JobHandle> {
    const schedule = this.schedules.get(name);

    if (schedule === undefined) {
      throw new Error(`No recurring job is registered as "${name}".`);
    }

    const minute = new Date().toISOString().slice(0, 16);

    return this.enqueue(name, schedule.payload as JobPayload<typeof name>, {
      idempotencyKey: `${name}:${minute}`,
    });
  }

  /**
   * Wait for everything in flight, including work those jobs enqueue.
   *
   * The loop matters: a sweep enqueues reminders, and a `drain` that returned
   * after the sweep would leave a test asserting on a notification that is
   * about to exist. It settles when a full pass adds nothing new.
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (this.inFlight.size > 0) {
      if (Date.now() > deadline) {
        throw new Error(
          `Queue did not drain within ${String(timeoutMs)}ms; ${String(this.inFlight.size)} job(s) still in flight.`,
        );
      }

      await Promise.allSettled([...this.inFlight]);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private start<T extends JobName>(
    name: T,
    payload: JobPayload<T>,
    executionId: string,
    maxAttempts: number,
    delayMs: number,
  ): void {
    const correlationId = getCorrelationId();

    const run = (async () => {
      if (delayMs > 0) await sleep(delayMs);
      await this.execute(name, payload, executionId, maxAttempts, correlationId);
    })();

    this.inFlight.add(run);

    // The rejection is handled inside `execute`; this only keeps an unhandled
    // rejection from taking the process down if that ever stops being true.
    void run.catch(() => undefined).finally(() => this.inFlight.delete(run));
  }

  private async execute<T extends JobName>(
    name: T,
    payload: JobPayload<T>,
    executionId: string,
    maxAttempts: number,
    correlationId: string,
  ): Promise<void> {
    const handler = this.registry.resolve(name);

    if (handler === undefined) {
      // Nothing listens for this job. Dead-lettered rather than retried: no
      // number of retries produces a handler, and the silent version of this
      // is a notification that simply never arrives.
      await this.finish(executionId, 'DEAD_LETTERED', {
        errorKind: 'PERMANENT',
        errorMessage: `No handler is registered for "${name}".`,
      });

      this.logger.error({ jobName: name, executionId }, 'No handler is registered for this job.');
      return;
    }

    const organizationId = organizationOf(payload);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.database.unscoped.jobExecution.update({
        where: { id: executionId },
        data: { status: 'RUNNING', attempts: attempt, startedAt: new Date() },
      });

      try {
        await withTimeout(
          runWithContext(
            {
              correlationId,
              startedAt: Date.now(),
              ...(organizationId === undefined ? {} : { organizationId }),
            },
            () => handler(payload, { jobName: name, attempt, executionId }),
          ),
          JOB_TIMEOUT_MS[name],
          `Job "${name}" exceeded ${String(JOB_TIMEOUT_MS[name])}ms.`,
        );

        await this.finish(executionId, 'SUCCEEDED', {});
        return;
      } catch (error) {
        const permanent = isPermanent(error);
        const message = error instanceof Error ? error.message : String(error);
        const last = attempt >= maxAttempts;

        if (permanent || last) {
          await this.finish(executionId, 'DEAD_LETTERED', {
            errorKind: permanent ? 'PERMANENT' : 'RETRIES_EXHAUSTED',
            errorMessage: message,
          });

          this.logger.error(
            { jobName: name, executionId, attempt, permanent, err: error },
            'Job dead-lettered.',
          );
          return;
        }

        const backoff = backoffMs(attempt);

        this.logger.warn(
          { jobName: name, executionId, attempt, backoffMs: backoff, err: error },
          'Job failed and will be retried.',
        );

        await this.database.unscoped.jobExecution.update({
          where: { id: executionId },
          data: { status: 'FAILED', errorKind: 'RETRYABLE', errorMessage: message },
        });

        await sleep(backoff);
      }
    }
  }

  private async finish(
    executionId: string,
    status: JobStatus,
    detail: { errorKind?: string; errorMessage?: string },
  ): Promise<void> {
    await this.database.unscoped.jobExecution.update({
      where: { id: executionId },
      data: {
        status,
        finishedAt: new Date(),
        errorKind: detail.errorKind ?? null,
        errorMessage: detail.errorMessage ?? null,
      },
    });
  }
}

/**
 * Retryable or not (docs/14 §3, requirement 6).
 *
 * **An `AppError` is permanent.** Every one of them is a business outcome — a
 * validation failure, a record that is not there, a state that does not allow
 * the transition — and none of those becomes true by waiting. Retrying them
 * burns five attempts to reach the same conclusion and delays the alert by the
 * whole backoff ladder.
 *
 * Everything else is assumed retryable, which is the safe direction: a network
 * blip retried is fixed, and a genuine bug retried five times is a bug with a
 * dead-letter row naming it.
 */
function isPermanent(error: unknown): boolean {
  return error instanceof PermanentJobError || error instanceof AppError;
}

/**
 * `2^attempt` seconds with **full** jitter, capped at fifteen minutes.
 *
 * Full jitter rather than a fixed ladder: without it, every job that failed
 * during the same provider outage retries at the same instant, and the retry
 * storm is what keeps the provider down.
 */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(2 ** attempt * 1000, 15 * 60 * 1000);

  //  rather than , and not because a retry delay is a
  // secret: the lint rule bans the weak generator outright so that nobody has
  // to judge, per call site, whether this particular one mattered.
  return randomInt(0, ceiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A pending timer must not keep the process alive at shutdown; the job is
    // lost either way and a hung exit is worse than a lost retry.
    timer.unref?.();
  });
}

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function organizationOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;

  const value = (payload as { organizationId?: unknown }).organizationId;

  return typeof value === 'string' ? value : undefined;
}
