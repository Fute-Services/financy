/**
 * `@financy/core` — domain primitives.
 *
 * Zero I/O, zero framework, zero database. Everything here is a pure function
 * of its inputs, which is what makes the money handling, the policy engine,
 * and the state machines exhaustively testable without infrastructure.
 *
 * Nothing in this package may import from `@financy/db`, NestJS, Next.js, or
 * any provider SDK. That constraint is what keeps the domain layer honest.
 */

export {
  Money,
  MONEY_SCALE,
  CurrencyMismatchError,
  InvalidMoneyError,
  type MoneyJSON,
} from './money.js';

export {
  getCurrency,
  getCurrencyExponent,
  isSupportedCurrency,
  normalizeCurrencyCode,
  UnknownCurrencyError,
  SUPPORTED_CURRENCY_CODES,
  type CurrencyDefinition,
} from './currency.js';

export * from './errors.js';
export * from './ids.js';
export * from './result.js';
export * from './state-machine.js';
export * from './period.js';
export * from './file-type.js';

export * from './policy/index.js';
