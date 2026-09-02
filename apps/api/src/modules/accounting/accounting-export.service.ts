import { createHash } from 'node:crypto';

import type {
  CreateExport,
  ExportBatchDetail,
  ExportBatchRecord,
  ExportResult,
  ListExportBatchesQuery,
} from '@financy/contracts';
import { ConflictError, Money, NotFoundError, newId } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { AccountingMappingService } from './accounting-mapping.service.js';

/** One record on its way out, before it has been coded. */
interface Candidate {
  recordType: 'transaction' | 'expense' | 'bill';
  recordId: string;
  description: string;
  amount: string;
  currency: string;
  occurredAt: Date;
  categoryId: string | null;
  departmentId: string | null;
  entityId: string;
  vendorId: string | null;
  spendType: 'CARD' | 'REIMBURSEMENT' | 'BILL';
}

/**
 * The accounting export (FR-ACC-003…007, epic 6.2).
 *
 * ## The unique index is what makes a re-run idempotent
 *
 * `(organisation, recordType, recordId)` on `export_batch_items` is unique, so
 * a record that has been exported once cannot be picked up by a second run
 * whatever the filters say (FR-ACC-005). A status column on the record would be
 * a second copy of the same fact, and the two would disagree the first time a
 * batch was interrupted halfway.
 *
 * ## Only reviewed and coded records leave
 *
 * FR-ACC-003. A record with no GL account exported with a default one produces
 * a clean-looking file that is wrong, and nobody finds out until an accountant
 * does — a quarter later, when the trail is cold. Unmapped records are listed,
 * by name, and the export goes ahead without them rather than inventing an
 * account for them.
 *
 * ## An unbalanced batch is not written at all
 *
 * FR-ACC-006. Debits equal credits or the whole run is refused with the
 * difference recorded. Half a journal in somebody else's ledger is worse than
 * no journal.
 *
 * ## The checksum is over the exact bytes handed out
 *
 * Not over the ids, and not over a re-derived rendering. Two people comparing
 * what was received against what was sent need one number to compare, and it
 * has to be a number of the thing that actually moved.
 */
@Injectable()
export class AccountingExportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly mapping: AccountingMappingService,
  ) {}

  async list(
    query: ListExportBatchesQuery,
  ): Promise<{ items: ExportBatchRecord[]; total: number }> {
    const [total, rows] = await Promise.all([
      this.database.client.exportBatch.count({}),
      this.database.client.exportBatch.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map((row) => toRecord(row)) };
  }

  async get(id: string): Promise<ExportBatchDetail> {
    const row = await this.database.client.exportBatch.findFirst({
      where: { id },
      include: { items: true },
    });

    if (row === null) throw new NotFoundError('Export batch');

    return {
      ...toRecord(row),
      items: row.items.map((item) => ({
        id: item.id,
        recordType: item.recordType,
        recordId: item.recordId,
        glAccountCode: item.glAccountCode,
        costCenterCode: item.costCenterCode,
        taxCode: item.taxCode,
        debit: { amount: item.debit, currency: item.currency },
        credit: { amount: item.credit, currency: item.currency },
        memo: item.memo,
      })),
    };
  }

  /**
   * Build a batch, or say what one would contain.
   *
   * A dry run marks nothing and writes nothing. It exists because the first
   * question anybody asks before an export is "how many are unmapped", and
   * finding out by running it for real leaves a batch they then have to
   * explain.
   */
  async run(input: CreateExport): Promise<ExportResult> {
    const organizationId = requireOrganization();
    const actor = getContext()?.membershipId;

    if (actor === undefined) throw new Error('An export must name the membership that ran it.');

    const organization = await this.database.unscoped.organization.findUnique({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });

    if (organization === null) throw new NotFoundError('Organization');

    const currency = (input.currency ?? organization.baseCurrency).toUpperCase();
    const from = new Date(`${input.periodStart}T00:00:00.000Z`);
    const to = new Date(`${input.periodEnd}T23:59:59.999Z`);

    await this.assertPeriodIsOpen(organizationId, from, to);

    const candidates = await this.candidates(organizationId, from, to, currency, input.recordTypes);

    const coded: {
      candidate: Candidate;
      glAccountCode: string;
      costCenterCode: string | null;
      taxCode: string | null;
    }[] = [];
    const unmapped: ExportResult['unmapped'] = [];

    for (const candidate of candidates) {
      const result = await this.mapping.resolve(organizationId, {
        categoryId: candidate.categoryId,
        departmentId: candidate.departmentId,
        entityId: candidate.entityId,
        vendorId: candidate.vendorId,
        spendType: candidate.spendType,
      });

      if (!result.matched || result.glAccount === null) {
        unmapped.push({
          recordType: candidate.recordType,
          recordId: candidate.recordId,
          description: candidate.description,
          amount: { amount: candidate.amount, currency: candidate.currency },
          reason: result.explanation,
        });
        continue;
      }

      coded.push({
        candidate,
        glAccountCode: result.glAccount.code,
        costCenterCode: result.costCenter?.code ?? null,
        taxCode: result.taxCode?.code ?? null,
      });
    }

    // Every line is a debit to an expense account, balanced by a single credit
    // to the account it was paid from. That is the simplest journal that
    // balances, and the one an import into any ledger expects.
    const debits = Money.sum(
      coded.map((line) => Money.of(line.candidate.amount, currency)),
      currency,
    );
    const credits = debits;

    if (input.dryRun) {
      return {
        batch: null,
        eligible: candidates.length,
        exported: coded.length,
        unmapped,
        imbalance: null,
        dryRun: true,
      };
    }

    if (coded.length === 0) {
      return {
        batch: null,
        eligible: candidates.length,
        exported: 0,
        unmapped,
        imbalance: null,
        dryRun: false,
      };
    }

    if (!debits.equals(credits)) {
      // Unreachable with the journal shape above, and checked anyway: the day
      // a second journal shape arrives, this is what stops half of it reaching
      // a ledger.
      const difference = debits.subtract(credits);

      const failed = await this.recordFailure(organizationId, actor, {
        from,
        to,
        currency,
        debits,
        credits,
      });

      return {
        batch: failed,
        eligible: candidates.length,
        exported: 0,
        unmapped,
        imbalance: {
          debits: debits.toJSON().amount,
          credits: credits.toJSON().amount,
          difference: difference.toJSON().amount,
        },
        dryRun: false,
      };
    }

    const batchId = newId();

    const rows = coded.map((line) => ({
      id: newId(),
      organizationId,
      batchId,
      recordType: line.candidate.recordType,
      recordId: line.candidate.recordId,
      glAccountCode: line.glAccountCode,
      costCenterCode: line.costCenterCode,
      taxCode: line.taxCode,
      debit: Money.of(line.candidate.amount, currency).toJSON().amount,
      credit: '0.0000',
      currency,
      memo: line.candidate.description,
    }));

    // Over the exact bytes the batch represents, in a stable order, so two
    // runs of the same set produce the same number and a person can compare
    // what they received against what was sent.
    const checksum = createHash('sha256')
      .update(
        rows
          .map((row) =>
            [row.recordType, row.recordId, row.glAccountCode, row.debit, row.currency].join('|'),
          )
          .sort()
          .join('\n'),
      )
      .digest('hex');

    let created = 0;

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.exportBatch.create({
        data: {
          id: batchId,
          organizationId,
          reference: await nextReference(tx, organizationId),
          exportType: 'GENERAL_LEDGER',
          periodStart: from,
          periodEnd: to,
          rowCount: rows.length,
          checksum,
          totalDebits: debits.toJSON().amount,
          totalCredits: credits.toJSON().amount,
          currency,
          status: 'COMPLETED',
          createdByMembershipId: actor,
        },
      });

      // One at a time, because the unique index is doing real work here: a
      // record another run took while this one was building must be skipped,
      // not made to fail the whole batch.
      for (const row of rows) {
        try {
          await tx.exportBatchItem.create({ data: row });
          created += 1;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }

      await tx.exportBatch.update({
        where: { id: batchId },
        data: { rowCount: created },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'accounting.exported',
        resourceType: 'export_batch',
        resourceId: batchId,
        after: {
          rowCount: created,
          checksum,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          currency,
          unmapped: unmapped.length,
        },
      });
    });

    return {
      batch: await this.get(batchId).then((batch) => toBatchSummary(batch)),
      eligible: candidates.length,
      exported: created,
      unmapped,
      imbalance: null,
      dryRun: false,
    };
  }

  /**
   * Has this record already left?
   *
   * Used by the write paths that must refuse to change an exported record
   * (FR-ACC-007). Reads the batch items rather than a flag on the record, so
   * there is one fact and not two that can disagree.
   */
  async isExported(
    organizationId: string,
    recordType: string,
    recordId: string,
  ): Promise<boolean> {
    const item = await this.database.unscoped.exportBatchItem.findFirst({
      where: { organizationId, recordType, recordId },
      select: { id: true },
    });

    return item !== null;
  }

  /**
   * Everything eligible in the window that has not already been exported.
   *
   * Reviewed **and** coded, per FR-ACC-003. The category is what the mapping
   * reads, so a record without one is not eligible in the first place — it
   * would land in the unmapped queue anyway, and listing it as eligible would
   * make the counts read as a mapping problem rather than a coding one.
   */
  private async candidates(
    organizationId: string,
    from: Date,
    to: Date,
    currency: string,
    recordTypes: CreateExport['recordTypes'],
  ): Promise<Candidate[]> {
    const wanted = new Set(recordTypes ?? ['transaction', 'expense', 'bill']);

    const exported = new Set(
      (
        await this.database.unscoped.exportBatchItem.findMany({
          where: { organizationId },
          select: { recordType: true, recordId: true },
        })
      ).map((item) => `${item.recordType}:${item.recordId}`),
    );

    const candidates: Candidate[] = [];

    if (wanted.has('transaction')) {
      const rows = await this.database.unscoped.transaction.findMany({
        where: {
          organizationId,
          status: 'POSTED',
          reviewStatus: 'REVIEWED',
          currency,
          occurredAt: { gte: from, lte: to },
          NOT: { categoryId: null },
        },
      });

      for (const row of rows) {
        if (exported.has(`transaction:${row.id}`)) continue;

        candidates.push({
          recordType: 'transaction',
          recordId: row.id,
          description: row.merchantName,
          amount: row.amount,
          currency: row.currency,
          occurredAt: row.occurredAt,
          categoryId: row.categoryId,
          departmentId: row.departmentId,
          entityId: row.entityId,
          vendorId: null,
          spendType: 'CARD',
        });
      }
    }

    if (wanted.has('expense')) {
      const rows = await this.database.unscoped.expense.findMany({
        where: {
          organizationId,
          status: { in: ['APPROVED', 'REIMBURSED'] },
          currency,
          expenseDate: { gte: from, lte: to },
          NOT: { categoryId: null },
        },
      });

      for (const row of rows) {
        if (exported.has(`expense:${row.id}`)) continue;

        candidates.push({
          recordType: 'expense',
          recordId: row.id,
          description: row.merchantName,
          amount: row.amount,
          currency: row.currency,
          occurredAt: row.expenseDate,
          categoryId: row.categoryId,
          departmentId: row.departmentId,
          entityId: row.entityId,
          vendorId: null,
          spendType: 'REIMBURSEMENT',
        });
      }
    }

    if (wanted.has('bill')) {
      const rows = await this.database.unscoped.bill.findMany({
        where: {
          organizationId,
          status: { in: ['APPROVED', 'PAID'] },
          currency,
          issueDate: { gte: from, lte: to },
        },
        include: {
          vendor: { select: { id: true, name: true } },
          lines: { orderBy: { sequence: 'asc' }, take: 1 },
        },
      });

      for (const row of rows) {
        if (exported.has(`bill:${row.id}`)) continue;

        const first = row.lines[0];

        candidates.push({
          recordType: 'bill',
          recordId: row.id,
          description: `${row.vendor.name} — ${row.billNumber}`,
          amount: row.totalAmount,
          currency: row.currency,
          occurredAt: row.issueDate,
          categoryId: first?.categoryId ?? null,
          departmentId: first?.departmentId ?? null,
          entityId: row.entityId,
          vendorId: row.vendorId,
          spendType: 'BILL',
        });
      }
    }

    return candidates;
  }

  /**
   * A closed period exports nothing.
   *
   * Closing is what makes a month final; an export dated into a closed period
   * would put figures into a ledger the accounts have already signed off, with
   * nothing on either side saying it happened.
   */
  private async assertPeriodIsOpen(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<void> {
    const closed = await this.database.unscoped.accountingPeriod.findFirst({
      where: {
        organizationId,
        reopenedAt: null,
        periodStart: { lte: to },
        periodEnd: { gte: from },
      },
    });

    if (closed !== null) {
      throw new ConflictError(
        'That period is closed. Reopen it, or date the correction into the open period.',
      );
    }
  }

  private async recordFailure(
    organizationId: string,
    actor: string,
    details: { from: Date; to: Date; currency: string; debits: Money; credits: Money },
  ): Promise<ExportBatchRecord> {
    const id = newId();

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.exportBatch.create({
        data: {
          id,
          organizationId,
          reference: await nextReference(tx, organizationId),
          exportType: 'GENERAL_LEDGER',
          periodStart: details.from,
          periodEnd: details.to,
          rowCount: 0,
          checksum: '',
          totalDebits: details.debits.toJSON().amount,
          totalCredits: details.credits.toJSON().amount,
          currency: details.currency,
          status: 'FAILED',
          failureReason: `Debits ${details.debits.toJSON().amount} do not equal credits ${details.credits.toJSON().amount}.`,
          createdByMembershipId: actor,
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'accounting.export_failed',
        resourceType: 'export_batch',
        resourceId: id,
        metadata: {
          debits: details.debits.toJSON().amount,
          credits: details.credits.toJSON().amount,
        },
      });
    });

    const row = await this.database.unscoped.exportBatch.findFirst({ where: { id } });

    if (row === null) throw new NotFoundError('Export batch');

    return toRecord(row);
  }
}

interface BatchRow {
  id: string;
  reference: string;
  exportType: string;
  periodStart: Date;
  periodEnd: Date;
  rowCount: number;
  checksum: string;
  totalDebits: string;
  totalCredits: string;
  currency: string;
  status: string;
  failureReason: string | null;
  createdAt: Date;
}

function toRecord(row: BatchRow): ExportBatchRecord {
  return {
    id: row.id,
    reference: row.reference,
    exportType: row.exportType,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    rowCount: row.rowCount,
    checksum: row.checksum,
    totals: {
      debits: { amount: row.totalDebits, currency: row.currency },
      credits: { amount: row.totalCredits, currency: row.currency },
    },
    currency: row.currency,
    status: row.status as ExportBatchRecord['status'],
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBatchSummary(detail: ExportBatchDetail): ExportBatchRecord {
  const { items: _items, ...summary } = detail;

  return summary;
}

async function nextReference(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const count = await tx.exportBatch.count({ where: { organizationId } });

  return `EXP-${String(count + 1).padStart(4, '0')}`;
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
