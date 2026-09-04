import { Logger } from 'nestjs-pino';

import { createApp } from './create-app.js';
import { ConfigService, ConfigurationError } from './platform/index.js';

/**
 * How long a shutting-down instance is given to finish what it is doing
 * before the process exits. Matches the 30 s drain in `docs/17 §6`.
 */
const SHUTDOWN_GRACE_MS = 30_000;

/**
 * The long-lived process.
 *
 * Everything about *what* the application is lives in `create-app.ts`, shared
 * with the serverless entrypoint. What is left here is what only a process
 * that owns a port can do: listen, and shut down when told to.
 */
async function bootstrap(): Promise<void> {
  const app = await createApp();

  /**
   * Lets `onModuleDestroy` run on SIGTERM, which is what closes the Prisma
   * connection pool cleanly. Without it a rolling deploy leaves connections
   * open until PostgreSQL times them out.
   */
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
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
