import type { Metadata } from 'next';
import {
  BUDGET_SCOPE_TYPE_LABELS,
  BUDGET_STATUS_LABELS,
  type BudgetRecord,
  type EntitySummary,
  type OffsetCollection,
  type Resource,
  type CategoryNode,
  type DepartmentNode,
} from '@financy/contracts';
import {
  BudgetMeter,
  Card,
  DataTable,
  FilteredEmptyState,
  FirstRunEmptyState,
  Money,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { BudgetFilters } from './filters';
import { NewBudgetButton } from './new-budget-button';

export const metadata: Metadata = { title: 'Budgets' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Budgets, with the only number anybody scans for on every row.
 *
 * **The meter and the figure, never the meter alone.** A bar is unreadable in
 * greyscale, in a screenshot pasted into a chat, and to a screen reader; the
 * percentage sits beside it for all three. Colour carries emphasis and never
 * meaning.
 *
 * **Remaining is the headline, not allocated.** "€40,000 allocated" is a fact
 * about the past. "€3,200 left" is the number that changes what somebody does
 * next, so it gets the emphasis and the column closest to the meter.
 */
export default async function BudgetsPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'budget:read')) {
    return (
      <>
        <PageHeader title="Budgets" />
        <Card>
          <PermissionState permission="budget:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const query = new URLSearchParams();

  for (const key of ['status', 'scopeType', 'entityId', 'q']) {
    const value = first(params[key]);
    // Only what was given: the API's query schema is strict, so a blank
    // parameter is a 422 rather than a no-op.
    if (value !== undefined && value !== '') query.set(key, value);
  }

  const [budgets, entities, departments, categories] = await Promise.all([
    apiFetch<OffsetCollection<BudgetRecord>>(`/budgets?${query.toString()}`),
    apiFetch<Resource<EntitySummary[]>>('/entities'),
    can(session, 'budget:manage')
      ? apiFetch<Resource<DepartmentNode[]>>('/departments').catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] as DepartmentNode[] }),
    can(session, 'budget:manage')
      ? apiFetch<Resource<CategoryNode[]>>('/categories').catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] as CategoryNode[] }),
  ]);

  const filtered = [...query.keys()].length > 0;

  const columns: Column<BudgetRecord>[] = [
    {
      key: 'name',
      header: 'Budget',
      render: (budget) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-900">{budget.name}</div>
          <div className="truncate text-[12px] text-ink-500">
            {BUDGET_SCOPE_TYPE_LABELS[budget.scopeType]}
            {budget.scopeName === null ? '' : ` · ${budget.scopeName}`}
          </div>
        </div>
      ),
    },
    {
      key: 'used',
      header: 'Used',
      width: '180px',
      render: (budget) => <BudgetMeter percent={budget.totals.utilization ?? 0} />,
    },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'right',
      render: (budget) => (
        <Money
          amount={budget.totals.remaining.amount}
          currency={budget.totals.remaining.currency}
        />
      ),
    },
    {
      key: 'allocated',
      header: 'Allocated',
      align: 'right',
      render: (budget) => (
        <span className="text-ink-500">
          <Money
            amount={budget.totals.allocated.amount}
            currency={budget.totals.allocated.currency}
          />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (budget) => (
        <StatusBadge status={budget.status} label={BUDGET_STATUS_LABELS[budget.status]} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Budgets"
        description="What was planned, what is reserved, and what is left."
        action={
          can(session, 'budget:manage') ? (
            <NewBudgetButton
              entities={entities.data}
              departments={departments.data}
              categories={categories.data}
              baseCurrency={session.organization.baseCurrency}
            />
          ) : undefined
        }
      />

      <BudgetFilters entities={entities.data} />

      {budgets.data.length === 0 ? (
        <Card>
          {filtered ? (
            <FilteredEmptyState />
          ) : (
            <FirstRunEmptyState
              title="No budgets yet"
              description="A budget is drawn around one department, entity, project, or category, over a period. Spend that matches it draws it down on its own."
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={budgets.data}
            rowKey={(budget) => budget.id}
            caption="Budgets and their utilisation"
          />
        </Card>
      )}
    </>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
