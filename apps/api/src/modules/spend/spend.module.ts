import { Module } from '@nestjs/common';

import { ApprovalsModule } from '../approvals/index.js';
import { PoliciesModule } from '../policies/index.js';
import { ApprovalController } from './approval.controller.js';
import { SpendRequestController } from './spend-request.controller.js';
import { SpendRequestService } from './spend-request.service.js';

@Module({
  imports: [PoliciesModule, ApprovalsModule],
  controllers: [SpendRequestController, ApprovalController],
  providers: [SpendRequestService],
  exports: [SpendRequestService],
})
export class SpendModule {}
