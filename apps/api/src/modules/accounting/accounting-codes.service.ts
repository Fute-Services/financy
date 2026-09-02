import type {
  AccountingCodeRecord,
  AccountingPeriodRecord,
  ClosePeriod,
  CreateAccountingCode,
  ImportAccountingCodes,
  ListAccountingCodesQuery,
  ReopenPeriod,
  UpdateAccountingCode,
} from '@financy/contracts';
import { ConflictError, NotFoundError, ValidationError, newId } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';

/**
 * The chart of accounts, cost centres, tax codes, and the close (FR-ACC-001,
 * epic 6.1).
 *
 * ## One table for three taxonomies
 *
 * They share every operation — import, rename, retire, map to — and differ only
 * in what they name. Three tables would mean three of every endpoint and three
 * chances to forget one of them when something changes.
 *
 * ## Codes are retired, never deleted
 *
 * A code that has ever appeared in an export has to keep resolving for anybody
 * reading last year's batch. Deleting it turns an archived export into a file
 * of unexplained numbers, which is exactly the thing an audit is trying to
 * avoid.
 *
 * ## Importing is a whole file, upserted by code
 *
 * Because that is how a chart arrives: as an export from the ledger somebody
 * already keeps. Four hundred creates would be four hundred requests, and one
 * of them would fail halfway and leave a chart nobody can trust.
 */
@Injectable()
export class AccountingCodesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListAccountingCodesQuery,
  ): Promise<{ items: AccountingCodeRecord[]; total: number }> {
    const where: Prisma.AccountingCodeWhereInput = {
      ...(query.codeType === undefined ? {} : { codeType: query.codeType }),
      ...(query.activeOnly === true ? { isActive: true } : {}),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }),
    };

    const [total, rows] = await Promise.all([
      this.database.client.accountingCode.count({ where }),
      this.database.client.accountingCode.findMany({
        where,
        orderBy: [{ codeType: 'asc' }, { code: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map((row) => toCodeRecord(row)) };
  }

  async create(input: CreateAccountingCode): Promise<AccountingCodeRecord> {
    const organizationId = requireOrganization();
    const id = newId();

    try {
      await this.database.unscoped.$transaction(async (tx) => {
        await tx.accountingCode.create({
          data: {
            id,
            organizationId,
            codeType: input.codeType,
            code: input.code,
            name: input.name,
            parentId: input.parentId ?? null,
            isActive: true,
          },
        });

        await this.audit.record(tx, {
          organizationId,
          action: 'accounting_code.created',
          resourceType: 'accounting_code',
          resourceId: id,
          after: { codeType: input.codeType, code: input.code, name: input.name },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`${input.code} already exists as a ${input.codeType}.`);
      }
      throw error;
    }

    return this.get(id);
  }

  async get(id: string): Promise<AccountingCodeRecord> {
    const row = await this.database.client.accountingCode.findFirst({ where: { id } });

    if (row === null) throw new NotFoundError('Accounting code');

    return toCodeRecord(row);
  }

  async update(id: string, input: UpdateAccountingCode): Promise<AccountingCodeRecord> {
    const organizationId = requireOrganization();

    const existing = await this.database.client.accountingCode.findFirst({ where: { id } });
    if (existing === null) throw new NotFoundError('Accounting code');

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.accountingCode.updateMany({
        where: { id, organizationId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: input.isActive === false ? 'accounting_code.retired' : 'accounting_code.updated',
        resourceType: 'accounting_code',
        resourceId: id,
        before: { name: existing.name, isActive: existing.isActive },
        after: { ...input },
      });
    });

    return this.get(id);
  }

  /**
   * Import a chart, upserting by code.
   *
   * Existing codes are renamed rather than duplicated, and nothing is retired
   * by omission: a chart exported from a ledger routinely omits accounts that
   * are still in use elsewhere, and treating an absence as a retirement would
   * break every mapping that pointed at one.
   */
  async import(input: ImportAccountingCodes): Promise<{ created: number; updated: number }> {
    const organizationId = requireOrganization();

    let created = 0;
    let updated = 0;

    for (const entry of input.codes) {
      const existing = await this.database.unscoped.accountingCode.findFirst({
        where: { organizationId, codeType: input.codeType, code: entry.code },
        select: { id: true, name: true },
      });

      if (existing === null) {
        await this.database.unscoped.accountingCode.create({
          data: {
            id: newId(),
            organizationId,
            codeType: input.codeType,
            code: entry.code,
            name: entry.name,
            isActive: true,
          },
        });
        created += 1;
        continue;
      }

      if (existing.name !== entry.name) {
        await this.database.unscoped.accountingCode.update({
          where: { id: existing.id },
          data: { name: entry.name },
        });
        updated += 1;
      }
    }

    await this.database.unscoped.$transaction(async (tx) => {
      // One event for the import, not one per row. Four hundred audit events
      // for one action is a trail nobody can read.
      await this.audit.record(tx, {
        organizationId,
        action: 'accounting_code.imported',
        resourceType: 'accounting_code',
        metadata: { codeType: input.codeType, supplied: input.codes.length, created, updated },
      });
    });

    return { created, updated };
  }

  // ── The close ────────────────────────────────────────────────────────────

  async periods(): Promise<AccountingPeriodRecord[]> {
    const rows = await this.database.client.accountingPeriod.findMany({
      include: { closedBy: { select: { id: true, user: { select: { fullName: true } } } } },
      orderBy: { periodStart: 'desc' },
    });

    return rows.map((row) => toPeriodRecord(row));
  }

  /**
   * Close a period.
   *
   * Nothing dated inside it can be exported again, and a correction is dated
   * into the open period — which is what an accountant expects and what a
   * silently re-openable month would break.
   */
  async close(input: ClosePeriod): Promise<AccountingPeriodRecord> {
    const organizationId = requireOrganization();
    const actor = getContext()?.membershipId;

    if (actor === undefined) throw new Error('A close must name the membership that made it.');

    const from = new Date(`${input.periodStart}T00:00:00.000Z`);
    const to = new Date(`${input.periodEnd}T23:59:59.999Z`);

    if (to.getTime() < from.getTime()) {
      throw new ValidationError({ periodEnd: ['The period ends before it starts.'] });
    }

    const overlapping = await this.database.unscoped.accountingPeriod.findFirst({
      where: {
        organizationId,
        reopenedAt: null,
        periodStart: { lte: to },
        periodEnd: { gte: from },
      },
    });

    if (overlapping !== null) {
      throw new ConflictError('That period overlaps one that is already closed.');
    }

    const id = newId();

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.accountingPeriod.create({
        data: {
          id,
          organizationId,
          periodStart: from,
          periodEnd: to,
          closedByMembershipId: actor,
          note: input.note ?? null,
          // Written explicitly rather than left absent: on MongoDB a `null`
          // filter does not match a missing field, and every "is this period
          // still closed" query filters on exactly this (ADR-0017).
          reopenedAt: null,
          reopenedByMembershipId: null,
          reopenReason: null,
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'accounting_period.closed',
        resourceType: 'accounting_period',
        resourceId: id,
        after: { periodStart: input.periodStart, periodEnd: input.periodEnd },
      });
    });

    return this.period(id);
  }

  async reopen(
    id: string,
    input: ReopenPeriod,
    expectedVersion: number,
  ): Promise<AccountingPeriodRecord> {
    const organizationId = requireOrganization();
    const actor = getContext()?.membershipId ?? null;

    const existing = await this.database.client.accountingPeriod.findFirst({ where: { id } });
    if (existing === null) throw new NotFoundError('Accounting period');

    guardVersion('Accounting period', expectedVersion, existing.version);

    if (existing.reopenedAt !== null) {
      throw new ConflictError('That period is already open.');
    }

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.accountingPeriod.updateMany({
        where: { id, organizationId, version: existing.version },
        data: {
          reopenedAt: new Date(),
          reopenedByMembershipId: actor,
          reopenReason: input.reason,
          version: { increment: 1 },
        },
      });

      // Both the close and the re-open stay on the record, and both are
      // audited. Pretending re-opening never happens is how a system ends up
      // with two versions of a signed-off month and no way to tell them apart.
      await this.audit.record(tx, {
        organizationId,
        action: 'accounting_period.reopened',
        resourceType: 'accounting_period',
        resourceId: id,
        before: { closedAt: existing.closedAt.toISOString() },
        after: { reason: input.reason },
      });
    });

    return this.period(id);
  }

  private async period(id: string): Promise<AccountingPeriodRecord> {
    const row = await this.database.client.accountingPeriod.findFirst({
      where: { id },
      include: { closedBy: { select: { id: true, user: { select: { fullName: true } } } } },
    });

    if (row === null) throw new NotFoundError('Accounting period');

    return toPeriodRecord(row);
  }
}

interface CodeRow {
  id: string;
  codeType: string;
  code: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  createdAt: Date;
}

function toCodeRecord(row: CodeRow): AccountingCodeRecord {
  return {
    id: row.id,
    codeType: row.codeType as AccountingCodeRecord['codeType'],
    code: row.code,
    name: row.name,
    parentId: row.parentId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

interface PeriodRow {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  closedAt: Date;
  closedBy: { id: string; user: { fullName: string } };
  note: string | null;
  reopenedAt: Date | null;
  reopenReason: string | null;
  version: number;
}

function toPeriodRecord(row: PeriodRow): AccountingPeriodRecord {
  return {
    id: row.id,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    closedAt: row.closedAt.toISOString(),
    closedBy: { membershipId: row.closedBy.id, fullName: row.closedBy.user.fullName },
    note: row.note,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    reopenReason: row.reopenReason,
    isClosed: row.reopenedAt === null,
    version: row.version,
  };
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
