import { Money } from '@financy/core';
import type { PolicyContext } from '@financy/core';
import { NotFoundError } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';
import { BudgetLedgerService } from '../budgets/index.js';

/**
 * What a caller knows about the spend before the context is assembled.
 *
 * Deliberately small: everything else is looked up. A caller that could pass
 * the requester's department, or the budget's remaining balance, could pass a
 * wrong one — and a policy evaluated against a context the requester supplied
 * is not a control, it is a suggestion.
 */
export interface ContextRequest {
  readonly spendType: PolicyContext['spendType'];
  readonly amount: string;
  readonly currency: string;
  readonly requesterMembershipId: string;
  readonly entityId: string;
  readonly categoryId?: string | null;
  readonly projectId?: string | null;
  readonly vendorId?: string | null;
  readonly merchantName?: string | null;
  readonly hasReceipt?: boolean;
  readonly memo?: string | null;
  readonly neededBy?: Date | null;
  /** Injected, so an evaluation can be reproduced or simulated at any date. */
  readonly now: Date;
}

/**
 * Assembling the evaluation context (task 2.1.3, docs/11 §3).
 *
 * **This is the only impure part of the policy path, and it is impure on
 * purpose.** The evaluator is a pure function of its context; everything that
 * has to read the database happens here, once, before it is called. That
 * separation is what makes a decision reproducible: given the same context, the
 * same policies always produce the same decision, whatever the database has
 * done since.
 *
 * **Nothing in the context comes from the requester.** The department, the
 * manager chain, the tenure, the spend history — all of it is read from the
 * organisation's own records. A policy evaluated against numbers the requester
 * supplied would be a policy the requester could satisfy by lying.
 */
@Injectable()
export class PolicyContextService {
  constructor(
    private readonly database: DatabaseService,
    private readonly budgets: BudgetLedgerService,
  ) {}

  async build(
    tx: Prisma.TransactionClient,
    organizationId: string,
    request: ContextRequest,
  ): Promise<PolicyContext> {
    const membership = await tx.membership.findFirst({
      where: { id: request.requesterMembershipId, organizationId },
      select: {
        id: true,
        createdAt: true,
        managerMembershipId: true,
        role: { select: { key: true } },
        department: { select: { id: true, path: true } },
      },
    });

    if (membership === null) throw new NotFoundError('Membership');

    const [organization, category, managerChain, spentThisMonth, budget] = await Promise.all([
      tx.organization.findUnique({
        where: { id: organizationId },
        select: { baseCurrency: true, fiscalYearStartMonth: true },
      }),
      request.categoryId === undefined || request.categoryId === null
        ? Promise.resolve(null)
        : tx.category.findFirst({
            where: { id: request.categoryId, organizationId },
            select: { id: true, key: true, parentId: true },
          }),
      this.managerChain(tx, organizationId, membership.managerMembershipId),
      this.spendThisMonth(tx, organizationId, request.requesterMembershipId, request.now),
      this.budgetPosition(organizationId, request, {
        departmentId: membership.department?.id ?? null,
      }),
    ]);

    if (organization === null) throw new NotFoundError('Organization');

    const amount = Money.of(request.amount, request.currency);

    /**
     * No conversion is performed here, and the absence is deliberate.
     *
     * A rate has to be *recorded* with the decision — a converted amount
     * whose rate nobody can reproduce is a number that cannot be checked.
     * Until the FX provider lands (Phase 5), an amount already in the base
     * currency is used as-is and anything else is passed through unchanged,
     * so a policy authored against `amountInBaseCurrency` sees the same value
     * it would see with a rate of one. What it must never do is invent a
     * rate.
     */
    const amountInBaseCurrency = amount.currency === organization.baseCurrency ? amount : amount;

    const memo = request.memo ?? null;

    return {
      organizationId,
      spendType: request.spendType,
      amount,
      amountInBaseCurrency,
      requester: {
        membershipId: membership.id,
        roleKey: membership.role.key,
        departmentId: membership.department?.id ?? null,
        // `/` rather than an empty string for somebody in no department: the
        // path operators are prefix tests, and an empty prefix would make
        // every `IS_DESCENDANT_OF` rule match everybody.
        departmentPath: membership.department?.path ?? '/',
        entityId: request.entityId,
        managerChain,
        tenureDays: Math.max(
          0,
          Math.floor((request.now.getTime() - membership.createdAt.getTime()) / 86_400_000),
        ),
      },
      classification: {
        categoryId: category?.id ?? null,
        // Categories are at most two deep and carry no materialised path, so
        // one is composed from the keys. Delimited at both ends like the
        // department path, for the same prefix-matching reason.
        categoryPath: category === null ? '/' : `/${category.key}/`,
        projectId: request.projectId ?? null,
        vendorId: request.vendorId ?? null,
        merchantName: request.merchantName ?? null,
      },
      budget,
      evidence: {
        hasReceipt: request.hasReceipt ?? false,
        hasMemo: memo !== null && memo.trim() !== '',
        memoLength: memo?.trim().length ?? 0,
        receiptCount: request.hasReceipt === true ? 1 : 0,
      },
      temporal: {
        now: request.now,
        neededBy: request.neededBy ?? null,
        fiscalPeriod: fiscalPeriod(request.now, organization.fiscalYearStartMonth),
      },
      history: {
        requesterSpendThisMonth: spentThisMonth,
        // Per-category history needs the same query with a category filter;
        // it is not read until a rule can name it, and no field does yet.
        requesterSpendThisMonthInCategory: Money.zero(organization.baseCurrency),
        similarRequestsLast30Days: 0,
      },
    };
  }

  /**
   * The budget this spend draws on, as the evaluator sees it (FR-BDG-007).
   *
   * **The tightest match wins.** A charge can legitimately fall inside a
   * departmental budget and an organisation-wide one at the same time, and a
   * rule that says "block when this would exceed the budget" means the budget
   * that runs out first. Picking the largest, or the first the database
   * happened to return, would make the same rule behave differently depending
   * on which budgets somebody set up.
   *
   * `null` when nothing matches, which the evaluator already treats as a
   * first-class case: `budget.exists` is false, and `budget.wouldExceed` is
   * false because spend cannot exceed a budget that does not exist.
   */
  private async budgetPosition(
    organizationId: string,
    request: ContextRequest,
    resolved: { departmentId: string | null },
  ): Promise<PolicyContext['budget']> {
    const amount = Money.of(request.amount, request.currency);

    const positions = await this.budgets.positions(organizationId, {
      entityId: request.entityId,
      departmentId: resolved.departmentId,
      projectId: request.projectId ?? null,
      categoryId: request.categoryId ?? null,
      occurredAt: request.now,
      amount,
    });

    const tightest = positions.reduce<(typeof positions)[number] | null>(
      (best, position) =>
        best === null ||
        Money.of(position.remaining, position.currency).lessThan(
          Money.of(best.remaining, best.currency),
        )
          ? position
          : best,
      null,
    );

    if (tightest === null) return null;

    const allocated = Money.of(tightest.allocated, tightest.currency);
    const committed = Money.of(tightest.committed, tightest.currency);
    const actual = Money.of(tightest.actual, tightest.currency);
    const usedAfter = committed.add(actual).add(amount);

    return {
      budgetLineId: tightest.budgetLineId,
      allocated,
      committed,
      actual,
      remaining: Money.of(tightest.remaining, tightest.currency),
      // A ratio, not a percentage: `1.0` is fully consumed. Zero allocation
      // has no ratio, and reporting one would make every rule about
      // utilisation fire on an empty budget.
      utilizationAfterThisSpend: allocated.isZero()
        ? 0
        : Number(usedAfter.toJSON().amount) / Number(allocated.toJSON().amount),
      wouldExceed: tightest.wouldExceed,
    };
  }

  /**
   * The requester's managers, nearest first.
   *
   * Walked with a bound rather than recursively until null: a pre-existing
   * loop in the data — which the membership service refuses to create but
   * cannot retroactively prevent — would otherwise hang the request rather
   * than producing a decision.
   */
  private async managerChain(
    tx: Prisma.TransactionClient,
    organizationId: string,
    firstManagerId: string | null,
  ): Promise<string[]> {
    if (firstManagerId === null) return [];

    const rows = await tx.membership.findMany({
      where: { organizationId },
      select: { id: true, managerMembershipId: true },
    });

    const parentOf = new Map(rows.map((row) => [row.id, row.managerMembershipId]));
    const chain: string[] = [];

    let cursor: string | null = firstManagerId;

    for (let step = 0; step < parentOf.size && cursor !== null; step += 1) {
      if (chain.includes(cursor)) break;

      chain.push(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }

    return chain;
  }

  /**
   * What this person has already had approved this calendar month.
   *
   * Approved rather than submitted: a rule about "spend this month" means
   * money committed, and counting requests still awaiting a decision would
   * let a rejected request keep suppressing somebody's limit.
   */
  private async spendThisMonth(
    tx: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
    now: Date,
  ): Promise<Money> {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });

    const currency = organization?.baseCurrency ?? 'USD';
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const rows = await tx.spendRequest.findMany({
      where: {
        organizationId,
        requesterMembershipId: membershipId,
        status: 'APPROVED',
        decidedAt: { gte: monthStart },
      },
      select: { amountInBaseCurrency: true },
    });

    // Summed with `Money`, never with `+`. Adding decimal strings as numbers
    // is how a total ends up a hundredth of a unit out and nobody can say
    // which row caused it.
    return Money.sum(
      rows.map((row) => Money.of(row.amountInBaseCurrency, currency)),
      currency,
    );
  }
}

/**
 * The fiscal period label a rule can match on.
 *
 * `2026-Q3` relative to the organisation's own fiscal year start, not the
 * calendar's — an organisation whose year begins in April has a Q1 that runs
 * April to June, and a rule about "end of Q4" that used calendar quarters
 * would fire in the wrong month for them.
 */
export function fiscalPeriod(now: Date, fiscalYearStartMonth: number): string {
  const month = now.getUTCMonth() + 1;
  const offset = (month - fiscalYearStartMonth + 12) % 12;
  const quarter = Math.floor(offset / 3) + 1;

  // The fiscal year is labelled by the calendar year it *starts* in, so a
  // year beginning in April 2026 is "2026" through to March 2027.
  const year = month >= fiscalYearStartMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  return `${String(year)}-Q${String(quarter)}`;
}
