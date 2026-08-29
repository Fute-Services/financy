/**
 * ISO 4217 currency support.
 *
 * The exponent matters more than it looks. Most currencies have two minor
 * units, but JPY has zero and KWD has three — so "round to 2 decimal places"
 * is wrong for both, and an allocation that distributes remainders in cents
 * would distribute them incorrectly. Every rounding and allocation operation
 * in {@link Money} consults this table rather than assuming.
 *
 * @see docs/07-NON-FUNCTIONAL-REQUIREMENTS.md §7 (NFR-FIN-004)
 */

export interface CurrencyDefinition {
  /** ISO 4217 alphabetic code. */
  readonly code: string;
  /** Number of digits after the decimal separator for settlement. */
  readonly exponent: 0 | 2 | 3;
  /** Display symbol. Not unique — never use it as an identifier. */
  readonly symbol: string;
  readonly name: string;
}

/**
 * Supported currencies.
 *
 * Deliberately a curated list rather than the full ISO table: an unrecognised
 * code is far more likely to be a bug (a typo, a locale string, a truncated
 * value) than a legitimate exotic currency, and accepting it silently would
 * let bad data into financial records. Adding a currency is a one-line,
 * reviewed change.
 */
const CURRENCIES: Record<string, CurrencyDefinition> = {
  USD: { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar' },
  EUR: { code: 'EUR', exponent: 2, symbol: '€', name: 'Euro' },
  GBP: { code: 'GBP', exponent: 2, symbol: '£', name: 'Pound Sterling' },
  CAD: { code: 'CAD', exponent: 2, symbol: 'CA$', name: 'Canadian Dollar' },
  AUD: { code: 'AUD', exponent: 2, symbol: 'A$', name: 'Australian Dollar' },
  NZD: { code: 'NZD', exponent: 2, symbol: 'NZ$', name: 'New Zealand Dollar' },
  CHF: { code: 'CHF', exponent: 2, symbol: 'CHF', name: 'Swiss Franc' },
  SEK: { code: 'SEK', exponent: 2, symbol: 'kr', name: 'Swedish Krona' },
  NOK: { code: 'NOK', exponent: 2, symbol: 'kr', name: 'Norwegian Krone' },
  DKK: { code: 'DKK', exponent: 2, symbol: 'kr', name: 'Danish Krone' },
  PLN: { code: 'PLN', exponent: 2, symbol: 'zł', name: 'Polish Złoty' },
  CZK: { code: 'CZK', exponent: 2, symbol: 'Kč', name: 'Czech Koruna' },
  SGD: { code: 'SGD', exponent: 2, symbol: 'S$', name: 'Singapore Dollar' },
  HKD: { code: 'HKD', exponent: 2, symbol: 'HK$', name: 'Hong Kong Dollar' },
  INR: { code: 'INR', exponent: 2, symbol: '₹', name: 'Indian Rupee' },
  ZAR: { code: 'ZAR', exponent: 2, symbol: 'R', name: 'South African Rand' },
  BRL: { code: 'BRL', exponent: 2, symbol: 'R$', name: 'Brazilian Real' },
  MXN: { code: 'MXN', exponent: 2, symbol: 'MX$', name: 'Mexican Peso' },
  AED: { code: 'AED', exponent: 2, symbol: 'AED', name: 'UAE Dirham' },
  // Zero-exponent: no minor unit at all.
  JPY: { code: 'JPY', exponent: 0, symbol: '¥', name: 'Japanese Yen' },
  KRW: { code: 'KRW', exponent: 0, symbol: '₩', name: 'South Korean Won' },
  // Three-exponent: thousandths.
  KWD: { code: 'KWD', exponent: 3, symbol: 'KD', name: 'Kuwaiti Dinar' },
  BHD: { code: 'BHD', exponent: 3, symbol: 'BD', name: 'Bahraini Dinar' },
  OMR: { code: 'OMR', exponent: 3, symbol: 'OMR', name: 'Omani Rial' },
  TND: { code: 'TND', exponent: 3, symbol: 'DT', name: 'Tunisian Dinar' },
};

export const SUPPORTED_CURRENCY_CODES: readonly string[] = Object.freeze(Object.keys(CURRENCIES));

/** Thrown when a currency code is not recognised. */
export class UnknownCurrencyError extends Error {
  readonly code = 'UNKNOWN_CURRENCY';
  constructor(public readonly currency: string) {
    super(
      `Unknown currency "${currency}". Supported: ${SUPPORTED_CURRENCY_CODES.join(', ')}. ` +
        'Add it to packages/core/src/currency.ts if it is legitimate.',
    );
    this.name = 'UnknownCurrencyError';
  }
}

export function isSupportedCurrency(code: string): boolean {
  return Object.hasOwn(CURRENCIES, code);
}

export function getCurrency(code: string): CurrencyDefinition {
  const definition = CURRENCIES[code];
  if (!definition) throw new UnknownCurrencyError(code);
  return definition;
}

/**
 * Digits after the decimal point used when settling in this currency.
 * Not the same as {@link Money}'s internal scale, which is always 4.
 */
export function getCurrencyExponent(code: string): number {
  return getCurrency(code).exponent;
}

/**
 * Normalise and validate a currency code.
 *
 * Uppercasing is a convenience; anything that is not three letters is rejected
 * outright rather than coerced, because a coerced currency is a silently wrong
 * financial record.
 */
export function normalizeCurrencyCode(code: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) throw new UnknownCurrencyError(code);
  if (!isSupportedCurrency(upper)) throw new UnknownCurrencyError(upper);
  return upper;
}
