import { Prisma } from '@prisma/client';

import { applyTenantScope } from './tenant-scope.js';

/**
 * How the extension learns which organisation the current request belongs to.
 *
 * A function rather than a value, because the client is a long-lived singleton
 * and the organisation changes per request. In `backend` this reads the
 * `AsyncLocalStorage` request context; in a test it can be a closure over a
 * variable. `undefined` means "no context", which is a hard failure for a
 * tenant-scoped model — never a permissive default.
 */
export type OrganizationResolver = () => string | undefined;

/**
 * The Prisma client extension that enforces tenant isolation (layer 2 of
 * three — docs/08 §4.5).
 *
 * Deliberately thin. All of the reasoning lives in `applyTenantScope`, which
 * is pure and therefore testable without a database; this wrapper only knows
 * how to intercept an operation and hand the rewritten arguments back to
 * Prisma. Logic that cannot be tested cheaply does not get written here.
 */
export function tenantExtension(resolveOrganizationId: OrganizationResolver) {
  return Prisma.defineExtension({
    name: 'financy-tenant-scope',
    query: {
      $allModels: {
        // `async` so a refusal surfaces as a rejected promise rather than a
        // synchronous throw. Prisma's callers await this, and an operation
        // that sometimes throws and sometimes rejects is the kind of
        // inconsistency that gets a `try` written in one place and forgotten
        // in another.
        async $allOperations({ model, operation, args, query }) {
          const scoped = applyTenantScope({
            model,
            operation,
            args,
            organizationId: resolveOrganizationId(),
          });

          return query(scoped as typeof args);
        },
      },
    },
  });
}
