import { describe, expect, it } from 'vitest';

import {
  compareDecimalStrings,
  currencyCodeSchema,
  dateOnlySchema,
  decimalStringSchema,
  emailSchema,
  idSchema,
  moneySchema,
  nonEmptyString,
  nonNegativeMoneySchema,
  optionalText,
  positiveMoneySchema,
  slugSchema,
  timestampSchema,
  versionSchema,
} from './primitives.js';

describe('idSchema', () => {
  it('accepts a generated v7 id', () => {
    expect(idSchema.safeParse('0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f').success).toBe(true);
  });

  it.each(['', 'not-a-uuid', '0192f3a19c2b7d4e8f012a3b4c5d6e7f'])('rejects %j', (value) => {
    expect(idSchema.safeParse(value).success).toBe(false);
  });
});

describe('money', () => {
  it('accepts a string amount with a supported currency', () => {
    expect(moneySchema.parse({ amount: '2400.0000', currency: 'USD' })).toEqual({
      amount: '2400.0000',
      currency: 'USD',
    });
  });

  it('uppercases the currency code', () => {
    expect(moneySchema.parse({ amount: '1.00', currency: 'usd' }).currency).toBe('USD');
  });

  /**
   * The single most important assertion in this file. A monetary JSON number
   * has already lost precision by the time a validator sees it, so the schema
   * must refuse the type outright rather than coerce it.
   */
  it('rejects a numeric amount', () => {
    expect(moneySchema.safeParse({ amount: 2400, currency: 'USD' }).success).toBe(false);
  });

  it('rejects more than four fractional digits', () => {
    expect(moneySchema.safeParse({ amount: '1.23456', currency: 'USD' }).success).toBe(false);
  });

  it('rejects an unknown currency', () => {
    expect(moneySchema.safeParse({ amount: '1.00', currency: 'XYZ' }).success).toBe(false);
  });

  it('rejects unknown keys, so a client-supplied total cannot ride along', () => {
    expect(
      moneySchema.safeParse({ amount: '1.00', currency: 'USD', formatted: '$1.00' }).success,
    ).toBe(false);
  });

  it('rejects an amount that is not representable', () => {
    expect(moneySchema.safeParse({ amount: '', currency: 'USD' }).success).toBe(false);
  });

  it('distinguishes positive from non-negative', () => {
    const zero = { amount: '0.0000', currency: 'USD' };
    expect(positiveMoneySchema.safeParse(zero).success).toBe(false);
    expect(nonNegativeMoneySchema.safeParse(zero).success).toBe(true);
    expect(nonNegativeMoneySchema.safeParse({ amount: '-1.00', currency: 'USD' }).success).toBe(
      false,
    );
    expect(positiveMoneySchema.safeParse({ amount: '0.0001', currency: 'USD' }).success).toBe(true);
  });
});

describe('decimalStringSchema', () => {
  it.each(['0', '-1.5', '12345.6789'])('accepts %j', (value) => {
    expect(decimalStringSchema.safeParse(value).success).toBe(true);
  });

  it.each(['1.', '.5', '1e3', 'abc', '1.00000'])('rejects %j', (value) => {
    expect(decimalStringSchema.safeParse(value).success).toBe(false);
  });
});

describe('compareDecimalStrings', () => {
  it.each([
    ['1.00', '1.0000', 0],
    ['1.0001', '1.0002', -1],
    ['10', '9.9999', 1],
    ['-5', '1', -1],
    ['-5', '-6', 1],
    ['-1.0001', '-1.0002', 1],
    ['0', '-0', 0],
  ])('compares %s to %s', (left, right, expected) => {
    expect(compareDecimalStrings(left, right)).toBe(expected);
  });

  it('does not lose precision past the float boundary', () => {
    expect(compareDecimalStrings('9007199254740993.0001', '9007199254740993.0002')).toBe(-1);
  });
});

describe('strings', () => {
  it('treats whitespace as empty', () => {
    expect(nonEmptyString(10).safeParse('   ').success).toBe(false);
  });

  it('trims before measuring length', () => {
    expect(nonEmptyString(3).parse('  abc  ')).toBe('abc');
  });

  it('enforces the maximum', () => {
    expect(nonEmptyString(3).safeParse('abcd').success).toBe(false);
  });

  it('maps an empty optional text field to undefined', () => {
    expect(optionalText(10).parse('')).toBeUndefined();
    expect(optionalText(10).parse('  hi ')).toBe('hi');
  });

  it('lower-cases email', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects a malformed email', () => {
    expect(emailSchema.safeParse('ada@').success).toBe(false);
  });

  it.each(['finance', 'finance-team', 'a1-b2'])('accepts slug %j', (value) => {
    expect(slugSchema.safeParse(value).success).toBe(true);
  });

  it.each(['Finance', 'finance_team', '-finance', 'finance-'])('rejects slug %j', (value) => {
    expect(slugSchema.safeParse(value).success).toBe(false);
  });
});

describe('time', () => {
  it('accepts a UTC instant', () => {
    expect(timestampSchema.safeParse('2026-08-29T14:32:11.482Z').success).toBe(true);
  });

  it('rejects an instant with a non-UTC offset', () => {
    expect(timestampSchema.safeParse('2026-08-29T14:32:11+02:00').success).toBe(false);
  });

  it('accepts a date-only value and rejects an instant for it', () => {
    expect(dateOnlySchema.safeParse('2026-08-29').success).toBe(true);
    expect(dateOnlySchema.safeParse('2026-08-29T00:00:00Z').success).toBe(false);
  });
});

describe('currency and version', () => {
  it('normalises and validates currency', () => {
    expect(currencyCodeSchema.parse(' eur ')).toBe('EUR');
    expect(currencyCodeSchema.safeParse('EURO').success).toBe(false);
  });

  it('requires a version of at least 1', () => {
    expect(versionSchema.safeParse(0).success).toBe(false);
    expect(versionSchema.safeParse(1).success).toBe(true);
  });
});
