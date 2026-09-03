import type { Metadata } from 'next';
import { BILL_STATUS_LABELS, type BillRecord, type OffsetCollection } from '@financy/contracts';
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

import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { BillFilters } from './filters';

export const metadata: Metadata = { title: 'Bills' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * What the company owes suppliers.
 *
 * **Sorted by when it is due, not when it arrived.** An accounts payable list
 * exists to answer "what has to go out this week", and any other default order
 * makes somebody re-sort it every morning.
 *
 * **Overdue is said in words as well as colour.** `daysUntilDue` arrives
 * negative from the server — no arithmetic happens here — and a row eleven days
 * late says so, because a red tint means nothing in a printout or to somebody
 * scanning quickly.
 */
export default async function BillsPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'bill:read')) {
    return (
      <>
        <PageHeader title="Bills" />
        <Card>
          <PermissionState permission="bill:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const query = new URLSearchParams();

  for (const key of ['status', 'vendorId', 'overdue', 'q']) {
    const value = Array.isArray(params[key]) ? params[key][0] : params[key];
    if (value !== undefined && value !== '') query.set(key, value);
  }

  const bills = await apiFetch<OffsetCollection<BillRecord>>(`/bills?${query.toString()}`);
  const filtered = [...query.keys()].length > 0;

  const columns: Column<BillRecord>[] = [
    {
      key: 'vendor',
      header: 'Supplier',
      render: (bill) => (
        <Link href={`/bills/${bill.id}`} className="block min-w-0">
          <div className="truncate font-medium text-ink-900 hover:text-cobalt-600">
            {bill.vendor.name}
          </div>
          <div className="truncate text-[12px] text-ink-500">Invoice {bill.billNumber}</div>
        </Link>
      ),
    },
    {
      key: 'total',
      header: 'Amount',
      align: 'right',
      render: (bill) => <Money amount={bill.total.amount} currency={bill.total.currency} />,
    },
    {
      key: 'due',
      header: 'Due',
      render: (bill) => <DueCell bill={bill} />,
    },
    {
      key: 'status',
      header: 'Status',
      width: '150px',
      render: (bill) => (
        <StatusBadge status={bill.status} label={BILL_STATUS_LABELS[bill.status]} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Bills"
        description="Supplier invoices, in the order they have to be paid."
        action={
          can(session, 'bill:create') ? (
            <Link
              href="/bills/new"
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-cobalt-600 px-3 text-[13px] font-medium text-white hover:bg-cobalt-700"
            >
              Enter a bill
            </Link>
          ) : undefined
        }
      />

      <BillFilters />

      {bills.data.length === 0 ? (
        <Card>
          {filtered ? (
            <FilteredEmptyState />
          ) : (
            <FirstRunEmptyState
              title="No bills yet"
              description="A bill is a supplier's invoice. It goes through the same approval as any other spend, and its number is unique per supplier so it cannot be paid twice."
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={bills.data}
            rowKey={(bill) => bill.id}
            caption="Supplier invoices"
          />
        </Card>
      )}
    </>
  );
}

/**
 * When it is due, and how late it is.
 *
 * The number comes from the server already signed. This renders it; it does not
 * compute it.
 */
function DueCell({ bill }: { bill: BillRecord }): React.JSX.Element {
  const due = new Date(bill.dueDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (bill.status === 'PAID' || bill.status === 'CANCELLED' || bill.status === 'CREDIT_NOTE') {
    return <span className="text-[13px] text-ink-500">{due}</span>;
  }

  if (bill.daysUntilDue < 0) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-[13px] text-ink-700">{due}</span>
        <Badge tone="danger">{Math.abs(bill.daysUntilDue)} days late</Badge>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-[13px] text-ink-700">{due}</span>
      {bill.daysUntilDue <= 7 && <Badge tone="warning">in {bill.daysUntilDue} days</Badge>}
    </span>
  );
}
