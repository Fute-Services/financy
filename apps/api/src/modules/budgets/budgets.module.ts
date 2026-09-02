import { Module } from '@nestjs/common';

import { BudgetLedgerService } from './budget-ledger.service.js';
import { BudgetsController } from './budgets.controller.js';
import { BudgetsService } from './budgets.service.js';

/**
 * Budgets and their ledger.
 *
 * `BudgetLedgerService` is exported because four other modules move money
 * against a budget — approvals commit, postings actualise, cancellations
 * release — and every one of them must do it through the same append-and-
 * materialise path. A module that reached for `budgetLine.update` directly
 * would break the invariant the whole design rests on.
 */
@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetLedgerService],
  exports: [BudgetsService, BudgetLedgerService],
})
export class BudgetsModule {}
