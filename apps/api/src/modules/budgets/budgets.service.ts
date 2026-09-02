import type {
  AllocateBudgetLine,
  BudgetDetail,
  BudgetMovementRecord,
  BudgetRecord,
  CreateBudget,
  ListBudgetMovementsQuery,
  ListBudgetsQuery,
  UpdateBudget,
} from '@financy/contracts';
import {
  ConflictError,
  Money,
  NotFoundError,
  ValidationError,
  newId,
  toDateString,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getOrganizationId } from '../../platform/request-context/index.js';
import { runWithRetry, utilizationOf } from './budget-ledger.service.js';

/**
 * Budgets (FR-BDG-001…008; epic 4.1).
 *
 * ## Creating a budget creates its periods
 *
 * A budget over a year with monthly granularity is twelve lines, generated
 * here. The alternative — lines created lazily when spend first lands in a
 * month — makes "what is left in March" unanswerable until somebody spends in
 * March, and makes the budget screen a list that grows as the year does.
 *
 * ## The allocation is spread, not typed twelve times
 *
 * A total split evenly across the periods, using `Money.allocate` so the
 * remainder lands somewhere rather than vanishing. Uneven months are the
 * exception and are edited per line afterwards; asking for twelve numbers up
 * front to serve the exception is a form nobody fills in correctly.
 *
 * ## Allocation is absolute and versioned
 *
 * `PUT` an amount, with `If-Match`. Two people each typing "500" into a form
 * they opened a minute apart should not produce 1,000 — the second one is told
 * the number moved. A delta-based route cannot make that distinction.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListBudgetsQuery): Promise<{ items: BudgetRecord[]; total: number }> {
    const asOf = query.asOf === undefined ? undefined : new Date(`${query.asOf}T00:00:00.000Z`);

    const where: Prisma.BudgetWhereInput = {
      // No `archivedAt: null`. On MongoDB an optional field that was never
      // written is absent, and Prisma's `null` filter does not match absent
      // (ADR-0017) — so that predicate returned *nothing* for every budget
      // ever created through this service, and the screen was empty while the
      // rows were fine. `status` carries the same information and is always
      // set, which is why every other module in this codebase filters on it.
      ...(query.status === undefined ? { status: { not: 'ARCHIVED' } } : { status: query.status }),
      ...(query.scopeType === undefined ? {} : { scopeType: query.scopeType }),
      ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
      ...(query.q === undefined ? {} : { name: { contains: query.q, mode: 'insensitive' } }),
      ...(asOf === undefined ? {} : { periodStart: { lte: asOf }, periodEnd: { gte: asOf } }),
    };

    const [total, rows] = await Promise.all([
      this.database.client.budget.count({ where }),
      this.database.client.budget.findMany({
        where,
        include: { lines: true },
        orderBy: [{ periodStart: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const names = await this.scopeNames(rows);

    return { total, items: rows.map((row) => toRecord(row, names)) };
  }

  async get(id: string): Promise<BudgetDetail> {
    const row = await this.database.client.budget.findFirst({
      where: { id },
      include: { lines: { orderBy: { periodStart: 'asc' } } },
    });

    if (row === null) throw new NotFoundError('Budget');

    const names = await this.scopeNames([row]);

    return {
      ...toRecord(row, names),
      lines: row.lines.map((line) => toLine(line)),
    };
  }

  async create(input: CreateBudget): Promise<BudgetDetail> {
    const organizationId = requireOrganization();

    const periodStart = new Date(`${input.periodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${input.periodEnd}T00:00:00.000Z`);
    const currency = input.currency.toUpperCase();

    await this.assertScopeExists(organizationId, input);

    const periods = splitIntoPeriods(periodStart, periodEnd, input.periodGranularity);

    // Evenly, with `allocate` so the odd penny lands on a line rather than
    // disappearing between them.
    const total =
      input.totalAllocated === undefined
        ? Money.zero(currency)
        : Money.of(input.totalAllocated.amount, currency);
    const shares = total.allocate(periods.map(() => 1));

    const budgetId = newId();

    try {
      await this.database.unscoped.$transaction(async (tx) => {
        await tx.budget.create({
          data: {
            id: budgetId,
            organizationId,
            name: input.name,
            scopeType: input.scopeType,
            scopeId: input.scopeId ?? null,
            entityId: input.entityId,
            currency,
            periodStart,
            periodEnd,
            periodGranularity: input.periodGranularity,
            overspendBehavior: input.overspendBehavior,
            ...(input.alertThresholds === undefined
              ? {}
              : { alertThresholds: input.alertThresholds }),
            status: 'DRAFT',
          },
        });

        await tx.budgetLine.createMany({
          data: periods.map((period, index) => ({
            id: newId(),
            organizationId,
            budgetId,
            periodStart: period.start,
            periodEnd: period.end,
            allocatedAmount: (shares[index] ?? Money.zero(currency)).toJSON().amount,
            committedAmount: '0.0000',
            actualAmount: '0.0000',
            currency,
          })),
        });

        await this.audit.record(tx, {
          organizationId,
          action: 'budget.created',
          resourceType: 'budget',
          resourceId: budgetId,
          after: {
            name: input.name,
            scopeType: input.scopeType,
            currency,
            allocated: total.toJSON().amount,
            periods: periods.length,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A budget with that name already covers this period.');
      }
      throw error;
    }

    return this.get(budgetId);
  }

  async update(id: string, input: UpdateBudget, expectedVersion: number): Promise<BudgetDetail> {
    const organizationId = requireOrganization();

    const existing = await this.database.client.budget.findFirst({ where: { id } });
    if (existing === null) throw new NotFoundError('Budget');

    guardVersion('Budget', expectedVersion, existing.version);

    if (existing.status === 'CLOSED' && input.status !== undefined && input.status !== 'CLOSED') {
      // Reopening a closed period is a real operation, and it is not this one:
      // it needs a reason and an audit trail of its own, so a plain PATCH is
      // refused rather than quietly permitted.
      throw new ConflictError('A closed budget cannot be reopened from here.');
    }

    await this.database.unscoped.$transaction(async (tx) => {
      const updated = await tx.budget.updateMany({
        where: { id, organizationId, version: existing.version },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.overspendBehavior === undefined
            ? {}
            : { overspendBehavior: input.overspendBehavior }),
          ...(input.alertThresholds === undefined
            ? {}
            : { alertThresholds: input.alertThresholds }),
          ...(input.status === undefined ? {} : { status: input.status }),
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) throw new ConflictError('The budget changed. Read it again.');

      await this.audit.record(tx, {
        organizationId,
        action: input.status === undefined ? 'budget.updated' : `budget.${input.status.toLowerCase()}`,
        resourceType: 'budget',
        resourceId: id,
        before: {
          name: existing.name,
          status: existing.status,
          overspendBehavior: existing.overspendBehavior,
        },
        after: { ...input },
      });
    });

    return this.get(id);
  }

  /**
   * Set one period's allocation.
   *
   * The change is recorded as an `ADJUSTMENT` movement as well as written to
   * the line, so a budget that was topped up in June explains itself in
   * October (FR-BDG-003). Reducing an allocation below what is already
   * committed is allowed and deliberately so — it is how a finance team claws
   * budget back, and refusing it would leave them editing the ledger instead.
   */
  async allocate(
    budgetId: string,
    lineId: string,
    input: AllocateBudgetLine,
    expectedVersion: number,
  ): Promise<BudgetDetail> {
    const organizationId = requireOrganization();

    const line = await this.database.client.budgetLine.findFirst({
      where: { id: lineId, budgetId },
    });

    if (line === null) throw new NotFoundError('Budget line');

    guardVersion('Budget line', expectedVersion, line.version);

    const target = Money.of(input.amount.amount, input.amount.currency.toUpperCase());

    if (target.currency !== line.currency) {
      throw new ValidationError({
        'amount.currency': [`The allocation must be in ${line.currency}, the budget’s own currency.`],
      });
    }

    const current = Money.of(line.allocatedAmount, line.currency);
    const delta = target.subtract(current);

    await runWithRetry(() =>
      this.database.unscoped.$transaction(async (tx) => {
        const updated = await tx.budgetLine.updateMany({
          where: { id: lineId, organizationId, version: line.version },
          data: { allocatedAmount: target.toJSON().amount, version: { increment: 1 } },
        });

        if (updated.count === 0) {
          throw new ConflictError('The budget line changed. Read it again.');
        }

        if (!delta.isZero()) {
          await tx.budgetMovement.create({
            data: {
              id: newId(),
              organizationId,
              budgetLineId: lineId,
              movementType: 'ADJUSTMENT',
              direction: delta.isNegative() ? 'DECREASE' : 'INCREASE',
              amount: delta.abs().toJSON().amount,
              currency: line.currency,
              sourceType: 'MANUAL',
              // The movement id doubles as the source id: a manual adjustment
              // has no upstream record, and reusing the line id would collide
              // with the next adjustment on the same line.
              sourceId: newId(),
              memo: input.memo ?? null,
            },
          });
        }

        await this.audit.record(tx, {
          organizationId,
          action: 'budget.reallocated',
          resourceType: 'budget_line',
          resourceId: lineId,
          before: { allocated: current.toJSON().amount },
          after: { allocated: target.toJSON().amount },
          metadata: { budgetId, ...(input.memo === undefined ? {} : { memo: input.memo }) },
        });
      }),
    );

    return this.get(budgetId);
  }

  /** The ledger for one budget, newest first. */
  async movements(
    budgetId: string,
    query: ListBudgetMovementsQuery,
  ): Promise<{ items: BudgetMovementRecord[]; total: number }> {
    const lines = await this.database.client.budgetLine.findMany({
      where: { budgetId },
      select: { id: true },
    });

    if (lines.length === 0) {
      const budget = await this.database.client.budget.findFirst({ where: { id: budgetId } });
      if (budget === null) throw new NotFoundError('Budget');
    }

    const where: Prisma.BudgetMovementWhereInput = {
      budgetLineId:
        query.budgetLineId === undefined
          ? { in: lines.map((line) => line.id) }
          : query.budgetLineId,
    };

    const [total, rows] = await Promise.all([
      this.database.client.budgetMovement.count({ where }),
      this.database.client.budgetMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        budgetLineId: row.budgetLineId,
        movementType: row.movementType,
        direction: row.direction,
        amount: { amount: row.amount, currency: row.currency },
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        actorMembershipId: row.actorMembershipId,
        memo: row.memo,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Refuse a budget drawn around something that does not exist.
   *
   * Checked here rather than by a foreign key, because `scopeId` points at one
   * of four different collections depending on `scopeType` and MongoDB has no
   * way to express that (ADR-0017). A budget pointing at a deleted department
   * would match no spend and read as permanently unused.
   */
  private async assertScopeExists(organizationId: string, input: CreateBudget): Promise<void> {
    const entity = await this.database.unscoped.entity.findFirst({
      where: { id: input.entityId, organizationId },
    });

    if (entity === null) {
      throw new ValidationError({ entityId: ['That entity does not exist.'] });
    }

    const scopeId = input.scopeId;
    if (scopeId == null) return;

    const found = await (async (): Promise<boolean> => {
      switch (input.scopeType) {
        case 'DEPARTMENT':
          return (
            (await this.database.unscoped.department.count({
              where: { id: scopeId, organizationId },
            })) > 0
          );
        case 'PROJECT':
          return (
            (await this.database.unscoped.project.count({
              where: { id: scopeId, organizationId },
            })) > 0
          );
        case 'CATEGORY':
          return (
            (await this.database.unscoped.category.count({
              where: { id: scopeId, organizationId },
            })) > 0
          );
        case 'ENTITY':
          return scopeId === input.entityId;
        case 'ORGANIZATION':
          // Unreachable: the schema refuses a scope id on an organisation-wide
          // budget, and the guard above returned when there was none.
          return false;
      }
    })();

    if (!found) {
      throw new ValidationError({
        scopeId: [`That ${input.scopeType.toLowerCase()} does not exist.`],
      });
    }
  }

  /**
   * Resolve scope ids to names for display.
   *
   * One query per kind, not one per budget. A twenty-five row list that
   * resolved names individually is twenty-five round trips to say what four
   * would.
   */
  private async scopeNames(
    budgets: readonly { scopeType: string; scopeId: string | null }[],
  ): Promise<Map<string, string>> {
    const idsByKind = new Map<string, string[]>();

    for (const budget of budgets) {
      if (budget.scopeId === null) continue;
      const bucket = idsByKind.get(budget.scopeType) ?? [];
      bucket.push(budget.scopeId);
      idsByKind.set(budget.scopeType, bucket);
    }

    const names = new Map<string, string>();

    const lookups: Promise<{ id: string; name: string }[]>[] = [];

    for (const [kind, ids] of idsByKind) {
      const where = { id: { in: ids } };
      const select = { id: true, name: true };

      switch (kind) {
        case 'DEPARTMENT':
          lookups.push(this.database.client.department.findMany({ where, select }));
          break;
        case 'PROJECT':
          lookups.push(this.database.client.project.findMany({ where, select }));
          break;
        case 'CATEGORY':
          lookups.push(this.database.client.category.findMany({ where, select }));
          break;
        case 'ENTITY':
          lookups.push(this.database.client.entity.findMany({ where, select }));
          break;
        default:
          break;
      }
    }

    for (const rows of await Promise.all(lookups)) {
      for (const row of rows) names.set(row.id, row.name);
    }

    return names;
  }
}

interface LineRow {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  allocatedAmount: string;
  committedAmount: string;
  actualAmount: string;
  currency: string;
  version: number;
}

function toLine(line: LineRow): BudgetDetail['lines'][number] {
  const allocated = Money.of(line.allocatedAmount, line.currency);
  const committed = Money.of(line.committedAmount, line.currency);
  const actual = Money.of(line.actualAmount, line.currency);

  return {
    id: line.id,
    periodStart: line.periodStart.toISOString(),
    periodEnd: line.periodEnd.toISOString(),
    allocated: allocated.toJSON(),
    committed: committed.toJSON(),
    actual: actual.toJSON(),
    remaining: allocated.subtract(committed).subtract(actual).toJSON(),
    utilization: utilizationOf(allocated, committed.add(actual)),
    version: line.version,
  };
}

function toRecord(
  budget: {
    id: string;
    name: string;
    scopeType: string;
    scopeId: string | null;
    entityId: string;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    periodGranularity: string;
    overspendBehavior: string;
    alertThresholds: number[];
    status: string;
    createdAt: Date;
    version: number;
    lines: LineRow[];
  },
  names: ReadonlyMap<string, string>,
): BudgetRecord {
  const currency = budget.currency;

  const allocated = Money.sum(
    budget.lines.map((line) => Money.of(line.allocatedAmount, currency)),
    currency,
  );
  const committed = Money.sum(
    budget.lines.map((line) => Money.of(line.committedAmount, currency)),
    currency,
  );
  const actual = Money.sum(
    budget.lines.map((line) => Money.of(line.actualAmount, currency)),
    currency,
  );

  return {
    id: budget.id,
    name: budget.name,
    scopeType: budget.scopeType as BudgetRecord['scopeType'],
    scopeId: budget.scopeId,
    scopeName: budget.scopeId === null ? null : (names.get(budget.scopeId) ?? null),
    entityId: budget.entityId,
    currency,
    periodStart: budget.periodStart.toISOString(),
    periodEnd: budget.periodEnd.toISOString(),
    periodGranularity: budget.periodGranularity as BudgetRecord['periodGranularity'],
    overspendBehavior: budget.overspendBehavior as BudgetRecord['overspendBehavior'],
    alertThresholds: budget.alertThresholds,
    status: budget.status as BudgetRecord['status'],
    totals: {
      allocated: allocated.toJSON(),
      committed: committed.toJSON(),
      actual: actual.toJSON(),
      remaining: allocated.subtract(committed).subtract(actual).toJSON(),
      utilization: utilizationOf(allocated, committed.add(actual)),
    },
    createdAt: budget.createdAt.toISOString(),
    version: budget.version,
  };
}

/**
 * Cut a date range into the periods a budget tracks.
 *
 * Inclusive of the day the range ends: a budget stated as 1 Jan – 31 Dec has
 * twelve months in it, and a half-open reading would give it thirteen with a
 * one-day December.
 */
export function splitIntoPeriods(
  start: Date,
  end: Date,
  granularity: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL',
): { start: Date; end: Date }[] {
  if (granularity === 'ANNUAL') return [{ start, end }];

  const step = granularity === 'MONTHLY' ? 1 : 3;
  const periods: { start: Date; end: Date }[] = [];

  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  // Guarded rather than `while (true)`: a malformed range should produce a
  // validation error upstream, never an unbounded loop here.
  for (let index = 0; index < 240; index += 1) {
    if (cursor.getTime() > end.getTime()) break;

    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, 1));
    const periodStart = index === 0 ? start : cursor;
    const periodEnd = new Date(Math.min(next.getTime() - 86_400_000, end.getTime()));

    periods.push({ start: periodStart, end: periodEnd });
    cursor = next;
  }

  return periods.length === 0 ? [{ start, end }] : periods;
}

/** For the invariant test and the alert job, which both need a day string. */
export { toDateString };

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
