import { ValidationError } from '@financy/core';
import { toFieldErrors } from '@financy/contracts';
import { type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/**
 * Validate a request payload against a schema from `@financy/contracts`.
 *
 * Used per-parameter rather than globally, because the schema is what makes
 * it useful and a global pipe has no way to know which one applies:
 *
 * ```ts
 * create(@Body(new ZodValidationPipe(createSpendRequestSchema)) dto: CreateSpendRequest) { … }
 * ```
 *
 * Two properties matter more than the validation itself:
 *
 * - **The parsed value replaces the raw one.** Schemas trim, lower-case, and
 *   coerce, so the handler receives the normalised value rather than whatever
 *   the client sent. A handler that validated and then used the original
 *   would be validating something it does not go on to use.
 * - **Unknown keys are rejected**, because the contract schemas are strict.
 *   That is what stops a client smuggling `organizationId` or a computed
 *   `total` into a request body: the field does not exist, so the request
 *   fails rather than the value being quietly ignored — or, worse, read.
 */
export class ZodValidationPipe<TSchema extends ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        // Converted into the domain error so it takes the same path through
        // the exception filter as a validation failure raised by a service.
        // One 422 shape, from one place.
        throw new ValidationError(toFieldErrors(error));
      }

      throw error;
    }
  }
}
