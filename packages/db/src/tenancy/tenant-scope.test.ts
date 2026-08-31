import { TenantContextMissingError, TenantMismatchError } from '@financy/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnclassifiedModelError, UnscopedOperationError } from './errors.js';
import { applyTenantScope } from './tenant-scope.js';

/**
 * The registry is empty until Phase 1 adds the schema, so these tests stub it.
 * Stubbing the registry rather than the schema is deliberate: it keeps the
 * suite testing the *rewriting rules*, which are what this module owns, and
 * leaves "is every real model registered?" to the separate registry test that
 * reads the generated client.
 */
vi.mock('./model-registry.js', () => ({
  classifyModel: (model: string) => {
    if (model === 'Expense') return 'tenant-scoped';
    if (model === 'User') return 'global';
    return 'unregistered';
  },
}));

const ORG = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';
const OTHER_ORG = '0192f3a1-9c2b-7d4e-8f01-aaaaaaaaaaaa';

/** A scoped call with a tenant context present. */
function scope(operation: string, args: unknown) {
  return applyTenantScope({ model: 'Expense', operation, args, organizationId: ORG });
}

/**
 * A scoped call with *no* tenant context.
 *
 * A separate helper rather than an optional parameter on `scope`: a parameter
 * default fires on an explicitly passed `undefined`, so `scope(op, args,
 * undefined)` would quietly test the happy path and pass.
 */
function scopeWithoutContext(operation: string, args: unknown) {
  return applyTenantScope({ model: 'Expense', operation, args, organizationId: undefined });
}

describe('read and mutate-by-filter operations', () => {
  it.each([
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'updateMany',
    'updateManyAndReturn',
    'deleteMany',
    'count',
    'aggregate',
    'groupBy',
  ])('injects the organisation into where for %s', (operation) => {
    expect(scope(operation, { where: { status: 'DRAFT' } })).toEqual({
      where: { status: 'DRAFT', organizationId: ORG },
    });
  });

  it('adds a where clause when the caller supplied none', () => {
    expect(scope('findMany', {})).toEqual({ where: { organizationId: ORG } });
  });

  it('handles a call with no arguments at all', () => {
    expect(scope('findMany', undefined)).toEqual({ where: { organizationId: ORG } });
  });

  it('preserves the rest of the arguments', () => {
    expect(scope('findMany', { take: 10, orderBy: { createdAt: 'desc' } })).toEqual({
      take: 10,
      orderBy: { createdAt: 'desc' },
      where: { organizationId: ORG },
    });
  });

  /**
   * The hole this closes: without it, `findUnique({ where: { id } })` — the
   * single most common query in the codebase — would return any organisation's
   * row. Prisma's extended `where` unique is what makes the predicate legal
   * alongside the primary key.
   */
  it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete'])(
    'scopes %s by primary key too',
    (operation) => {
      expect(scope(operation, { where: { id: 'abc' } })).toEqual({
        where: { id: 'abc', organizationId: ORG },
      });
    },
  );
});

describe('write operations', () => {
  it('stamps the organisation onto a created row', () => {
    expect(scope('create', { data: { amount: '10.0000' } })).toEqual({
      data: { amount: '10.0000', organizationId: ORG },
    });
  });

  it.each(['createMany', 'createManyAndReturn'])('stamps every row of %s', (operation) => {
    expect(scope(operation, { data: [{ amount: '1.0000' }, { amount: '2.0000' }] })).toEqual({
      data: [
        { amount: '1.0000', organizationId: ORG },
        { amount: '2.0000', organizationId: ORG },
      ],
    });
  });

  it('scopes both halves of an upsert', () => {
    expect(
      scope('upsert', {
        where: { id: 'abc' },
        create: { amount: '1.0000' },
        update: { amount: '2.0000' },
      }),
    ).toEqual({
      where: { id: 'abc', organizationId: ORG },
      create: { amount: '1.0000', organizationId: ORG },
      update: { amount: '2.0000' },
    });
  });

  /**
   * `update` is left alone on purpose. The row is already pinned by `where`,
   * and writing the column there would be an attempt to move a record between
   * organisations — which nothing in this product is allowed to do.
   */
  it('does not let an upsert move a record between organisations', () => {
    const result = scope('upsert', {
      where: { id: 'abc' },
      create: {},
      update: {},
    }) as { update: Record<string, unknown> };
    expect(result.update).not.toHaveProperty('organizationId');
  });
});

describe('fail-closed behaviour', () => {
  it('throws rather than running an unscoped query when there is no context', () => {
    expect(() => scopeWithoutContext('findMany', {})).toThrow(TenantContextMissingError);
  });

  it('names the model and operation, so the offending call site is findable', () => {
    try {
      scopeWithoutContext('findMany', {});
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as TenantContextMissingError).details).toMatchObject({
        model: 'Expense',
        operation: 'findMany',
      });
    }
  });

  it('rejects a model that is in neither registry', () => {
    expect(() =>
      applyTenantScope({
        model: 'ForgottenModel',
        operation: 'findMany',
        args: {},
        organizationId: ORG,
      }),
    ).toThrow(UnclassifiedModelError);
  });

  it('rejects an operation it has no scoping rule for', () => {
    expect(() => scope('someFutureOperation', {})).toThrow(UnscopedOperationError);
  });

  it('still classifies before it checks context, so an unknown model fails as unknown', () => {
    expect(() =>
      applyTenantScope({
        model: 'ForgottenModel',
        operation: 'findMany',
        args: {},
        organizationId: undefined,
      }),
    ).toThrow(UnclassifiedModelError);
  });
});

describe('a client-supplied organisation', () => {
  it('is accepted when it agrees with the session', () => {
    expect(scope('findMany', { where: { organizationId: ORG } })).toEqual({
      where: { organizationId: ORG },
    });
  });

  /**
   * Overwriting silently would hide either a bug or an attempt. Neither is
   * something this layer should absorb on the caller's behalf.
   */
  it('is rejected when it disagrees, rather than silently overwritten', () => {
    expect(() => scope('findMany', { where: { organizationId: OTHER_ORG } })).toThrow(
      TenantMismatchError,
    );
  });

  it('is rejected on a create as well as a read', () => {
    expect(() => scope('create', { data: { organizationId: OTHER_ORG } })).toThrow(
      TenantMismatchError,
    );
  });

  it('is rejected on any row of a createMany', () => {
    expect(() =>
      scope('createMany', { data: [{ amount: '1' }, { organizationId: OTHER_ORG }] }),
    ).toThrow(TenantMismatchError);
  });

  it('records both organisations so the security event is actionable', () => {
    try {
      scope('findMany', { where: { organizationId: OTHER_ORG } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as TenantMismatchError).details).toMatchObject({
        supplied: OTHER_ORG,
        session: ORG,
      });
    }
  });
});

describe('global models', () => {
  let args: unknown;

  beforeEach(() => {
    args = { where: { email: 'ada@example.com' } };
  });

  /**
   * A user is one identity across several organisations (docs/09 §1.2), so
   * scoping `User` would make login impossible before the organisation is
   * even known.
   */
  it('passes through untouched', () => {
    expect(
      applyTenantScope({ model: 'User', operation: 'findFirst', args, organizationId: ORG }),
    ).toBe(args);
  });

  it('passes through with no context, because they need none', () => {
    expect(
      applyTenantScope({ model: 'User', operation: 'findFirst', args, organizationId: undefined }),
    ).toBe(args);
  });
});

describe('immutability of the arguments it is given', () => {
  it('does not mutate what it was given', () => {
    const args = { where: { status: 'DRAFT' } };
    const result = scope('findMany', args);

    expect(args).toEqual({ where: { status: 'DRAFT' } });
    expect(result).not.toBe(args);
  });
});
