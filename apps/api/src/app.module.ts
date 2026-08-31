import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import {
  AppExceptionFilter,
  ConfigModule,
  DatabaseModule,
  HealthModule,
  LoggingModule,
  RequestContextMiddleware,
} from './platform/index.js';

/**
 * The application root.
 *
 * Phase 0 wires the platform only. Domain modules (`auth`, `organization`,
 * `policies`, …) land in `src/modules/` from Phase 1 and are added here — the
 * module map in `docs/08 §4.2` is the plan, and this file is where it becomes
 * real.
 *
 * Ordering matters in one place: `ConfigModule` first, because
 * `LoggingModule` and `DatabaseModule` both resolve their settings from it,
 * and a process that logs before it knows its log level has already lost the
 * first thing worth reading.
 */
@Module({
  imports: [ConfigModule, LoggingModule, DatabaseModule, HealthModule],
  providers: [
    {
      // Registered here rather than with `app.useGlobalFilters` so it takes
      // part in dependency injection and can hold the logger.
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including health and anything added later. The correlation
    // id has to exist before any other code runs, because the exception
    // filter needs one precisely when something has gone wrong early.
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
