import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ACCOUNTING_STATUS_LABELS,
  MATCH_STATUS_LABELS,
  RECEIPT_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
  type OffsetCollection,
  type OrganizationSettings,
  type Resource,
  type SpendRequestRecord,
  type TransactionDetail,
} from '@financy/contracts';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Money,
  PermissionState,
  StatusBadge,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { CodingPanel } from './coding-panel';
import { ReviewPanel } from './review-panel';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const { data } = await apiFetch<Resource<TransactionDetail>>(`/transactions/${id}`);
    return { title: data.merchantName };
  } catch {
    return { title: 'Transaction' };
  }
}

/**
 * One transaction, and the four things that are separately true about it.
 *
 * **The four statuses are shown as four, side by side.** Settled, evidenced,
 * reviewed, coded — a charge is routinely in a different state on each, and
 * presenting them as one summary word would force a false ordering on four
 * processes that run in parallel.
 *
 * **The money is not editable, and the page does not pretend otherwise.**
 * Amount, merchant, and date have no controls on a posted row, because they are
 * immutable — somebody has already reconciled against them. A correction is an
 * adjustment: a new linked row, visible below, that leaves the original intact
 * so the arithmetic still works and the history survives.
 */
export default async function TransactionPage({ params }: Props): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();

  if (session === null || !can(session, 'transaction:read')) {
    return (
      <>
        <PageHeader title="Transaction" />
        <Card>
          <PermissionState permission="transaction:read" />
        </Card>
      </>
    );
  }

  let transaction: TransactionDetail;

  try {
    transaction = (await apiFetch<Resource<TransactionDetail>>(`/transactions/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const canCode = can(session, 'transaction:categorize');
  const canReview = can(session, 'transaction:review');

  const [settings, approved] = await Promise.all([
    canCode ? apiFetch<Resource<OrganizationSettings>>('/organization').catch(() => null) : null,
    canReview
      ? apiFetch<OffsetCollection<SpendRequestRecord>>(
          '/spend-requests?status=APPROVED&pageSize=50',
        ).catch(() => null)
      : null,
  ]);

  return (
    <>
      <div className="mb-1">
        <Link href="/transactions" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Transactions
        </Link>
      </div>

      <PageHeader
        title={transaction.merchantName}
        description={
          transaction.card === null
            ? (transaction.member?.fullName ?? 'No card')
            : `${transaction.card.name}${
                transaction.card.lastFour === null ? '' : ` ···· ${transaction.card.lastFour}`
              }`
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-2xl font-semibold text-ink-900">
          <Money amount={transaction.amount.amount} currency={transaction.amount.currency} />
        </span>
        <StatusBadge
          status={transaction.status}
          label={TRANSACTION_STATUS_LABELS[transaction.status]}
        />
        <time dateTime={transaction.occurredAt} className="text-[13px] text-ink-500">
          {formatDateTime(transaction.occurredAt)}
        </time>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Axis label="Settlement" value={TRANSACTION_STATUS_LABELS[transaction.status]} />
        <Axis label="Evidence" value={RECEIPT_STATUS_LABELS[transaction.receiptStatus]} />
        <Axis
          label="Review"
          value={REVIEW_STATUS_LABELS[transaction.reviewStatus]}
          tone={transaction.reviewStatus === 'DISPUTED' ? 'danger' : undefined}
        />
        <Axis label="Coding" value={ACCOUNTING_STATUS_LABELS[transaction.accountingStatus]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {settings !== null ? (
            <CodingPanel
              transaction={transaction}
              departments={settings.data.departments}
              categories={settings.data.categories}
            />
          ) : (
            <Card>
              <CardHeader title="Coding" />
              <CardBody>
                <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
                  <Detail label="Category" value={transaction.categoryId ?? '—'} />
                  <Detail label="Department" value={transaction.departmentId ?? '—'} />
                  <Detail label="Memo" value={transaction.memo ?? '—'} />
                </dl>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Corrections"
              description="A posted transaction is never edited. A refund or a fee is a new linked row."
            />
            <CardBody className="p-0">
              {transaction.adjustments.length === 0 ? (
                <p className="px-5 py-6 text-[13px] text-ink-500">
                  None. The amount above is the amount that moved.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {transaction.adjustments.map((adjustment) => (
                    <li key={adjustment.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Badge tone="neutral">{adjustment.adjustmentType}</Badge>
                        <span className="text-sm font-semibold text-ink-900">
                          <Money
                            amount={adjustment.amount.amount}
                            currency={adjustment.amount.currency}
                          />
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-ink-700">{adjustment.reason}</p>
                      <p className="mt-0.5 text-[12px] text-ink-400">
                        {adjustment.createdBy ?? 'Unknown'} ·{' '}
                        <time dateTime={adjustment.createdAt}>
                          {formatDateTime(adjustment.createdAt)}
                        </time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Provenance" />
            <CardBody>
              <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
                <Detail label="Source" value={transaction.source.toLowerCase()} />
                <Detail label="Provider" value={transaction.provider} />
                <Detail
                  label="Their reference"
                  value={
                    <span className="font-mono text-[12px]">
                      {transaction.providerTransactionId}
                    </span>
                  }
                />
                <Detail label="As they sent it" value={transaction.merchantRaw ?? '—'} />
                <Detail label="Happened" value={formatDateTime(transaction.occurredAt)} />
                <Detail
                  label="Settled"
                  value={
                    transaction.postedAt === null ? 'Not yet' : formatDateTime(transaction.postedAt)
                  }
                />
                <Detail label="Recorded here" value={formatDateTime(transaction.createdAt)} />
              </dl>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Authorisation"
              description="The spend request this fulfils, if there was one."
            />
            <CardBody className="flex flex-col gap-2">
              <Badge
                tone={
                  transaction.matchStatus === 'AUTO_MATCHED'
                    ? 'info'
                    : transaction.matchStatus === 'UNMATCHED'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {MATCH_STATUS_LABELS[transaction.matchStatus]}
              </Badge>

              {transaction.spendRequest !== null ? (
                <Link
                  href={`/spend/${transaction.spendRequest.id}`}
                  className="text-[13px] text-cobalt-500 hover:underline"
                >
                  <span className="font-mono">{transaction.spendRequest.reference}</span> —{' '}
                  {transaction.spendRequest.purpose}
                </Link>
              ) : (
                <p className="text-[13px] text-ink-500">
                  {transaction.matchStatus === 'NOT_APPLICABLE'
                    ? 'Recorded as a genuine unplanned purchase.'
                    : 'Not linked to a request. Somebody in finance can link it or mark it unplanned.'}
                </p>
              )}

              {transaction.matchStatus === 'AUTO_MATCHED' && (
                <p className="text-[12px] text-ink-500">
                  Linked automatically because the entity, the exact amount, and the timing all
                  lined up, and only one approved request fitted. Check it before relying on it.
                </p>
              )}
            </CardBody>
          </Card>

          {canReview && (
            <ReviewPanel transaction={transaction} approvedRequests={approved?.data ?? []} />
          )}
        </div>
      </div>
    </>
  );
}

function Axis({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | undefined;
}): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div
        className={
          tone === 'danger'
            ? 'mt-0.5 text-[13px] font-medium text-[var(--color-danger-text)]'
            : 'mt-0.5 text-[13px] font-medium text-ink-800'
        }
      >
        {value}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-800">{value}</dd>
    </>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
