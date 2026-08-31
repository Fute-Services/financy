/**
 * Request and response headers that are part of the contract (docs/10 §2.1).
 */

import { z } from 'zod';

export const HEADER = {
  correlationId: 'x-correlation-id',
  idempotencyKey: 'idempotency-key',
  idempotentReplay: 'idempotent-replay',
  ifMatch: 'if-match',
  rateLimitLimit: 'x-ratelimit-limit',
  rateLimitRemaining: 'x-ratelimit-remaining',
  rateLimitReset: 'x-ratelimit-reset',
  retryAfter: 'retry-after',
} as const;

/**
 * A UUID, because the key must be unique across everything the client has ever
 * sent and a client-chosen string like `"submit"` collides with itself on the
 * second request.
 */
export const idempotencyKeySchema = z.uuid({ error: 'Idempotency-Key must be a UUID' });

/** `If-Match: 7` carries the record `version`, not an ETag hash. */
export const ifMatchSchema = z
  .string()
  .regex(/^\d+$/, { error: 'If-Match must be the record version' })
  .transform((value) => Number.parseInt(value, 10));

export const IDEMPOTENCY_RETENTION_HOURS = 24;
