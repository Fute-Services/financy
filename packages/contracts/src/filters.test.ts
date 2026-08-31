import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  amountRangeSchema,
  dateRangeSchema,
  multiValue,
  searchQuerySchema,
  sortSchema,
  strictQuery,
} from './filters.js';

describe('strictQuery', () => {
  const query = strictQuery({ status: z.string().optional(), q: searchQuerySchema });

  /**
   * The reason this module exists. Silently ignoring `?statuss=APPROVED`
   * hands the user a file they believe is filtered — see docs/10 §2.6.
   */
  it('rejects an unknown filter rather than ignoring it', () => {
    const result = query.safeParse({ statuss: 'APPROVED' });
    expect(result.success).toBe(false);
  });

  it('accepts the declared filters', () => {
    expect(query.parse({ status: 'APPROVED', q: 'acme' })).toEqual({
      status: 'APPROVED',
      q: 'acme',
    });
  });

  it('drops the empty strings an untouched form input submits', () => {
    expect(query.parse({ status: '', q: 'acme' })).toEqual({ q: 'acme' });
  });

  it('passes a non-object through to the object schema, which rejects it', () => {
    expect(query.safeParse('nonsense').success).toBe(false);
    expect(query.safeParse(null).success).toBe(false);
  });
});

describe('multiValue', () => {
  const schema = z.object({ status: multiValue(z.enum(['APPROVED', 'FULFILLED'])) });

  it('normalises a single occurrence to an array', () => {
    expect(schema.parse({ status: 'APPROVED' }).status).toEqual(['APPROVED']);
  });

  it('keeps a repeated occurrence as an array', () => {
    expect(schema.parse({ status: ['APPROVED', 'FULFILLED'] }).status).toEqual([
      'APPROVED',
      'FULFILLED',
    ]);
  });

  it('stays undefined when absent', () => {
    expect(schema.parse({}).status).toBeUndefined();
  });

  it('still validates each member', () => {
    expect(schema.safeParse({ status: ['APPROVED', 'NOPE'] }).success).toBe(false);
  });
});

describe('sortSchema', () => {
  const sort = sortSchema(['occurredAt', 'amount'] as const, {
    field: 'occurredAt',
    direction: 'desc',
  });

  it('parses field and direction', () => {
    expect(sort.parse('amount:asc')).toEqual({ field: 'amount', direction: 'asc' });
  });

  it('defaults the direction to ascending', () => {
    expect(sort.parse('amount')).toEqual({ field: 'amount', direction: 'asc' });
  });

  it('falls back when the parameter is absent', () => {
    expect(sort.parse(undefined)).toEqual({ field: 'occurredAt', direction: 'desc' });
  });

  /**
   * An open sort parameter is an index-planning problem and an information
   * leak: ordering by a column you cannot read still ranks the rows by it.
   */
  it('rejects a field that was not allow-listed', () => {
    expect(sort.safeParse('passwordHash:asc').success).toBe(false);
  });

  it('rejects an unknown direction', () => {
    expect(sort.safeParse('amount:sideways').success).toBe(false);
  });
});

describe('dateRangeSchema', () => {
  const range = dateRangeSchema('occurredFrom', 'occurredTo');

  it('accepts a valid range and each bound alone', () => {
    expect(range.safeParse({ occurredFrom: '2026-08-01', occurredTo: '2026-08-31' }).success).toBe(
      true,
    );
    expect(range.safeParse({ occurredFrom: '2026-08-01' }).success).toBe(true);
    expect(range.safeParse({}).success).toBe(true);
  });

  /**
   * An inverted range returns nothing, and "nothing" reads to a user as
   * "no data" — a different and far more misleading answer than "bad range".
   */
  it('rejects an inverted range instead of returning an empty page', () => {
    const result = range.safeParse({ occurredFrom: '2026-08-31', occurredTo: '2026-08-01' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['occurredFrom']);
  });

  it('accepts an equal pair — a single-day range', () => {
    expect(range.safeParse({ occurredFrom: '2026-08-01', occurredTo: '2026-08-01' }).success).toBe(
      true,
    );
  });
});

describe('amountRangeSchema', () => {
  it('accepts a valid range', () => {
    expect(amountRangeSchema.safeParse({ amountMin: '100', amountMax: '5000' }).success).toBe(true);
  });

  it('rejects an inverted range', () => {
    expect(amountRangeSchema.safeParse({ amountMin: '5000', amountMax: '100' }).success).toBe(
      false,
    );
  });

  it('rejects a monetary bound sent as a number', () => {
    expect(amountRangeSchema.safeParse({ amountMin: 100 }).success).toBe(false);
  });

  it('compares beyond the float boundary without losing the difference', () => {
    expect(
      amountRangeSchema.safeParse({
        amountMin: '9007199254740993.0002',
        amountMax: '9007199254740993.0001',
      }).success,
    ).toBe(false);
  });
});
