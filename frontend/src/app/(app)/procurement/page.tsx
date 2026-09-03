import type { Metadata } from 'next';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  type OffsetCollection,
  type PurchaseOrderRecord,
} from '@financy/contracts';
import {
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
import { OrderFilters } from './filters';

export const metadata: Metadata = { title: 'Procurement' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Purchase orders — money promised before it is spent.
 *
 * **An approved order has already reserved its budget.** That is the reason to
 * raise one at all, and the reason the status column matters more here than the
 * amount: an approved order and a draft one differ by a commitment nobody can
 * see anywhere else.
 */
export default async function ProcurementPage({
  searchParams,
}: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'purchase_order:read')) {
    return (
      <>
        <PageHeader title="Procurement" />
        <Card>
          <PermissionState permission="purchase_order:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const query = new URLSearchParams();

  for (const key of ['status', 'vendorId', 'mine', 'q']) {
    const value = Array.isArray(params[key]) ? params[key][0] : params[key];
    if (value !== undefined && value !== '') query.set(key, value);
  }

  const orders = await apiFetch<OffsetCollection<PurchaseOrderRecord>>(
    `/purchase-orders?${query.toString()}`,
  );
  const filtered = [...query.keys()].length > 0;

  const columns: Column<PurchaseOrderRecord>[] = [
    {
      key: 'po',
      header: 'Order',
      render: (order) => (
        <Link href={`/procurement/${order.id}`} className="block min-w-0">
          <div className="truncate font-medium text-ink-900 hover:text-cobalt-600">
            {order.vendor.name}
          </div>
          <div className="truncate text-[12px] text-ink-500">
            {order.poNumber} · raised by {order.requester.fullName}
          </div>
        </Link>
      ),
    },
    {
      key: 'total',
      header: 'Value',
      align: 'right',
      render: (order) => <Money amount={order.total.amount} currency={order.total.currency} />,
    },
    {
      key: 'expected',
      header: 'Expected',
      render: (order) => (
        <span className="text-[13px] text-ink-600">
          {order.expectedDate === null ? '—' : formatDay(order.expectedDate)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '160px',
      render: (order) => (
        <StatusBadge
          status={order.status}
          label={PURCHASE_ORDER_STATUS_LABELS[order.status]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Procurement"
        description="Purchase orders. An approved one reserves its budget from the day it is agreed, not the day the invoice arrives."
        action={
          can(session, 'purchase_order:create') ? (
            <Link
              href="/procurement/new"
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-cobalt-600 px-3 text-[13px] font-medium text-white hover:bg-cobalt-700"
            >
              Raise an order
            </Link>
          ) : undefined
        }
      />

      <OrderFilters />

      {orders.data.length === 0 ? (
        <Card>
          {filtered ? (
            <FilteredEmptyState />
          ) : (
            <FirstRunEmptyState
              title="No purchase orders yet"
              description="A purchase order commits money before anything is bought, which is what makes a three-way match against the invoice possible later."
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={orders.data}
            rowKey={(order) => order.id}
            caption="Purchase orders"
          />
        </Card>
      )}
    </>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
