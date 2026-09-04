import type { RateLimitRule } from './decorators.js';

/**
 * The counting half of the rate limiter, as a pure data structure.
 *
 * Separated from the guard for the same reason `applyTenantScope` is separated
 * from its Prisma extension: the arithmetic is where the mistakes live —
 * off-by-one at the boundary, a window that never expires, a `Retry-After` of
 * zero telling a client to retry immediately — and all of it can be asserted
 * in milliseconds with an injected clock instead of by sleeping in a test.
 *
 * **A sliding log, not a fixed bucket.** A fixed window resets on the hour, so
 * a limit of 3/hour actually permits 6 in two minutes if they straddle the
 * boundary. Keeping the timestamps and dropping the expired ones costs a small
 * array per key and removes that burst entirely.
 */
export class SlidingWindowCounter {
  /** Hit timestamps per key, oldest first. */
  private readonly hits = new Map<string, number[]>();

  /**
   * How often to sweep keys nobody is using any more.
   *
   * Without this the map is an unbounded, attacker-controlled allocation: the
   * key contains the caller's IP, so anyone able to vary a source address can
   * add entries faster than any single window expires them.
   */
  private static readonly SWEEP_EVERY_MS = 60_000;
  private lastSweep = 0;

  /**
   * Record a hit and say whether it is allowed.
   *
   * The hit is recorded **only when it is allowed**. Counting refused requests
   * would let a caller who is already over the limit hold themselves over it
   * indefinitely by continuing to hammer the endpoint — the window would never
   * drain, and a legitimate retry after the stated `Retry-After` would still
   * fail.
   */
  hit(key: string, rule: RateLimitRule, now: number): RateLimitVerdict {
    this.sweep(now);

    const windowMs = rule.windowSeconds * 1000;
    const cutoff = now - windowMs;

    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);

    if (recent.length >= rule.limit) {
      // The oldest hit in the window is the one whose expiry frees a slot.
      const oldest = recent[0] ?? now;
      const resetAt = oldest + windowMs;

      this.hits.set(key, recent);

      return {
        allowed: false,
        limit: rule.limit,
        remaining: 0,
        resetAt,
        // Rounded **up**, and never below one: a `Retry-After: 0` invites an
        // immediate retry that is certain to fail, which turns a rate limit
        // into a busy loop.
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);

    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit - recent.length,
      resetAt: (recent[0] ?? now) + windowMs,
    };
  }

  /** Drop keys whose every hit has aged out. Cheap, and amortised. */
  private sweep(now: number): void {
    if (now - this.lastSweep < SlidingWindowCounter.SWEEP_EVERY_MS) return;

    this.lastSweep = now;

    for (const [key, timestamps] of this.hits) {
      // A key is only removable once its *newest* hit is older than the
      // longest window any route uses. Tracking that per key would mean
      // storing the rule too, so the sweep uses the longest window in the
      // system as the bound — over-retaining briefly is harmless, dropping a
      // key early is not.
      const newest = timestamps[timestamps.length - 1];

      if (newest === undefined || now - newest > SlidingWindowCounter.MAX_WINDOW_MS) {
        this.hits.delete(key);
      }
    }
  }

  /**
   * The longest window any `@RateLimit` uses, as the sweep's retention bound.
   * A day, so that "3 per day" — the invitation-resend limit in docs/10 §7 —
   * is not swept out from under itself.
   */
  private static readonly MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

  /** Test seam. Nothing in the application calls this. */
  reset(): void {
    this.hits.clear();
    this.lastSweep = 0;
  }
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch milliseconds at which the window frees a slot. */
  readonly resetAt: number;
  readonly retryAfterSeconds?: number;
}
