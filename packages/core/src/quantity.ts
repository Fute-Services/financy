import Decimal from 'decimal.js';

/**
 * Exact decimal arithmetic for things that are counted, not paid.
 *
 * ## Why this is not `Money`
 *
 * Purchase order lines, receipts, and three-way matching all deal in
 * quantities — 3 laptops, 2.5 metres, 0.75 days. They need the same exactness
 * money does: `0.1 + 0.2` is famously not `0.3` in binary floating point, and a
 * warehouse that receives a third of a shipment three times should end up with
 * all of it.
 *
 * What they emphatically do not have is a **currency**. Reaching for `Money`
 * with a placeholder code — `XXX`, or the order's own currency — makes every
 * quantity look like an amount to every reader and to every type check, and the
 * first person to sum a column of them gets a number in dollars that counts
 * laptops.
 *
 * ## The scale matches the money columns
 *
 * Four decimal places, the same as `NUMERIC(20,4)`, so a quantity and an amount
 * round the same way and a line total computed from them cannot disagree with
 * itself by a rounding step.
 */
const SCALE = 4;

const Q = Decimal.clone({
  precision: 34,
  // Half-even, matching `Money`. Half-up biases a long column of values
  // upward, which over a year of receipts is a real drift in the wrong
  // direction.
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -18,
  toExpPos: 34,
});

export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

/**
 * Parse and normalise one quantity.
 *
 * Rejects a JavaScript `number` for the same reason `Money` does: by the time a
 * value is a `number` it may already have lost precision, and accepting one
 * here would make the loss this module's fault rather than the caller's.
 */
export function quantity(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidQuantityError('A quantity must be a decimal string.');
  }

  let parsed: Decimal;

  try {
    parsed = new Q(value.trim());
  } catch {
    throw new InvalidQuantityError(`"${value}" is not a decimal number.`);
  }

  if (!parsed.isFinite()) {
    throw new InvalidQuantityError(`"${value}" is not a finite quantity.`);
  }

  return parsed.toFixed(SCALE);
}

export function addQuantities(left: string, right: string): string {
  return new Q(quantity(left)).plus(quantity(right)).toFixed(SCALE);
}

export function subtractQuantities(left: string, right: string): string {
  return new Q(quantity(left)).minus(quantity(right)).toFixed(SCALE);
}

export function sumQuantities(values: readonly string[]): string {
  return values.reduce((total, value) => addQuantities(total, value), '0');
}

/** Signed comparison, so a caller never has to parse to compare. */
export function compareQuantities(left: string, right: string): -1 | 0 | 1 {
  return new Q(quantity(left)).comparedTo(quantity(right)) as -1 | 0 | 1;
}

export function quantityIsZero(value: string): boolean {
  return new Q(quantity(value)).isZero();
}

export function quantityIsPositive(value: string): boolean {
  return new Q(quantity(value)).greaterThan(0);
}
