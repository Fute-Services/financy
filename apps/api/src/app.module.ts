import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import {
  AppExceptionFilter,
  AuditModule,
  AuthGuard,
  ConfigModule,
  DatabaseModule,
  DocumentsModule,
  HealthModule,
  LoggingModule,
  QueueModule,
  RequestContextMiddleware,
} from './platform/index.js';
import { AuthModule } from './modules/auth/index.js';
import { AuditReadModule } from './modules/audit/index.js';
import { DepartmentsModule } from './modules/departments/index.js';
import { EntitiesModule } from './modules/entities/index.js';
import { OrganizationModule } from './modules/organization/index.js';
import { PeopleModule } from './modules/people/index.js';
import { PoliciesModule } from './modules/policies/index.js';
import { ProjectsModule } from './modules/projects/index.js';
import { CardsModule } from './modules/cards/index.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { ReceiptsModule } from './modules/receipts/index.js';
import { TransactionsModule } from './modules/transactions/index.js';
import { SpendModule } from './modules/spend/index.js';

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
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    AuditModule,
    QueueModule,
    DocumentsModule,
    HealthModule,
    AuthModule,
    PeopleModule,
    OrganizationModule,
    EntitiesModule,
    DepartmentsModule,
    ProjectsModule,
    PoliciesModule,
    SpendModule,
    CardsModule,
    TransactionsModule,
    NotificationsModule,
    ReceiptsModule,
    AuditReadModule,
  ],
  providers: [
    {
      // Registered here rather than with `app.useGlobalFilters` so it takes
      // part in dependency injection and can hold the logger.
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
    {
      // Global, so authentication is the default and `@Public()` is the
      // deliberate opt-out. A route that declares nothing is locked down
      // rather than exposed, which is the failure mode worth having.
      provide: APP_GUARD,
      useClass: AuthGuard,
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
