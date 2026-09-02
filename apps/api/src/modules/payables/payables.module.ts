import { Module } from '@nestjs/common';

import { ApprovalsModule } from '../approvals/index.js';
import { BudgetsModule } from '../budgets/index.js';
import { PoliciesModule } from '../policies/index.js';
import { BillsService } from './bills.service.js';
import {
  BillsController,
  PurchaseOrdersController,
  VendorsController,
} from './payables.controller.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { VendorsService } from './vendors.service.js';

/**
 * Everything owed to somebody outside the company.
 *
 * One module for suppliers, their invoices, and the orders that precede them,
 * because the three are one workflow with one duplicate-payment problem running
 * through it: a supplier entered twice becomes an invoice paid twice, and a
 * purchase order that nothing matches becomes a commitment nobody releases.
 * Splitting them would put the unique indexes that prevent both on one side of
 * a boundary and the states they protect on the other.
 */
@Module({
  imports: [ApprovalsModule, BudgetsModule, PoliciesModule],
  controllers: [VendorsController, BillsController, PurchaseOrdersController],
  providers: [VendorsService, BillsService, PurchaseOrdersService],
  exports: [VendorsService, BillsService, PurchaseOrdersService],
})
export class PayablesModule {}
