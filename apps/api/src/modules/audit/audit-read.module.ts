import { Module } from '@nestjs/common';

import { AuditReadController } from './audit-read.controller.js';
import { AuditReadService } from './audit-read.service.js';

@Module({
  controllers: [AuditReadController],
  providers: [AuditReadService],
  exports: [AuditReadService],
})
export class AuditReadModule {}
