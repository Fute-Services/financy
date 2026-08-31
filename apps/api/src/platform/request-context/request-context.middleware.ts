import { newCorrelationId } from '@financy/core';
import { CORRELATION_ID_PATTERN, HEADER } from '@financy/contracts';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithContext } from './request-context.js';

/**
 * Opens the request context and pins a correlation id to it.
 *
 * Runs before everything else, so no code path can execute without a
 * correlation id — including the exception filter, which needs one precisely
 * when things have gone wrong.
 *
 * A client-supplied `X-Correlation-Id` is honoured, because tracing a request
 * across the web app and the API is exactly what the header is for. It is
 * validated first: the value ends up in log lines and in a response header,
 * and an unvalidated one is a log-injection and header-splitting vector for
 * the price of a `curl`.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header(HEADER.correlationId);
    const correlationId =
      supplied !== undefined && CORRELATION_ID_PATTERN.test(supplied)
        ? supplied
        : newCorrelationId();

    // Echoed back so the caller can quote it, and set before `next()` so it
    // survives a handler that throws.
    response.setHeader(HEADER.correlationId, correlationId);

    runWithContext({ correlationId, startedAt: Date.now() }, () => {
      next();
    });
  }
}
