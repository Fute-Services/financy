import type { Metadata } from 'next';
import Link from 'next/link';
import type { DashboardSummary, Resource } from '@financy/contracts';
import {
  BarChart,
  BudgetMeter,
  Card,
  CardBody,
  CardHeader,
  KpiCard,
  Money,
  ErrorState,
  type BarChartPoint,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Overview' };

/**
 * The first screen after signing in (epic 4.3).
 *
 * ## Every figure arrives finished
 *
 * Not one number on this page is computed here. The month-to-date total, the
 * comparison, the trend points, the utilisation percentages — all of it comes
 * from `/v1/dashboard`, and this file formats and lays out. That is the
 * governing rule for anything financial (docs/15 §1), and it bites hardest on a
 * dashboard, because a dashboard figure is the one people quote without opening
 * anything to check it.
 *
 * ## It says whose numbers these are
 *
 * The same endpoint returns an employee their own spend and finance the whole
 * organisation, so the heading has to say which — "€12,400 this month" means
 * two very different things and the difference is invisible otherwise.
 *
 * ## Attention before totals
 *
 * The list of things to open comes first on narrow screens and sits beside the
 * numbers on wide ones. Totals describe; the attention list is the only part
 * anybody acts on, and a dashboard whose actionable half is below the fold is a
 * dashboard people stop opening.
 */
export default async function OverviewPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null) {
    return (
      <>
        <PageHeader title="Overview" />
        <Card>
          <ErrorState message="Your session could not be read. Sign in again." />
        </Card>
      </>
    );
  }

  let dashboard: DashboardSummary;

  try {
    dashboard = (await apiFetch<Resource<DashboardSummary>>('/dashboard')).data;
  } catch {
    return (
      <>
        <PageHeader title="Overview" />
        <Card>
          <ErrorState message="The overview could not be loaded. It will be here when the service is." />
        </Card>
      </>
    );
  }

  const scopeWord =
    dashboard.scope === 'ORGANIZATION'
      ? 'across the organisation'
      : dashboard.scope === 'DEPARTMENT'
        ? 'across your department'
        : 'on your own records';

  const change = describeChange(
    dashboard.spendMonthToDate.amount,
    dashboard.spendPreviousMonthToDate.amount,
  );

  /**
   * The trend, formatted once here and handed to the chart as strings.
   *
   * The chart is given a magnitude for geometry and a rendered string for
   * display, so there is no path by which it could show a number the server
   * did not produce.
   */
  const trend: BarChartPoint[] = dashboard.trend.map((point, index) => ({
    label: monthLabel(point.label),
    formatted: formatMoney(point.amount.amount, point.amount.currency),
    value: Number(point.amount.amount),
    // The last bucket is the month we are standing in. Drawn faint and
    // labelled "so far", because a partial month next to five whole ones
    // otherwise reads as a collapse in spending.
    partial: index === dashboard.trend.length - 1,
  }));

  return (
    <>
      <PageHeader
        title={`Good to see you, ${session.user.fullName.split(' ')[0] ?? ''}`}
        description={`Everything below is ${scopeWord}.`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Spend this month"
              value={
                <Money
                  amount={dashboard.spendMonthToDate.amount}
                  currency={dashboard.currency}
                />
              }
              {...(change === null
                ? {}
                : {
                    delta: change.label,
                    deltaDirection: change.direction,
                    // Spending more is not automatically bad, but on a spend
                    // tool it is the direction worth noticing.
                    deltaIsGood: false,
                  })}
              hint=" vs the same point last month"
            />
            <KpiCard
              label="Awaiting approval"
              value={String(dashboard.pendingApprovals)}
              hint={dashboard.pendingApprovals === 0 ? 'Nothing is stuck' : 'Approvals'}
            />
            <KpiCard
              label="Receipts missing"
              value={String(dashboard.missingReceipts)}
              hint="Posted charges"
            />
            <KpiCard
              label="Owed to staff"
              value={
                <Money
                  amount={dashboard.outstandingReimbursements.amount}
                  currency={dashboard.currency}
                />
              }
              hint="Unpaid batches"
            />
          </div>

          <Card>
            <CardHeader
              title="Spend, month by month"
              description="Six months, including the quiet ones."
            />
            <CardBody>
              <BarChart points={trend} caption="Spend by month, across the last six months" />
            </CardBody>
          </Card>

          {dashboard.budgets.length > 0 && (
            <Card>
              <CardHeader
                title="Budgets"
                description="Committed and spent, against what was allocated."
                action={
                  <Link
                    href="/budgets"
                    className="text-[13px] text-[var(--color-accent-text)] hover:underline"
                  >
                    All budgets
                  </Link>
                }
              />
              <CardBody className="flex flex-col gap-3">
                {dashboard.budgets.map((budget) => (
                  <div key={budget.id} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/budgets/${budget.id}`}
                        className="truncate text-[13px] text-ink-800 hover:text-cobalt-600"
                      >
                        {budget.name}
                      </Link>
                      <span className="tabular text-[12px] text-ink-500">
                        <Money
                          amount={budget.remaining.amount}
                          currency={budget.remaining.currency}
                        />{' '}
                        left
                      </span>
                    </div>
                    <BudgetMeter percent={budget.utilization ?? 0} />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Needs you"
              description="The part of this page that is actually a to-do list."
            />
            <CardBody className="p-0">
              {dashboard.needsAttention.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-ink-500">
                  Nothing is waiting on you. That is worth knowing too.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {dashboard.needsAttention.map((item) => (
                    <li key={item.kind}>
                      <Link
                        href={item.href}
                        className="flex items-center justify-between px-5 py-3 text-[13px] text-ink-800 hover:bg-ink-50"
                      >
                        <span>{item.label}</span>
                        <span className="tabular font-medium text-ink-900">{item.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {dashboard.uncategorisedTransactions > 0 && (
            <Card>
              <CardHeader title="Close readiness" />
              <CardBody>
                <p className="text-[13px] text-ink-600">
                  {dashboard.uncategorisedTransactions} charge
                  {dashboard.uncategorisedTransactions === 1 ? ' has' : 's have'} no category yet.
                  Nothing closes until they do.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The comparison sentence, or nothing.
 *
 * `null` when the earlier period was empty: "up from nothing" is not a
 * percentage, and rendering ∞% or 100% would both be inventions.
 *
 * The arithmetic here is over two numbers the **server** produced and is a
 * presentational ratio, not a financial figure — no money is being added.
 */
function describeChange(
  current: string,
  previous: string,
): { label: string; direction: 'up' | 'down' | 'flat' } | null {
  const now = Number(current);
  const before = Number(previous);

  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;

  const percent = Math.round(((now - before) / before) * 1000) / 10;

  return {
    label: `${percent > 0 ? '+' : ''}${String(percent)}%`,
    direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat',
  };
}

/**
 * `2026-04` → `Apr`.
 *
 * The server's bucket key is stable and sortable, which is what it is for. It
 * is not what somebody reads along an axis.
 */
function monthLabel(key: string): string {
  const [year, month] = key.split('-');

  if (year === undefined || month === undefined) return key;

  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Money for the chart, formatted here rather than inside it.
 *
 * Compact, because six full currency strings along an axis collide at any
 * width worth having. The exact figures are in the accessible table the chart
 * renders beneath itself, and on every screen that lists the underlying rows.
 */
function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(value);
}
