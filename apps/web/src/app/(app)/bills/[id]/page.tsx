import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  BILL_STATUS_LABELS,
  type ApprovalInstance,
  type BillDetail,
  type Resource,
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

import { ApprovalTimeline } from '@/components/approval-timeline';
import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { BillActions } from './bill-actions';

export const metadata: Metadata = { title: 'Bill' };

/**
 * One supplier invoice.
 *
 * ## The match is on the page, and it names the line
 *
 * When a bill references purchase order lines, the comparison between what was
 * ordered, what arrived, and what is being charged is the only thing anybody
 * needs from this screen. "This bill does not match" with no line reference
 * sends a person to a spreadsheet; a row-level verdict tells them which line to
 * ask the supplier about.
 *
 * ## A paid bill offers a credit note, not an edit
 *
 * The action panel changes with the status rather than showing everything
 * greyed out, because an edit button that is present and refuses is a promise
 * the screen does not keep.
 */
export default async function BillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const { id } = await params;

  if (session === null || !can(session, 'bill:read')) {
    return (
      <>
        <PageHeader title="Bill" />
        <Card>
          <PermissionState permission="bill:read" />
        </Card>
      </>
    );
  }

  let bill: BillDetail;

  try {
    bill = (await apiFetch<Resource<BillDetail>>(`/bills/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const instance =
    bill.approvalInstanceId === null
      ? null
      : await apiFetch<Resource<ApprovalInstance>>(`/approvals/${bill.approvalInstanceId}`)
          .then((response) => response.data)
          .catch(() => null);

  return (
    <>
      <div className="mb-1">
        <Link href="/bills" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Bills
        </Link>
      </div>

      <PageHeader
        title={bill.vendor.name}
        description={`Invoice ${bill.billNumber} · ${bill.reference}`}
        action={<StatusBadge status={bill.status} label={BILL_STATUS_LABELS[bill.status]} />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="The invoice" />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Total">
                <Money amount={bill.total.amount} currency={bill.total.currency} />
              </Field>
              <Field label="Issued">{formatDay(bill.issueDate)}</Field>
              <Field label="Due">
                {formatDay(bill.dueDate)}
                {bill.daysUntilDue < 0 && bill.status !== 'PAID' && (
                  <span className="ml-2">
                    <Badge tone="danger">{Math.abs(bill.daysUntilDue)} days late</Badge>
                  </span>
                )}
              </Field>
              <Field label="Payment reference">{bill.paymentReference ?? 'Not paid yet'}</Field>
              {bill.memo !== null && (
                <div className="sm:col-span-2">
                  <Field label="Note">{bill.memo}</Field>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Lines" description="The total is the sum of these." />
            <CardBody className="p-0">
              <ul className="divide-y divide-[var(--border-subtle)]">
                {bill.lines.map((line) => (
                  <li key={line.id} className="flex items-center justify-between px-5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink-800">{line.description}</div>
                      <div className="text-[12px] text-ink-500">
                        {line.quantity} ×{' '}
                        <Money
                          amount={line.unitAmount.amount}
                          currency={line.unitAmount.currency}
                        />
                      </div>
                    </div>
                    <Money amount={line.lineAmount.amount} currency={line.lineAmount.currency} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {bill.match !== null && (
            <Card>
              <CardHeader
                title="Against the order"
                description="Ordered, received, and billed — compared line by line, with a 2.5% tolerance for rounding and freight."
                action={<MatchBadge status={bill.match.status} />}
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {bill.match.lines.map((line) => (
                    <li key={line.billLineId} className="px-5 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] text-ink-700">
                          Ordered {line.orderedQuantity} · received {line.receivedQuantity} ·
                          billed {line.billedQuantity}
                        </span>
                        <MatchBadge status={line.verdict} />
                      </div>
                      <div className="mt-1 text-[12px] text-ink-500">
                        <Money
                          amount={line.orderedAmount.amount}
                          currency={line.orderedAmount.currency}
                        />{' '}
                        ordered against{' '}
                        <Money
                          amount={line.billedAmount.amount}
                          currency={line.billedAmount.currency}
                        />{' '}
                        billed — {line.variancePercent}% apart
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {instance !== null && (
            <Card>
              <CardHeader
                title="Approval"
                description="The same chain machinery every other kind of spend uses."
              />
              <CardBody>
                <ApprovalTimeline instance={instance} />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <BillActions
            bill={bill}
            canEnter={can(session, 'bill:create')}
            canPay={can(session, 'bill:mark_paid')}
          />
        </div>
      </div>
    </>
  );
}

function MatchBadge({ status }: { status: string }): React.JSX.Element {
  const tone =
    status === 'MATCHED'
      ? 'success'
      : status === 'WITHIN_TOLERANCE'
        ? 'info'
        : status === 'NOT_RECEIVED'
          ? 'warning'
          : 'danger';

  const label =
    status === 'MATCHED'
      ? 'Matches'
      : status === 'WITHIN_TOLERANCE'
        ? 'Close enough'
        : status === 'NOT_RECEIVED'
          ? 'Not received yet'
          : 'Needs a look';

  return <Badge tone={tone}>{label}</Badge>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-0.5 text-[13px] text-ink-800">{children}</div>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
