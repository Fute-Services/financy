import { HEADER } from '@financy/contracts';
import { RateLimitError } from '@financy/core';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { RATE_LIMIT_KEY, type RateLimitRule } from './decorators.js';
import { SlidingWindowCounter } from './sliding-window.js';

/**
 * Enforces `@RateLimit` (docs/10 §7).
 *
 * ## What this is, and what it is not
 *
 * The counter lives **in this process's memory**. With more than one instance
 * behind a load balancer, a limit of 3/hour is 3/hour *per instance*, so four
 * instances permit twelve. That is a real weakening and it is stated here
 * rather than buried, because the alternative — a shared counter in Redis —
 * needs the Redis adapter that `QueueModule` also does not have yet, and
 * shipping nothing at all leaves a public, unauthenticated write endpoint with
 * no ceiling whatsoever.
 *
 * The trade is deliberate and bounded: an in-memory limiter stops the casual
 * script and the accidental double-submit, which is the traffic a demo form
 * actually attracts. It does not stop a distributed flood, and nothing at this
 * layer would — that belongs at the edge.
 *
 * ## Why it is registered before `AuthGuard`
 *
 * Guard order is registration order. This one runs first so that a limit can
 * apply to requests that never reach authentication — an unauthenticated flood
 * is exactly the case worth refusing cheaply, and a limiter that only counted
 * requests which already passed auth would be useless on `/auth/login`.
 *
 * The consequence is that there is no membership to key by yet, so the key is
 * the caller's address. `app.set('trust proxy', 1)` in `main.ts` is what makes
 * `req.ip` the client rather than the load balancer; without it every caller
 * would share one bucket and the first busy minute would lock out everybody.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly counter = new SlidingWindowCounter();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();

    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      handler,
      controller,
    ]);

    // No declaration means no ceiling. See the note on the decorator for why
    // this default is open where `@Public()`'s is closed.
    if (rule === undefined) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const key = `${controller.name}.${handler.name}:${callerKey(request)}`;
    const verdict = this.counter.hit(key, rule, Date.now());

    response.setHeader(HEADER.rateLimitLimit, String(verdict.limit));
    response.setHeader(HEADER.rateLimitRemaining, String(verdict.remaining));
    // Seconds since the epoch, which is what every client library expects
    // from this header — milliseconds would be read as a date in the year
    // 56,000 and produce a nonsense back-off.
    response.setHeader(HEADER.rateLimitReset, String(Math.ceil(verdict.resetAt / 1000)));

    if (verdict.allowed) return true;

    // The exception filter reads `retryAfterSeconds` out of the details and
    // sets `Retry-After` from it, so the header does not have to be set twice.
    throw new RateLimitError(verdict.retryAfterSeconds ?? rule.windowSeconds);
  }
}

/**
 * Who is being counted.
 *
 * `req.ip` alone, deliberately: no header the caller controls takes part.
 * Keying on `X-Forwarded-For` as sent would let anybody reset their own bucket
 * by changing one header, which is a rate limiter in appearance only. Express
 * derives `ip` from that header **only** because `trust proxy` says the hop in
 * front is ours.
 *
 * `'unknown'` is one shared bucket rather than a bypass. A request with no
 * resolvable address should not get a free pass, and in practice this is a
 * unix-socket or test-harness call.
 */
function callerKey(request: Request): string {
  return request.ip ?? 'unknown';
}
