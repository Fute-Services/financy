import { Module } from '@nestjs/common';

import { AccountingCodesService } from './accounting-codes.service.js';
import { AccountingExportService } from './accounting-export.service.js';
import { AccountingMappingService } from './accounting-mapping.service.js';
import { AccountingController } from './accounting.controller.js';

/**
 * The chart of accounts, the rules that reach it, and the export.
 *
 * One module, because the three are one question asked in three places: which
 * account does this belong to, and has it left yet. Splitting the export from
 * the mapping would let the export derive a code the simulator would not, which
 * makes the harness FR-ACC-002 asks for worse than having none.
 */
@Module({
  controllers: [AccountingController],
  providers: [AccountingCodesService, AccountingMappingService, AccountingExportService],
  exports: [AccountingCodesService, AccountingMappingService, AccountingExportService],
})
export class AccountingModule {}
