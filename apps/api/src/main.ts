import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { ConfigService, ConfigurationError, loadEnvironment } from './platform/index.js';

/** Enough for a large JSON body; file uploads go through signed URLs, not here. */
const BODY_LIMIT = '1mb';

/**
 * How long a shutting-down instance is given to finish what it is doing
 * before the process exits. Matches the 30 s drain in `docs/17 §6`.
 */
const SHUTDOWN_GRACE_MS = 30_000;

async function bootstrap(): Promise<void> {
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
      // for a page do not apply. `apps/web` sets its own CSP.
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

  /**
   * Lets `onModuleDestroy` run on SIGTERM, which is what closes the Prisma
   * connection pool cleanly. Without it a rolling deploy leaves connections
   * open until PostgreSQL times them out.
   */
  app.enableShutdownHooks();

  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(
    {
      port,
      appEnv: config.get('APP_ENV'),
      documentProvider: config.get('DOCUMENT_PROVIDER'),
      queue: config.get('REDIS_URL') === undefined ? 'inline' : 'bullmq',
    },
    'Financy API listening',
  );

  const shutdown = (signal: string) => {
    logger.log({ signal }, 'Shutting down');

    const timer = setTimeout(() => {
      logger.error({ signal }, 'Graceful shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);

    // Do not hold the event loop open just to wait for the deadline we may
    // never reach.
    timer.unref();

    void app.close().then(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

bootstrap().catch((error: unknown) => {
  /**
   * Startup failures are printed with `console.error`, not the logger: the
   * logger may be exactly what failed to construct, and a configuration error
   * that produced no output because logging was broken is the worst possible
   * way to spend an afternoon.
   */
  if (error instanceof ConfigurationError) {
    console.error(`\n${error.message}\n`);
    console.error('Copy .env.example to .env and fill it in. See README, "Getting started".\n');
  } else {
    console.error(error);
  }

  process.exit(1);
});
