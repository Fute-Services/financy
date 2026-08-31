import { TenantContextMissingError } from '@financy/core';
import { describe, expect, it, vi } from 'vitest';

import { tenantExtension } from './tenant-extension.js';

vi.mock('./model-registry.js', () => ({
  classifyModel: (model: string) => (model === 'Expense' ? 'tenant-scoped' : 'global'),
}));

const ORG = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';

type Interceptor = (input: {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

/**
 * Recover the interceptor without standing up a database.
 *
 * `Prisma.defineExtension(spec)` returns `client => client.$extends(spec)`, so
 * applying it to a stub client whose `$extends` just captures its argument
 * hands back the extension definition itself. That is enough to prove the
 * wiring — that arguments are rewritten before Prisma sees them, and that a
 * refusal stops the query — while the rules being applied are proven
 * exhaustively in `tenant-scope.test.ts`.
 */
function interceptorFor(resolve: () => string | undefined): Interceptor {
  let captured: unknown;

  const applyToClient = tenantExtension(resolve) as unknown as (client: {
    $extends: (spec: unknown) => unknown;
  }) => unknown;

  applyToClient({
    $extends: (spec) => {
      captured = spec;
      return null;
    },
  });

  return (captured as { query: { $allModels: { $allOperations: Interceptor } } }).query.$allModels
    .$allOperations;
}

describe('tenantExtension', () => {
  it('hands Prisma the rewritten arguments rather than the original ones', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 'a' }]);
    const intercept = interceptorFor(() => ORG);

    const result = await intercept({
      model: 'Expense',
      operation: 'findMany',
      args: { where: { status: 'DRAFT' } },
      query,
    });

    expect(query).toHaveBeenCalledWith({ where: { status: 'DRAFT', organizationId: ORG } });
    expect(result).toEqual([{ id: 'a' }]);
  });

  /**
   * The resolver is called per operation rather than captured once, because
   * the client is a long-lived singleton and the organisation changes with
   * every request.
   */
  it('resolves the organisation on each call', async () => {
    const resolve = vi.fn().mockReturnValue(ORG);
    const intercept = interceptorFor(resolve);
    const query = vi.fn().mockResolvedValue(null);

    await intercept({ model: 'Expense', operation: 'findMany', args: {}, query });
    await intercept({ model: 'Expense', operation: 'findMany', args: {}, query });

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('never reaches Prisma when there is no tenant context', async () => {
    const query = vi.fn();
    const intercept = interceptorFor(() => undefined);

    await expect(
      intercept({ model: 'Expense', operation: 'findMany', args: {}, query }),
    ).rejects.toThrow(TenantContextMissingError);

    expect(query).not.toHaveBeenCalled();
  });

  it('leaves a global model untouched', async () => {
    const query = vi.fn().mockResolvedValue(null);
    const args = { where: { email: 'ada@example.com' } };

    await interceptorFor(() => undefined)({ model: 'User', operation: 'findFirst', args, query });

    expect(query).toHaveBeenCalledWith(args);
  });
});
