import {
  REPORT_KEYS,
  reportFiltersSchema,
  type ReportFilters,
  type ReportKey,
  type ReportResult,
  type ReportSummary,
  type Resource,
} from '@financy/contracts';
import { NotFoundError } from '@financy/core';
import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AuditService } from '../../platform/audit/index.js';
import { RequirePermission } from '../../platform/authorization/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getCorrelationId, getOrganizationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { toCsv } from './csv.js';
import { ReportsService } from './reports.service.js';

/**
 * `/v1/reports` (docs/10 §5.12, epics 4.2 and 4.4).
 *
 * **Reports are registry entries, not routes.** One pair of endpoints serves
 * all eleven, so filtering, permission checking, scope enforcement, pagination,
 * and audit are inherited rather than re-implemented — which is what stops the
 * twelfth report from being the one that forgot a scope check.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  @Get()
  @RequirePermission('report:read')
  list(): Resource<ReportSummary[]> {
    return { data: this.reports.catalogue(), meta: { correlationId: getCorrelationId() } };
  }

  @Get(':key')
  @RequirePermission('report:read')
  async run(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(reportFiltersSchema)) filters: ReportFilters,
  ): Promise<Resource<ReportResult>> {
    return {
      data: await this.reports.run(assertKey(key), filters),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * The same report, as a file.
   *
   * **The audit event records the exact filter set**, not merely that an export
   * happened (docs/15 §9). "Who exported company spend, and what did it
   * contain?" is a question an auditor will ask months later, and answering it
   * must not require re-running the query against data that has since changed.
   *
   * Synchronous up to the row ceiling. Beyond it the export is a queued job in
   * Phase 5 — the response says so rather than silently truncating, because a
   * truncated export is indistinguishable from a complete one once it is in
   * somebody's inbox.
   */
  @Get(':key/export')
  @RequirePermission('report:export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(reportFiltersSchema)) filters: ReportFilters,
    @Res() response: Response,
  ): Promise<void> {
    const reportKey = assertKey(key);
    const result = await this.reports.runForExport(reportKey, filters);
    const body = toCsv(result.columns, result.rows);

    const organizationId = getOrganizationId();

    if (organizationId !== undefined) {
      await this.database.unscoped.$transaction(async (tx) => {
        await this.audit.record(tx, {
          organizationId,
          action: 'report.exported',
          resourceType: 'report',
          resourceId: reportKey,
          metadata: {
            // Every filter, verbatim. A record that said only "a report was
            // exported" cannot answer what it contained.
            filters: { ...filters },
            rowCount: result.rows.length,
            truncated: result.totalRows > result.rows.length,
            format: 'CSV',
          },
        });
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportKey}-${stamp}.csv"`,
    );
    response.send(body);
  }
}

function assertKey(key: string): ReportKey {
  if (!(REPORT_KEYS as readonly string[]).includes(key)) throw new NotFoundError('Report');

  return key as ReportKey;
}
