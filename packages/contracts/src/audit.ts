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

// ═══════════════════════════════════════════════════════════════════════════
//  Security events (docs/10 §5.5, task 1.6.3)
//
//  A separate collection and a separate endpoint, because the questions
//  differ. The audit trail answers "who changed this record"; this answers
//  "is someone attacking us". A failed login has no resource and no
//  before/after, and forcing it into the audit shape would make both harder
//  to query and neither easier to read (docs/12 §7).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mirrors the `SecurityEventType` enum in the schema. A test in `@financy/db`,
 * which may import both, asserts the lists match.
 */
export const SECURITY_EVENT_TYPES = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'MFA_ENROLLED',
  'MFA_CHALLENGE_FAILED',
  'SESSION_REVOKED',
  'ROLE_CHANGED',
  'MEMBERSHIP_DEACTIVATED',
  'TENANT_MISMATCH_ATTEMPTED',
  'STEP_UP_FAILED',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const SECURITY_EVENT_LABELS: Readonly<Record<SecurityEventType, string>> = {
  LOGIN_SUCCEEDED: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in',
  ACCOUNT_LOCKED: 'Account locked',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_RESET_COMPLETED: 'Password reset completed',
  MFA_ENROLLED: 'Second factor enrolled',
  MFA_CHALLENGE_FAILED: 'Second factor failed',
  SESSION_REVOKED: 'Session revoked',
  ROLE_CHANGED: 'Role changed',
  MEMBERSHIP_DEACTIVATED: 'Member deactivated',
  TENANT_MISMATCH_ATTEMPTED: 'Cross-organisation access attempted',
  STEP_UP_FAILED: 'Re-authentication failed',
};

/**
 * The types worth surfacing on their own, because each is a signal rather
 * than routine traffic.
 *
 * `LOGIN_SUCCEEDED` is deliberately absent: in a healthy organisation it is
 * most of the collection, and a "concerning events" filter that is 95%
 * successful logins is a filter nobody uses twice.
 */
export const NOTABLE_SECURITY_EVENT_TYPES: readonly SecurityEventType[] = [
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'MFA_CHALLENGE_FAILED',
  'STEP_UP_FAILED',
  'TENANT_MISMATCH_ATTEMPTED',
  'ROLE_CHANGED',
  'MEMBERSHIP_DEACTIVATED',
  'SESSION_REVOKED',
];

export const securityEventSchema = z.object({
  id: idSchema,
  type: z.enum(SECURITY_EVENT_TYPES),
  /** Both nullable: a failed login for an unknown address has neither. */
  userId: idSchema.nullable(),
  membershipId: idSchema.nullable(),
  /**
   * Resolved at read time rather than denormalised, unlike the audit trail's
   * `actorLabel`. The difference is what each is for: the audit trail is
   * evidence and must read the same in five years, while this is an operator
   * looking at what is happening *now* and wanting the current name.
   */
  actorLabel: z.string().max(200).nullable(),
  ipAddress: z.string().max(45).nullable(),
  userAgent: z.string().max(500).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  correlationId: correlationIdSchema,
  createdAt: timestampSchema,
});

export type SecurityEvent = z.infer<typeof securityEventSchema>;

export const listSecurityEventsQuerySchema = strictQuery({
  ...cursorPaginationQuerySchema.shape,
  type: z.enum(SECURITY_EVENT_TYPES).optional(),
  userId: idSchema.optional(),
  membershipId: idSchema.optional(),
  /** Only the types in `NOTABLE_SECURITY_EVENT_TYPES`. */
  notableOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  from: timestampSchema.optional(),
  before: timestampSchema.optional(),
});

export type ListSecurityEventsQuery = z.infer<typeof listSecurityEventsQuerySchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Export (task 1.6.2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `GET /v1/audit-events/export`.
 *
 * The same filters as the list, minus pagination — an export that paged would
 * not be an export. `limit` is capped hard rather than left open: an
 * unbounded export against a remote database is a way to take the API down
 * from an authenticated session, and a caller who genuinely needs more can
 * ask for a date range and repeat.
 */
export const exportAuditEventsQuerySchema = strictQuery({
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(100).optional(),
  resourceId: idSchema.optional(),
  actorMembershipId: idSchema.optional(),
  actorType: z.enum(ACTOR_TYPES).optional(),
  from: timestampSchema.optional(),
  before: timestampSchema.optional(),
  format: z.enum(['csv', 'json']).default('csv'),
});

export type ExportAuditEventsQuery = z.infer<typeof exportAuditEventsQuerySchema>;

/** The hard ceiling on one export. See `exportAuditEventsQuerySchema`. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

/**
 * The CSV column order, shared by the server that writes it and any test that
 * reads it back. A header nobody agrees on is a file that opens wrong.
 */
export const AUDIT_EXPORT_COLUMNS = [
  'createdAt',
  'action',
  'resourceType',
  'resourceId',
  'actorType',
  'actorLabel',
  'actorMembershipId',
  'ipAddress',
  'correlationId',
] as const;
