import { Module } from '@nestjs/common';

import { ApprovalsModule } from '../approvals/index.js';
import { BudgetsModule } from '../budgets/index.js';
import { PoliciesModule } from '../policies/index.js';
import { SpendRequestController } from './spend-request.controller.js';
import { SpendRequestService } from './spend-request.service.js';

@Module({
  imports: [BudgetsModule, PoliciesModule, ApprovalsModule],
  controllers: [SpendRequestController],
  providers: [SpendRequestService],
  exports: [SpendRequestService],
})
export class SpendModule {}
