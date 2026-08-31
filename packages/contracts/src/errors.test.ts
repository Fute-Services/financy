import {
  type AppError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@financy/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ERROR_CODES,
  HTTP_STATUS_BY_ERROR_CODE,
  errorResponseSchema,
  httpStatusForErrorCode,
  toFieldErrors,
} from './errors.js';

describe('the status map', () => {
  it('covers every code exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES.length).toBeGreaterThan(0);
  });

  it('maps every code to a real HTTP error status', () => {
    for (const code of ERROR_CODES) {
      const status = httpStatusForErrorCode(code);
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  /**
   * Cross-tenant access returns 404, never 403 — a 403 would confirm the
   * record exists (docs/10 §6). Worth asserting because it is the one place
   * where the obvious status is the wrong one.
   */
  it('returns 404 for a missing resource and 403 for a tenant mismatch', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE.RESOURCE_NOT_FOUND).toBe(404);
    expect(HTTP_STATUS_BY_ERROR_CODE.TENANT_MISMATCH).toBe(403);
  });

  /**
   * The domain classes and this map are two representations of one taxonomy.
   * If they disagree, a caller's status branch and their code branch disagree.
   */
  it.each([
    [new NotFoundError('Spend request'), 404],
    [new ValidationError({ amount: ['must be greater than 0'] }), 422],
    [new RateLimitError(30), 429],
    [new InternalError(), 500],
  ])('agrees with the domain error class', (error: AppError, expected) => {
    expect(httpStatusForErrorCode(error.code)).toBe(expected);
    expect(error.httpStatus).toBe(expected);
  });
});

describe('errorResponseSchema', () => {
  it('accepts the documented envelope', () => {
    const result = errorResponseSchema.safeParse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.',
        details: { fields: { amount: ['must be greater than 0'] } },
        correlationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      },
    });
    expect(result.success).toBe(true);
  });

  it('requires a correlation id — it is the handle support quotes', () => {
    expect(
      errorResponseSchema.safeParse({ error: { code: 'INTERNAL_ERROR', message: 'x' } }).success,
    ).toBe(false);
  });

  it('rejects a code outside the taxonomy', () => {
    expect(
      errorResponseSchema.safeParse({
        error: {
          code: 'SOMETHING_WENT_WRONG',
          message: 'x',
          correlationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        },
      }).success,
    ).toBe(false);
  });
});

describe('toFieldErrors', () => {
  const schema = z.object({
    amount: z.string().min(1),
    items: z.array(z.object({ quantity: z.number().int().positive() })),
  });

  it('keys messages by dotted path, including array indices', () => {
    const result = schema.safeParse({ amount: '', items: [{ quantity: 0 }] });
    expect(result.success).toBe(false);

    const fields = toFieldErrors(result.error!);
    expect(Object.keys(fields).sort()).toEqual(['amount', 'items.0.quantity']);
    expect(fields['amount']).toHaveLength(1);
  });

  it('keys a whole-object refinement failure as _ rather than dropping it', () => {
    const refined = z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b, {
      error: 'a must be less than b',
    });
    const result = refined.safeParse({ a: 2, b: 1 });
    expect(toFieldErrors(result.error!)['_']).toEqual(['a must be less than b']);
  });

  it('collects several messages for one field', () => {
    const strict = z.object({
      name: z
        .string()
        .min(5)
        .regex(/^[a-z]+$/),
    });
    const fields = toFieldErrors(strict.safeParse({ name: 'A1' }).error!);
    expect(fields['name']!.length).toBeGreaterThan(1);
  });
});
