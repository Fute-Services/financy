import { moneySchema } from '@financy/contracts';
import { ValidationError } from '@financy/core';
import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe.js';

const meta: ArgumentMetadata = { type: 'body' };

describe('ZodValidationPipe', () => {
  it('returns the parsed value', () => {
    const pipe = new ZodValidationPipe(z.strictObject({ name: z.string() }));
    expect(pipe.transform({ name: 'Acme' }, meta)).toEqual({ name: 'Acme' });
  });

  /**
   * The handler must receive the *normalised* value. Validating one thing and
   * then using another is a validation that proves nothing.
   */
  it('hands the handler the transformed value, not the raw one', () => {
    const pipe = new ZodValidationPipe(z.strictObject({ email: z.string().trim().toLowerCase() }));
    expect(pipe.transform({ email: '  Ada@Example.COM ' }, meta)).toEqual({
      email: 'ada@example.com',
    });
  });

  it('raises a domain ValidationError, so it takes the same path as any other 422', () => {
    const pipe = new ZodValidationPipe(z.strictObject({ name: z.string() }));
    expect(() => pipe.transform({ name: 42 }, meta)).toThrow(ValidationError);
  });

  it('reports every field at once, keyed by path', () => {
    const pipe = new ZodValidationPipe(z.strictObject({ name: z.string(), amount: moneySchema }));

    try {
      pipe.transform({ name: 42, amount: { amount: 'x', currency: 'ZZZ' } }, meta);
      expect.unreachable('should have thrown');
    } catch (error) {
      const fields = (error as ValidationError).details?.['fields'] as Record<string, string[]>;
      expect(Object.keys(fields)).toEqual(expect.arrayContaining(['name', 'amount.currency']));
    }
  });

  /**
   * The reason contract schemas are strict. Without this, a client could send
   * `organizationId` or a pre-computed `total` and rely on the server reading
   * one of them by mistake — the field simply must not survive the boundary.
   */
  it('rejects an unknown key rather than dropping it', () => {
    const pipe = new ZodValidationPipe(z.strictObject({ name: z.string() }));
    expect(() => pipe.transform({ name: 'Acme', organizationId: 'org-b' }, meta)).toThrow(
      ValidationError,
    );
  });

  it('rethrows a non-Zod failure untouched', () => {
    const exploding = z.string().transform(() => {
      throw new RangeError('not a validation problem');
    });

    expect(() => new ZodValidationPipe(exploding).transform('x', meta)).toThrow(RangeError);
  });
});
