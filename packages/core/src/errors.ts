/**
 * The application error taxonomy.
 *
 * Every error the API can return has a **stable machine-readable code**. Those
 * codes are part of the public contract (docs/10-API-SPECIFICATION.md §6):
 * clients branch on them, tests assert on them, and support quotes them. They
 * are never renamed — a new meaning gets a new code.
 *
 * `message` is for humans and may change. `code` is for machines and may not.
 */

export type ErrorCode =
  // 401
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'MFA_REQUIRED'
  // 403
  | 'FORBIDDEN'
  | 'STEP_UP_REQUIRED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'SELF_ELEVATION_FORBIDDEN'
  | 'AUDITOR_READ_ONLY'
  | 'TENANT_MISMATCH'
  // 404
  | 'RESOURCE_NOT_FOUND'
  // 409
  | 'INVALID_STATE_TRANSITION'
  | 'POSTED_RECORD_IMMUTABLE'
  | 'STALE_VERSION'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'REQUEST_IN_PROGRESS'
  | 'STEP_NOT_ACTIONABLE'
  | 'EXPENSE_ALREADY_REIMBURSED'
  | 'BUDGET_EXCEEDED'
  | 'LAST_ADMIN'
  | 'CURRENCY_LOCKED'
  | 'MEMBERSHIP_EXISTS'
  | 'POLICY_BLOCKED'
  | 'CYCLIC_HIERARCHY'
  // 422
  | 'VALIDATION_FAILED'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_FILE'
  | 'UNRESOLVABLE_APPROVER'
  // 429
  | 'RATE_LIMITED'
  // 500 / 502 / 504
  | 'INTERNAL_ERROR'
  | 'POLICY_EVALUATION_FAILED'
  | 'TENANT_CONTEXT_MISSING'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT';

export interface AppErrorOptions {
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
  readonly correlationId?: string;
}

/** Base class for every error that is safe to surface to a caller. */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;

  readonly details: Record<string, unknown> | undefined;
  readonly correlationId: string | undefined;

  /**
   * Whether the client may safely retry the identical request.
   * Drives both client behaviour and job retry classification.
   */
  readonly retryable: boolean = false;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.details = options.details;
    this.correlationId = options.correlationId;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
    };
  }
}

// ── 401 ──────────────────────────────────────────────────────────────────

export class UnauthenticatedError extends AppError {
  readonly code: ErrorCode = 'UNAUTHENTICATED';
  readonly httpStatus = 401;
  constructor(message = 'Authentication is required.', options?: AppErrorOptions) {
    super(message, options);
  }
}

export class SessionExpiredError extends UnauthenticatedError {
  override readonly code: ErrorCode = 'SESSION_EXPIRED';
  constructor(options?: AppErrorOptions) {
    super('Your session has expired. Please sign in again.', options);
  }
}

export class MfaRequiredError extends UnauthenticatedError {
  override readonly code: ErrorCode = 'MFA_REQUIRED';
  constructor(options?: AppErrorOptions) {
    super('A second authentication factor is required.', options);
  }
}

// ── 403 ──────────────────────────────────────────────────────────────────

export class ForbiddenError extends AppError {
  readonly code: ErrorCode = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(
    message = 'You do not have permission to perform this action.',
    options?: AppErrorOptions,
  ) {
    super(message, options);
  }
}

export class StepUpRequiredError extends ForbiddenError {
  override readonly code: ErrorCode = 'STEP_UP_REQUIRED';
  constructor(options?: AppErrorOptions) {
    super('Please re-enter your password to confirm this action.', options);
  }
}

/** INV-02 — a user may never approve their own request, including via delegation. */
export class SelfApprovalForbiddenError extends ForbiddenError {
  override readonly code: ErrorCode = 'SELF_APPROVAL_FORBIDDEN';
  constructor(options?: AppErrorOptions) {
    super('You cannot approve your own request.', options);
  }
}

/** INV-03 — a user may never grant themselves a permission or elevate their own role. */
export class SelfElevationForbiddenError extends ForbiddenError {
  override readonly code: ErrorCode = 'SELF_ELEVATION_FORBIDDEN';
  constructor(options?: AppErrorOptions) {
    super('You cannot change your own role or permissions.', options);
  }
}

/** INV-05 — auditors are read-only, enforced independently of the permission check. */
export class AuditorReadOnlyError extends ForbiddenError {
  override readonly code: ErrorCode = 'AUDITOR_READ_ONLY';
  constructor(options?: AppErrorOptions) {
    super('Auditor access is read-only.', options);
  }
}

/**
 * A client supplied an organisation id that disagrees with the session's.
 * This is either a bug worth finding or an attack worth knowing about, so it
 * is distinct from a generic 403 and always writes a security event.
 */
export class TenantMismatchError extends ForbiddenError {
  override readonly code: ErrorCode = 'TENANT_MISMATCH';
  constructor(options?: AppErrorOptions) {
    super('The request organisation does not match the authenticated session.', options);
  }
}

// ── 404 ──────────────────────────────────────────────────────────────────

/**
 * Also returned for cross-tenant access.
 *
 * A 403 would confirm the record exists, which leaks across a tenant boundary.
 * See docs/12-SECURITY-MODEL.md §5.
 */
export class NotFoundError extends AppError {
  readonly code: ErrorCode = 'RESOURCE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(resource = 'Resource', options?: AppErrorOptions) {
    super(`${resource} not found.`, options);
  }
}

// ── 409 ──────────────────────────────────────────────────────────────────

export class ConflictError extends AppError {
  readonly code: ErrorCode = 'INVALID_STATE_TRANSITION';
  readonly httpStatus = 409;
}

export class InvalidStateTransitionError extends ConflictError {
  override readonly code: ErrorCode = 'INVALID_STATE_TRANSITION';
  constructor(entity: string, from: string, to: string, options?: AppErrorOptions) {
    super(`${entity} cannot move from ${from} to ${to}.`, {
      ...options,
      details: { ...options?.details, entity, currentState: from, attemptedState: to },
    });
  }
}

export class PostedRecordImmutableError extends ConflictError {
  override readonly code: ErrorCode = 'POSTED_RECORD_IMMUTABLE';
  constructor(entity: string, options?: AppErrorOptions) {
    super(
      `${entity} has been posted and its financial values cannot be changed. Create an adjustment instead.`,
      options,
    );
  }
}

export class StaleVersionError extends ConflictError {
  override readonly code: ErrorCode = 'STALE_VERSION';
  constructor(entity: string, expected: number, actual: number, options?: AppErrorOptions) {
    super(`${entity} has changed since you loaded it.`, {
      ...options,
      details: { ...options?.details, expectedVersion: expected, currentVersion: actual },
    });
  }
}

export class IdempotencyKeyReusedError extends ConflictError {
  override readonly code: ErrorCode = 'IDEMPOTENCY_KEY_REUSED';
  constructor(options?: AppErrorOptions) {
    super('This idempotency key was already used with a different request body.', options);
  }
}

export class RequestInProgressError extends ConflictError {
  override readonly code: ErrorCode = 'REQUEST_IN_PROGRESS';
  override readonly retryable = true;
  constructor(options?: AppErrorOptions) {
    super('A request with this idempotency key is still being processed.', options);
  }
}

export class StepNotActionableError extends ConflictError {
  override readonly code: ErrorCode = 'STEP_NOT_ACTIONABLE';
  constructor(options?: AppErrorOptions) {
    super('This approval step is no longer awaiting a decision.', options);
  }
}

export class ExpenseAlreadyReimbursedError extends ConflictError {
  override readonly code: ErrorCode = 'EXPENSE_ALREADY_REIMBURSED';
  constructor(reference?: string, options?: AppErrorOptions) {
    super(
      reference
        ? `This expense was already included in reimbursement ${reference}.`
        : 'This expense has already been reimbursed.',
      options,
    );
  }
}

export class BudgetExceededError extends ConflictError {
  override readonly code: ErrorCode = 'BUDGET_EXCEEDED';
  constructor(options?: AppErrorOptions) {
    super('This spend would exceed the budget, which is configured to block.', options);
  }
}

export class LastAdminError extends ConflictError {
  override readonly code: ErrorCode = 'LAST_ADMIN';
  constructor(options?: AppErrorOptions) {
    super(
      'This is the last organisation administrator and cannot be removed or demoted. Promote another member first.',
      options,
    );
  }
}

export class CurrencyLockedError extends ConflictError {
  override readonly code: ErrorCode = 'CURRENCY_LOCKED';
  constructor(options?: AppErrorOptions) {
    super('The base currency cannot be changed once financial records exist.', options);
  }
}

export class MembershipExistsError extends ConflictError {
  override readonly code: ErrorCode = 'MEMBERSHIP_EXISTS';
  constructor(options?: AppErrorOptions) {
    super('That person is already a member of this organisation.', options);
  }
}

export class PolicyBlockedError extends ConflictError {
  override readonly code: ErrorCode = 'POLICY_BLOCKED';
  constructor(
    reasons: ReadonlyArray<{ reasonCode: string; message: string }>,
    options?: AppErrorOptions,
  ) {
    super(reasons[0]?.message ?? 'This spend is not permitted by policy.', {
      ...options,
      details: { ...options?.details, blocks: reasons },
    });
  }
}

export class CyclicHierarchyError extends ConflictError {
  override readonly code: ErrorCode = 'CYCLIC_HIERARCHY';
  constructor(entity: string, options?: AppErrorOptions) {
    super(`That change would create a cycle in the ${entity} hierarchy.`, options);
  }
}

// ── 422 ──────────────────────────────────────────────────────────────────

export type FieldErrors = Record<string, string[]>;

export class ValidationError extends AppError {
  readonly code: ErrorCode = 'VALIDATION_FAILED';
  readonly httpStatus = 422;
  constructor(fields: FieldErrors, options?: AppErrorOptions) {
    super('The request could not be processed.', {
      ...options,
      details: { ...options?.details, fields },
    });
  }
}

/**
 * The client's header amount disagreed with the server's computation from the
 * line items. The server value always wins; this reports the disagreement.
 * See ADR-0013 and FR-SPD-006.
 */
export class AmountMismatchError extends AppError {
  readonly code: ErrorCode = 'AMOUNT_MISMATCH';
  readonly httpStatus = 422;
  constructor(expected: string, received: string, options?: AppErrorOptions) {
    super('The submitted total does not match the sum of the line items.', {
      ...options,
      details: { ...options?.details, serverComputed: expected, received },
    });
  }
}

export class InvalidFileError extends AppError {
  readonly code: ErrorCode = 'INVALID_FILE';
  readonly httpStatus = 422;
  constructor(reason: string, options?: AppErrorOptions) {
    super(reason, options);
  }
}

/**
 * No eligible approver could be resolved, even after the fallback ladder.
 *
 * This is a hard failure by design. Silently auto-approving when no approver
 * can be found would be the worst possible default in a spend control system.
 */
export class UnresolvableApproverError extends AppError {
  readonly code: ErrorCode = 'UNRESOLVABLE_APPROVER';
  readonly httpStatus = 422;
  constructor(options?: AppErrorOptions) {
    super(
      'No eligible approver could be found for this request. An administrator needs to review the approval configuration.',
      options,
    );
  }
}

// ── 429 ──────────────────────────────────────────────────────────────────

export class RateLimitError extends AppError {
  readonly code: ErrorCode = 'RATE_LIMITED';
  readonly httpStatus = 429;
  override readonly retryable = true;
  constructor(
    public readonly retryAfterSeconds: number,
    options?: AppErrorOptions,
  ) {
    super('Too many requests. Please try again shortly.', {
      ...options,
      details: { ...options?.details, retryAfterSeconds },
    });
  }
}

// ── 5xx ──────────────────────────────────────────────────────────────────

export class InternalError extends AppError {
  readonly code: ErrorCode = 'INTERNAL_ERROR';
  readonly httpStatus = 500;
  constructor(options?: AppErrorOptions) {
    // Deliberately generic: internals never reach the client. The correlation
    // id is the handle for anyone investigating.
    super('Something went wrong. Please try again.', options);
  }
}

/**
 * Policy evaluation threw.
 *
 * The request is **blocked**, not allowed. Failing open in a spend control
 * system is not an acceptable degradation. See docs/11 §10.
 */
export class PolicyEvaluationFailedError extends AppError {
  readonly code: ErrorCode = 'POLICY_EVALUATION_FAILED';
  readonly httpStatus = 500;
  constructor(options?: AppErrorOptions) {
    super('Spending policy could not be evaluated, so this request was not submitted.', options);
  }
}

/**
 * A repository was reached without a tenant context.
 *
 * Always a bug, and always fail-closed: the alternative is a query with no
 * organisation predicate. Any occurrence pages on-call.
 */
export class TenantContextMissingError extends AppError {
  readonly code: ErrorCode = 'TENANT_CONTEXT_MISSING';
  readonly httpStatus = 500;
  constructor(model: string, operation: string, options?: AppErrorOptions) {
    super(`No tenant context for ${operation} on ${model}.`, {
      ...options,
      details: { ...options?.details, model, operation },
    });
  }
}

export class ProviderError extends AppError {
  readonly code: ErrorCode = 'PROVIDER_ERROR';
  // Annotated as `number` rather than inferred as the literal `502`, so that
  // ProviderTimeoutError can widen it to 504.
  readonly httpStatus: number = 502;
  override readonly retryable = true;
  constructor(provider: string, operation: string, options?: AppErrorOptions) {
    super(`The ${provider} service could not complete ${operation}.`, {
      ...options,
      details: { ...options?.details, provider, operation },
    });
  }
}

export class ProviderTimeoutError extends ProviderError {
  override readonly code: ErrorCode = 'PROVIDER_TIMEOUT';
  override readonly httpStatus = 504;
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Whether a failed operation may safely be retried with the identical input. */
export function isRetryable(error: unknown): boolean {
  return isAppError(error) ? error.retryable : false;
}
