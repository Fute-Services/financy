import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  GLOBAL_MODELS,
  TENANT_SCOPED_MODELS,
  assertRegistriesDisjoint,
  classifyModel,
} from './model-registry.js';

/**
 * The architecture test for tenant isolation.
 *
 * It reads the generated Prisma client's own model list, so it cannot drift
 * from the schema: adding a model to `schema.prisma` and forgetting to
 * classify it fails here, at build time, rather than on the first request
 * that returns another organisation's rows.
 *
 * The registry is empty in Phase 0 because the schema is. That is not a
 * loophole — the assertion is "every model is classified", which an empty
 * schema satisfies honestly and a Phase 1 schema will not until the work is
 * done.
 */
describe('every Prisma model is classified', () => {
  const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

  it('classifies each model as tenant-scoped or global', () => {
    const unregistered = modelNames.filter((name) => classifyModel(name) === 'unregistered');

    expect(
      unregistered,
      `Unclassified models: ${unregistered.join(', ')}. Register each in model-registry.ts as tenant-scoped or global.`,
    ).toEqual([]);
  });

  it('registers no model that the schema does not define', () => {
    const known = new Set(modelNames);
    const stale = [...TENANT_SCOPED_MODELS, ...GLOBAL_MODELS].filter((name) => !known.has(name));

    expect(stale, `Registered models absent from the schema: ${stale.join(', ')}`).toEqual([]);
  });

  it('classifies no model as both', () => {
    const both = [...TENANT_SCOPED_MODELS].filter((name) => GLOBAL_MODELS.has(name));
    expect(both).toEqual([]);
  });
});

describe('classifyModel', () => {
  it('reports an unknown model as unregistered rather than guessing', () => {
    expect(classifyModel('NotAModel')).toBe('unregistered');
  });
});

describe('assertRegistriesDisjoint', () => {
  it('rejects a model claimed by both registries', () => {
    expect(() => assertRegistriesDisjoint(new Set(['Expense']), new Set(['Expense']))).toThrow(
      /both tenant-scoped and global/,
    );
  });

  it('accepts disjoint registries', () => {
    expect(() => assertRegistriesDisjoint(new Set(['Expense']), new Set(['User']))).not.toThrow();
  });
});
