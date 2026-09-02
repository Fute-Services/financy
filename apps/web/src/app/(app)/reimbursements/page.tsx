import type { Metadata } from 'next';
import Link from 'next/link';
import {
  REIMBURSEMENT_STATUS_LABELS,
  type OffsetCollection,
  type OrganizationSettings,
  type Person,
  type ReimbursementRecord,
  type Resource,
} from '@financy/contracts';
import {
  Card,
  DataTable,
  FirstRunEmptyState,
  Money,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { NewBatchButton } from './new-batch-button';

export const metadata: Metadata = { title: 'Reimbursements' };

/**
 * Batches of approved claims, paid as one payment.
 *
 * **The total and the line count sit together**, because a batch of one for
 * £4,000 and a batch of forty for the same amount are different things to
 * check before releasing money.
 */
export default async function ReimbursementsPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'reimbursement:read')) {
    return (
      <>
        <PageHeader title="Reimbursements" />
        <Card>
          <PermissionState permission="reimbursement:read" />
        </Card>
      </>
    );
  }

  const canCreate = can(session, 'reimbursement:create');

  const [batches, settings, people] = await Promise.all([
    apiFetch<OffsetCollection<ReimbursementRecord>>('/reimbursements?pageSize=50'),
    canCreate
      ? apiFetch<Resource<OrganizationSettings>>('/organization')
      : Promise.resolve(null),
    canCreate
      ? apiFetch<OffsetCollection<Person>>('/memberships?pageSize=100').catch(() => null)
      : Promise.resolve(null),
  ]);

  const columns: Column<ReimbursementRecord>[] = [
    {
      key: 'reference',
      header: 'Reference',
      render: (batch) => (
        <Link
          href={`/reimbursements/${batch.id}`}
          className="font-mono text-[13px] text-ink-700 hover:text-cobalt-600 hover:underline"
        >
          {batch.reference}
        </Link>
      ),
    },
    { key: 'payee', header: 'Paying', render: (batch) => batch.payee.fullName },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (batch) => <Money amount={batch.total.amount} currency={batch.total.currency} />,
    },
    {
      key: 'lineCount',
      header: 'Claims',
      align: 'right',
      render: (batch) => <span className="tabular text-[13px]">{batch.lineCount}</span>,
    },
    {
      key: 'period',
      header: 'Period',
      render: (batch) => `${formatDate(batch.periodStart)} – ${formatDate(batch.periodEnd)}`,
    },
    {
      key: 'paymentReference',
      header: 'Payment',
      render: (batch) =>
        batch.paymentReference === null ? (
          <span className="text-[12px] text-ink-400">—</span>
        ) : (
          <span className="font-mono text-[12px] text-ink-600">{batch.paymentReference}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (batch) => (
        <StatusBadge status={batch.status} label={REIMBURSEMENT_STATUS_LABELS[batch.status]} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Reimbursements"
        description="Approved out-of-pocket claims, grouped into one payment per person, entity, currency, and period."
        count={`${String(batches.pagination.totalCount)} total`}
        action={
          canCreate && settings !== null ? (
            <NewBatchButton
              entities={settings.data.entities}
              people={people?.data ?? []}
              baseCurrency={settings.data.organization.baseCurrency}
            />
          ) : undefined
        }
      />

      <Card>
        {batches.data.length === 0 ? (
          <div className="p-6">
            <FirstRunEmptyState
              title="No batches yet"
              description="When somebody's expenses have been approved, build a batch to pay them. Everything that qualifies goes in — you choose the person, the entity, the currency, and the period."
            />
          </div>
        ) : (
          <DataTable rows={batches.data} columns={columns} rowKey={(batch) => batch.id} />
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
