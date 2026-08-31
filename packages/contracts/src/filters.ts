/**
 * Query-string filtering and sorting (docs/10 §2.6).
 *
 * The rule that shapes this module: **an unknown filter parameter is a `422`,
 * not a silent ignore.** Silently dropping `?statuss=APPROVED` is how someone
 * exports a file they believe is filtered, reconciles against it, and is
 * wrong. Every query schema is therefore built with {@link strictQuery}.
 */

import { z } from 'zod';

import {
  compareDecimalStrings,
  dateOnlySchema,
  decimalStringSchema,
  nonEmptyString,
} from './primitives.js';

/**
 * Build a query schema that rejects unknown keys.
 *
 * Also drops the empty-string values a browser form submits for untouched
 * inputs, so `?q=&status=OPEN` means "status OPEN", not "empty search".
 */
export function strictQuery<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess((raw) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(([, value]) => value !== ''),
    );
  }, z.strictObject(shape));
}

/**
 * A repeatable parameter: `?status=APPROVED&status=FULFILLED` is an OR.
 *
 * Express parses one occurrence as a string and several as an array, so the
 * schema normalises both to an array rather than making every call site
 * remember which it got.
 */
export function multiValue<T extends z.ZodType>(item: T) {
  return z
    .union([item, z.array(item)])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    );
}

export type SortDirection = 'asc' | 'desc';

export interface SortSpec<TField extends string> {
  field: TField;
  direction: SortDirection;
}

/**
 * `?sort=occurredAt:desc`.
 *
 * The allowed fields are an explicit list per endpoint, never "any column".
 * An open sort parameter is both an index-planning problem and an information
 * leak — sorting by a column you cannot read still orders the rows by it.
 */
export function sortSchema<const TFields extends readonly [string, ...string[]]>(
  allowedFields: TFields,
  fallback: { field: TFields[number]; direction: SortDirection },
) {
  const fieldSet = new Set<string>(allowedFields);

  return z
    .string()
    .optional()
    .transform((value, ctx): SortSpec<TFields[number]> => {
      if (value === undefined) return fallback;

      const [field, direction = 'asc'] = value.split(':');

      if (field === undefined || !fieldSet.has(field)) {
        ctx.addIssue({
          code: 'custom',
          message: `must sort by one of: ${allowedFields.join(', ')}`,
        });
        return fallback;
      }

      if (direction !== 'asc' && direction !== 'desc') {
        ctx.addIssue({ code: 'custom', message: 'sort direction must be asc or desc' });
        return fallback;
      }

      return { field, direction };
    });
}

/** `?q=acme` — free-text search, bounded so it cannot become a scan payload. */
export const searchQuerySchema = nonEmptyString(128).optional();

/**
 * `?occurredFrom=2026-08-01&occurredTo=2026-08-31`.
 *
 * Inclusive on both ends, and an inverted range is rejected rather than
 * quietly returning nothing — an empty result reads as "no data" to a user,
 * which is a different and much more misleading answer than "bad range".
 */
export function dateRangeSchema(fromKey: string, toKey: string) {
  return z
    .object({
      [fromKey]: dateOnlySchema.optional(),
      [toKey]: dateOnlySchema.optional(),
    })
    .refine(
      (value) => {
        const from = value[fromKey];
        const to = value[toKey];
        return from === undefined || to === undefined || from <= to;
      },
      { error: `${fromKey} must not be after ${toKey}`, path: [fromKey] },
    );
}

/**
 * `?amountMin=100&amountMax=5000`.
 *
 * Strings, like every other monetary value on the wire, and currency-free:
 * the endpoint applies them within the currency it is already filtering or
 * grouping by. Comparing a bound against mixed currencies would be arithmetic
 * across currencies, which this system never does.
 */
export const amountRangeSchema = z
  .object({
    amountMin: decimalStringSchema.optional(),
    amountMax: decimalStringSchema.optional(),
  })
  .refine(
    (value) =>
      value.amountMin === undefined ||
      value.amountMax === undefined ||
      compareDecimalStrings(value.amountMin, value.amountMax) <= 0,
    { error: 'amountMin must not be greater than amountMax', path: ['amountMin'] },
  );
