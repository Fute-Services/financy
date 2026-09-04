import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'financy:rate-limit';

export interface RateLimitRule {
  /** How many requests the window allows. */
  readonly limit: number;
  /** The window, in seconds. */
  readonly windowSeconds: number;
}

/**
 * A per-route request ceiling, keyed by caller (docs/10 §7).
 *
 * Written on the handler rather than configured centrally, because the limit
 * is a property of what the endpoint *does* — three demo requests an hour is a
 * statement about demo requests, and it belongs next to them where a reviewer
 * changing the endpoint sees it.
 *
 * Absent metadata means no limit, which is the correct default here and the
 * opposite of the `@Public()` default next door. Authentication fails closed
 * because an undeclared route must not be reachable; a rate limit fails open
 * because a route with no declared ceiling is still behind the guards that do
 * fail closed, and refusing every undeclared route would take the whole API
 * down the moment this guard is registered.
 */
export const RateLimit = (limit: number, windowSeconds: number) =>
  SetMetadata<string, RateLimitRule>(RATE_LIMIT_KEY, { limit, windowSeconds });
