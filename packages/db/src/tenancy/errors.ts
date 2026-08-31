import { AppError, type AppErrorOptions, type ErrorCode } from '@financy/core';

/**
 * A query was issued against a model that is registered as neither
 * tenant-scoped nor global.
 *
 * This fails closed. The alternative — passing an unknown model through
 * untouched — means running a query with no organisation predicate, which is
 * precisely the bug this layer exists to make impossible. A model added to
 * `schema.prisma` and forgotten in the registry therefore breaks loudly on
 * first use rather than quietly returning another organisation's rows.
 */
export class UnclassifiedModelError extends AppError {
  readonly code: ErrorCode = 'TENANT_CONTEXT_MISSING';
  readonly httpStatus = 500;

  constructor(model: string, operation: string, options?: AppErrorOptions) {
    super(
      `Model "${model}" is not registered as tenant-scoped or global, so ${operation} cannot be given an organisation predicate. Register it in packages/db/src/tenancy/model-registry.ts.`,
      { ...options, details: { ...options?.details, model, operation } },
    );
  }
}

/**
 * A Prisma operation reached the tenant extension without a rule for where its
 * organisation predicate belongs.
 *
 * Refused for the same reason an unregistered model is: we cannot demonstrate
 * that the query is scoped, and "probably fine" is not a standard this layer
 * is allowed to work to. A new Prisma operation therefore requires a decision
 * here before it can be used.
 */
export class UnscopedOperationError extends AppError {
  readonly code: ErrorCode = 'TENANT_CONTEXT_MISSING';
  readonly httpStatus = 500;

  constructor(model: string, operation: string, options?: AppErrorOptions) {
    super(
      `Operation "${operation}" on tenant-scoped model "${model}" has no tenant-scoping rule. Add one in packages/db/src/tenancy/tenant-scope.ts.`,
      { ...options, details: { ...options?.details, model, operation } },
    );
  }
}
