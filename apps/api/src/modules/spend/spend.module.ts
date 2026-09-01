import { Module } from '@nestjs/common';

import { ApprovalsModule } from '../approvals/index.js';
import { PoliciesModule } from '../policies/index.js';
import { SpendRequestController } from './spend-request.controller.js';
import { SpendRequestService } from './spend-request.service.js';

@Module({
  imports: [PoliciesModule, ApprovalsModule],
  controllers: [SpendRequestController],
  providers: [SpendRequestService],
  exports: [SpendRequestService],
})
export class SpendModule {}
