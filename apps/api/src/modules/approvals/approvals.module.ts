import { Module } from '@nestjs/common';

import { ApprovalResolverService } from './approval-resolver.service.js';
import { ApprovalService } from './approval.service.js';

@Module({
  providers: [ApprovalService, ApprovalResolverService],
  exports: [ApprovalService, ApprovalResolverService],
})
export class ApprovalsModule {}
