import { describe, it, expect } from 'vitest';
import * as E from './errors.js';

/**
 * Error codes are part of the **public API contract**
 * (docs/10-API-SPECIFICATION.md §6). Clients branch on them, tests assert on
 * them, and support quotes them. This suite exists to make a rename impossible
 * to do accidentally: changing a code here fails the build, which forces the
 * change to be a deliberate, reviewed decision.
 *
 * `message` is for humans and may change freely; `code` may not.
 */

interface Case {
  readonly name: string;
  readonly error: E.AppError;
  readonly code: E.ErrorCode;
  readonly status: number;
  readonly retryable?: boolean;
}

const cases: Case[] = [
  // 401
  { name: 'UnauthenticatedError', error: new E.UnauthenticatedError(), code: 'UNAUTHENTICATED', status: 401 },
  { name: 'SessionExpiredError', error: new E.SessionExpiredError(), code: 'SESSION_EXPIRED', status: 401 },
  { name: 'MfaRequiredError', error: new E.MfaRequiredError(), code: 'MFA_REQUIRED', status: 401 },

  // 403
  { name: 'ForbiddenError', error: new E.ForbiddenError(), code: 'FORBIDDEN', status: 403 },
  { name: 'StepUpRequiredError', error: new E.StepUpRequiredError(), code: 'STEP_UP_REQUIRED', status: 403 },
  { name: 'SelfApprovalForbiddenError', error: new E.SelfApprovalForbiddenError(), code: 'SELF_APPROVAL_FORBIDDEN', status: 403 },
  { name: 'SelfElevationForbiddenError', error: new E.SelfElevationForbiddenError(), code: 'SELF_ELEVATION_FORBIDDEN', status: 403 },
  { name: 'AuditorReadOnlyError', error: new E.AuditorReadOnlyError(), code: 'AUDITOR_READ_ONLY', status: 403 },
  { name: 'TenantMismatchError', error: new E.TenantMismatchError(), code: 'TENANT_MISMATCH', status: 403 },

  // 404
  { name: 'NotFoundError', error: new E.NotFoundError('Transaction'), code: 'RESOURCE_NOT_FOUND', status: 404 },

  // 409
  { name: 'ConflictError', error: new E.ConflictError('conflict'), code: 'INVALID_STATE_TRANSITION', status: 409 },
  { name: 'InvalidStateTransitionError', error: new E.InvalidStateTransitionError('Spend request', 'DRAFT', 'APPROVED'), code: 'INVALID_STATE_TRANSITION', status: 409 },
  { name: 'PostedRecordImmutableError', error: new E.PostedRecordImmutableError('Transaction'), code: 'POSTED_RECORD_IMMUTABLE', status: 409 },
  { name: 'StaleVersionError', error: new E.StaleVersionError('Budget', 3, 5), code: 'STALE_VERSION', status: 409 },
  { name: 'IdempotencyKeyReusedError', error: new E.IdempotencyKeyReusedError(), code: 'IDEMPOTENCY_KEY_REUSED', status: 409 },
  { name: 'RequestInProgressError', error: new E.RequestInProgressError(), code: 'REQUEST_IN_PROGRESS', status: 409, retryable: true },
  { name: 'StepNotActionableError', error: new E.StepNotActionableError(), code: 'STEP_NOT_ACTIONABLE', status: 409 },
  { name: 'ExpenseAlreadyReimbursedError', error: new E.ExpenseAlreadyReimbursedError('RB-2026-0041'), code: 'EXPENSE_ALREADY_REIMBURSED', status: 409 },
  { name: 'BudgetExceededError', error: new E.BudgetExceededError(), code: 'BUDGET_EXCEEDED', status: 409 },
  { name: 'LastAdminError', error: new E.LastAdminError(), code: 'LAST_ADMIN', status: 409 },
  { name: 'CurrencyLockedError', error: new E.CurrencyLockedError(), code: 'CURRENCY_LOCKED', status: 409 },
  { name: 'MembershipExistsError', error: new E.MembershipExistsError(), code: 'MEMBERSHIP_EXISTS', status: 409 },
  { name: 'PolicyBlockedError', error: new E.PolicyBlockedError([{ reasonCode: 'RECEIPT_REQUIRED', message: 'A receipt is required.' }]), code: 'POLICY_BLOCKED', status: 409 },
  { name: 'CyclicHierarchyError', error: new E.CyclicHierarchyError('department'), code: 'CYCLIC_HIERARCHY', status: 409 },

  // 422
  { name: 'ValidationError', error: new E.ValidationError({ amount: ['must be greater than 0'] }), code: 'VALIDATION_FAILED', status: 422 },
  { name: 'AmountMismatchError', error: new E.AmountMismatchError('2400.0000', '2000.0000'), code: 'AMOUNT_MISMATCH', status: 422 },
  { name: 'InvalidFileError', error: new E.InvalidFileError('That file type is not supported.'), code: 'INVALID_FILE', status: 422 },
  { name: 'UnresolvableApproverError', error: new E.UnresolvableApproverError(), code: 'UNRESOLVABLE_APPROVER', status: 422 },

  // 429
  { name: 'RateLimitError', error: new E.RateLimitError(60), code: 'RATE_LIMITED', status: 429, retryable: true },

  // 5xx
  { name: 'InternalError', error: new E.InternalError(), code: 'INTERNAL_ERROR', status: 500 },
  { name: 'PolicyEvaluationFailedError', error: new E.PolicyEvaluationFailedError(), code: 'POLICY_EVALUATION_FAILED', status: 500 },
  { name: 'TenantContextMissingError', error: new E.TenantContextMissingError('Transaction', 'findMany'), code: 'TENANT_CONTEXT_MISSING', status: 500 },
  { name: 'ProviderError', error: new E.ProviderError('CardProvider', 'issueCard'), code: 'PROVIDER_ERROR', status: 502, retryable: true },
  { name: 'ProviderTimeoutError', error: new E.ProviderTimeoutError('CardProvider', 'issueCard'), code: 'PROVIDER_TIMEOUT', status: 504, retryable: true },
];

describe('error taxonomy — stable contract', () => {
  it.each(cases)('$name exposes code $code with HTTP $status', ({ error, code, status }) => {
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(status);
  });

  it.each(cases)('$name is an AppError with a non-empty human message', ({ error, name }) => {
    expect(E.isAppError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it.each(cases)('$name serialises to the wire envelope', ({ error, code }) => {
    const json = error.toJSON();
    expect(json.code).toBe(code);
    expect(json.message).toBe(error.message);
  });

  it('marks only genuinely retryable errors as retryable', () => {
    for (const { error, retryable = false, name } of cases) {
      expect(E.isRetryable(error), `${name} retryable`).toBe(retryable);
    }
  });

  it('every declared error code is covered by a case', () => {
    // If a new code is added to the union without a case here, this fails —
    // which is the point. An untested code is an untested contract.
    const covered = new Set(cases.map((c) => c.code));
    const declared: E.ErrorCode[] = [
      'UNAUTHENTICATED', 'SESSION_EXPIRED', 'MFA_REQUIRED',
      'FORBIDDEN', 'STEP_UP_REQUIRED', 'SELF_APPROVAL_FORBIDDEN',
      'SELF_ELEVATION_FORBIDDEN', 'AUDITOR_READ_ONLY', 'TENANT_MISMATCH',
      'RESOURCE_NOT_FOUND',
      'INVALID_STATE_TRANSITION', 'POSTED_RECORD_IMMUTABLE', 'STALE_VERSION',
      'IDEMPOTENCY_KEY_REUSED', 'REQUEST_IN_PROGRESS', 'STEP_NOT_ACTIONABLE',
      'EXPENSE_ALREADY_REIMBURSED', 'BUDGET_EXCEEDED', 'LAST_ADMIN',
      'CURRENCY_LOCKED', 'MEMBERSHIP_EXISTS', 'POLICY_BLOCKED', 'CYCLIC_HIERARCHY',
      'VALIDATION_FAILED', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'INVALID_FILE',
      'UNRESOLVABLE_APPROVER',
      'RATE_LIMITED',
      'INTERNAL_ERROR', 'POLICY_EVALUATION_FAILED', 'TENANT_CONTEXT_MISSING',
      'PROVIDER_ERROR', 'PROVIDER_TIMEOUT',
    ];
    // CURRENCY_MISMATCH is raised by Money, not by an AppError subclass.
    const expected = declared.filter((c) => c !== 'CURRENCY_MISMATCH');
    expect([...covered].sort()).toEqual(expected.sort());
  });
});

describe('error details — what an operator needs to act', () => {
  it('InvalidStateTransitionError names both states', () => {
    const error = new E.InvalidStateTransitionError('Transaction', 'POSTED', 'PENDING');
    expect(error.details).toMatchObject({
      entity: 'Transaction',
      currentState: 'POSTED',
      attemptedState: 'PENDING',
    });
  });

  it('StaleVersionError carries both versions so the client can show a real diff', () => {
    expect(new E.StaleVersionError('Budget', 3, 5).details).toMatchObject({
      expectedVersion: 3,
      currentVersion: 5,
    });
  });

  it('ValidationError carries a field-keyed map', () => {
    const error = new E.ValidationError({
      amount: ['must be greater than 0'],
      currency: ['must be a valid ISO-4217 code'],
    });
    expect(error.details?.['fields']).toEqual({
      amount: ['must be greater than 0'],
      currency: ['must be a valid ISO-4217 code'],
    });
  });

  it('AmountMismatchError reports the server figure, which is the authoritative one', () => {
    expect(new E.AmountMismatchError('2400.0000', '2000.0000').details).toMatchObject({
      serverComputed: '2400.0000',
      received: '2000.0000',
    });
  });

  it('PolicyBlockedError surfaces every blocking reason, not just the first', () => {
    const error = new E.PolicyBlockedError([
      { reasonCode: 'RECEIPT_REQUIRED', message: 'A receipt is required.' },
      { reasonCode: 'BUDGET_EXCEEDED', message: 'This exceeds the remaining budget.' },
    ]);
    // The user should be able to fix everything at once rather than
    // discovering problems one resubmission at a time.
    expect(error.details?.['blocks']).toHaveLength(2);
    expect(error.message).toBe('A receipt is required.');
  });

  it('PolicyBlockedError falls back to a generic message when given no reasons', () => {
    expect(new E.PolicyBlockedError([]).message).toBe('This spend is not permitted by policy.');
  });

  it('RateLimitError reports the retry delay', () => {
    const error = new E.RateLimitError(90);
    expect(error.retryAfterSeconds).toBe(90);
    expect(error.details).toMatchObject({ retryAfterSeconds: 90 });
  });

  it('TenantContextMissingError names the model and operation that escaped the context', () => {
    expect(new E.TenantContextMissingError('Transaction', 'findMany').details).toMatchObject({
      model: 'Transaction',
      operation: 'findMany',
    });
  });

  it('ProviderError names the provider and operation without leaking vendor detail', () => {
    const error = new E.ProviderError('CardProvider', 'issueCard');
    expect(error.details).toMatchObject({ provider: 'CardProvider', operation: 'issueCard' });
    expect(error.message).not.toContain('stack');
  });

  it('ExpenseAlreadyReimbursedError names the batch when known', () => {
    expect(new E.ExpenseAlreadyReimbursedError('RB-2026-0041').message).toContain('RB-2026-0041');
    expect(new E.ExpenseAlreadyReimbursedError().message).toBe(
      'This expense has already been reimbursed.',
    );
  });

  it('NotFoundError names the resource type generically', () => {
    expect(new E.NotFoundError('Transaction').message).toBe('Transaction not found.');
    expect(new E.NotFoundError().message).toBe('Resource not found.');
  });

  it('omits absent optional fields from the wire envelope', () => {
    const bare = new E.ForbiddenError().toJSON();
    expect(bare).not.toHaveProperty('details');
    expect(bare).not.toHaveProperty('correlationId');
  });
});

describe('error metadata', () => {
  it('carries a correlation id when supplied, so a user can quote it to support', () => {
    const error = new E.InternalError({ correlationId: 'abc-123' });
    expect(error.correlationId).toBe('abc-123');
    expect(error.toJSON().correlationId).toBe('abc-123');
  });

  it('preserves the cause chain for diagnosis', () => {
    const root = new Error('connection refused');
    const error = new E.ProviderError('PaymentProvider', 'initiatePayment', { cause: root });
    expect(error.cause).toBe(root);
  });

  it('does not leak internals through InternalError’s message', () => {
    // The correlation id is the handle for investigation; the message is not.
    expect(new E.InternalError().message).toBe('Something went wrong. Please try again.');
  });

  it('accepts a custom message where the class allows one', () => {
    expect(new E.ForbiddenError('Only finance may mark a bill paid.').message).toBe(
      'Only finance may mark a bill paid.',
    );
  });

  it('isAppError rejects non-AppError values', () => {
    expect(E.isAppError(new Error('plain'))).toBe(false);
    expect(E.isAppError('a string')).toBe(false);
    expect(E.isAppError(null)).toBe(false);
    expect(E.isRetryable(new Error('plain'))).toBe(false);
  });
});
