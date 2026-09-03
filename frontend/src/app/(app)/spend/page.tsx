import type { Metadata } from 'next';
import Link from 'next/link';
import {
  SPEND_REQUEST_STATUSES,
  SPEND_STATUS_LABELS,
  type OffsetCollection,
  type SpendRequestRecord,
} from '@financy/contracts';
import {
  Badge,
  Button,
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
import { SpendFilters } from './filters';

export const metadata: Metadata = { title: 'My spend' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Spend requests.
 *
 * **Defaults to the caller's own.** The nav calls this "My spend", and somebody
 * with `spend_request:read_all` opening it to find four hundred rows from
 * across the organisation has been shown a report rather than their own work.
 * The scope toggle is there for when they want the report.
 *
 * **A blocked request is still a row.** It has a decision, a reason, and a
 * reference somebody quoted in a message — hiding it would make "I raised it
 * and nothing happened" the user's experience of a policy working exactly as
 * written.
 */
export default async function SpendPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'spend_request:read')) {
    return (
      <>
        <PageHeader title="My spend" />
        <Card>
          <PermissionState permission="spend_request:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const status = first(params['status']);
  const scope = first(params['scope']) ?? 'mine';
  const page = first(params['page']) ?? '1';

  const canSeeAll = can(session, 'spend_request:read_all');

  const query = new URLSearchParams();
  if (status !== undefined) query.set('status', status);
  // `mine` unless the caller both asked for everything and may see it. Asking
  // for a scope you do not hold narrows silently rather than 403-ing: the
  // parameter is a view preference, not a request for named data.
  if (scope !== 'all' || !canSeeAll) query.set('mine', 'true');
  query.set('page', page);
  query.set('pageSize', '25');

  const result = await apiFetch<OffsetCollection<SpendRequestRecord>>(
    `/spend-requests?${query.toString()}`,
  );

  const columns: ReadonlyArray<Column<SpendRequestRecord>> = [
    {
      key: 'reference',
      header: 'Reference',
      render: (request) => (
        <Link
          href={`/spend/${request.id}`}
          className="font-mono text-[13px] text-ink-800 hover:text-cobalt-600 hover:underline"
        >
          {request.reference}
        </Link>
      ),
    },
    {
      key: 'purpose',
      header: 'Purpose',
      render: (request) => (
        <div className="min-w-0">
          <div className="truncate text-ink-800">{request.purpose}</div>
          {scope === 'all' && canSeeAll && (
            <div className="truncate text-[12px] text-ink-500">{request.requester.fullName}</div>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (request) => (
        <Money amount={request.amount.amount} currency={request.amount.currency} />
      ),
    },
    {
      key: 'neededBy',
      header: 'Needed by',
      render: (request) =>
        request.neededBy === null ? (
          <span className="text-ink-400">—</span>
        ) : (
          <time dateTime={request.neededBy} className="tabular text-ink-600">
            {formatDate(request.neededBy)}
          </time>
        ),
    },
    {
      key: 'verdict',
      header: 'Policy',
      render: (request) => <VerdictCell request={request} />,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (request) => (
        <StatusBadge status={request.status} label={SPEND_STATUS_LABELS[request.status]} />
      ),
    },
  ];

  const { totalCount, totalPages, page: currentPage } = result.pagination;
  const isFiltered = status !== undefined;

  return (
    <>
      <PageHeader
        title={scope === 'all' && canSeeAll ? 'Spend requests' : 'My spend'}
        description="Requests to spend, before anything is spent. Policy decides each one at submission."
        count={`${String(totalCount)} ${totalCount === 1 ? 'request' : 'requests'}`}
        action={
          can(session, 'spend_request:create') ? (
            <Link href="/spend/new">
              <Button variant="primary">New request</Button>
            </Link>
          ) : undefined
        }
      />

      <SpendFilters statuses={SPEND_REQUEST_STATUSES} canSeeAll={canSeeAll} />

      <Card>
        <DataTable
          columns={columns}
          rows={result.data}
          rowKey={(request) => request.id}
          caption="Spend requests, newest first"
          emptyState={
            isFiltered ? (
              <FilteredEmptyState />
            ) : (
              <FirstRunEmptyState
                title="Nothing raised yet"
                description="A spend request asks for permission before money moves. Policy decides at submission whether it needs anybody's approval, and the answer is recorded with the request."
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
              status={status}
              scope={scope}
            />
            <PageLink
              page={currentPage + 1}
              disabled={currentPage >= totalPages}
              label="Next"
              status={status}
              scope={scope}
            />
          </div>
        </nav>
      )}
    </>
  );
}

/**
 * What policy said, in one cell.
 *
 * Read from the stored decision, never recomputed. Recomputing would answer
 * with today's rules — a different question, and a wrong answer to the one this
 * column is asking.
 */
function VerdictCell({ request }: { request: SpendRequestRecord }): React.JSX.Element {
  if (request.policyDecision === null) {
    return <span className="text-[12px] text-ink-400">Not evaluated</span>;
  }

  const { verdict, requirements, blocks } = request.policyDecision;

  if (verdict === 'BLOCKED') {
    return (
      <Badge tone="danger" title={blocks[0]?.message}>
        Blocked
      </Badge>
    );
  }

  const steps = requirements.approvalSteps.length;

  if (steps === 0) {
    return <span className="text-[12px] text-ink-500">No approval needed</span>;
  }

  return (
    <span className="text-[12px] text-ink-600">
      {steps === 1 ? '1 approval step' : `${String(steps)} approval steps`}
    </span>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined || single === '' ? undefined : single;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function PageLink({
  page,
  disabled,
  label,
  status,
  scope,
}: {
  page: number;
  disabled: boolean;
  label: string;
  status: string | undefined;
  scope: string;
}): React.JSX.Element {
  if (disabled) {
    return (
      <span className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-300">
        {label}
      </span>
    );
  }

  const query = new URLSearchParams({ page: String(page), scope });
  if (status !== undefined) query.set('status', status);

  return (
    <a
      href={`/spend?${query.toString()}`}
      className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-700 hover:bg-ink-50"
    >
      {label}
    </a>
  );
}
