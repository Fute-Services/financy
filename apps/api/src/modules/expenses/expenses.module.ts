import { Module } from '@nestjs/common';

import { ApprovalsModule } from '../approvals/index.js';
import { BudgetsModule } from '../budgets/index.js';
import { PoliciesModule } from '../policies/index.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
import { ReimbursementsController } from './reimbursements.controller.js';
import { ReimbursementsService } from './reimbursements.service.js';

/**
 * Expenses and the batches that pay them.
 *
 * One module for both, because a reimbursement is only ever a set of expenses:
 * splitting them would put the `UNIQUE(expense_id)` invariant on one side of a
 * boundary and the status it protects on the other.
 */
@Module({
  imports: [ApprovalsModule, BudgetsModule, PoliciesModule],
  controllers: [ExpensesController, ReimbursementsController],
  providers: [ExpensesService, ReimbursementsService],
  exports: [ExpensesService, ReimbursementsService],
})
export class ExpensesModule {}
