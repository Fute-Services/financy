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

import { MEMBERSHIP_SCOPES, ROLE_KEYS } from './permissions.js';
import { emailSchema, idSchema, nonEmptyString, timestampSchema } from './primitives.js';
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
