import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service.js';
import { SecurityEventService } from './security-event.service.js';

/**
 * Global because every module that mutates anything must audit it, and making
 * that an import someone can forget is the opposite of the guarantee.
 */
@Global()
@Module({
  providers: [AuditService, SecurityEventService],
  exports: [AuditService, SecurityEventService],
})
export class AuditModule {}
