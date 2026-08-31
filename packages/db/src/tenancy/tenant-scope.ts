/**
 * Layer 2 of tenant isolation, as a pure function (docs/08 §4.5).
 *
 * The Prisma extension in `tenant-extension.ts` is a thin wrapper around
 * {@link applyTenantScope}. Keeping the rewriting logic here — with no Prisma
 * client, no database, and no async context — is what makes it exhaustively
 * testable: every operation, every shape of `where`, and every fail-closed
 * path can be asserted in milliseconds without a container.
 *
 * What this layer does *not* cover: `$queryRaw` and `$executeRaw` never reach
 * a model extension, so raw SQL must carry its own `organization_id` predicate.
 * That is why reporting aggregates live in repositories with a mandatory
 * organisation parameter, and why PostgreSQL RLS (layer 3, Phase 6) exists at
 * all — it is the only layer that still holds when the application is wrong.
 */

import { TenantContextMissingError, TenantMismatchError } from '@financy/core';

import { UnclassifiedModelError, UnscopedOperationError } from './errors.js';
import { classifyModel } from './model-registry.js';

/** The column carrying the tenant on every scoped model. */
export const TENANT_COLUMN = 'organizationId';

/**
 * Operations whose organisation predicate belongs in `where`.
 *
 * `findUnique`, `update`, and `delete` are included because Prisma accepts
 * non-unique fields alongside the unique one in `where` (extended `where`
 * unique, GA since Prisma 5). Without that, a lookup by primary key would be
 * the one hole in the layer: `findUnique({ where: { id } })` would happily
 * return another organisation's row.
 */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations whose organisation belongs in the row being written. */
const DATA_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

export interface TenantScopeInput {
  readonly model: string;
  readonly operation: string;
  readonly args: unknown;
  /** The caller's organisation, resolved from the session — never from the request. */
  readonly organizationId: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge the organisation into a `where`-shaped object.
 *
 * A caller that already supplied the *same* organisation is fine — repository
 * code sometimes states it for readability. A caller supplying a *different*
 * one is either a bug worth finding or an attempt worth knowing about, so it
 * raises `TenantMismatchError` rather than being silently overwritten.
 */
function mergeTenant(
  target: unknown,
  organizationId: string,
  model: string,
  operation: string,
): Record<string, unknown> {
  const base = isRecord(target) ? target : {};
  const existing = base[TENANT_COLUMN];

  if (existing !== undefined && existing !== organizationId) {
    throw new TenantMismatchError({
      details: { model, operation, supplied: existing, session: organizationId },
    });
  }

  return { ...base, [TENANT_COLUMN]: organizationId };
}

/**
 * Rewrite a Prisma operation's arguments so it cannot leave the caller's
 * organisation.
 *
 * Returns the arguments untouched for a global model. Throws — never returns
 * an unscoped query — when the model is tenant-scoped and there is no context.
 */
export function applyTenantScope(input: TenantScopeInput): unknown {
  const { model, operation, args, organizationId } = input;

  switch (classifyModel(model)) {
    case 'global':
      return args;

    case 'unregistered':
      throw new UnclassifiedModelError(model, operation);

    case 'tenant-scoped':
      break;
  }

  // Fail closed. The alternative is a query with no organisation predicate,
  // and there is no context in which that is the better outcome.
  if (organizationId === undefined) {
    throw new TenantContextMissingError(model, operation);
  }

  const base = isRecord(args) ? args : {};

  if (WHERE_OPERATIONS.has(operation)) {
    return { ...base, where: mergeTenant(base['where'], organizationId, model, operation) };
  }

  if (DATA_OPERATIONS.has(operation)) {
    const data = base['data'];

    // `createMany` takes an array; `create` takes one object. Both arrive here.
    if (Array.isArray(data)) {
      return {
        ...base,
        data: data.map((row) => mergeTenant(row, organizationId, model, operation)),
      };
    }

    return { ...base, data: mergeTenant(data, organizationId, model, operation) };
  }

  if (operation === 'upsert') {
    return {
      ...base,
      where: mergeTenant(base['where'], organizationId, model, operation),
      create: mergeTenant(base['create'], organizationId, model, operation),
      // `update` is deliberately left alone: the row it targets has already
      // been constrained by `where`, and injecting the column there would be
      // an attempt to *move* a record between organisations.
    };
  }

  // An operation we have not classified. Unknown operations are refused for
  // the same reason unknown models are: we cannot prove this one is scoped.
  throw new UnscopedOperationError(model, operation);
}
