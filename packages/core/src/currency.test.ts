import { describe, it, expect } from 'vitest';
import {
  getCurrency,
  getCurrencyExponent,
  isSupportedCurrency,
  normalizeCurrencyCode,
  UnknownCurrencyError,
  SUPPORTED_CURRENCY_CODES,
} from './currency.js';

describe('currency registry', () => {
  it('returns a full definition for a supported code', () => {
    expect(getCurrency('USD')).toEqual({
      code: 'USD',
      exponent: 2,
      symbol: '$',
      name: 'US Dollar',
    });
  });

  it('carries the correct exponent for non-two-decimal currencies', () => {
    // The reason this table exists: "round to 2 decimal places" is wrong for
    // both of these, and an allocation distributing cents would distribute
    // the wrong unit.
    expect(getCurrencyExponent('USD')).toBe(2);
    expect(getCurrencyExponent('JPY')).toBe(0);
    expect(getCurrencyExponent('KRW')).toBe(0);
    expect(getCurrencyExponent('KWD')).toBe(3);
    expect(getCurrencyExponent('BHD')).toBe(3);
    expect(getCurrencyExponent('OMR')).toBe(3);
    expect(getCurrencyExponent('TND')).toBe(3);
  });

  it('reports support membership', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    // Guards against a prototype-pollution style lookup succeeding.
    expect(isSupportedCurrency('toString')).toBe(false);
    expect(isSupportedCurrency('constructor')).toBe(false);
  });

  it('throws a named error for an unknown code, listing what is supported', () => {
    expect(() => getCurrency('XYZ')).toThrow(UnknownCurrencyError);
    try {
      getCurrency('XYZ');
      expect.unreachable('should have thrown');
    } catch (error) {
      const e = error as UnknownCurrencyError;
      expect(e.code).toBe('UNKNOWN_CURRENCY');
      expect(e.currency).toBe('XYZ');
      expect(e.message).toContain('USD');
    }
  });

  it('exposes a frozen list of supported codes', () => {
    expect(SUPPORTED_CURRENCY_CODES).toContain('USD');
    expect(SUPPORTED_CURRENCY_CODES).toContain('JPY');
    expect(SUPPORTED_CURRENCY_CODES.length).toBeGreaterThan(20);
    expect(Object.isFrozen(SUPPORTED_CURRENCY_CODES)).toBe(true);
  });
});

describe('currency normalisation', () => {
  it('uppercases and trims', () => {
    expect(normalizeCurrencyCode('usd')).toBe('USD');
    expect(normalizeCurrencyCode('  eur  ')).toBe('EUR');
    expect(normalizeCurrencyCode('GbP')).toBe('GBP');
  });

  it('rejects anything that is not three letters, rather than coercing it', () => {
    // A coerced currency is a silently wrong financial record, which is worse
    // than a rejected request.
    for (const bad of ['', 'US', 'USDD', '123', 'US$', 'U S', 'dollar']) {
      expect(() => normalizeCurrencyCode(bad), `expected "${bad}" to be rejected`).toThrow(
        UnknownCurrencyError,
      );
    }
  });

  it('rejects a well-formed but unsupported code', () => {
    // Far more likely to be a typo or a truncated value than a legitimate
    // exotic currency — so it is refused rather than accepted silently.
    expect(() => normalizeCurrencyCode('XAU')).toThrow(UnknownCurrencyError);
  });
});
