import { PrismaClient } from '@prisma/client';

export type { PrismaClient };

import { tenantExtension, type OrganizationResolver } from './tenancy/tenant-extension.js';

export type LogEvent = {
  level: 'query' | 'info' | 'warn' | 'error';
  message: string;
  durationMs?: number;
};

export interface PrismaClientOptions {
  readonly databaseUrl: string;
  /**
   * Emit every statement. Development only — a query log in production is a
   * PII leak in the shape of a log file, and the parameters it prints include
   * email addresses and monetary amounts.
   */
  readonly logQueries?: boolean;
  /**
   * Where Prisma's own diagnostics go. Passed in rather than imported so this
   * package does not depend on the application's logger, which would invert
   * the dependency between the data layer and the framework.
   */
  readonly onLog?: (event: LogEvent) => void;
}

/**
 * Build a Prisma client.
 *
 * A factory rather than a module-level singleton: tests need several clients
 * (one per fixture database, one with no tenant context), and a singleton
 * created at import time connects to whatever `DATABASE_URL` happened to be
 * set when the module was first required — which in a test run is rarely the
 * database the test meant.
 */
export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const client = new PrismaClient({
    datasources: { db: { url: options.databaseUrl } },
    log: [
      ...(options.logQueries ? ([{ emit: 'event', level: 'query' }] as const) : []),
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  if (options.onLog) {
    const forward = options.onLog;

    // `as never` on the event names: Prisma types the event map from the `log`
    // option, which is built conditionally above, so it cannot narrow it here.
    client.$on('query' as never, (event: { query: string; duration: number }) => {
      forward({ level: 'query', message: event.query, durationMs: event.duration });
    });

    for (const level of ['info', 'warn', 'error'] as const) {
      client.$on(level as never, (event: { message: string }) => {
        forward({ level, message: event.message });
      });
    }
  }

  return client;
}

/**
 * Wrap a client so every query is tenant-scoped.
 *
 * The unwrapped client should not escape the platform database module.
 * Repositories receive this one, which is why a repository cannot forget the
 * organisation predicate — it is not their responsibility to remember.
 */
export function withTenantScope(client: PrismaClient, resolveOrganizationId: OrganizationResolver) {
  return client.$extends(tenantExtension(resolveOrganizationId));
}

export type TenantScopedPrismaClient = ReturnType<typeof withTenantScope>;
