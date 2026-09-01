/**
 * Authentication contracts (docs/10 §5.1).
 *
 * Two rules shape every schema here:
 *
 * 1. **`organizationId` is never accepted from the client.** It is resolved
 *    from the session's membership. There is no field for it in any request
 *    below — not an ignored one, not an optional one. A field that does not
 *    exist cannot be trusted by mistake.
 * 2. **Nothing that identifies an account leaks through a failure.** Login,
 *    password reset, and invitation lookup all answer the same way whether or
 *    not the subject exists, because the difference is itself the information
 *    an attacker wants (docs/12 §3).
 */

import { z } from 'zod';

import { emailSchema, idSchema, nonEmptyString, timestampSchema } from './primitives.js';
import { MEMBERSHIP_SCOPES, ROLE_KEYS } from './permissions.js';

/**
 * A password.
 *
 * Twelve characters minimum and **no composition rules** — no "must contain a
 * digit and a symbol". Those rules measurably reduce entropy in practice,
 * because people satisfy them with `Password1!` rather than with length
 * (docs/03 / OWASP). Length is what actually helps, and the breached-password
 * check does the rest server-side.
 *
 * The upper bound exists because argon2 hashes whatever it is given, and an
 * unbounded password is a CPU-exhaustion vector.
 */
export const passwordSchema = z
  .string()
  .min(12, { error: 'must be at least 12 characters' })
  .max(256, { error: 'must be at most 256 characters' });

export const registerRequestSchema = z.strictObject({
  organizationName: nonEmptyString(120),
  fullName: nonEmptyString(120),
  email: emailSchema,
  password: passwordSchema,
  /** ISO-4217. Locked once any financial record exists (`409 CURRENCY_LOCKED`). */
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { error: 'must be a three-letter ISO-4217 code' })
    .default('USD'),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, { error: 'must be a two-letter ISO-3166 code' })
    .default('US'),
});

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, { error: 'is required' }),
});

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: z.string().min(1, { error: 'is required' }),
  newPassword: passwordSchema,
});

export const switchOrganizationRequestSchema = z.strictObject({
  organizationId: idSchema,
});

/**
 * `POST /v1/auth/step-up` — re-prove the password on the session you already
 * hold (FR-AUTH-010, docs/12 §4).
 *
 * Not a second login: it issues no session and changes no cookie. It stamps
 * `steppedUpAt` on the current one, which routes marked `@RequireStepUp()`
 * check against `STEP_UP_WINDOW_MINUTES`.
 *
 * The reason it exists is the failure it prevents. A stolen session cookie is
 * enough to read everything the victim can read; without a step-up it would
 * also be enough to promote an attacker's own account to `ORG_ADMIN`, which
 * turns a session theft into a permanent tenancy takeover. Requiring the
 * password again puts a secret the cookie does not contain between the two.
 *
 * No email field: the session already says who is asking, and accepting one
 * would let a caller step up as somebody else if the pair happened to match.
 */
export const stepUpRequestSchema = z.strictObject({
  password: z.string().min(1, { error: 'is required' }),
});

export const stepUpResponseSchema = z.object({
  /** When the window closes. The UI counts down against it. */
  expiresAt: timestampSchema,
});

// ── Responses ─────────────────────────────────────────────────────────────

export const sessionUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  fullName: z.string(),
});

export const sessionOrganizationSchema = z.object({
  id: idSchema,
  slug: z.string(),
  name: z.string(),
  baseCurrency: z.string(),
});

export const sessionMembershipSchema = z.object({
  id: idSchema,
  roleKey: z.enum(ROLE_KEYS),
  roleName: z.string(),
  scope: z.enum(MEMBERSHIP_SCOPES),
  departmentId: idSchema.nullable(),
});

/**
 * `GET /v1/auth/session`.
 *
 * `permissions` is the **server-resolved** set for this membership, sent so
 * the browser can decide what to render. It is not an authorisation decision:
 * every endpoint re-checks independently, and the API tests prove each denial
 * without involving the frontend at all (docs/03 §7).
 */
export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  organization: sessionOrganizationSchema,
  membership: sessionMembershipSchema,
  permissions: z.array(z.string()),
  /** Every organisation this user belongs to, for the switcher. */
  organizations: z.array(
    z.object({ id: idSchema, slug: z.string(), name: z.string(), roleKey: z.enum(ROLE_KEYS) }),
  ),
  /** True while any provider is a mock or sandbox adapter (ADR-0014). */
  isSandbox: z.boolean(),
  expiresAt: timestampSchema,
});

export const activeSessionSchema = z.object({
  id: idSchema,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  lastSeenAt: timestampSchema,
  createdAt: timestampSchema,
  /** Distinguishes "this device" in a list of sessions. */
  isCurrent: z.boolean(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type SwitchOrganizationRequest = z.infer<typeof switchOrganizationRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ActiveSession = z.infer<typeof activeSessionSchema>;
export type StepUpRequest = z.infer<typeof stepUpRequestSchema>;
export type StepUpResponse = z.infer<typeof stepUpResponseSchema>;
