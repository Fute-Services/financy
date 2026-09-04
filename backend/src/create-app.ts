import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { ConfigService, loadEnvironment } from './platform/index.js';

/** Enough for a large JSON body; file uploads go through signed URLs, not here. */
const BODY_LIMIT = '1mb';

/**
 * Everything that makes the application, up to but not including listening.
 *
 * Extracted from `main.ts` because there are now two ways this application
 * starts and only one of them owns a port:
 *
 *  - `main.ts` calls this, then `listen`, and installs signal handlers. That is
 *    the real deployment target — a long-lived process.
 *  - `api/index.js` calls this, then `init`, and hands Express to a serverless
 *    platform that owns the socket itself.
 *
 * The split exists so the two cannot drift. A serverless entrypoint that
 * rebuilt the middleware stack by hand would eventually be missing the CORS
 * origin list, or `trust proxy`, or the body limit — and each of those is a
 * security control rather than a nicety. There is one place they are
 * configured, and it is here.
 */
export async function createApp(): Promise<NestExpressApplication> {
  // Before the framework, so a misconfiguration is reported as a list of
  // variables rather than as a dependency-injection failure.
  loadEnvironment();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Hold log lines until the Pino logger is resolved, so startup output is
    // structured too rather than arriving in Nest's own format.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  /**
   * `/v1` is the stability contract (docs/10 §1): no breaking change ships
   * inside a version. Health is under it too, so there is exactly one prefix
   * to configure in a load balancer.
   */
  app.setGlobalPrefix('v1');

  app.use(
    helmet({
      // The API serves JSON, never a document, so the directives that matter
      // for a page do not apply. `frontend` sets its own CSP.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(cookieParser());

  /**
   * An explicit origin list with credentials enabled. `origin: true` reflects
   * whatever origin asked, which with `credentials: true` means any site can
   * make authenticated requests on a signed-in user's behalf.
   */
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'If-Match', 'X-Correlation-Id'],
    exposedHeaders: [
      'X-Correlation-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
      'Idempotent-Replay',
    ],
    maxAge: 600,
  });

  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

  /**
   * Behind a load balancer, `X-Forwarded-For` is the only source of the
   * client's address — and rate limiting keyed on the balancer's own IP
   * limits every user as if they were one. Enabled for one hop, not for any:
   * trusting the whole chain lets a client forge the header and defeat the
   * limit entirely.
   */
  app.set('trust proxy', 1);

  return app;
}
