/**
 * The wire form of the error taxonomy.
 *
 * `@financy/core` owns the taxonomy as classes the domain throws;
 * this module owns its HTTP projection: the status each code maps to and the
 * envelope the client receives. Keeping the mapping here rather than inside
 * the exception filter means the frontend can import it too, so a client can
 * branch on a code without hard-coding a status it inferred from a response.
 */

import type { ErrorCode } from '@financy/core';
import { z } from 'zod';

import { correlationIdSchema } from './primitives.js';

/**
 * Every error code and the status it produces.
 *
 * Typed as `Record<ErrorCode, number>`, so adding a code to the taxonomy in
 * `@financy/core` without mapping it here is a compile error rather than a
 * runtime `500`. That is the whole point of writing the map out longhand.
 */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = {
  // 401 — who are you?
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  MFA_REQUIRED: 401,

  // 403 — we know who you are, and no.
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  SELF_APPROVAL_FORBIDDEN: 403,
  SELF_ELEVATION_FORBIDDEN: 403,
  AUDITOR_READ_ONLY: 403,
  TENANT_MISMATCH: 403,

  // 404 — including every cross-tenant read. See docs/10 §6.
  RESOURCE_NOT_FOUND: 404,

  // 409 — the request is well-formed but conflicts with current state.
  INVALID_STATE_TRANSITION: 409,
  POSTED_RECORD_IMMUTABLE: 409,
  STALE_VERSION: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_IN_PROGRESS: 409,
  STEP_NOT_ACTIONABLE: 409,
  EXPENSE_ALREADY_REIMBURSED: 409,
  BUDGET_EXCEEDED: 409,
  LAST_ADMIN: 409,
  CURRENCY_LOCKED: 409,
  MEMBERSHIP_EXISTS: 409,
  POLICY_BLOCKED: 409,
  CYCLIC_HIERARCHY: 409,

  // 422 — the request is understood and unprocessable.
  VALIDATION_FAILED: 422,
  AMOUNT_MISMATCH: 422,
  CURRENCY_MISMATCH: 422,
  INVALID_FILE: 422,
  UNRESOLVABLE_APPROVER: 422,

  // 429
  RATE_LIMITED: 429,

  // 5xx — ours, not the caller's.
  INTERNAL_ERROR: 500,
  POLICY_EVALUATION_FAILED: 500,
  TENANT_CONTEXT_MISSING: 500,
  PROVIDER_ERROR: 502,
  PROVIDER_TIMEOUT: 504,
};

/** The complete code list, derived from the map so the two cannot diverge. */
export const ERROR_CODES = Object.keys(HTTP_STATUS_BY_ERROR_CODE) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(ERROR_CODES);

export function httpStatusForErrorCode(code: ErrorCode): number {
  return HTTP_STATUS_BY_ERROR_CODE[code];
}

/**
 * A field-keyed validation map: `{ "amount": ["must be greater than 0"] }`.
 *
 * Keyed by field rather than returned as a flat list so a form can attach each
 * message to the input that caused it.
 */
export const fieldErrorsSchema = z.record(z.string(), z.array(z.string()));

export const errorBodySchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  correlationId: correlationIdSchema,
});

/** The single error envelope. Every non-2xx response has exactly this shape. */
export const errorResponseSchema = z.object({ error: errorBodySchema });

export type FieldErrors = z.infer<typeof fieldErrorsSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Turn a Zod failure into the `details.fields` map the API returns.
 *
 * Nested paths are dotted (`items.0.amount`) so the client can address an
 * array element, and a top-level error — a failed cross-field refinement, for
 * instance — is keyed `_` rather than being dropped.
 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }

  return fields;
}
