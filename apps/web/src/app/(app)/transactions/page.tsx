import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MATCH_STATUS_LABELS,
  RECEIPT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
  type CardRecord,
  type OffsetCollection,
  type OrganizationSettings,
  type Resource,
  type TransactionRecord,
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
import { TransactionFilters } from './filters';
import { ImportButton } from './import-button';

export const metadata: Metadata = { title: 'Transactions' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Money that has actually moved.
 *
 * **Four status axes get four filters, not one.** A charge is routinely posted,
 * missing its receipt, unreviewed, and uncoded at the same time — that is the
 * ordinary state of a card charge on the day it lands. One `status` filter
 * would make "everything settled but still needing a receipt" impossible to
 * ask for, which is precisely the question the finance queue is.
 *
 * The row shows the two axes people scan for — settlement and review — and the
 * others live in the filter bar and on the detail page. A row carrying five
 * badges is a row nobody reads.
 */
export default async function TransactionsPage({
  searchParams,
}: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'transaction:read')) {
    return (
      <>
        <PageHeader title="Transactions" />
        <Card>
          <PermissionState permission="transaction:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;

  const query = new URLSearchParams();
  for (const key of [
    'status',
    'reviewStatus',
    'receiptStatus',
    'matchStatus',
    'cardId',
    'categoryId',
    'q',
  ]) {
    const value = first(params[key]);
    // Only what was actually given: the API's query schema is strict, so an
    // empty `status=` for an untouched picker is a 422 rather than no filter.
    if (value !== undefined) query.set(key, value);
  }

  const page = first(params['page']) ?? '1';
  query.set('page', page);
  query.set('pageSize', '25');

  const canImport = can(session, 'transaction:import');

  const [result, cards, settings] = await Promise.all([
    apiFetch<OffsetCollection<TransactionRecord>>(`/transactions?${query.toString()}`),
    can(session, 'card:read')
      ? apiFetch<OffsetCollection<CardRecord>>('/cards?pageSize=100').catch(() => null)
      : Promise.resolve(null),
    canImport
      ? apiFetch<Resource<OrganizationSettings>>('/organization').catch(() => null)
      : Promise.resolve(null),
  ]);

  const columns: ReadonlyArray<Column<TransactionRecord>> = [
    {
      key: 'merchant',
      header: 'Merchant',
      render: (transaction) => (
        <div className="min-w-0">
          <Link
            href={`/transactions/${transaction.id}`}
            className="truncate font-medium text-ink-900 hover:text-cobalt-600 hover:underline"
          >
            {transaction.merchantName}
          </Link>
          <div className="truncate text-[12px] text-ink-500">
            {transaction.card === null
              ? (transaction.member?.fullName ?? 'No card')
              : `${transaction.card.name}${
                  transaction.card.lastFour === null ? '' : ` ···· ${transaction.card.lastFour}`
                }`}
          </div>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'When',
      render: (transaction) => (
        <time dateTime={transaction.occurredAt} className="tabular text-ink-600">
          {formatDate(transaction.occurredAt)}
        </time>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (transaction) => (
        <Money amount={transaction.amount.amount} currency={transaction.amount.currency} />
      ),
    },
    {
      key: 'evidence',
      header: 'Evidence',
      render: (transaction) => (
        <div className="flex flex-wrap gap-1">
          {transaction.receiptStatus === 'MISSING' && <Badge tone="warning">No receipt</Badge>}
          {transaction.receiptStatus === 'ATTACHED' && <Badge tone="success">Receipt</Badge>}
          {transaction.matchStatus === 'AUTO_MATCHED' && (
            // Marked as automatic, because a guess and a decision should not
            // look the same to whoever reviews it.
            <Badge tone="info" title="Linked automatically — check it before relying on it.">
              Auto-matched
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'review',
      header: 'Review',
      render: (transaction) => (
        <span
          className={
            transaction.reviewStatus === 'DISPUTED'
              ? 'text-[13px] text-[var(--color-danger-text)]'
              : 'text-[13px] text-ink-600'
          }
        >
          {REVIEW_STATUS_LABELS[transaction.reviewStatus]}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (transaction) => (
        <StatusBadge
          status={transaction.status}
          label={TRANSACTION_STATUS_LABELS[transaction.status]}
        />
      ),
    },
  ];

  const { totalCount, totalPages, page: currentPage } = result.pagination;
  const isFiltered = [...query.keys()].some((key) => key !== 'page' && key !== 'pageSize');

  return (
    <>
      <PageHeader
        title="Transactions"
        description="The record of money spent. Settlement, evidence, review, and coding move independently."
        count={`${String(totalCount)} ${totalCount === 1 ? 'transaction' : 'transactions'}`}
        action={
          canImport && settings !== null ? (
            <ImportButton entities={settings.data.entities} cards={cards?.data ?? []} />
          ) : undefined
        }
      />

      <TransactionFilters cards={cards?.data ?? []} />

      <Card>
        <DataTable
          columns={columns}
          rows={result.data}
          rowKey={(transaction) => transaction.id}
          caption="Transactions, most recent first"
          emptyState={
            isFiltered ? (
              <FilteredEmptyState />
            ) : (
              <FirstRunEmptyState
                title="Nothing spent yet"
                description="Charges arrive from the card provider, or through an import. Each one carries four independent statuses — settled, evidenced, reviewed, coded — because those four things genuinely happen separately."
              />
            )
          }
        />
      </Card>

      {totalPages > 1 && (
        <nav
          className="mt-4 flex items-center justify-between text-[13px] text-ink-500"
          aria-label="Pagination"
        >
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <PageLink
              page={currentPage - 1}
              disabled={currentPage <= 1}
              label="Previous"
              query={query}
            />
            <PageLink
              page={currentPage + 1}
              disabled={currentPage >= totalPages}
              label="Next"
              query={query}
            />
          </div>
        </nav>
      )}

      <p className="mt-4 text-[12px] text-ink-400">
        Receipt states: {Object.values(RECEIPT_STATUS_LABELS).join(' · ')}. Matching:{' '}
        {Object.values(MATCH_STATUS_LABELS).join(' · ')}.
      </p>
    </>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined || single === '' ? undefined : single;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function PageLink({
  page,
  disabled,
  label,
  query,
}: {
  page: number;
  disabled: boolean;
  label: string;
  query: URLSearchParams;
}): React.JSX.Element {
  if (disabled) {
    return (
      <span className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-300">
        {label}
      </span>
    );
  }

  const next = new URLSearchParams(query);
  next.set('page', String(page));

  return (
    <a
      href={`/transactions?${next.toString()}`}
      className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-700 hover:bg-ink-50"
    >
      {label}
    </a>
  );
}
