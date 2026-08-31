import { errorResponseSchema } from '@financy/contracts';
import {
  AuditorReadOnlyError,
  BudgetExceededError,
  NotFoundError,
  RateLimitError,
  TenantMismatchError,
  ValidationError,
} from '@financy/core';
import { ForbiddenException, HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { runWithContext } from '../request-context/index.js';
import { AppExceptionFilter } from './exception.filter.js';

const CORRELATION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function makeHost() {
  const json = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, setHeader, json }),
      getRequest: () => ({ method: 'POST', path: '/v1/spend-requests' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json, setHeader };
}

function makeLogger() {
  return { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() };
}

describe('AppExceptionFilter', () => {
  let logger: ReturnType<typeof makeLogger>;
  let filter: AppExceptionFilter;

  beforeEach(() => {
    logger = makeLogger();
    filter = new AppExceptionFilter(logger as never);
  });

  function handle(exception: unknown) {
    const { host, status, json, setHeader } = makeHost();

    runWithContext({ correlationId: CORRELATION_ID, startedAt: Date.now() }, () => {
      filter.catch(exception, host);
    });

    return {
      status: status.mock.calls[0]?.[0] as number,
      body: json.mock.calls[0]?.[0] as { error: { code: string; message: string } },
      setHeader,
    };
  }

  describe('domain errors', () => {
    it.each([
      [new NotFoundError('Spend request'), 404, 'RESOURCE_NOT_FOUND'],
      [new ValidationError({ amount: ['must be greater than 0'] }), 422, 'VALIDATION_FAILED'],
      [new BudgetExceededError(), 409, 'BUDGET_EXCEEDED'],
      [new RateLimitError(30), 429, 'RATE_LIMITED'],
    ])('maps %s to its status and code', (error, status, code) => {
      const result = handle(error);
      expect(result.status).toBe(status);
      expect(result.body.error.code).toBe(code);
    });

    it('passes the domain message through — it was written to be read', () => {
      expect(handle(new NotFoundError('Spend request')).body.error.message).toBe(
        'Spend request not found.',
      );
    });

    it('includes structured details for a client that can use them', () => {
      const body = handle(new ValidationError({ amount: ['must be greater than 0'] }))
        .body as unknown as {
        error: { details: { fields: Record<string, string[]> } };
      };
      expect(body.error.details.fields).toEqual({ amount: ['must be greater than 0'] });
    });

    it('sets Retry-After on a rate limit, so a client waits rather than hammering', () => {
      expect(handle(new RateLimitError(30)).setHeader).toHaveBeenCalledWith('retry-after', '30');
    });
  });

  describe('the response envelope', () => {
    it('always matches the published error schema', () => {
      for (const error of [new NotFoundError(), new Error('boom'), zodFailure()]) {
        expect(errorResponseSchema.safeParse(handle(error).body).success).toBe(true);
      }
    });

    it('always carries the correlation id, in the body and the header', () => {
      const result = handle(new Error('boom'));
      expect(result.body.error).toMatchObject({ correlationId: CORRELATION_ID });
      expect(result.setHeader).toHaveBeenCalledWith('x-correlation-id', CORRELATION_ID);
    });
  });

  describe('unknown errors', () => {
    /**
     * The security property of this filter. A stack trace or a driver message
     * names the ORM, often the schema, and sometimes a column — for free, to
     * anyone who can make the server throw.
     */
    it('never leaks the internal message', () => {
      const result = handle(new Error('relation "spend_requests" does not exist'));

      expect(result.status).toBe(500);
      expect(result.body.error.code).toBe('INTERNAL_ERROR');
      expect(result.body.error.message).toBe('Something went wrong. Please try again.');
      expect(JSON.stringify(result.body)).not.toContain('spend_requests');
    });

    it('handles a thrown non-Error without falling over', () => {
      expect(handle('a string').status).toBe(500);
      expect(handle(undefined).status).toBe(500);
    });

    it('logs the original at error level, so the correlation id leads somewhere', () => {
      const cause = new Error('relation "spend_requests" does not exist');
      handle(cause);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: CORRELATION_ID, err: cause }),
        expect.any(String),
      );
    });
  });

  describe('framework exceptions', () => {
    it('maps the statuses that have an unambiguous code', () => {
      expect(handle(new ForbiddenException()).body.error.code).toBe('FORBIDDEN');
    });

    it('does not invent a code for a status we did not choose', () => {
      const result = handle(new HttpException('Teapot', HttpStatus.I_AM_A_TEAPOT));
      expect(result.status).toBe(500);
      expect(result.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('logging levels', () => {
    it('logs an ordinary 4xx quietly — it is expected traffic, not an incident', () => {
      handle(new NotFoundError());
      expect(logger.debug).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    /**
     * These three are attempts to cross a boundary rather than ordinary
     * client mistakes, and Phase 1 promotes them to security events.
     */
    it.each([new TenantMismatchError(), new AuditorReadOnlyError()])(
      'flags a boundary violation as security-relevant',
      (error) => {
        handle(error);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ securityRelevant: true }),
          expect.any(String),
        );
      },
    );
  });

  describe('a Zod error that escapes the pipe', () => {
    it('is a 422 with the same field map the pipe would have produced', () => {
      const result = handle(zodFailure());

      expect(result.status).toBe(422);
      expect(result.body.error.code).toBe('VALIDATION_FAILED');
      expect(
        (result.body as unknown as { error: { details: { fields: Record<string, string[]> } } })
          .error.details.fields,
      ).toHaveProperty('amount');
    });
  });
});

/** A real `ZodError`, produced the way one actually occurs. */
function zodFailure() {
  const result = z.object({ amount: z.string() }).safeParse({ amount: 1 });
  if (result.success) throw new Error('fixture should not parse');
  return result.error;
}
