/**
 * `/v1/people` — the organisation's members (docs/10 §5.3).
 *
 * "People" rather than "users" throughout, and the distinction is not
 * cosmetic. A `User` is an account, and one account can belong to several
 * organisations; a `Membership` is that account's presence in *this*
 * organisation, carrying the role, the department, and the scope. Everything
 * this endpoint returns is a property of the membership, not of the account —
 * which is why the id in the payload is the membership id, and why deactivating
 * someone here does not touch their ability to sign in elsewhere.
 */

import { z } from 'zod';

import { passwordSchema } from './auth.js';
import { MEMBERSHIP_SCOPES, ROLE_KEYS } from './permissions.js';
import {
  emailSchema,
  idSchema,
  nonEmptyString,
  timestampSchema,
  versionSchema,
} from './primitives.js';
import { strictQuery } from './filters.js';
import { offsetPaginationQuerySchema } from './pagination.js';

/**
 * Mirrors the `MembershipStatus` enum in the schema.
 *
 * Repeated here rather than imported from Prisma, because this package is
 * compiled into the browser and must not depend on the database client. A test
 * in `@financy/db` — which may import both — asserts the two lists match, so
 * drift is a failing build rather than a runtime surprise.
 *
 * Two states, not four. "Invited" is a row in `invitations`, not a membership
 * that half exists, and "suspended" is a policy decision nobody has made yet;
 * inventing either here would put a value in the contract that the database
 * cannot store.
 */
export const MEMBERSHIP_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const STATUS_LABELS: Readonly<Record<MembershipStatus, string>> = {
  ACTIVE: 'Active',
  INACTIVE: 'Deactivated',
};

/** What a member can see. Keys come from the shared catalogue. */
export const SCOPE_LABELS: Readonly<Record<(typeof MEMBERSHIP_SCOPES)[number], string>> = {
  SELF: 'Own records only',
  DEPARTMENT: 'Their department',
  ENTITY: 'Assigned entities',
  ORGANISATION: 'The whole organisation',
};

export const personSchema = z.object({
  /** The **membership** id. See the note at the top of this file. */
  id: idSchema,
  userId: idSchema,
  email: emailSchema,
  fullName: nonEmptyString(200),
  role: z.object({
    key: z.enum(ROLE_KEYS),
    name: nonEmptyString(100),
  }),
  department: z
    .object({
      id: idSchema,
      name: nonEmptyString(200),
      code: z.string().max(50).nullable(),
    })
    .nullable(),
  scope: z.enum(MEMBERSHIP_SCOPES),
  status: z.enum(MEMBERSHIP_STATUSES),
  /**
   * `null` until they first sign in. Distinguishing "added but never arrived"
   * from "arrived and went quiet" is the whole reason this is on the list
   * rather than buried on a detail screen.
   */
  lastLoginAt: timestampSchema.nullable(),
  joinedAt: timestampSchema,
  /**
   * Sent straight back as `If-Match` on a write against this membership.
   *
   * On the list rather than only on the detail, because the people screen
   * offers a role change and a deactivation from the row: without it, every
   * action would need a detail fetch first, which is one request per row for
   * a field the list query already reads.
   */
  version: versionSchema,
});

export type Person = z.infer<typeof personSchema>;

/**
 * Offset pagination, not cursor.
 *
 * People lists are small, sorted by name, and what a user does with them is
 * jump to page four — which a cursor cannot express. Cursor pagination is for
 * collections that are large and append-heavy, which this is not; the audit
 * trail is, and uses one.
 */
export const listPeopleQuerySchema = strictQuery({
  ...offsetPaginationQuerySchema.shape,
  /** Matches name or email. Trimmed, because a trailing space finds nothing. */
  q: z.string().trim().max(200).optional(),
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  roleKey: z.enum(ROLE_KEYS).optional(),
  departmentId: idSchema.optional(),
});

export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Writes (docs/10 §5.3, tasks 1.5.5 and 1.5.7)
//
//  The role is **not** in `updateMembershipSchema`. It has its own endpoint
//  because it is the one field whose change is a privilege decision rather
//  than a data correction: it needs step-up re-authentication, it must refuse
//  self-elevation (INV-03) and the demotion of the last administrator
//  (INV-04), and it writes a security event as well as an audit event
//  (INV-08). Folding it into the general PATCH would make every one of those
//  a conditional inside a handler that mostly does something else.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `PATCH /v1/memberships/{id}` — department, manager, and scope.
 *
 * `status` is absent: deactivation revokes sessions and has its own endpoint,
 * and a PATCH that could set `INACTIVE` would be a way to sign someone out
 * without the audit trail saying that is what happened.
 */
export const updateMembershipSchema = z
  .strictObject({
    departmentId: idSchema.nullable().optional(),
    /** `null` clears the reporting line. Cycles are refused by the service. */
    managerMembershipId: idSchema.nullable().optional(),
    scope: z.enum(MEMBERSHIP_SCOPES).optional(),
    /**
     * Which entities this membership may see, when `scope` is `ENTITY`.
     *
     * PostgreSQL required at least one via a CHECK; the service does now. An
     * `ENTITY`-scoped membership with an empty list can see nothing at all,
     * which reads to the person as a broken account rather than as a
     * deliberate restriction.
     */
    entityScope: z.array(idSchema).max(50).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * `POST /v1/memberships/{id}/role`.
 *
 * A reason is mandatory and is not decoration: a role change is the single
 * most consequential thing an administrator can do to another person's
 * account, and six months later "why does this person have finance access"
 * is a question the audit log should be able to answer without asking anyone.
 */
export const changeRoleSchema = z.strictObject({
  roleKey: z.enum(ROLE_KEYS),
  reason: nonEmptyString(500),
});

/** `POST /v1/memberships/{id}/deactivate`. */
export const deactivateMembershipSchema = z.strictObject({
  reason: nonEmptyString(500),
});

/**
 * One membership in full, as the detail screen and every write return it.
 *
 * `permissions` is resolved from the role rather than stored, so the list a
 * reader sees is the list the guard will enforce — a cached copy would drift
 * the moment the catalogue changed.
 */
export const membershipDetailSchema = personSchema.extend({
  managerMembershipId: idSchema.nullable(),
  entityScope: z.array(idSchema),
  permissions: z.array(z.string()),
});

export type UpdateMembership = z.infer<typeof updateMembershipSchema>;
export type ChangeRole = z.infer<typeof changeRoleSchema>;
export type DeactivateMembership = z.infer<typeof deactivateMembershipSchema>;
export type MembershipDetail = z.infer<typeof membershipDetailSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Invitations (docs/10 §5.1 and §5.3, task 1.5.6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `POST /v1/memberships/invitations`.
 *
 * The role is chosen at invite time rather than after acceptance, so the
 * person arrives with the access they were meant to have. Inviting somebody
 * and then promoting them is two audit events describing one intent, and the
 * window between them is a real account with the wrong permissions.
 */
export const createInvitationSchema = z.strictObject({
  email: emailSchema,
  roleKey: z.enum(ROLE_KEYS),
  departmentId: idSchema.nullable().optional(),
});

/**
 * The invitation as an administrator sees it.
 *
 * No token. The plaintext exists once, in the create and resend responses,
 * and is never readable again — the stored form is a hash, so a leaked
 * listing cannot be used to join an organisation.
 */
export const invitationSchema = z.object({
  id: idSchema,
  email: emailSchema,
  roleKey: z.enum(ROLE_KEYS),
  departmentId: idSchema.nullable(),
  invitedByMembershipId: idSchema,
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  resentCount: z.int().min(0),
  createdAt: timestampSchema,
  /** Derived, so a client does not re-implement the expiry comparison. */
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
});

/**
 * What creating or resending returns.
 *
 * The **token travels in the response**, once, and this is a deliberate
 * decision rather than a placeholder for an email. The inviter is already
 * authorised to invite this person; handing them a link to pass on is how
 * every "copy invite link" flow works, and it means an invitation is not
 * silently dead when mail delivery fails — which it does, to exactly the
 * corporate mail filters this product's customers run.
 *
 * When the mailer lands (Phase 2) it sends the same link. It does not become
 * the only way to obtain one.
 */
export const issuedInvitationSchema = z.object({
  invitation: invitationSchema,
  /** Single-use, expiring, and never recoverable from the stored hash. */
  token: nonEmptyString(200),
});

/** `GET /v1/auth/invitations/{token}` — the acceptance screen's preflight. */
export const invitationPreviewSchema = z.object({
  organizationName: nonEmptyString(200),
  email: emailSchema,
  roleKey: z.enum(ROLE_KEYS),
  /** Whether the invitee already has an account, so the form knows what to ask. */
  requiresPassword: z.boolean(),
  expiresAt: timestampSchema,
});

/**
 * `POST /v1/auth/invitations/accept`.
 *
 * `password` is required only for a new account and refused for an existing
 * one: accepting an invitation must never be a way to set the password of an
 * account somebody else controls. The service enforces the pairing, because
 * only it knows whether the address already has an account — and the preview
 * endpoint says which case it is without revealing anything the token holder
 * does not already know.
 */
export const acceptInvitationSchema = z.strictObject({
  token: nonEmptyString(200),
  fullName: nonEmptyString(120).optional(),
  password: passwordSchema.optional(),
});

export type CreateInvitation = z.infer<typeof createInvitationSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type IssuedInvitation = z.infer<typeof issuedInvitationSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;

/** How long an invitation stays usable. Long enough to survive a weekend. */
export const INVITATION_TTL_HOURS = 72;

/** Resends per invitation per day (docs/10 §5.3). */
export const INVITATION_RESEND_LIMIT_PER_DAY = 3;
