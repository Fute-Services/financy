import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  BUDGET_MOVEMENT_TYPE_LABELS,
  BUDGET_OVERSPEND_BEHAVIOR_LABELS,
  BUDGET_SCOPE_TYPE_LABELS,
  BUDGET_STATUS_LABELS,
  type BudgetDetail,
  type BudgetMovementRecord,
  type OffsetCollection,
  type Resource,
} from '@financy/contracts';
import {
  BudgetMeter,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  KpiCard,
  Money,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { BudgetActions } from './budget-actions';
import { PeriodTable } from './period-table';

export const metadata: Metadata = { title: 'Budget' };

/**
 * One budget: its periods, and the ledger that explains them.
 *
 * **The ledger is on the page, not behind a link.** The first question anybody
 * asks a budget is where the money went, and an answer that requires knowing
 * there is a second screen is an answer most people never get. Every movement
 * names what caused it, so "committed €4,200" is traceable to the request that
 * committed it.
 *
 * **Committed and spent are separate columns and stay separate.** Collapsing
 * them into "used" would hide the distinction that matters most at a month end:
 * money reserved against approvals can still be released, and money spent
 * cannot.
 */
export default async function BudgetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const { id } = await params;

  if (session === null || !can(session, 'budget:read')) {
    return (
      <>
        <PageHeader title="Budget" />
        <Card>
          <PermissionState permission="budget:read" />
        </Card>
      </>
    );
  }

  let budget: BudgetDetail;

  try {
    budget = (await apiFetch<Resource<BudgetDetail>>(`/budgets/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const movements = await apiFetch<OffsetCollection<BudgetMovementRecord>>(
    `/budgets/${id}/movements?pageSize=25`,
  ).catch(() => null);

  const movementColumns: Column<BudgetMovementRecord>[] = [
    {
      key: 'movementType',
      header: 'What',
      render: (movement) => (
        <span className="text-ink-800">
          {BUDGET_MOVEMENT_TYPE_LABELS[movement.movementType]}
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Because of',
      render: (movement) => (
        <span className="text-[12px] text-ink-500">
          {movement.sourceType.toLowerCase().replaceAll('_', ' ')}
          {movement.memo === null ? '' : ` · ${movement.memo}`}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (movement) => (
        <span className={movement.direction === 'DECREASE' ? 'text-ink-500' : undefined}>
          {movement.direction === 'DECREASE' ? '−' : ''}
          <Money amount={movement.amount.amount} currency={movement.amount.currency} />
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'When',
      align: 'right',
      width: '160px',
      render: (movement) => (
        <span className="text-[12px] text-ink-500">{formatDate(movement.createdAt)}</span>
      ),
    },
  ];

  return (
    <>
      <div className="mb-1">
        <Link href="/budgets" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Budgets
        </Link>
      </div>

      <PageHeader
        title={budget.name}
        description={`${BUDGET_SCOPE_TYPE_LABELS[budget.scopeType]}${
          budget.scopeName === null ? '' : ` · ${budget.scopeName}`
        } · ${BUDGET_OVERSPEND_BEHAVIOR_LABELS[budget.overspendBehavior].toLowerCase()}`}
        action={
          <StatusBadge status={budget.status} label={BUDGET_STATUS_LABELS[budget.status]} />
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Allocated"
          value={
            <Money
              amount={budget.totals.allocated.amount}
              currency={budget.totals.allocated.currency}
            />
          }
        />
        <KpiCard
          label="Committed"
          value={
            <Money
              amount={budget.totals.committed.amount}
              currency={budget.totals.committed.currency}
            />
          }
          hint="Approved, not yet paid"
        />
        <KpiCard
          label="Spent"
          value={
            <Money
              amount={budget.totals.actual.amount}
              currency={budget.totals.actual.currency}
            />
          }
          hint="Money that has left"
        />
        <KpiCard
          label="Remaining"
          value={
            <Money
              amount={budget.totals.remaining.amount}
              currency={budget.totals.remaining.currency}
            />
          }
          hint={
            budget.totals.utilization === null
              ? 'Nothing allocated yet'
              : `${String(budget.totals.utilization)}% used`
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title="Periods"
              description={
                can(session, 'budget:manage')
                  ? 'Set any period’s allocation. The amount replaces what is there — it is not added to it.'
                  : 'What each period was given, and what it has used.'
              }
            />
            <CardBody className="p-0">
              <PeriodTable
                budgetId={budget.id}
                lines={budget.lines}
                currency={budget.currency}
                editable={can(session, 'budget:manage')}
              />
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="The ledger"
              description="Every movement, in order. Nothing here is ever deleted — a cancelled reservation is a release, not an erasure."
            />
            {movements === null || movements.data.length === 0 ? (
              <CardBody>
                <p className="text-[13px] text-ink-500">
                  Nothing has moved against this budget yet.
                </p>
              </CardBody>
            ) : (
              <DataTable
                columns={movementColumns}
                rows={movements.data}
                rowKey={(movement) => movement.id}
                density="compact"
                caption="Budget movements"
              />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <BudgetActions budget={budget} manageable={can(session, 'budget:manage')} />

          <Card>
            <CardHeader title="Overall" />
            <CardBody className="flex flex-col gap-2">
              <BudgetMeter percent={budget.totals.utilization ?? 0} />
              <p className="text-[12px] text-ink-500">
                Alerts at {budget.alertThresholds.join('%, ')}%. Each fires once for each period.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
