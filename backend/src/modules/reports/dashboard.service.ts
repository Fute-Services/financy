import type { DashboardSummary } from '@financy/contracts';
import { Money, NotFoundError } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';
import { callerHas, getContext, getOrganizationId } from '../../platform/request-context/index.js';

/**
 * The dashboard (docs/15 §7, epic 4.3).
 *
 * ## Role-awareness is a scope, not a set of hidden components
 *
 * The employee's dashboard *returns* the employee's data. It does not return
 * the organisation's and render a subset — a component that filtered would
 * hand the full set to anybody who opened the network tab, and the difference
 * between "not shown" and "not sent" is the entire control.
 *
 * ## Every number arrives finished
 *
 * The month-to-date figure, the comparison, the trend points, the budget
 * utilisation — all computed here. The screen formats and never adds. That is
 * the same rule as the reports (docs/15 §1) and it matters more on a dashboard,
 * because a dashboard figure is the one people quote without opening anything.
 *
 * ## "Needs attention" is the part anybody acts on
 *
 * A row of totals says how the month is going. The attention list says what to
 * open, and it is filtered to things this person can actually do something
 * about — an employee is not shown the review queue, because being told about
 * work you cannot do is how a dashboard becomes wallpaper.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async summary(): Promise<DashboardSummary> {
    const organizationId = requireOrganization();
    const membershipId = getContext()?.membershipId ?? null;

    const organization = await this.database.unscoped.organization.findUnique({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });

    if (organization === null) throw new NotFoundError('Organization');

    const currency = organization.baseCurrency;
    const wide = callerHas('transaction:read_all');
    const scope: DashboardSummary['scope'] = wide ? 'ORGANIZATION' : 'OWN';

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const previousMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    // The same *day* of the previous month, not the whole of it. Comparing
    // eleven days against thirty-one is a comparison that always reads as a
    // collapse in spending, every month, until the last day of it.
    const previousMonthToDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, now.getUTCDate(), 23, 59, 59, 999),
    );

    const mine = wide || membershipId === null ? {} : { memberMembershipId: membershipId };
    const myExpenses =
      wide || membershipId === null ? {} : { submitterMembershipId: membershipId };

    const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const [
      monthCharges,
      previousCharges,
      monthClaims,
      previousClaims,
      trendCharges,
      trendClaims,
      pendingApprovals,
      uncategorised,
      missingReceipts,
      reimbursements,
      budgets,
    ] = await Promise.all([
      this.charges(organizationId, mine, monthStart, now),
      this.charges(organizationId, mine, previousMonthStart, previousMonthToDate),
      this.claims(organizationId, myExpenses, monthStart, now),
      this.claims(organizationId, myExpenses, previousMonthStart, previousMonthToDate),
      this.charges(organizationId, mine, trendStart, now),
      this.claims(organizationId, myExpenses, trendStart, now),
      this.pendingApprovalCount(organizationId, membershipId, wide),
      wide
        ? this.database.unscoped.transaction.count({
            where: { organizationId, categoryId: null, status: 'POSTED' },
          })
        : Promise.resolve(0),
      this.database.unscoped.transaction.count({
        where: { organizationId, receiptStatus: 'MISSING', status: 'POSTED', ...mine },
      }),
      this.database.unscoped.reimbursementBatch.findMany({
        where: {
          organizationId,
          status: { in: ['DRAFT', 'APPROVED'] },
          ...(wide || membershipId === null ? {} : { payeeMembershipId: membershipId }),
        },
        select: { totalAmount: true, currency: true },
      }),
      callerHas('budget:read')
        ? this.database.unscoped.budget.findMany({
            where: {
              organizationId,
              // `status` alone, never `archivedAt: null` — an absent field does
              // not match a null filter on MongoDB (ADR-0017), and an ACTIVE
              // budget is by definition not archived.
              status: 'ACTIVE',
              periodStart: { lte: now },
              periodEnd: { gte: now },
            },
            include: { lines: true },
            orderBy: { name: 'asc' },
            take: 8,
          })
        : Promise.resolve([]),
    ]);

    const sum = (rows: readonly { amount: string; currency: string }[]): Money =>
      Money.sum(
        rows
          .filter((row) => row.currency === currency)
          .map((row) => Money.of(row.amount, row.currency)),
        currency,
      );

    const monthToDate = sum(monthCharges).add(sum(monthClaims));
    const previous = sum(previousCharges).add(sum(previousClaims));

    const trend = this.bucketByMonth([...trendCharges, ...trendClaims], currency, trendStart, now);

    return {
      scope,
      currency,
      spendMonthToDate: monthToDate.toJSON(),
      spendPreviousMonthToDate: previous.toJSON(),
      pendingApprovals,
      uncategorisedTransactions: uncategorised,
      missingReceipts,
      outstandingReimbursements: sum(
        reimbursements.map((batch) => ({ amount: batch.totalAmount, currency: batch.currency })),
      ).toJSON(),
      budgets: budgets.map((budget) => {
        const allocated = Money.sum(
          budget.lines.map((line) => Money.of(line.allocatedAmount, budget.currency)),
          budget.currency,
        );
        const used = Money.sum(
          budget.lines.map((line) =>
            Money.of(line.committedAmount, budget.currency).add(
              Money.of(line.actualAmount, budget.currency),
            ),
          ),
          budget.currency,
        );

        return {
          id: budget.id,
          name: budget.name,
          utilization: allocated.isZero()
            ? null
            : Math.round(
                (Number(used.toJSON().amount) / Number(allocated.toJSON().amount)) * 100,
              ),
          remaining: allocated.subtract(used).toJSON(),
          overspendBehavior: budget.overspendBehavior,
        };
      }),
      trend,
      needsAttention: this.attention({
        pendingApprovals,
        uncategorised,
        missingReceipts,
        wide,
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  private async charges(
    organizationId: string,
    scope: Record<string, unknown>,
    from: Date,
    to: Date,
  ): Promise<{ amount: string; currency: string; occurredAt: Date }[]> {
    return this.database.unscoped.transaction.findMany({
      where: { organizationId, status: 'POSTED', occurredAt: { gte: from, lte: to }, ...scope },
      select: { amount: true, currency: true, occurredAt: true },
    });
  }

  private async claims(
    organizationId: string,
    scope: Record<string, unknown>,
    from: Date,
    to: Date,
  ): Promise<{ amount: string; currency: string; occurredAt: Date }[]> {
    const rows = await this.database.unscoped.expense.findMany({
      where: {
        organizationId,
        paymentMethod: 'OUT_OF_POCKET',
        status: { in: ['APPROVED', 'REIMBURSED'] },
        expenseDate: { gte: from, lte: to },
        ...scope,
      },
      select: { amount: true, currency: true, expenseDate: true },
    });

    return rows.map((row) => ({
      amount: row.amount,
      currency: row.currency,
      occurredAt: row.expenseDate,
    }));
  }

  /**
   * What is waiting on this person, or on everybody.
   *
   * For somebody who can act, it is the steps naming them — the same query the
   * approval queue runs, so the badge and the page never disagree.
   */
  private async pendingApprovalCount(
    organizationId: string,
    membershipId: string | null,
    wide: boolean,
  ): Promise<number> {
    if (!callerHas('approval:read')) return 0;

    return this.database.unscoped.approvalStep.count({
      where: {
        organizationId,
        status: { in: ['ACTIVE', 'ESCALATED'] },
        ...(wide || membershipId === null ? {} : { eligibleMembershipIds: { has: membershipId } }),
      },
    });
  }

  /** Six months of spend, one point per month, oldest first. */
  private bucketByMonth(
    rows: readonly { amount: string; currency: string; occurredAt: Date }[],
    currency: string,
    from: Date,
    to: Date,
  ): DashboardSummary['trend'] {
    const buckets = new Map<string, Money>();

    for (
      let cursor = new Date(from);
      cursor.getTime() <= to.getTime();
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    ) {
      // Empty months are points too. A trend line that skipped them would
      // draw a quiet August as a straight line to September.
      buckets.set(monthKey(cursor), Money.zero(currency));
    }

    for (const row of rows) {
      if (row.currency !== currency) continue;

      const key = monthKey(row.occurredAt);
      const existing = buckets.get(key);

      if (existing === undefined) continue;

      buckets.set(key, existing.add(Money.of(row.amount, row.currency)));
    }

    return [...buckets.entries()].map(([label, amount]) => ({
      label,
      amount: amount.toJSON(),
    }));
  }

  private attention(counts: {
    pendingApprovals: number;
    uncategorised: number;
    missingReceipts: number;
    wide: boolean;
  }): DashboardSummary['needsAttention'] {
    const items: DashboardSummary['needsAttention'] = [];

    if (counts.pendingApprovals > 0 && callerHas('approval:read')) {
      items.push({
        kind: 'approvals',
        label: 'Waiting for a decision',
        count: counts.pendingApprovals,
        href: '/approvals',
      });
    }

    if (counts.missingReceipts > 0) {
      items.push({
        kind: 'receipts',
        label: 'Charges with no receipt',
        count: counts.missingReceipts,
        href: '/transactions?receiptStatus=MISSING',
      });
    }

    // Only for somebody who can code them. Telling an employee about eighty
    // uncategorised charges is telling them about somebody else's job.
    if (counts.uncategorised > 0 && callerHas('transaction:review')) {
      items.push({
        kind: 'review',
        label: 'Charges waiting to be reviewed',
        count: counts.uncategorised,
        href: '/review',
      });
    }

    return items;
  }
}

function monthKey(date: Date): string {
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}
