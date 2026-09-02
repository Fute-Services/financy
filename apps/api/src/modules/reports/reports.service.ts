import {
  REPORT_LABELS,
  REPORT_QUESTIONS,
  type ReportColumn,
  type ReportFilters,
  type ReportKey,
  type ReportResult,
  type ReportRow,
  type ReportSummary,
} from '@financy/contracts';
import { ForbiddenError, Money, NotFoundError } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';
import { callerHas, getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { intersectIds, intervalLabel, resolvePeriod } from './report-scope.js';

/**
 * One line of spend, whatever record it came from.
 *
 * Card charges and out-of-pocket claims are different records with different
 * lifecycles, and every spend report has to answer across both. Normalising
 * once, here, is what stops "spend by department" and "spend by category"
 * quietly disagreeing about whether reimbursements count.
 */
interface SpendRow {
  amount: string;
  currency: string;
  occurredAt: Date;
  entityId: string;
  departmentId: string | null;
  categoryId: string | null;
  projectId: string | null;
  membershipId: string | null;
  merchantName: string;
  method: 'CARD' | 'REIMBURSEMENT';
}

/**
 * What a caller may see, resolved once per request.
 *
 * `null` on a list means "no restriction". An empty array means "restricted to
 * nothing", which is a real and different answer — it is what a manager gets
 * when they ask for a department that is not theirs.
 */
interface Scope {
  width: 'ORGANIZATION' | 'DEPARTMENT' | 'OWN';
  membershipId: string | null;
  departmentIds: string[] | null;
}

/**
 * Reports (docs/15; epics 4.2 and 4.4).
 *
 * ## Nothing is computed in the browser
 *
 * Every figure — a KPI, a subtotal, a percentage, an export cell — is produced
 * here. The rule is stated that strongly (docs/15 §1) because a client-side sum
 * is unauditable, scope-blind, and pagination-truncated: it can only add up
 * what happened to be fetched, and the shortfall grows with how interesting the
 * report is. Every result therefore carries its own `totals`, so a client never
 * has a reason to add anything.
 *
 * ## Currencies are never mixed
 *
 * `SINGLE` mode counts one currency and **says how many records it left out**.
 * `GROUPED` returns a row per currency. There is no converted mode, because a
 * conversion needs a rate recorded alongside the figure and there is no FX
 * provider until Phase 5 — a single unlabelled number here is the easy, wrong
 * choice that ends up in a board deck.
 *
 * ## Scope is intersected, never replaced
 *
 * A manager asking for another department's spend gets an empty report, not an
 * error. An error would confirm the department exists and that they are outside
 * it, which is an organisation chart anybody patient can assemble.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  /** The catalogue, with each entry marked available or not for this caller. */
  catalogue(): ReportSummary[] {
    return (Object.keys(REPORT_LABELS) as ReportKey[]).map((key) => ({
      key,
      name: REPORT_LABELS[key],
      question: REPORT_QUESTIONS[key],
      permission: PERMISSIONS[key],
      available: callerHas(PERMISSIONS[key]),
    }));
  }

  async run(key: ReportKey, filters: ReportFilters): Promise<ReportResult> {
    const organizationId = requireOrganization();

    // The route already checks `report:read`. This is the report's *own*
    // permission — budget-vs-actual needs `budget:read`, and somebody who can
    // run reports but not see budgets must not get one through this door.
    if (!callerHas(PERMISSIONS[key])) {
      throw new ForbiddenError(
        `This report needs the ${PERMISSIONS[key]} permission, which your role does not grant.`,
      );
    }

    const organization = await this.database.unscoped.organization.findUnique({
      where: { id: organizationId },
      select: { baseCurrency: true, fiscalYearStartMonth: true },
    });

    if (organization === null) throw new NotFoundError('Organization');

    const period = resolvePeriod(filters, new Date(), organization.fiscalYearStartMonth);
    const currency = (filters.currency ?? organization.baseCurrency).toUpperCase();
    const scope = await this.scopeFor(organizationId, key);

    const context: RunContext = { organizationId, filters, period, currency, scope };

    const partial = await this.execute(key, context);

    return {
      key,
      name: REPORT_LABELS[key],
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        label: period.label,
      },
      currencyMode: filters.currencyMode,
      currency: filters.currencyMode === 'SINGLE' ? currency : null,
      generatedAt: new Date().toISOString(),
      page: filters.page,
      pageSize: filters.pageSize,
      ...partial,
    };
  }

  /**
   * Every row a report would return, unpaginated, for the export path.
   *
   * The same query with the same scope — deliberately the same function, not a
   * parallel one. An export whose query drifted from the report it claims to
   * be is the failure nobody notices until an auditor compares them.
   */
  async runForExport(key: ReportKey, filters: ReportFilters): Promise<ReportResult> {
    return this.run(key, { ...filters, page: 1, pageSize: 5000 });
  }

  // ── the reports ──────────────────────────────────────────────────────────

  private async execute(key: ReportKey, context: RunContext): Promise<PartialResult> {
    switch (key) {
      case 'spend-total':
        return this.spendOverTime(context);
      case 'spend-by-department':
        return this.spendGrouped(context, 'departmentId', 'Department');
      case 'spend-by-category':
        return this.spendGrouped(context, 'categoryId', 'Category');
      case 'spend-by-vendor':
        return this.spendGrouped(context, 'merchantName', 'Merchant');
      case 'spend-by-person':
        return this.spendGrouped(context, 'membershipId', 'Person');
      case 'budget-vs-actual':
        return this.budgetVsActual(context);
      case 'pending-approvals':
        return this.pendingApprovals(context);
      case 'outstanding-reimbursements':
        return this.outstandingReimbursements(context);
      case 'policy-exceptions':
        return this.policyExceptions(context);
      case 'uncategorised-transactions':
        return this.closeReadiness(context, 'UNCATEGORISED');
      case 'missing-receipts':
        return this.closeReadiness(context, 'MISSING_RECEIPT');
      default:
        throw new NotFoundError('Report');
    }
  }

  /**
   * Spend per interval, with the same window one period earlier beside it.
   *
   * The comparison is the point. "€84,000 this month" is a number; "€84,000,
   * up 31% on last month" is the beginning of a question, and the person
   * reading it should not have to run the report twice and subtract.
   */
  private async spendOverTime(context: RunContext): Promise<PartialResult> {
    const rows = await this.spendRows(context, context.period);
    const { kept, excluded } = this.byCurrency(rows, context);

    const buckets = new Map<string, Money>();

    for (const row of kept) {
      const label = intervalLabel(row.occurredAt, context.filters.interval);
      const amount = Money.of(row.amount, row.currency);
      buckets.set(label, (buckets.get(label) ?? Money.zero(row.currency)).add(amount));
    }

    const previous = await this.previousPeriodTotal(context);
    const total = Money.sum(
      [...buckets.values()],
      context.filters.currencyMode === 'SINGLE' ? context.currency : context.currency,
    );

    const ordered = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right));

    return {
      columns: [
        { key: 'period', label: 'Period', kind: 'text' },
        { key: 'amount', label: 'Spend', kind: 'money' },
        { key: 'share', label: 'Share', kind: 'percent' },
      ],
      rows: ordered.map(([label, amount]) => ({
        period: label,
        amount: amount.toJSON(),
        share: total.isZero()
          ? 0
          : Math.round((Number(amount.toJSON().amount) / Number(total.toJSON().amount)) * 1000) / 10,
      })),
      totals: {
        amount: total.toJSON(),
        previousPeriod: previous.toJSON(),
        // Signed, and `null` rather than a fabricated 100% when the prior
        // period was empty: "up from nothing" is not a percentage.
        change: previous.isZero()
          ? null
          : Math.round(
              ((Number(total.toJSON().amount) - Number(previous.toJSON().amount)) /
                Number(previous.toJSON().amount)) *
                1000,
            ) / 10,
        transactions: kept.length,
      },
      excludedForCurrency: excluded,
      totalRows: ordered.length,
    };
  }

  /** Spend grouped by one dimension, largest first. */
  private async spendGrouped(
    context: RunContext,
    dimension: 'departmentId' | 'categoryId' | 'membershipId' | 'merchantName',
    label: string,
  ): Promise<PartialResult> {
    const rows = await this.spendRows(context, context.period);
    const { kept, excluded } = this.byCurrency(rows, context);

    const buckets = new Map<string, { amount: Money; count: number }>();

    for (const row of kept) {
      const raw = row[dimension];
      // Unassigned is its own bucket rather than being dropped. A report that
      // silently omitted uncategorised spend would total less than the bank.
      const groupKey = typeof raw === 'string' && raw !== '' ? raw : UNASSIGNED;
      const existing = buckets.get(groupKey) ?? { amount: Money.zero(context.currency), count: 0 };

      buckets.set(groupKey, {
        amount: existing.amount.add(Money.of(row.amount, row.currency)),
        count: existing.count + 1,
      });
    }

    const names =
      dimension === 'merchantName'
        ? new Map<string, string>()
        : await this.namesFor(context.organizationId, dimension, [...buckets.keys()]);

    const total = Money.sum(
      [...buckets.values()].map((bucket) => bucket.amount),
      context.currency,
    );

    const ordered = [...buckets.entries()].sort(
      ([, left], [, right]) => Number(right.amount.toJSON().amount) - Number(left.amount.toJSON().amount),
    );

    const page = ordered.slice(
      (context.filters.page - 1) * context.filters.pageSize,
      context.filters.page * context.filters.pageSize,
    );

    return {
      columns: [
        { key: 'name', label, kind: 'text' },
        { key: 'amount', label: 'Spend', kind: 'money' },
        { key: 'count', label: 'Records', kind: 'number' },
        { key: 'share', label: 'Share', kind: 'percent' },
      ],
      rows: page.map(([groupKey, bucket]) => ({
        name:
          groupKey === UNASSIGNED
            ? 'Unassigned'
            : (names.get(groupKey) ?? (dimension === 'merchantName' ? groupKey : 'Unknown')),
        amount: bucket.amount.toJSON(),
        count: bucket.count,
        share: total.isZero()
          ? 0
          : Math.round(
              (Number(bucket.amount.toJSON().amount) / Number(total.toJSON().amount)) * 1000,
            ) / 10,
      })),
      totals: { amount: total.toJSON(), groups: ordered.length },
      excludedForCurrency: excluded,
      totalRows: ordered.length,
    };
  }

  /** Every active budget against what it has actually consumed. */
  private async budgetVsActual(context: RunContext): Promise<PartialResult> {
    const budgets = await this.database.unscoped.budget.findMany({
      where: {
        organizationId: context.organizationId,
        archivedAt: null,
        status: { in: ['ACTIVE', 'CLOSED'] },
        periodStart: { lte: context.period.to },
        periodEnd: { gte: context.period.from },
        ...(context.filters.entityIds === undefined
          ? {}
          : { entityId: { in: context.filters.entityIds } }),
      },
      include: { lines: true },
      orderBy: { name: 'asc' },
    });

    const rows: ReportRow[] = [];

    let allocatedTotal = Money.zero(context.currency);
    let usedTotal = Money.zero(context.currency);
    let excluded = 0;

    for (const budget of budgets) {
      if (budget.currency !== context.currency && context.filters.currencyMode === 'SINGLE') {
        excluded += 1;
        continue;
      }

      const allocated = Money.sum(
        budget.lines.map((line) => Money.of(line.allocatedAmount, budget.currency)),
        budget.currency,
      );
      const committed = Money.sum(
        budget.lines.map((line) => Money.of(line.committedAmount, budget.currency)),
        budget.currency,
      );
      const actual = Money.sum(
        budget.lines.map((line) => Money.of(line.actualAmount, budget.currency)),
        budget.currency,
      );
      const used = committed.add(actual);
      const remaining = allocated.subtract(used);

      rows.push({
        name: budget.name,
        allocated: allocated.toJSON(),
        committed: committed.toJSON(),
        actual: actual.toJSON(),
        remaining: remaining.toJSON(),
        utilization: allocated.isZero()
          ? null
          : Math.round(
              (Number(used.toJSON().amount) / Number(allocated.toJSON().amount)) * 1000,
            ) / 10,
        // Said plainly rather than left to a colour: a budget that will breach
        // is the only row on this report anybody needs to act on.
        status: remaining.isNegative()
          ? 'Over'
          : allocated.isZero()
            ? 'Unallocated'
            : Number(used.toJSON().amount) / Number(allocated.toJSON().amount) >= 0.9
              ? 'At risk'
              : 'On plan',
      });

      if (budget.currency === context.currency) {
        allocatedTotal = allocatedTotal.add(allocated);
        usedTotal = usedTotal.add(used);
      }
    }

    return {
      columns: [
        { key: 'name', label: 'Budget', kind: 'text' },
        { key: 'allocated', label: 'Allocated', kind: 'money' },
        { key: 'committed', label: 'Committed', kind: 'money' },
        { key: 'actual', label: 'Spent', kind: 'money' },
        { key: 'remaining', label: 'Remaining', kind: 'money' },
        { key: 'utilization', label: 'Used', kind: 'percent' },
        { key: 'status', label: 'Status', kind: 'status' },
      ],
      rows: this.paginate(rows, context),
      totals: {
        allocated: allocatedTotal.toJSON(),
        used: usedTotal.toJSON(),
        remaining: allocatedTotal.subtract(usedTotal).toJSON(),
      },
      excludedForCurrency: excluded,
      totalRows: rows.length,
    };
  }

  /** What is waiting, with whom, and for how long. */
  private async pendingApprovals(context: RunContext): Promise<PartialResult> {
    const steps = await this.database.unscoped.approvalStep.findMany({
      where: {
        organizationId: context.organizationId,
        status: { in: ['ACTIVE', 'ESCALATED'] },
      },
      include: { instance: { select: { subjectType: true, subjectId: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const now = Date.now();

    const rows: ReportRow[] = steps.map((step) => ({
      subject: step.instance.subjectType === 'expense' ? 'Expense' : 'Spend request',
      subjectId: step.instance.subjectId,
      step: `Step ${String(step.sequence)} · ${step.stepType}`,
      approvers: step.eligibleMembershipIds.length,
      // Whole days, because "waiting 3 days" is what somebody chases on and
      // "waiting 76.4 hours" is a number they have to convert first.
      waitingDays: Math.floor((now - step.createdAt.getTime()) / 86_400_000),
      overdue: step.dueAt !== null && step.dueAt.getTime() < now,
      status: step.status,
    }));

    const overdue = rows.filter((row) => row['overdue'] === true).length;

    return {
      columns: [
        { key: 'subject', label: 'What', kind: 'text' },
        { key: 'step', label: 'Step', kind: 'text' },
        { key: 'approvers', label: 'Approvers', kind: 'number' },
        { key: 'waitingDays', label: 'Waiting (days)', kind: 'number' },
        { key: 'status', label: 'Status', kind: 'status' },
      ],
      rows: this.paginate(rows, context),
      totals: {
        pending: rows.length,
        overdue,
        oldestDays: rows.reduce(
          (oldest, row) => Math.max(oldest, Number(row['waitingDays'] ?? 0)),
          0,
        ),
      },
      excludedForCurrency: 0,
      totalRows: rows.length,
    };
  }

  /** What the company owes its own people, oldest first. */
  private async outstandingReimbursements(context: RunContext): Promise<PartialResult> {
    const batches = await this.database.unscoped.reimbursementBatch.findMany({
      where: {
        organizationId: context.organizationId,
        status: { in: ['DRAFT', 'APPROVED'] },
        ...(context.scope.width === 'OWN' && context.scope.membershipId !== null
          ? { payeeMembershipId: context.scope.membershipId }
          : {}),
      },
      include: { payee: { select: { user: { select: { fullName: true } } } } },
      orderBy: { createdAt: 'asc' },
    });

    let total = Money.zero(context.currency);
    let excluded = 0;
    const rows: ReportRow[] = [];

    for (const batch of batches) {
      if (batch.currency !== context.currency && context.filters.currencyMode === 'SINGLE') {
        excluded += 1;
        continue;
      }

      rows.push({
        reference: batch.reference,
        payee: batch.payee.user.fullName,
        amount: { amount: batch.totalAmount, currency: batch.currency },
        status: batch.status,
        waitingDays: Math.floor((Date.now() - batch.createdAt.getTime()) / 86_400_000),
      });

      if (batch.currency === context.currency) {
        total = total.add(Money.of(batch.totalAmount, batch.currency));
      }
    }

    return {
      columns: [
        { key: 'reference', label: 'Batch', kind: 'text' },
        { key: 'payee', label: 'Owed to', kind: 'text' },
        { key: 'amount', label: 'Amount', kind: 'money' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'waitingDays', label: 'Waiting (days)', kind: 'number' },
      ],
      rows: this.paginate(rows, context),
      totals: { amount: total.toJSON(), batches: rows.length },
      excludedForCurrency: excluded,
      totalRows: rows.length,
    };
  }

  /**
   * Where policy was bypassed or breached.
   *
   * Both halves matter and they are different things: an **exception** is spend
   * that policy flagged and let through, and an **override** is a chain a human
   * cut short. A report that showed only one of them would let the other become
   * the route everybody uses.
   */
  private async policyExceptions(context: RunContext): Promise<PartialResult> {
    const [requests, overrides] = await Promise.all([
      this.database.unscoped.spendRequest.findMany({
        where: {
          organizationId: context.organizationId,
          createdAt: { gte: context.period.from, lte: context.period.to },
          NOT: { policyDecision: { equals: null } },
        },
        select: {
          id: true,
          reference: true,
          purpose: true,
          amountInBaseCurrency: true,
          policyDecision: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.database.unscoped.approvalAction.findMany({
        where: {
          organizationId: context.organizationId,
          action: 'OVERRIDE',
          createdAt: { gte: context.period.from, lte: context.period.to },
        },
        include: { actedBy: { select: { user: { select: { fullName: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const rows: ReportRow[] = [];

    for (const request of requests) {
      const decision = request.policyDecision as { exceptions?: { reasonCode: string }[] } | null;
      const exceptions = decision?.exceptions ?? [];

      if (exceptions.length === 0) continue;

      rows.push({
        kind: 'Exception',
        reference: request.reference,
        detail: request.purpose,
        reasons: exceptions.map((exception) => exception.reasonCode).join(', '),
        amount: { amount: request.amountInBaseCurrency, currency: context.currency },
        by: null,
        occurredAt: request.createdAt.toISOString(),
      });
    }

    for (const override of overrides) {
      rows.push({
        kind: 'Override',
        reference: override.approvalStepId,
        detail: override.comment ?? 'An approval chain was settled by override.',
        reasons: 'APPROVAL_OVERRIDDEN',
        amount: null,
        by: override.actedBy.user.fullName ?? null,
        occurredAt: override.createdAt.toISOString(),
      });
    }

    // Both sides are ISO strings by construction, and `occurredAt` on a report
    // row is typed as the union every cell can hold — so the comparison narrows
    // rather than stringifying whatever turns up.
    const when = (row: ReportRow): string =>
      typeof row['occurredAt'] === 'string' ? row['occurredAt'] : '';

    rows.sort((left, right) => when(right).localeCompare(when(left)));

    return {
      columns: [
        { key: 'kind', label: 'Kind', kind: 'status' },
        { key: 'reference', label: 'Reference', kind: 'text' },
        { key: 'detail', label: 'What', kind: 'text' },
        { key: 'reasons', label: 'Why', kind: 'text' },
        { key: 'by', label: 'By', kind: 'text' },
        { key: 'occurredAt', label: 'When', kind: 'date' },
      ],
      rows: this.paginate(rows, context),
      totals: {
        exceptions: rows.filter((row) => row['kind'] === 'Exception').length,
        overrides: rows.filter((row) => row['kind'] === 'Override').length,
      },
      excludedForCurrency: 0,
      totalRows: rows.length,
    };
  }

  /** The two things that block a close, as one query shape. */
  private async closeReadiness(
    context: RunContext,
    kind: 'UNCATEGORISED' | 'MISSING_RECEIPT',
  ): Promise<PartialResult> {
    const transactions = await this.database.unscoped.transaction.findMany({
      where: {
        organizationId: context.organizationId,
        occurredAt: { gte: context.period.from, lte: context.period.to },
        ...(kind === 'UNCATEGORISED' ? { categoryId: null } : { receiptStatus: 'MISSING' }),
        ...this.spendWhere(context, 'memberMembershipId'),
      },
      include: { member: { select: { user: { select: { fullName: true } } } } },
      orderBy: { occurredAt: 'desc' },
    });

    let total = Money.zero(context.currency);
    let excluded = 0;
    const rows: ReportRow[] = [];

    for (const transaction of transactions) {
      if (transaction.currency !== context.currency && context.filters.currencyMode === 'SINGLE') {
        excluded += 1;
        continue;
      }

      rows.push({
        merchant: transaction.merchantName,
        amount: { amount: transaction.amount, currency: transaction.currency },
        // Named, because the next action is asking a person for something.
        whose: transaction.member?.user.fullName ?? 'Unassigned',
        occurredAt: transaction.occurredAt.toISOString(),
        ageDays: Math.floor((Date.now() - transaction.occurredAt.getTime()) / 86_400_000),
      });

      if (transaction.currency === context.currency) {
        total = total.add(Money.of(transaction.amount, transaction.currency));
      }
    }

    return {
      columns: [
        { key: 'merchant', label: 'Merchant', kind: 'text' },
        { key: 'amount', label: 'Amount', kind: 'money' },
        { key: 'whose', label: 'Whose', kind: 'text' },
        { key: 'occurredAt', label: 'When', kind: 'date' },
        { key: 'ageDays', label: 'Age (days)', kind: 'number' },
      ],
      rows: this.paginate(rows, context),
      totals: { amount: total.toJSON(), records: rows.length },
      excludedForCurrency: excluded,
      totalRows: rows.length,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Every card charge and reimbursable claim in the window, as one list.
   *
   * Only **posted** charges and **approved or reimbursed** claims count. A
   * pending authorisation may be reversed and a draft claim may never be
   * submitted; counting either would make a spend report disagree with the
   * bank in a direction nobody can explain.
   */
  private async spendRows(
    context: RunContext,
    period: { from: Date; to: Date },
  ): Promise<SpendRow[]> {
    const wantsCard =
      context.filters.paymentMethods === undefined ||
      context.filters.paymentMethods.includes('CARD');
    const wantsReimbursement =
      context.filters.paymentMethods === undefined ||
      context.filters.paymentMethods.includes('REIMBURSEMENT');

    const [transactions, expenses] = await Promise.all([
      wantsCard
        ? this.database.unscoped.transaction.findMany({
            where: {
              organizationId: context.organizationId,
              status: 'POSTED',
              occurredAt: { gte: period.from, lte: period.to },
              ...this.spendWhere(context, 'memberMembershipId'),
            },
          })
        : Promise.resolve([]),
      wantsReimbursement
        ? this.database.unscoped.expense.findMany({
            where: {
              organizationId: context.organizationId,
              paymentMethod: 'OUT_OF_POCKET',
              status: { in: ['APPROVED', 'REIMBURSED'] },
              expenseDate: { gte: period.from, lte: period.to },
              ...this.spendWhere(context, 'submitterMembershipId'),
            },
          })
        : Promise.resolve([]),
    ]);

    return [
      ...transactions.map((transaction) => ({
        amount: transaction.amount,
        currency: transaction.currency,
        occurredAt: transaction.occurredAt,
        entityId: transaction.entityId,
        departmentId: transaction.departmentId,
        categoryId: transaction.categoryId,
        projectId: transaction.projectId,
        membershipId: transaction.memberMembershipId,
        merchantName: transaction.merchantName,
        method: 'CARD' as const,
      })),
      ...expenses.map((expense) => ({
        amount: expense.amount,
        currency: expense.currency,
        occurredAt: expense.expenseDate,
        entityId: expense.entityId,
        departmentId: expense.departmentId,
        categoryId: expense.categoryId,
        projectId: expense.projectId,
        membershipId: expense.submitterMembershipId,
        merchantName: expense.merchantName,
        method: 'REIMBURSEMENT' as const,
      })),
    ];
  }

  /** The same window, one period earlier, for the comparison figure. */
  private async previousPeriodTotal(context: RunContext): Promise<Money> {
    const span = context.period.to.getTime() - context.period.from.getTime();
    const previous = {
      from: new Date(context.period.from.getTime() - span - 1),
      to: new Date(context.period.from.getTime() - 1),
    };

    const rows = await this.spendRows(context, previous);
    const { kept } = this.byCurrency(rows, context);

    return Money.sum(
      kept.map((row) => Money.of(row.amount, row.currency)),
      context.currency,
    );
  }

  /**
   * Drop what is not in the report's currency, and count what was dropped.
   *
   * Counting is the whole point. A total that quietly excluded a third of the
   * spend looks exactly like one that did not.
   */
  private byCurrency(
    rows: readonly SpendRow[],
    context: RunContext,
  ): { kept: SpendRow[]; excluded: number } {
    if (context.filters.currencyMode !== 'SINGLE') return { kept: [...rows], excluded: 0 };

    const kept = rows.filter((row) => row.currency === context.currency);

    return { kept, excluded: rows.length - kept.length };
  }

  /**
   * The filters and the caller's ceiling, in one object.
   *
   * **Built once rather than spread from two places.** Two spreads that each
   * wrote `departmentId` meant the second silently replaced the first, which
   * turns "intersect the request with the scope" into "ignore the request" —
   * and it fails in the direction that shows a department head data they asked
   * about but are not entitled to, or hides data they are. The intersection is
   * explicit here so it cannot be undone by ordering.
   *
   * `memberField` differs between the two spend records: a charge names the
   * cardholder, a claim names whoever submitted it.
   */
  private spendWhere(
    context: RunContext,
    memberField: 'memberMembershipId' | 'submitterMembershipId',
  ): Record<string, unknown> {
    const { filters, scope } = context;

    const departmentIds = intersectIds(
      filters.departmentIds,
      scope.width === 'DEPARTMENT' ? scope.departmentIds : null,
    );

    return {
      ...(filters.entityIds === undefined ? {} : { entityId: { in: filters.entityIds } }),
      ...(filters.categoryIds === undefined ? {} : { categoryId: { in: filters.categoryIds } }),
      ...(filters.projectIds === undefined ? {} : { projectId: { in: filters.projectIds } }),
      // An empty array is a real answer — it is what somebody gets when they
      // ask for a department that is not theirs — and it matches nothing,
      // which is exactly right.
      ...(departmentIds === undefined ? {} : { departmentId: { in: departmentIds } }),
      ...(scope.width === 'OWN' && scope.membershipId !== null
        ? { [memberField]: scope.membershipId }
        : {}),
      ...(scope.width === 'OWN' && scope.membershipId === null ? { id: NOTHING } : {}),
    };
  }

  /**
   * How wide this caller may look for this report.
   *
   * Read from the `:read_all` companion rather than from the role name, because
   * roles are organisation-editable and the permission is what the grant
   * actually says.
   *
   * The middle width is **department headship, not a role**. Somebody who heads
   * a department sees it and everything under it; everybody else sees their
   * own. Using a role name would break the first time an organisation renamed
   * one, and using "has a department" would show every employee their whole
   * team's spend — which is a different product from the one this is.
   */
  private async scopeFor(organizationId: string, key: ReportKey): Promise<Scope> {
    const membershipId = getContext()?.membershipId ?? null;

    if (callerHas(READ_ALL[key])) {
      return { width: 'ORGANIZATION', membershipId, departmentIds: null };
    }

    if (membershipId === null) {
      return { width: 'OWN', membershipId: null, departmentIds: null };
    }

    const headed = await this.database.unscoped.department.findMany({
      // No `archivedAt: null` filter: on MongoDB a null filter does not match a
      // document where the field is absent (ADR-0017), so adding one here would
      // silently narrow every department head to their own spend.
      where: { organizationId, headMembershipId: membershipId },
      select: { path: true },
    });

    if (headed.length === 0) {
      return { width: 'OWN', membershipId, departmentIds: null };
    }

    // Everything beneath, resolved from the materialised path — so a
    // reorganisation changes the data and not this code.
    const descendants = await this.database.unscoped.department.findMany({
      where: {
        organizationId,
        OR: headed.map((department) => ({ path: { startsWith: department.path } })),
      },
      select: { id: true },
    });

    return {
      width: 'DEPARTMENT',
      membershipId,
      departmentIds: descendants.map((department) => department.id),
    };
  }

  private async namesFor(
    organizationId: string,
    dimension: 'departmentId' | 'categoryId' | 'membershipId',
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const real = ids.filter((id) => id !== UNASSIGNED);
    if (real.length === 0) return new Map();

    const where = { organizationId, id: { in: real } };

    const rows =
      dimension === 'departmentId'
        ? await this.database.unscoped.department.findMany({
            where,
            select: { id: true, name: true },
          })
        : dimension === 'categoryId'
          ? await this.database.unscoped.category.findMany({
              where,
              select: { id: true, name: true },
            })
          : (
              await this.database.unscoped.membership.findMany({
                where,
                select: { id: true, user: { select: { fullName: true } } },
              })
            ).map((membership) => ({ id: membership.id, name: membership.user.fullName }));

    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private paginate(rows: readonly ReportRow[], context: RunContext): ReportRow[] {
    const start = (context.filters.page - 1) * context.filters.pageSize;
    return rows.slice(start, start + context.filters.pageSize);
  }
}

interface RunContext {
  organizationId: string;
  filters: ReportFilters;
  period: { from: Date; to: Date; label: string };
  currency: string;
  scope: Scope;
}

type PartialResult = Pick<
  ReportResult,
  'columns' | 'rows' | 'totals' | 'excludedForCurrency' | 'totalRows'
> & { columns: ReportColumn[] };

/** The bucket for records with no value on the grouping dimension. */
const UNASSIGNED = '__unassigned__';

/** An id nothing has, for the case where a scope resolves to nobody. */
const NOTHING = '__nothing__';

/** The permission each report needs beyond `report:read` (docs/15 §3). */
const PERMISSIONS: Readonly<Record<ReportKey, string>> = {
  'spend-total': 'report:read',
  'spend-by-department': 'report:read',
  'spend-by-category': 'report:read',
  'spend-by-vendor': 'report:read',
  'spend-by-person': 'report:read',
  'budget-vs-actual': 'budget:read',
  'pending-approvals': 'approval:read',
  'outstanding-reimbursements': 'reimbursement:read',
  'policy-exceptions': 'report:read',
  'uncategorised-transactions': 'transaction:read',
  'missing-receipts': 'transaction:read',
};

/**
 * Which permission widens each report to the whole organisation.
 *
 * The `:read_all` companion, not the base permission: everybody who can run a
 * report can run it over their own data, and this is what decides whether they
 * see anybody else's.
 */
const READ_ALL: Readonly<Record<ReportKey, string>> = {
  'spend-total': 'transaction:read_all',
  'spend-by-department': 'transaction:read_all',
  'spend-by-category': 'transaction:read_all',
  'spend-by-vendor': 'transaction:read_all',
  'spend-by-person': 'transaction:read_all',
  'budget-vs-actual': 'budget:read',
  'pending-approvals': 'approval:read',
  'outstanding-reimbursements': 'reimbursement:read_all',
  'policy-exceptions': 'spend_request:read_all',
  'uncategorised-transactions': 'transaction:read_all',
  'missing-receipts': 'transaction:read_all',
};

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}
