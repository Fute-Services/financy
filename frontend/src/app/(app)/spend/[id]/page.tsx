import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  SPEND_STATUS_LABELS,
  type ApprovalInstance,
  type Resource,
  type SpendRequestRecord,
} from '@financy/contracts';
import { Card, CardBody, CardHeader, Money, PermissionState, StatusBadge } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { ApprovalTimeline } from '@/components/approval-timeline';
import { DecisionPanel } from '@/components/decision-panel';
import { RequestActions } from './request-actions';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const { data } = await apiFetch<Resource<SpendRequestRecord>>(`/spend-requests/${id}`);
    return { title: data.reference };
  } catch {
    return { title: 'Spend request' };
  }
}

/**
 * One spend request: what was asked, what policy said, and where it has got to.
 *
 * ## The verdict panel reads the stored decision and never recomputes
 *
 * "Why did this need three approvals?" is answered by the snapshot taken at
 * submission, under the engine version recorded in it. Recomputing against
 * today's policies would answer a different question — what would happen if it
 * were raised now — and present the answer as history.
 *
 * ## The timeline is the answer to the question a pending request generates
 *
 * "Where is it, and who is it with." Approvers are named, because "waiting on
 * two people" is not something a requester can act on and "waiting on Priya"
 * is. Without this the question gets asked in a chat message the record never
 * sees.
 */
export default async function SpendRequestPage({ params }: Props): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();

  if (session === null || !can(session, 'spend_request:read')) {
    return (
      <>
        <PageHeader title="Spend request" />
        <Card>
          <PermissionState permission="spend_request:read" />
        </Card>
      </>
    );
  }

  let request: SpendRequestRecord;

  try {
    request = (await apiFetch<Resource<SpendRequestRecord>>(`/spend-requests/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Read only when there is one. A request that was allowed outright has no
  // chain, and asking for a null id would be a 404 on a page that is fine.
  const approval =
    request.approvalInstanceId === null || !can(session, 'approval:read')
      ? null
      : await apiFetch<Resource<ApprovalInstance>>(`/approvals/${request.approvalInstanceId}`)
          .then((response) => response.data)
          .catch(() => null);

  const isRequester = request.requester.membershipId === session.membership.id;

  return (
    <>
      <div className="mb-1">
        <Link href="/spend" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← My spend
        </Link>
      </div>

      <PageHeader
        title={request.purpose}
        description={`${request.reference} · raised by ${request.requester.fullName}`}
        action={
          <RequestActions
            request={request}
            isRequester={isRequester}
            canCancel={can(session, 'spend_request:cancel')}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={request.status} label={SPEND_STATUS_LABELS[request.status]} />
        <span className="text-lg font-semibold text-ink-900">
          <Money amount={request.amount.amount} currency={request.amount.currency} />
        </span>
        {request.neededBy !== null && (
          <span className="text-[13px] text-ink-500">
            Needed by <time dateTime={request.neededBy}>{formatDate(request.neededBy)}</time>
          </span>
        )}
      </div>

      {request.status === 'CHANGES_REQUESTED' && (
        <div
          role="status"
          className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-fill)] px-3.5 py-2.5 text-[13px] text-[var(--color-warning-text)]"
        >
          <strong className="font-semibold">An approver sent this back.</strong> Read their comment
          in the timeline, edit the request, and submit it again — resubmitting evaluates policy
          from scratch, so the chain may not be the same one.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {approval !== null ? (
            <Card>
              <CardHeader
                title="Approval"
                description="Steps run in order. Approvers within a step were resolved when the chain opened."
              />
              <CardBody className="p-0">
                <ApprovalTimeline instance={approval} />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Approval" />
              <CardBody>
                <p className="text-[13px] text-ink-500">
                  {request.status === 'DRAFT'
                    ? 'Nothing yet. Policy is evaluated when you submit, and any chain it calls for opens then.'
                    : 'No approval chain — policy did not ask for one.'}
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
                <Detail
                  label="Reference"
                  value={<span className="font-mono">{request.reference}</span>}
                />
                <Detail
                  label="Amount"
                  value={
                    <Money amount={request.amount.amount} currency={request.amount.currency} />
                  }
                />
                <Detail
                  label="In base currency"
                  value={
                    <Money
                      amount={request.amountInBaseCurrency.amount}
                      currency={request.amountInBaseCurrency.currency}
                    />
                  }
                />
                <Detail label="Raised" value={formatDateTime(request.createdAt)} />
                <Detail
                  label="Submitted"
                  value={request.submittedAt === null ? '—' : formatDateTime(request.submittedAt)}
                />
                <Detail
                  label="Decided"
                  value={request.decidedAt === null ? '—' : formatDateTime(request.decidedAt)}
                />
                <Detail
                  label="Valid until"
                  value={request.validUntil === null ? '—' : formatDateTime(request.validUntil)}
                />
                {request.memo !== null && request.memo !== '' && (
                  <Detail
                    label="Memo"
                    value={<span className="whitespace-pre-wrap">{request.memo}</span>}
                  />
                )}
              </dl>
            </CardBody>
          </Card>
        </div>

        <DecisionPanel decision={request.policyDecision} />
      </div>
    </>
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
