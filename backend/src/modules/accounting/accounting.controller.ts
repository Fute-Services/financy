import {
  closePeriodSchema,
  createAccountingCodeSchema,
  createAccountingMappingSchema,
  createExportSchema,
  importAccountingCodesSchema,
  listAccountingCodesQuerySchema,
  listExportBatchesQuerySchema,
  reopenPeriodSchema,
  simulateMappingSchema,
  updateAccountingCodeSchema,
  updateAccountingMappingSchema,
  type AccountingCodeRecord,
  type AccountingMappingRecord,
  type AccountingPeriodRecord,
  type ClosePeriod,
  type CreateAccountingCode,
  type CreateAccountingMapping,
  type CreateExport,
  type ExportBatchDetail,
  type ExportBatchRecord,
  type ExportResult,
  type ImportAccountingCodes,
  type ListAccountingCodesQuery,
  type ListExportBatchesQuery,
  type MappingResult,
  type OffsetCollection,
  type ReopenPeriod,
  type Resource,
  type SimulateMapping,
  type UpdateAccountingCode,
  type UpdateAccountingMapping,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { AccountingCodesService } from './accounting-codes.service.js';
import { AccountingExportService } from './accounting-export.service.js';
import { AccountingMappingService } from './accounting-mapping.service.js';

/**
 * `/v1/accounting` (docs/10 §5.17, epics 6.1 and 6.2).
 *
 * **The dry run is a `POST` and not a `GET`.** It is a query in effect but a
 * command in shape: it takes a body of filters, and pairing it with the real
 * run means the two cannot drift. A `GET` with the same filter set spelled
 * differently would be a second definition of "what would be exported".
 */
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly codes: AccountingCodesService,
    private readonly mappings: AccountingMappingService,
    private readonly exports: AccountingExportService,
  ) {}

  // ── Codes ──────────────────────────────────────────────────────────────

  @Get('codes')
  @RequirePermission('accounting_code:manage')
  async listCodes(
    @Query(new ZodValidationPipe(listAccountingCodesQuerySchema)) query: ListAccountingCodesQuery,
  ): Promise<OffsetCollection<AccountingCodeRecord>> {
    const { items, total } = await this.codes.list(query);

    return {
      data: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post('codes')
  @RequirePermission('accounting_code:manage')
  async createCode(
    @Body(new ZodValidationPipe(createAccountingCodeSchema)) body: CreateAccountingCode,
  ): Promise<Resource<AccountingCodeRecord>> {
    return { data: await this.codes.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch('codes/:id')
  @RequirePermission('accounting_code:manage')
  async updateCode(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAccountingCodeSchema)) body: UpdateAccountingCode,
  ): Promise<Resource<AccountingCodeRecord>> {
    return { data: await this.codes.update(id, body), meta: { correlationId: getCorrelationId() } };
  }

  @Post('codes/import')
  @HttpCode(200)
  @RequirePermission('accounting_code:manage')
  async importCodes(
    @Body(new ZodValidationPipe(importAccountingCodesSchema)) body: ImportAccountingCodes,
  ): Promise<Resource<{ created: number; updated: number }>> {
    return { data: await this.codes.import(body), meta: { correlationId: getCorrelationId() } };
  }

  // ── Mapping ────────────────────────────────────────────────────────────

  @Get('mappings')
  @RequirePermission('accounting_code:manage')
  async listMappings(): Promise<Resource<AccountingMappingRecord[]>> {
    return { data: await this.mappings.list(), meta: { correlationId: getCorrelationId() } };
  }

  @Post('mappings')
  @RequirePermission('accounting_code:manage')
  async createMapping(
    @Body(new ZodValidationPipe(createAccountingMappingSchema)) body: CreateAccountingMapping,
  ): Promise<Resource<AccountingMappingRecord>> {
    return { data: await this.mappings.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch('mappings/:id')
  @RequirePermission('accounting_code:manage')
  async updateMapping(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAccountingMappingSchema)) body: UpdateAccountingMapping,
    @IfMatch() version: number,
  ): Promise<Resource<AccountingMappingRecord>> {
    return {
      data: await this.mappings.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /** The test harness: what would these rules do to a record shaped like this? */
  @Post('mappings/simulate')
  @HttpCode(200)
  @RequirePermission('accounting_code:manage')
  async simulate(
    @Body(new ZodValidationPipe(simulateMappingSchema)) body: SimulateMapping,
  ): Promise<Resource<MappingResult>> {
    return { data: await this.mappings.simulate(body), meta: { correlationId: getCorrelationId() } };
  }

  // ── Export ─────────────────────────────────────────────────────────────

  @Get('exports')
  @RequirePermission('accounting:export')
  async listExports(
    @Query(new ZodValidationPipe(listExportBatchesQuerySchema)) query: ListExportBatchesQuery,
  ): Promise<OffsetCollection<ExportBatchRecord>> {
    const { items, total } = await this.exports.list(query);

    return {
      data: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get('exports/:id')
  @RequirePermission('accounting:export')
  async getExport(@Param('id') id: string): Promise<Resource<ExportBatchDetail>> {
    return { data: await this.exports.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post('exports')
  @HttpCode(200)
  @RequirePermission('accounting:export')
  async runExport(
    @Body(new ZodValidationPipe(createExportSchema)) body: CreateExport,
  ): Promise<Resource<ExportResult>> {
    return { data: await this.exports.run(body), meta: { correlationId: getCorrelationId() } };
  }

  // ── The close ──────────────────────────────────────────────────────────

  @Get('periods')
  @RequirePermission('accounting:export')
  async periods(): Promise<Resource<AccountingPeriodRecord[]>> {
    return { data: await this.codes.periods(), meta: { correlationId: getCorrelationId() } };
  }

  @Post('periods')
  @RequirePermission('accounting:export')
  async close(
    @Body(new ZodValidationPipe(closePeriodSchema)) body: ClosePeriod,
  ): Promise<Resource<AccountingPeriodRecord>> {
    return { data: await this.codes.close(body), meta: { correlationId: getCorrelationId() } };
  }

  /**
   * Re-opening, which needs a reason and stays on the record.
   *
   * Deliberately awkward rather than impossible: closing the wrong month
   * happens, and a system with no way back forces somebody to fix it in the
   * database.
   */
  @Post('periods/:id/reopen')
  @HttpCode(200)
  @RequirePermission('accounting:export')
  async reopen(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reopenPeriodSchema)) body: ReopenPeriod,
    @IfMatch() version: number,
  ): Promise<Resource<AccountingPeriodRecord>> {
    return {
      data: await this.codes.reopen(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
