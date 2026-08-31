/**
 * `/v1/audit-events` — the audit trail, read-only (docs/10 §5.5).
 *
 * There is no write endpoint and there will not be one. Audit events are
 * written by `AuditService` inside the transaction that made the change, so a
 * change and its record commit together or not at all (ADR-0016). An endpoint
 * that let a caller post an audit event would let a caller post a *false* one,
 * and a trail that can be forged is worse than no trail because it is trusted.
 *
 * There is no delete endpoint for the same reason. Retention is a scheduled
 * job with its own authorisation, not a user action.
 */

import { z } from 'zod';

import { strictQuery } from './filters.js';
import { cursorPaginationQuerySchema } from './pagination.js';
import { correlationIdSchema, idSchema, nonEmptyString, timestampSchema } from './primitives.js';

export const ACTOR_TYPES = ['USER', 'SYSTEM', 'PROVIDER'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ACTOR_TYPE_LABELS: Readonly<Record<ActorType, string>> = {
  USER: 'Person',
  SYSTEM: 'System',
  PROVIDER: 'Integration',
};

export const auditEventSchema = z.object({
  id: idSchema,
  /** `resource.verb`, past tense — `membership.created`, `policy.published`. */
  action: nonEmptyString(100),
  resourceType: nonEmptyString(100),
  resourceId: idSchema.nullable(),
  actorType: z.enum(ACTOR_TYPES),
  /**
   * Denormalised at write time, deliberately.
   *
   * The trail must still read correctly after the person leaves and their
   * membership is deactivated, or after they change their name. Joining to the
   * live membership would silently rewrite history every time someone's
   * details changed, which defeats the purpose (docs/09 §7.12).
   */
  actorLabel: z.string().max(200).nullable(),
  actorMembershipId: idSchema.nullable(),
  /**
   * The before/after pair, already redacted by the writer. Secrets and
   * password hashes never reach this field, and the redaction happens at the
   * point of writing rather than the point of reading — a reader-side filter
   * protects nobody from a database dump.
   */
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().max(45).nullable(),
  correlationId: correlationIdSchema,
  createdAt: timestampSchema,
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

/**
 * Cursor pagination, not offset — the opposite choice from `/v1/people`, for
 * the opposite reason. This collection is large and append-only, and an offset
 * into it shifts under the reader every time anything happens in the
 * organisation. A cursor is stable across writes; page 4 is not.
 */
export const listAuditEventsQuerySchema = strictQuery({
  ...cursorPaginationQuerySchema.shape,
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(100).optional(),
  resourceId: idSchema.optional(),
  actorMembershipId: idSchema.optional(),
  actorType: z.enum(ACTOR_TYPES).optional(),
  /** Inclusive lower bound, ISO 8601. */
  from: timestampSchema.optional(),
  /** Exclusive upper bound, so consecutive ranges neither overlap nor gap. */
  before: timestampSchema.optional(),
});

export type ListAuditEventsQuery = z.infer<typeof listAuditEventsQuerySchema>;

/**
 * A human sentence for an action key.
 *
 * Falls back to the key itself rather than to something like "Unknown action".
 * A reader who sees `budget.reallocated` learns what happened; a reader who
 * sees "Unknown action" learns only that this screen is out of date.
 */
export function describeAction(action: string): string {
  const [resource, verb] = action.split('.');
  if (resource === undefined || verb === undefined) return action;

  const subject = resource.replaceAll('_', ' ');
  const past = verb.replaceAll('_', ' ');

  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${past}`;
}
