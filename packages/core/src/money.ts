import Decimal from 'decimal.js';
import { getCurrencyExponent, normalizeCurrencyCode } from './currency.js';

/**
 * `Money` — the only representation of a monetary value in this system.
 *
 * Three rules, from docs/07-NON-FUNCTIONAL-REQUIREMENTS.md §7 and ADR-0004:
 *
 *   1. Never IEEE-754. `0.1 + 0.2 !== 0.3` is not a curiosity here; it is a
 *      reconciliation failure someone has to explain to an auditor.
 *   2. Currency is never implicit. Two amounts without a shared currency
 *      cannot be combined, and attempting it throws rather than producing a
 *      plausible-looking wrong number.
 *   3. Crosses the wire as a string. `JSON.parse` produces doubles, so a
 *      monetary JSON *number* is corrupt the moment it is parsed.
 *
 * Internal scale is 4 decimal places, matching `NUMERIC(20,4)` in PostgreSQL.
 * Settlement rounding uses the currency's own exponent (2 for USD, 0 for JPY,
 * 3 for KWD), never a hard-coded 2.
 */

/** Configured clone — never mutate decimal.js's global instance. */
const D = Decimal.clone({
  precision: 34,
  // Banker's rounding. Half-up systematically inflates totals over many
  // roundings; half-to-even does not. This is set once, here, and is not
  // configurable per call site — a per-call rounding mode is how two parts of
  // a system come to disagree about the same figure.
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -21,
  toExpPos: 40,
});

/** Internal storage scale. Matches NUMERIC(20,4). */
export const MONEY_SCALE = 4;

/** Serialised form. This is exactly what crosses the API boundary. */
export interface MoneyJSON {
  readonly amount: string;
  readonly currency: string;
}

export class CurrencyMismatchError extends Error {
  readonly code = 'CURRENCY_MISMATCH';
  constructor(
    public readonly left: string,
    public readonly right: string,
    operation: string,
  ) {
    super(
      `Cannot ${operation} ${left} and ${right}. Amounts in different currencies are never combined. ` +
        'Convert explicitly with a recorded rate, or group by currency.',
    );
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  readonly code = 'INVALID_MONEY';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  private readonly value: Decimal;
  readonly currency: string;

  private constructor(value: Decimal, currency: string) {
    this.value = value;
    this.currency = currency;
    Object.freeze(this);
  }

  // ── Construction ───────────────────────────────────────────────────────

  /**
   * Build from a decimal string.
   *
   * A `number` is deliberately not accepted: by the time a monetary value is a
   * JavaScript number it may already have lost precision, and accepting it
   * here would make that loss invisible. Use {@link Money.fromMinorUnits} or a
   * string.
   */
  static of(amount: string, currency: string): Money {
    const code = normalizeCurrencyCode(currency);

    if (typeof (amount as unknown) !== 'string') {
      throw new InvalidMoneyError(
        `Money must be constructed from a string, received ${typeof amount}. ` +
          'A JavaScript number may already have lost precision.',
      );
    }

    const trimmed = amount.trim();
    if (trimmed === '') throw new InvalidMoneyError('Money amount cannot be empty.');
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new InvalidMoneyError(
        `"${amount}" is not a valid decimal amount. Expected digits with an optional single decimal point.`,
      );
    }

    const decimal = new D(trimmed);
    // Unreachable given the regex above, which admits only plain decimal
    // digits. Kept as a backstop: if that pattern is ever loosened, this is
    // what stops a non-finite value reaching a financial record. Excluded
    // from coverage rather than deleted, because the safety net is worth more
    // than the coverage line.
    /* c8 ignore next 3 */
    if (!decimal.isFinite()) {
      throw new InvalidMoneyError(`"${amount}" is not a finite amount.`);
    }

    if (decimal.decimalPlaces() > MONEY_SCALE) {
      throw new InvalidMoneyError(
        `"${amount}" has ${decimal.decimalPlaces()} decimal places; the maximum is ${MONEY_SCALE}. ` +
          'Round explicitly before constructing, so the loss of precision is a decision rather than an accident.',
      );
    }

    return new Money(decimal, code);
  }

  /** Zero in the given currency. */
  static zero(currency: string): Money {
    return new Money(new D(0), normalizeCurrencyCode(currency));
  }

  /**
   * Build from an integer count of minor units (cents, pence, yen).
   * The currency's own exponent is used, so JPY and KWD are handled correctly.
   */
  static fromMinorUnits(minorUnits: bigint | number, currency: string): Money {
    const code = normalizeCurrencyCode(currency);
    if (typeof minorUnits === 'number' && !Number.isSafeInteger(minorUnits)) {
      throw new InvalidMoneyError(`${minorUnits} is not a safe integer count of minor units.`);
    }
    const exponent = getCurrencyExponent(code);
    const value = new D(minorUnits.toString()).dividedBy(new D(10).pow(exponent));
    return new Money(value, code);
  }

  /** Rehydrate from the serialised form. */
  static fromJSON(json: MoneyJSON): Money {
    return Money.of(json.amount, json.currency);
  }

  // ── Arithmetic ─────────────────────────────────────────────────────────

  private assertSameCurrency(other: Money, operation: string): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency, operation);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add');
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract');
    return new Money(this.value.minus(other.value), this.currency);
  }

  /**
   * Multiply by a dimensionless scalar — a quantity, a percentage, an FX rate.
   *
   * Multiplying money by money is not defined and there is no method for it,
   * because the result would have no meaningful currency.
   */
  multiply(factor: string | number): Money {
    const f = new D(typeof factor === 'number' ? factor.toString() : factor);
    if (!f.isFinite()) throw new InvalidMoneyError(`Multiplier "${factor}" is not finite.`);
    return new Money(this.value.times(f).toDecimalPlaces(MONEY_SCALE), this.currency);
  }

  /** Divide by a dimensionless scalar. For splitting a sum, use {@link allocate}. */
  divide(divisor: string | number): Money {
    const d = new D(typeof divisor === 'number' ? divisor.toString() : divisor);
    if (d.isZero()) throw new InvalidMoneyError('Division by zero.');
    if (!d.isFinite()) throw new InvalidMoneyError(`Divisor "${divisor}" is not finite.`);
    return new Money(this.value.dividedBy(d).toDecimalPlaces(MONEY_SCALE), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.value.abs(), this.currency);
  }

  /**
   * Split across weighted shares **without losing or inventing a minor unit**.
   *
   * Naive division loses money: `100.00 / 3` rounded to cents three times
   * gives `99.99`. This distributes the remainder one minor unit at a time to
   * the largest shares first, so the parts always sum exactly to the whole.
   * A lost cent in a reimbursement split is a support ticket and, worse, a
   * reason to stop trusting every other figure on the page.
   *
   * @param weights Positive integers. `[1,1,1]` splits evenly; `[70,30]` 70/30.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) throw new InvalidMoneyError('allocate requires at least one weight.');
    if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
      throw new InvalidMoneyError('allocate weights must be non-negative integers.');
    }

    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total === 0) throw new InvalidMoneyError('allocate weights must not sum to zero.');

    const exponent = getCurrencyExponent(this.currency);
    const factor = new D(10).pow(exponent);

    // Work in whole minor units so remainder distribution is exact.
    const totalMinor = this.value.times(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);

    const shares: Decimal[] = [];
    let distributed = new D(0);

    for (const weight of weights) {
      // Truncate toward zero so the remainder is always non-negative in
      // magnitude and can be handed out deterministically below.
      const share = totalMinor.times(weight).dividedBy(total).toDecimalPlaces(0, Decimal.ROUND_DOWN);
      shares.push(share);
      distributed = distributed.plus(share);
    }

    let remainder = totalMinor.minus(distributed);
    const step = remainder.isNegative() ? new D(-1) : new D(1);

    // Hand the remainder out one minor unit at a time, largest weight first,
    // so the distribution is deterministic rather than dependent on ordering.
    const order = weights
      .map((weight, index) => ({ weight, index }))
      .sort((a, b) => b.weight - a.weight || a.index - b.index);

    let cursor = 0;
    while (!remainder.isZero() && order.length > 0) {
      const target = order[cursor % order.length];
      /* c8 ignore next */
      if (!target) break;
      shares[target.index] = (shares[target.index] ?? new D(0)).plus(step);
      remainder = remainder.minus(step);
      cursor += 1;
    }

    return shares.map((minor) => new Money(minor.dividedBy(factor), this.currency));
  }

  // ── Rounding ───────────────────────────────────────────────────────────

  /**
   * Round to the currency's settlement precision using banker's rounding.
   * USD → 2 dp, JPY → 0 dp, KWD → 3 dp.
   */
  roundToCurrency(): Money {
    const exponent = getCurrencyExponent(this.currency);
    return new Money(this.value.toDecimalPlaces(exponent, Decimal.ROUND_HALF_EVEN), this.currency);
  }

  // ── Comparison ─────────────────────────────────────────────────────────

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  /** @returns -1, 0, or 1. Throws on a currency mismatch rather than comparing magnitudes. */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other, 'compare');
    return this.value.comparedTo(other.value) as -1 | 0 | 1;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) === 1;
  }
  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }
  lessThan(other: Money): boolean {
    return this.compare(other) === -1;
  }
  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  isZero(): boolean {
    return this.value.isZero();
  }
  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }
  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  // ── Aggregation ────────────────────────────────────────────────────────

  /**
   * Sum a list. Requires an explicit currency so that summing an empty list
   * yields a correctly-denominated zero rather than throwing or guessing.
   */
  static sum(amounts: readonly Money[], currency: string): Money {
    const code = normalizeCurrencyCode(currency);
    return amounts.reduce<Money>((acc, amount) => acc.add(amount), Money.zero(code));
  }

  // ── Serialisation ──────────────────────────────────────────────────────

  /** Fixed-scale decimal string, e.g. `"2400.0000"`. The database representation. */
  toString(): string {
    return this.value.toFixed(MONEY_SCALE);
  }

  /** The wire format. Always a string; never a JSON number. */
  toJSON(): MoneyJSON {
    return { amount: this.toString(), currency: this.currency };
  }

  /** Integer minor units, using the currency's exponent. */
  toMinorUnits(): bigint {
    const exponent = getCurrencyExponent(this.currency);
    const rounded = this.value
      .times(new D(10).pow(exponent))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    return BigInt(rounded.toFixed(0));
  }

  /**
   * Escape hatch to a plain number, for charts and other presentation-only
   * consumers. Named to be conspicuous in review. **Never** feed the result
   * back into a financial calculation or persist it.
   */
  toUnsafeNumber(): number {
    return this.value.toNumber();
  }

  /** Localised display string. Presentation only. */
  format(locale = 'en-US'): string {
    const exponent = getCurrencyExponent(this.currency);
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(this.roundToCurrency().toUnsafeNumber());
  }

  /* c8 ignore next 3 */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Money(${this.toString()} ${this.currency})`;
  }
}
