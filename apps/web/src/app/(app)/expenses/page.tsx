import type { Metadata } from 'next';
import Link from 'next/link';
import {
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_STATUS_LABELS,
  type ExpenseRecord,
  type OffsetCollection,
} from '@financy/contracts';
import {
  Badge,
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
import { ExpenseFilters } from './filters';

export const metadata: Metadata = { title: 'Expenses' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Expenses.
 *
 * **Two columns nobody would guess are the important ones**: how it was paid,
 * and whether it has a receipt. Payment method decides whether approving means
 * "pay this person back" or "this card charge was reasonable", and evidence is
 * what finance is actually looking for when they open this screen.
 *
 * The filters live in the URL, so a filtered view is a link somebody can paste
 * into a ticket.
 */
export default async function ExpensesPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'expense:read')) {
    return (
      <>
        <PageHeader title="Expenses" />
        <Card>
          <PermissionState permission="expense:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const query = new URLSearchParams({ pageSize: '50' });

  for (const key of ['status', 'paymentMethod', 'q'] as const) {
    const value = params[key];
    if (typeof value === 'string' && value !== '') query.set(key, value);
  }

  if (params['mine'] === 'true') query.set('mine', 'true');

  const expenses = await apiFetch<OffsetCollection<ExpenseRecord>>(`/expenses?${query.toString()}`);
  const rows = expenses.data;
  const filtered = query.size > 1;

  const columns: Column<ExpenseRecord>[] = [
    {
      key: 'reference',
      header: 'Reference',
      render: (expense) => (
        <Link
          href={`/expenses/${expense.id}`}
          className="font-mono text-[13px] text-ink-700 hover:text-cobalt-600 hover:underline"
        >
          {expense.reference}
        </Link>
      ),
    },
    { key: 'merchantName', header: 'Merchant', render: (expense) => expense.merchantName },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (expense) => (
        <Money amount={expense.amount.amount} currency={expense.amount.currency} />
      ),
    },
    {
      key: 'paymentMethod',
      header: 'Paid',
      render: (expense) => (
        <Badge tone={expense.paymentMethod === 'COMPANY_CARD' ? 'info' : 'neutral'}>
          {expense.paymentMethod === 'COMPANY_CARD' ? 'Company card' : 'Own money'}
        </Badge>
      ),
    },
    {
      key: 'receiptIds',
      header: 'Evidence',
      render: (expense) =>
        expense.receiptIds.length === 0 ? (
          // Said plainly rather than shown as a blank cell: "no receipt" is the
          // thing finance is looking for, and an empty space reads as "not
          // loaded yet".
          <span className="text-[12px] text-ink-400">None</span>
        ) : (
          <span className="text-[12px] text-ink-600">
            {expense.receiptIds.length} receipt{expense.receiptIds.length === 1 ? '' : 's'}
          </span>
        ),
    },
    {
      key: 'expenseDate',
      header: 'Spent',
      render: (expense) => formatDate(expense.expenseDate),
    },
    {
      key: 'status',
      header: 'Status',
      render: (expense) => (
        <StatusBadge status={expense.status} label={EXPENSE_STATUS_LABELS[expense.status]} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Money already spent, waiting to be recognised. Approving one authorises paying it back."
        count={`${String(expenses.pagination.totalCount)} total`}
        action={
          can(session, 'expense:create') ? (
            <Link
              href="/expenses/new"
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-cobalt-600 px-3 text-[13px] font-medium text-white hover:bg-cobalt-700"
            >
              New expense
            </Link>
          ) : undefined
        }
      />

      <Card>
        <ExpenseFilters />

        {rows.length === 0 ? (
          <div className="p-6">
            {filtered ? (
              <FilteredEmptyState />
            ) : (
              <FirstRunEmptyState
                title="No expenses yet"
                description="An expense is money somebody has already spent. Raise one to have it recognised — and reimbursed, if it came out of their own pocket."
              />
            )}
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(expense) => expense.id}
            caption={`Payment methods: ${Object.values(EXPENSE_PAYMENT_METHOD_LABELS).join(' · ')}`}
          />
        )}
      </Card>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
