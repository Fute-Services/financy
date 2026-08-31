import {
  HTTP_STATUS_BY_ERROR_CODE,
  HEADER,
  toFieldErrors,
  type ErrorResponse,
} from '@financy/contracts';
import { isAppError, type ErrorCode } from '@financy/core';
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';

import { getCorrelationId } from '../request-context/index.js';

/**
 * Nest statuses that map onto a code in our taxonomy. Anything else from the
 * framework is a 500 as far as the client is concerned, because a status we
 * did not choose deliberately is not a contract we can keep.
 */
const CODE_BY_HTTP_STATUS: Readonly<Record<number, ErrorCode>> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'RESOURCE_NOT_FOUND',
  409: 'INVALID_STATE_TRANSITION',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

interface Normalised {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  /** The original, for the log. Never for the response. */
  cause: unknown;
}

/**
 * The single exit for every error the API produces.
 *
 * Two rules shape it:
 *
 * 1. **Every error response has the same shape** — a stable `code`, a human
 *    `message`, and a `correlationId` (docs/10 §3). Clients branch on the
 *    code; support quotes the correlation id. A stray framework error page
 *    breaks both.
 * 2. **Internals never reach the client.** A stack trace or a driver message
 *    tells an attacker the schema, the ORM, and often a column name. What the
 *    caller gets is a generic message and the correlation id; what we get is
 *    the whole thing in the log, joined to their request by that id.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const correlationId = getCorrelationId();

    const normalised = this.normalise(exception);

    this.log(normalised, request, correlationId);

    const body: ErrorResponse = {
      error: {
        code: normalised.code,
        message: normalised.message,
        ...(normalised.details ? { details: normalised.details } : {}),
        correlationId,
      },
    };

    // Set even on the error path: a client that retries needs the same handle
    // a successful response would have given it.
    response.setHeader(HEADER.correlationId, correlationId);

    if (normalised.code === 'RATE_LIMITED') {
      const retryAfter = normalised.details?.['retryAfterSeconds'];
      if (typeof retryAfter === 'number') {
        response.setHeader(HEADER.retryAfter, String(retryAfter));
      }
    }

    response.status(normalised.status).json(body);
  }

  private normalise(exception: unknown): Normalised {
    /**
     * A domain error. The taxonomy already decided the code and the status,
     * and the message was written to be read by a user — so it is passed
     * through unchanged. This is the path almost every 4xx takes.
     */
    if (isAppError(exception)) {
      return {
        status: HTTP_STATUS_BY_ERROR_CODE[exception.code] ?? exception.httpStatus,
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
        cause: exception,
      };
    }

    /**
     * A schema failure that escaped the validation pipe — a response schema
     * assertion, or a `parse` inside a service. Same 422 and the same
     * field-keyed map the pipe produces, so the client cannot tell the
     * difference and does not have to.
     */
    if (exception instanceof ZodError) {
      return {
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.',
        details: { fields: toFieldErrors(exception) },
        cause: exception,
      };
    }

    /**
     * Framework errors: an unmatched route, a payload over the body limit, a
     * guard that threw `ForbiddenException`. Mapped onto our codes where the
     * meaning is unambiguous, and to a 500 where it is not.
     */
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_HTTP_STATUS[status];

      if (code === undefined) {
        return {
          status: status >= 500 ? status : 500,
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong. Please try again.',
          cause: exception,
        };
      }

      return { status, code, message: exception.message, cause: exception };
    }

    /**
     * Anything else: a bug, a driver failure, an out-of-memory. The message is
     * deliberately identical for all of them.
     */
    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      cause: exception,
    };
  }

  private log(normalised: Normalised, request: Request, correlationId: string): void {
    const context = {
      correlationId,
      code: normalised.code,
      status: normalised.status,
      method: request.method,
      path: request.path,
    };

    if (normalised.status >= 500) {
      // The full error, with its stack, so the correlation id in the client's
      // hand leads to something worth reading.
      this.logger.error({ ...context, err: normalised.cause }, normalised.message);
      return;
    }

    /**
     * A 4xx is expected traffic, not an incident — except these three, which
     * are attempts to cross a boundary and are logged loudly on purpose.
     * Phase 1 promotes them to security events (`12 §7`).
     */
    const isBoundaryViolation =
      normalised.code === 'TENANT_MISMATCH' ||
      normalised.code === 'SELF_ELEVATION_FORBIDDEN' ||
      normalised.code === 'AUDITOR_READ_ONLY';

    if (isBoundaryViolation) {
      this.logger.warn({ ...context, securityRelevant: true }, normalised.message);
      return;
    }

    this.logger.debug(context, normalised.message);
  }
}
