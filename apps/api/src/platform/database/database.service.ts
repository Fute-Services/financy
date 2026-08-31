import {
  createPrismaClient,
  withTenantScope,
  type PrismaClient,
  type TenantScopedPrismaClient,
} from '@financy/db';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ConfigService } from '../config/index.js';
import { getOrganizationId } from '../request-context/index.js';

/**
 * The database connection, and the only place the unscoped Prisma client is
 * reachable.
 *
 * Repositories receive {@link DatabaseService.client}, which is the
 * tenant-scoped one. The raw client stays private so that "forgot the
 * organisation predicate" is not a mistake anyone is in a position to make —
 * the lint rule banning `@prisma/client` imports elsewhere closes the other
 * route to it (docs/08 §4.3).
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  /** Tenant-scoped. This is what everything above the platform layer gets. */
  readonly client: TenantScopedPrismaClient;

  /**
   * The **unscoped** client. Almost nothing may use this.
   *
   * A handful of operations legitimately run before any tenant context exists,
   * and the tenant extension would fail them closed — correctly, because at
   * that moment there is genuinely no organisation to scope by:
   *
   * - **Login**, which resolves a user by email before knowing their org.
   * - **Registration**, which creates the organisation it would scope to.
   * - **Session resolution**, which is what establishes the context.
   * - **Invitation acceptance**, where the token is the authorisation and it
   *   determines which organisation is being joined.
   *
   * Every one of those is in `modules/auth`. Anywhere else, reaching for this
   * means the tenant predicate is being bypassed, which is the bug this whole
   * layer exists to prevent — use {@link client} and let it fail closed.
   */
  readonly unscoped: PrismaClient;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.prisma = createPrismaClient({
      databaseUrl: config.get('DATABASE_URL'),

      // Query logging prints parameters, and the parameters here are email
      // addresses and monetary amounts. Development only, and never on
      // merely because the log level happens to be `debug` in staging.
      logQueries: config.get('LOG_LEVEL') === 'trace' && !config.isProductionLike,

      onLog: (event) => {
        if (event.level === 'error') this.logger.error({ prisma: event }, event.message);
        else if (event.level === 'warn') this.logger.warn({ prisma: event }, event.message);
        else this.logger.debug({ prisma: event }, event.message);
      },
    });

    this.unscoped = this.prisma;
    this.client = withTenantScope(this.prisma, getOrganizationId);
  }

  /**
   * Connect eagerly, but do not make startup conditional on it.
   *
   * Eagerly, because Prisma connects lazily and a bad `DATABASE_URL` would
   * otherwise be discovered by the first user rather than by the deploy.
   *
   * Not fatally, because the deployment model gates instances on
   * `/health/ready`, not on whether they started (docs/17 §6). An instance
   * that refuses to boot during a database blip crash-loops through a rolling
   * deploy and takes the *old* instances down with it as they are drained; one
   * that boots and reports not-ready simply never receives traffic, and joins
   * the pool by itself when the database returns.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$connect();
    } catch (error) {
      this.logger.error(
        { err: error },
        'Could not connect to the database at startup. The instance will report not-ready until it can.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * A liveness probe for the connection itself.
   *
   * The server's own `ping` command rather than a collection read, so
   * readiness does not depend on any particular collection existing or on the
   * application user holding read access to it.
   */
  async ping(): Promise<void> {
    await this.prisma.$runCommandRaw({ ping: 1 });
  }
}
