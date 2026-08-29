import { describe, it, expect } from 'vitest';
import { Money, MONEY_SCALE, CurrencyMismatchError, InvalidMoneyError } from './money.js';
import { UnknownCurrencyError } from './currency.js';

/**
 * Money is the single most safety-critical class in the codebase, so it
 * carries a 100% coverage floor (docs/16-TESTING-STRATEGY.md §10) and its
 * tests are exhaustive rather than representative.
 */

describe('Money — construction', () => {
  it('builds from a decimal string and normalises to the storage scale', () => {
    expect(Money.of('2400', 'USD').toString()).toBe('2400.0000');
    expect(Money.of('2400.5', 'USD').toString()).toBe('2400.5000');
    expect(Money.of('0.0001', 'USD').toString()).toBe('0.0001');
    expect(Money.of('-15.25', 'USD').toString()).toBe('-15.2500');
  });

  it('normalises and validates the currency code', () => {
    expect(Money.of('1', 'usd').currency).toBe('USD');
    expect(Money.of('1', ' eur ').currency).toBe('EUR');
    expect(() => Money.of('1', 'US')).toThrow(UnknownCurrencyError);
    expect(() => Money.of('1', 'XYZ')).toThrow(UnknownCurrencyError);
    expect(() => Money.of('1', '')).toThrow(UnknownCurrencyError);
  });

  it('rejects a JavaScript number, which may already have lost precision', () => {
    // @ts-expect-error deliberately violating the signature — this is the guard being tested
    expect(() => Money.of(24.5, 'USD')).toThrow(InvalidMoneyError);
  });

  it('rejects malformed amounts rather than coercing them', () => {
    for (const bad of ['', '   ', 'abc', '1.2.3', '1,000', '1e5', 'NaN', 'Infinity', '--5', '+5']) {
      expect(() => Money.of(bad, 'USD'), `expected "${bad}" to be rejected`).toThrow(
        InvalidMoneyError,
      );
    }
  });

  it('rejects over-precision instead of silently rounding it away', () => {
    expect(() => Money.of('1.23456', 'USD')).toThrow(InvalidMoneyError);
    expect(() => Money.of('1.2345', 'USD')).not.toThrow();
  });

  it('creates a correctly denominated zero', () => {
    const zero = Money.zero('GBP');
    expect(zero.isZero()).toBe(true);
    expect(zero.currency).toBe('GBP');
    expect(zero.toString()).toBe('0.0000');
  });

  it('builds from minor units using the currency exponent, not a hard-coded 2', () => {
    expect(Money.fromMinorUnits(12345, 'USD').toString()).toBe('123.4500');
    expect(Money.fromMinorUnits(12345, 'JPY').toString()).toBe('12345.0000'); // exponent 0
    expect(Money.fromMinorUnits(12345, 'KWD').toString()).toBe('12.3450'); // exponent 3
    expect(Money.fromMinorUnits(9007199254740993n, 'USD').toString()).toBe('90071992547409.9300');
  });

  it('rejects an unsafe integer count of minor units', () => {
    expect(() => Money.fromMinorUnits(2 ** 53, 'USD')).toThrow(InvalidMoneyError);
  });

  it('exposes the storage scale that matches NUMERIC(20,4)', () => {
    expect(MONEY_SCALE).toBe(4);
  });
});

describe('Money — arithmetic', () => {
  it('adds and subtracts exactly, where floating point would not', () => {
    // The canonical float failure: 0.1 + 0.2 !== 0.3
    expect(Money.of('0.1', 'USD').add(Money.of('0.2', 'USD')).toString()).toBe('0.3000');
    expect(Money.of('1000000000.01', 'USD').add(Money.of('0.02', 'USD')).toString()).toBe(
      '1000000000.0300',
    );
    expect(Money.of('10', 'USD').subtract(Money.of('3.33', 'USD')).toString()).toBe('6.6700');
  });

  it('multiplies and divides by a dimensionless scalar', () => {
    expect(Money.of('200', 'USD').multiply(12).toString()).toBe('2400.0000');
    expect(Money.of('100', 'USD').multiply('0.075').toString()).toBe('7.5000');
    expect(Money.of('100', 'USD').divide(4).toString()).toBe('25.0000');
  });

  it('rejects division by zero and non-finite operands', () => {
    expect(() => Money.of('100', 'USD').divide(0)).toThrow(InvalidMoneyError);
    expect(() => Money.of('100', 'USD').divide(Infinity)).toThrow(InvalidMoneyError);
    expect(() => Money.of('100', 'USD').multiply(Infinity)).toThrow(InvalidMoneyError);
  });

  it('negates and takes absolute value', () => {
    expect(Money.of('50', 'USD').negate().toString()).toBe('-50.0000');
    expect(Money.of('-50', 'USD').abs().toString()).toBe('50.0000');
    expect(Money.zero('USD').negate().isZero()).toBe(true);
  });

  it('is immutable — operations return new instances', () => {
    const original = Money.of('100', 'USD');
    const result = original.add(Money.of('50', 'USD'));
    expect(original.toString()).toBe('100.0000');
    expect(result.toString()).toBe('150.0000');
    expect(Object.isFrozen(original)).toBe(true);
  });
});

describe('Money — currency safety (NFR-FIN-005)', () => {
  it('refuses to combine differing currencies rather than comparing magnitudes', () => {
    const usd = Money.of('100', 'USD');
    const eur = Money.of('100', 'EUR');

    expect(() => usd.add(eur)).toThrow(CurrencyMismatchError);
    expect(() => usd.subtract(eur)).toThrow(CurrencyMismatchError);
    expect(() => usd.compare(eur)).toThrow(CurrencyMismatchError);
    expect(() => usd.greaterThan(eur)).toThrow(CurrencyMismatchError);
  });

  it('names both currencies and the operation in the error', () => {
    try {
      Money.of('1', 'USD').add(Money.of('1', 'JPY'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError);
      expect((error as CurrencyMismatchError).message).toContain('USD');
      expect((error as CurrencyMismatchError).message).toContain('JPY');
      expect((error as CurrencyMismatchError).message).toContain('add');
    }
  });

  it('treats differing currencies as unequal rather than throwing, so equals is total', () => {
    expect(Money.of('100', 'USD').equals(Money.of('100', 'EUR'))).toBe(false);
  });
});

describe('Money — rounding (NFR-FIN-004, banker’s rounding)', () => {
  it('rounds half to even, not half up', () => {
    // Half-up would give 3, 4, 5, 6 — systematically inflating a long series.
    expect(Money.of('2.5', 'USD').multiply(1).roundToCurrency().toString()).toBe('2.5000');
    expect(Money.of('0.125', 'USD').roundToCurrency().toString()).toBe('0.1200'); // 2 → even
    expect(Money.of('0.135', 'USD').roundToCurrency().toString()).toBe('0.1400'); // 4 → even
    expect(Money.of('0.145', 'USD').roundToCurrency().toString()).toBe('0.1400');
    expect(Money.of('0.155', 'USD').roundToCurrency().toString()).toBe('0.1600');
  });

  it('rounds to the currency’s own exponent, not always to 2', () => {
    expect(Money.of('1234.5678', 'USD').roundToCurrency().toString()).toBe('1234.5700');
    expect(Money.of('1234.5678', 'JPY').roundToCurrency().toString()).toBe('1235.0000');
    expect(Money.of('1234.5678', 'KWD').roundToCurrency().toString()).toBe('1234.5680');
  });
});

describe('Money — allocate (the lost-cent guarantee)', () => {
  it('splits evenly without losing or inventing a minor unit', () => {
    const parts = Money.of('100.00', 'USD').allocate([1, 1, 1]);
    expect(parts.map((p) => p.toString())).toEqual(['33.3400', '33.3300', '33.3300']);
    expect(Money.sum(parts, 'USD').toString()).toBe('100.0000');
  });

  it('splits by weight and still sums exactly to the whole', () => {
    const parts = Money.of('100.00', 'USD').allocate([70, 30]);
    expect(parts.map((p) => p.toString())).toEqual(['70.0000', '30.0000']);

    const awkward = Money.of('0.05', 'USD').allocate([3, 7]);
    expect(Money.sum(awkward, 'USD').toString()).toBe('0.0500');
  });

  it('never loses a unit across a wide range of amounts and splits', () => {
    for (let cents = 1; cents <= 250; cents += 1) {
      for (let shares = 2; shares <= 7; shares += 1) {
        const total = Money.fromMinorUnits(cents, 'USD');
        const parts = total.allocate(Array.from({ length: shares }, () => 1));
        expect(
          Money.sum(parts, 'USD').equals(total),
          `${cents} cents across ${shares} shares did not sum back to the whole`,
        ).toBe(true);
      }
    }
  });

  it('handles negative totals — a refund split is still exact', () => {
    const parts = Money.of('-100.00', 'USD').allocate([1, 1, 1]);
    expect(Money.sum(parts, 'USD').toString()).toBe('-100.0000');
  });

  it('respects the currency exponent when distributing the remainder', () => {
    const jpy = Money.of('100', 'JPY').allocate([1, 1, 1]);
    expect(jpy.map((p) => p.toString())).toEqual(['34.0000', '33.0000', '33.0000']);
    expect(Money.sum(jpy, 'JPY').toString()).toBe('100.0000');
  });

  it('gives the remainder to the largest weights first, deterministically', () => {
    const a = Money.of('10.00', 'USD').allocate([1, 1, 1]);
    const b = Money.of('10.00', 'USD').allocate([1, 1, 1]);
    expect(a.map(String)).toEqual(b.map(String));
  });

  it('tolerates zero weights', () => {
    const parts = Money.of('100.00', 'USD').allocate([1, 0, 1]);
    expect(parts[1]?.isZero()).toBe(true);
    expect(Money.sum(parts, 'USD').toString()).toBe('100.0000');
  });

  it('rejects invalid weight sets', () => {
    expect(() => Money.of('100', 'USD').allocate([])).toThrow(InvalidMoneyError);
    expect(() => Money.of('100', 'USD').allocate([0, 0])).toThrow(InvalidMoneyError);
    expect(() => Money.of('100', 'USD').allocate([-1, 2])).toThrow(InvalidMoneyError);
    expect(() => Money.of('100', 'USD').allocate([1.5, 2])).toThrow(InvalidMoneyError);
  });
});

describe('Money — comparison', () => {
  const hundred = Money.of('100', 'USD');

  it('compares correctly', () => {
    expect(hundred.compare(Money.of('50', 'USD'))).toBe(1);
    expect(hundred.compare(Money.of('100', 'USD'))).toBe(0);
    expect(hundred.compare(Money.of('150', 'USD'))).toBe(-1);
    expect(hundred.greaterThan(Money.of('99.9999', 'USD'))).toBe(true);
    expect(hundred.greaterThanOrEqual(hundred)).toBe(true);
    expect(hundred.lessThan(Money.of('100.0001', 'USD'))).toBe(true);
    expect(hundred.lessThanOrEqual(hundred)).toBe(true);
  });

  it('classifies sign, treating zero as neither positive nor negative', () => {
    expect(Money.zero('USD').isZero()).toBe(true);
    expect(Money.zero('USD').isPositive()).toBe(false);
    expect(Money.zero('USD').isNegative()).toBe(false);
    expect(Money.of('-0.0001', 'USD').isNegative()).toBe(true);
    expect(Money.of('0.0001', 'USD').isPositive()).toBe(true);
  });

  it('treats equality as value-and-currency', () => {
    expect(hundred.equals(Money.of('100.0000', 'USD'))).toBe(true);
    expect(hundred.equals(Money.of('100.0001', 'USD'))).toBe(false);
  });
});

describe('Money — aggregation', () => {
  it('sums a list', () => {
    const amounts = [Money.of('10.50', 'USD'), Money.of('20.25', 'USD'), Money.of('0.25', 'USD')];
    expect(Money.sum(amounts, 'USD').toString()).toBe('31.0000');
  });

  it('returns a correctly denominated zero for an empty list', () => {
    const empty = Money.sum([], 'EUR');
    expect(empty.isZero()).toBe(true);
    expect(empty.currency).toBe('EUR');
  });

  it('throws rather than summing a mixed-currency list', () => {
    expect(() => Money.sum([Money.of('1', 'USD'), Money.of('1', 'EUR')], 'USD')).toThrow(
      CurrencyMismatchError,
    );
  });
});

describe('Money — serialisation (NFR-FIN-002)', () => {
  it('serialises the amount as a STRING, never a JSON number', () => {
    const json = Money.of('2400.50', 'USD').toJSON();
    expect(json).toEqual({ amount: '2400.5000', currency: 'USD' });
    expect(typeof json.amount).toBe('string');

    // The whole point: a round trip through JSON must be lossless.
    const encoded = JSON.stringify({ total: Money.of('1000000000.01', 'USD') });
    expect(encoded).toContain('"amount":"1000000000.0100"');
    expect(encoded).not.toMatch(/"amount":\s*\d/);
  });

  it('round-trips exactly', () => {
    for (const amount of ['0.0001', '-99999999.9999', '2400.5000', '0.0000']) {
      const original = Money.of(amount, 'USD');
      expect(Money.fromJSON(original.toJSON()).equals(original)).toBe(true);
    }
  });

  it('converts to minor units using the currency exponent', () => {
    expect(Money.of('123.45', 'USD').toMinorUnits()).toBe(12345n);
    expect(Money.of('12345', 'JPY').toMinorUnits()).toBe(12345n);
    expect(Money.of('12.345', 'KWD').toMinorUnits()).toBe(12345n);
    expect(Money.of('-1.50', 'USD').toMinorUnits()).toBe(-150n);
  });

  it('exposes an unsafe number escape hatch that is conspicuously named', () => {
    expect(Money.of('123.45', 'USD').toUnsafeNumber()).toBeCloseTo(123.45, 4);
  });

  it('formats for display using the currency exponent', () => {
    expect(Money.of('1234.5', 'USD').format('en-US')).toBe('$1,234.50');
    expect(Money.of('1234', 'JPY').format('en-US')).toBe('¥1,234');
  });

  it('has a readable inspection form', () => {
    const inspect = Symbol.for('nodejs.util.inspect.custom');
    const money = Money.of('10', 'USD') as unknown as Record<symbol, () => string>;
    expect(money[inspect]?.()).toBe('Money(10.0000 USD)');
  });
});
