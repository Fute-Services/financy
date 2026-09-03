import { Module } from '@nestjs/common';

import { AuditExportService } from './audit-export.service.js';
import { AuditReadController } from './audit-read.controller.js';
import { AuditReadService } from './audit-read.service.js';
import { SecurityEventReadService } from './security-event-read.service.js';

@Module({
  controllers: [AuditReadController],
  providers: [AuditReadService, SecurityEventReadService, AuditExportService],
  exports: [AuditReadService, SecurityEventReadService],
})
export class AuditReadModule {}
