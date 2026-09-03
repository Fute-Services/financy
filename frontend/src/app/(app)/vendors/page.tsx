import type { Metadata } from 'next';
import {
  VENDOR_STATUS_LABELS,
  type OffsetCollection,
  type VendorRecord,
} from '@financy/contracts';
import {
  Card,
  DataTable,
  FilteredEmptyState,
  FirstRunEmptyState,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { NewVendorButton } from './new-vendor-button';
import { VendorFilters } from './filters';

export const metadata: Metadata = { title: 'Vendors' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Suppliers.
 *
 * **A merged supplier stays in the list, marked.** Hiding it would leave
 * somebody looking at an old invoice with a supplier they cannot find; showing
 * it says plainly what happened to it and where the invoices went.
 *
 * **Bank details are represented by four digits and never more.** The column
 * exists so a person can recognise the account they are paying into; the rest
 * of the number is not something this screen can show even to an administrator.
 */
export default async function VendorsPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'vendor:read')) {
    return (
      <>
        <PageHeader title="Vendors" />
        <Card>
          <PermissionState permission="vendor:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const query = new URLSearchParams();

  for (const key of ['status', 'q']) {
    const value = Array.isArray(params[key]) ? params[key][0] : params[key];
    if (value !== undefined && value !== '') query.set(key, value);
  }

  const vendors = await apiFetch<OffsetCollection<VendorRecord>>(`/vendors?${query.toString()}`);
  const filtered = [...query.keys()].length > 0;

  const columns: Column<VendorRecord>[] = [
    {
      key: 'name',
      header: 'Supplier',
      render: (vendor) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-900">{vendor.name}</div>
          {vendor.legalName !== null && vendor.legalName !== vendor.name && (
            <div className="truncate text-[12px] text-ink-500">{vendor.legalName}</div>
          )}
        </div>
      ),
    },
    {
      key: 'taxId',
      header: 'Tax ID',
      render: (vendor) => (
        <span className="text-[12px] text-ink-500">{vendor.taxId ?? '—'}</span>
      ),
    },
    {
      key: 'terms',
      header: 'Terms',
      align: 'right',
      width: '90px',
      render: (vendor) => (
        <span className="tabular text-[12px] text-ink-500">
          {vendor.paymentTermsDays} days
        </span>
      ),
    },
    {
      key: 'bank',
      header: 'Account',
      width: '110px',
      render: (vendor) =>
        vendor.bankAccountLast4 === null ? (
          <span className="text-[12px] text-ink-400">Not on file</span>
        ) : (
          <span className="tabular text-[12px] text-ink-600">
            ••••{vendor.bankAccountLast4}
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '150px',
      render: (vendor) => (
        <StatusBadge status={vendor.status} label={VENDOR_STATUS_LABELS[vendor.status]} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Who the company pays. One row per supplier — the duplicate check is what keeps it that way."
        action={can(session, 'vendor:manage') ? <NewVendorButton /> : undefined}
      />

      <VendorFilters />

      {vendors.data.length === 0 ? (
        <Card>
          {filtered ? (
            <FilteredEmptyState />
          ) : (
            <FirstRunEmptyState
              title="No suppliers yet"
              description="A supplier is added the first time somebody enters a bill or raises a purchase order for them."
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={vendors.data}
            rowKey={(vendor) => vendor.id}
            caption="Suppliers"
          />
        </Card>
      )}
    </>
  );
}
