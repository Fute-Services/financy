/**
 * Primitive schemas shared by every contract in the system.
 *
 * These are the smallest units the API agrees on. They exist here rather than
 * being re-declared per endpoint because a money field that is validated one
 * way in `spend-requests` and another way in `expenses` is a defect waiting
 * for a rounding difference to surface it.
 */

import { Money, SUPPORTED_CURRENCY_CODES, isValidId } from '@financy/core';
import { z } from 'zod';

// ── Identity ─────────────────────────────────────────────────────────────

/**
 * A record id.
 *
 * Ids are UUID v7 (ADR / docs/09 §1.1). The schema accepts any RFC-4122 UUID
 * rather than asserting version 7, because rejecting a well-formed id would
 * turn a data-provenance question into a validation failure for the caller,
 * and the id's *format* is what the contract actually depends on.
 */
export const idSchema = z.string().refine(isValidId, {
  error: 'must be a UUID',
});

/**
 * A branded id, so a `DepartmentId` cannot be passed where a `ProjectId` is
 * expected. The brand exists only in the type system; the wire format is a
 * plain string.
 */
export function brandedId<TBrand extends string>(): z.ZodType<TBrand & string> {
  return idSchema as unknown as z.ZodType<TBrand & string>;
}

/**
 * Characters a correlation id may contain.
 *
 * The API generates a v4 UUID, but it also **adopts** a well-formed id sent by
 * the caller, which is what lets one trace span the web app and the API. So
 * the schema is a character-class check rather than a UUID check — and it is a
 * check rather than a free string because the value ends up in log lines and
 * in a response header, where an unvalidated one is a log-injection and
 * header-splitting vector for the price of a `curl`.
 *
 * Shared with the API middleware, so what is accepted and what validates
 * cannot drift apart.
 */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export const correlationIdSchema = z.string().regex(CORRELATION_ID_PATTERN, {
  error: 'must be 8-128 characters of letters, digits, and _.:-',
});

// ── Strings ──────────────────────────────────────────────────────────────

/**
 * A required, human-entered string.
 *
 * Trimmed before length is measured, so `"   "` is empty rather than three
 * characters long. Every such field is bounded — an unbounded text column is
 * a denial-of-service vector and a storage surprise.
 */
export function nonEmptyString(maxLength: number): z.ZodString {
  return z
    .string()
    .trim()
    .min(1, { error: 'is required' })
    .max(maxLength, {
      error: `must be at most ${maxLength} characters`,
    });
}

/** An optional free-text field: empty string and absent both mean "not set". */
export function optionalText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, { error: `must be at most ${maxLength} characters` })
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();
}

/**
 * Email addresses are stored case-insensitively (`citext`, docs/09 §11), so
 * they are lower-cased here rather than at each call site.
 */
export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ error: 'must be a valid email address' }))
  .transform((value) => value.toLowerCase());

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'must be lowercase alphanumeric words separated by hyphens',
  });

// ── Time ─────────────────────────────────────────────────────────────────

/**
 * An instant, ISO-8601 with an explicit offset, always UTC
 * (docs/10 §2.3): `2026-08-29T14:32:11.482Z`.
 */
export const timestampSchema = z.iso.datetime({ offset: false });

/**
 * A calendar date with no timezone: `2026-08-29`.
 *
 * Due dates and budget periods are genuinely dates. Representing them as
 * instants introduces a timezone that does not exist and eventually moves a
 * month-end into the wrong month.
 */
export const dateOnlySchema = z.iso.date();

// ── Money ────────────────────────────────────────────────────────────────

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value): value is string => SUPPORTED_CURRENCY_CODES.includes(value), {
    error: 'must be a supported ISO-4217 currency code',
  });

/**
 * A decimal amount **as a string**, with at most four fractional digits.
 *
 * `z.number()` is deliberately absent from this schema and from every monetary
 * field in the API. `JSON.parse` produces IEEE-754 doubles, so a monetary JSON
 * *number* has already lost precision by the time any validator sees it — the
 * check would pass and the value would still be wrong. See docs/10 §2.2.
 */
export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,16}(\.\d{1,4})?$/, {
    error: 'must be a decimal string with at most 4 fractional digits',
  });

/** `{ "amount": "2400.0000", "currency": "USD" }` — the only monetary shape. */
export const moneySchema = z
  .strictObject({
    amount: decimalStringSchema,
    currency: currencyCodeSchema,
  })
  .refine(
    (value) => {
      try {
        Money.of(value.amount, value.currency);
        return true;
      } catch {
        return false;
      }
    },
    { error: 'is not a representable monetary amount' },
  );

export type MoneyInput = z.infer<typeof moneySchema>;

/** Money that must be strictly greater than zero — a request amount, a limit. */
export const positiveMoneySchema = moneySchema.refine(
  (value) => Money.of(value.amount, value.currency).isPositive(),
  { error: 'must be greater than zero' },
);

/** Money that may be zero but never negative — a balance, a remaining total. */
export const nonNegativeMoneySchema = moneySchema.refine(
  (value) => !Money.of(value.amount, value.currency).isNegative(),
  { error: 'must not be negative' },
);

// ── Concurrency ──────────────────────────────────────────────────────────

/**
 * The optimistic-concurrency token returned on every mutable record and sent
 * back in `If-Match` (docs/09 §1.7, docs/10 §2.8).
 */
export const versionSchema = z.int().min(1);

/**
 * Compare two decimal strings without going through a float.
 *
 * `Number('9007199254740993.0001')` is already wrong, so a validator that
 * compares monetary bounds numerically can accept an inverted range. This
 * compares digits: sign first, then integer magnitude, then a zero-padded
 * fraction.
 */
export function compareDecimalStrings(left: string, right: string): -1 | 0 | 1 {
  const parse = (value: string) => {
    const negative = value.startsWith('-');
    const [integer = '0', fraction = ''] = value.replace(/^[+-]/, '').split('.');
    return { negative, integer: integer.replace(/^0+(?=\d)/, ''), fraction };
  };

  const a = parse(left);
  const b = parse(right);

  // '-0' and '0' are the same amount. Treating them as different would make a
  // zero lower bound sort above a zero upper bound and reject a valid range.
  const isZero = (value: { integer: string; fraction: string }) =>
    /^0*$/.test(value.integer) && /^0*$/.test(value.fraction);
  if (isZero(a) && isZero(b)) return 0;

  if (a.negative !== b.negative) return a.negative ? -1 : 1;

  const sign = a.negative ? -1 : 1;
  const magnitude = (() => {
    if (a.integer.length !== b.integer.length) return a.integer.length < b.integer.length ? -1 : 1;
    if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1;

    const width = Math.max(a.fraction.length, b.fraction.length);
    const fa = a.fraction.padEnd(width, '0');
    const fb = b.fraction.padEnd(width, '0');
    if (fa === fb) return 0;
    return fa < fb ? -1 : 1;
  })();

  return (magnitude * sign) as -1 | 0 | 1;
}
