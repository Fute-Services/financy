import { describe, expect, it } from 'vitest';

import { UnclassifiedModelError, UnscopedOperationError } from './errors.js';

/**
 * Both of these are 500s that only ever fire on a developer mistake, so the
 * message is the whole product: it has to name the model, the operation, and
 * the file to edit, because whoever reads it is looking at a stack trace from
 * a deploy and not at this source.
 */
describe('UnclassifiedModelError', () => {
  const error = new UnclassifiedModelError('Expense', 'findMany');

  it('is a 500 in the tenant-context family', () => {
    expect(error.httpStatus).toBe(500);
    expect(error.code).toBe('TENANT_CONTEXT_MISSING');
  });

  it('names the model, the operation, and where to fix it', () => {
    expect(error.message).toContain('Expense');
    expect(error.message).toContain('findMany');
    expect(error.message).toContain('model-registry.ts');
  });

  it('carries the model and operation as structured details', () => {
    expect(error.details).toMatchObject({ model: 'Expense', operation: 'findMany' });
  });

  it('merges caller-supplied details rather than dropping them', () => {
    const withContext = new UnclassifiedModelError('Expense', 'findMany', {
      details: { correlationId: 'abc' },
      correlationId: 'abc',
    });

    expect(withContext.details).toMatchObject({
      model: 'Expense',
      operation: 'findMany',
      correlationId: 'abc',
    });
    expect(withContext.correlationId).toBe('abc');
  });
});

describe('UnscopedOperationError', () => {
  const error = new UnscopedOperationError('Expense', 'someFutureOperation');

  it('points at the scoping rules rather than the registry', () => {
    expect(error.message).toContain('tenant-scope.ts');
    expect(error.message).toContain('someFutureOperation');
  });

  it('merges caller-supplied details', () => {
    const withContext = new UnscopedOperationError('Expense', 'op', {
      details: { attempt: 2 },
    });
    expect(withContext.details).toMatchObject({ model: 'Expense', operation: 'op', attempt: 2 });
  });
});
