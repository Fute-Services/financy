import { Global, Module } from '@nestjs/common';

import { DatabaseService } from './database.service.js';

/**
 * Global because every module that stores anything needs it, and because
 * making it importable per-module would tempt someone to import the Prisma
 * client instead when the wiring felt like friction.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
