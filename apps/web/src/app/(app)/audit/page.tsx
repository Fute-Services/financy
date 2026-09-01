import type { Metadata } from 'next';
import {
  SECURITY_EVENT_LABELS,
  type AuditEvent,
  type CursorCollection,
  type SecurityEvent,
} from '@financy/contracts';
import { Badge, Card, DataTable, FirstRunEmptyState, PermissionState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { AuditFilters } from './filters';
import { AuditTable } from './audit-table';

export const metadata: Metadata = { title: 'Audit log' };

/**
 * The audit trail, and the security log beside it.
 *
 * **Two logs, one screen, one switch.** They answer different questions — the
 * audit trail answers "who changed this record", the security log answers "is
 * someone attacking us" — and they have different shapes, which is why they
 * are separate collections. But an operator investigating an incident wants
 * both, and making them two navigation items means always being on the wrong
 * one. The switch drops every filter when it moves: the two share no field
 * names, so an action filter carried onto the security log is a parameter the
 * endpoint refuses.
 *
 * Read-only, permanently. There is no write endpoint behind either and no
 * delete: a trail somebody can add to or prune is not evidence, and these
 * exist to be evidence. Audit events are written inside the transaction that
 * made the change, so a change and its record commit together or not at all
 * (ADR-0016).
 *
 * Paged with a cursor rather than page numbers. Both collections are
 * append-only, so an offset shifts under the reader every time anything
 * happens anywhere in the organisation — "page 4" is a different four rows
 * each time it loads.
 */

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined || single === '' ? undefined : single;
}

/**
 * Read a page, falling back to the first one if the cursor is not accepted.
 *
 * A cursor reaches this page from a bookmark, a pasted link, or a hand-edited
 * URL, and the API answers a malformed one with a `422` — correctly, since it
 * cannot page from a position it did not issue. Letting that throw turns a
 * stale bookmark into a crashed screen. Dropping the cursor shows the newest
 * entries instead, which is what somebody who followed an old link wanted to
 * see anyway, and says so rather than pretending nothing happened.
 */
async function readPage<T>(
  path: string,
  query: URLSearchParams,
): Promise<{ result: CursorCollection<T>; cursorRejected: boolean }> {
  try {
    return {
      result: await apiFetch<CursorCollection<T>>(`${path}?${query.toString()}`),
      cursorRejected: false,
    };
  } catch (error) {
    const rejected = error instanceof ApiError && error.status === 422 && query.has('cursor');

    if (!rejected) throw error;

    const retry = new URLSearchParams(query);
    retry.delete('cursor');

    return {
      result: await apiFetch<CursorCollection<T>>(`${path}?${retry.toString()}`),
      cursorRejected: true,
    };
  }
}

export default async function AuditPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'audit_event:read')) {
    return (
      <>
        <PageHeader title="Audit log" />
        <Card>
          <PermissionState permission="audit_event:read" />
        </Card>
      </>
    );
  }

  const canReadSecurity = can(session, 'security_event:read');
  const canExport = can(session, 'audit_event:export');

  const params = await searchParams;
  const requestedView = first(params['view']);
  // Falls back to the audit trail rather than 403-ing: a caller without
  // `security_event:read` who follows a shared link should land somewhere
  // useful, not on a refusal for a view they did not choose.
  const view = requestedView === 'security' && canReadSecurity ? 'security' : 'audit';

  const query = new URLSearchParams({ limit: '50' });

  for (const key of ['cursor', 'from', 'before'] as const) {
    const value = first(params[key]);
    if (value !== undefined) query.set(key, value);
  }

  if (view === 'audit') {
    for (const key of [
      'action',
      'resourceType',
      'resourceId',
      'actorType',
      'actorMembershipId',
    ] as const) {
      const value = first(params[key]);
      if (value !== undefined) query.set(key, value);
    }
  } else {
    for (const key of ['type', 'userId', 'membershipId', 'notableOnly'] as const) {
      const value = first(params[key]);
      if (value !== undefined) query.set(key, value);
    }
  }

  const filters = (
    <AuditFilters view={view} canReadSecurity={canReadSecurity} canExport={canExport} />
  );

  if (view === 'security') {
    const { result, cursorRejected } = await readPage<SecurityEvent>('/security-events', query);

    return (
      <>
        <Header subtitle="Sign-ins, lockouts, and privilege changes. Attempts as well as successes — a failed sign-in has no record in the audit trail, because nothing changed." />
        {filters}
        {cursorRejected ? <StaleCursorNotice /> : null}

        <Card>
          <DataTable
            columns={[
              {
                key: 'when',
                header: 'When',
                width: '180px',
                render: (event: SecurityEvent) => <Timestamp iso={event.createdAt} />,
              },
              {
                key: 'type',
                header: 'What happened',
                render: (event: SecurityEvent) => (
                  <span className="font-medium text-ink-900">
                    {SECURITY_EVENT_LABELS[event.type]}
                  </span>
                ),
              },
              {
                key: 'who',
                header: 'Who',
                render: (event: SecurityEvent) => (
                  // Null for a failed sign-in against an address with no
                  // account — which is exactly the row worth seeing, so it is
                  // shown rather than filtered out for lacking a name.
                  <span className="text-ink-800">
                    {event.actorLabel ?? <span className="text-ink-400">Unknown account</span>}
                  </span>
                ),
              },
              {
                key: 'from',
                header: 'From',
                align: 'right',
                render: (event: SecurityEvent) => (
                  <span className="tabular text-[12px] text-ink-500">
                    {event.ipAddress ?? <span className="text-ink-300">—</span>}
                  </span>
                ),
              },
            ]}
            rows={result.data}
            rowKey={(event) => event.id}
            caption="Security events, newest first"
            density="compact"
            emptyState={
              <FirstRunEmptyState
                title="Nothing recorded yet"
                description="Sign-ins, failed attempts, lockouts, and privilege changes appear here."
              />
            }
          />
        </Card>

        {/* `view` is a screen parameter, not an API one, so it is added here
            rather than carried from the query — without it "Older entries"
            lands back on the audit trail. */}
        <Older
          cursor={result.pagination.nextCursor}
          hasMore={result.pagination.hasMore}
          carry={new URLSearchParams([...query, ['view', 'security']])}
        />
      </>
    );
  }

  const { result, cursorRejected } = await readPage<AuditEvent>('/audit-events', query);

  return (
    <>
      <Header subtitle="Every change, who made it, and when. Written inside the transaction that made the change, and never editable." />
      {filters}
      {cursorRejected ? <StaleCursorNotice /> : null}

      <Card>
        {/* A client component only because a row expands to show the
            before/after. The rows themselves are rendered from server data. */}
        <AuditTable events={result.data} />
      </Card>

      <Older
        cursor={result.pagination.nextCursor}
        hasMore={result.pagination.hasMore}
        carry={query}
      />
    </>
  );
}

function StaleCursorNotice(): React.JSX.Element {
  return (
    <p
      role="status"
      className="mb-4 rounded-md border border-[var(--border-subtle)] bg-ink-50/60 px-3 py-2 text-[13px] text-ink-600"
    >
      That link pointed at a position this log no longer has, so these are the newest entries
      instead.
    </p>
  );
}

function Header({ subtitle }: { subtitle: string }): React.JSX.Element {
  return (
    <PageHeader
      title="Audit log"
      description={subtitle}
      action={<Badge tone="neutral">Read-only</Badge>}
    />
  );
}

function Timestamp({ iso }: { iso: string }): React.JSX.Element {
  return (
    <time dateTime={iso} className="tabular text-[12px] text-ink-600">
      {/* UTC, for the same reason the audit table uses it: an operator
          correlating this with the API's logs is comparing absolute
          instants. */}
      {new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
      })}{' '}
      UTC
    </time>
  );
}

/**
 * "Older entries", carrying the current filters with it.
 *
 * A cursor without its filters would page into a differently-filtered result
 * set, which is the same bug as reusing a cursor across a filter change and
 * just as invisible.
 */
function Older({
  cursor,
  hasMore,
  carry,
}: {
  cursor: string | null;
  hasMore: boolean;
  /** The query the page was rendered from, minus its own pagination. */
  carry: URLSearchParams;
}): React.JSX.Element | null {
  if (!hasMore || cursor === null) return null;

  const next = new URLSearchParams(carry);
  next.delete('limit');
  next.set('cursor', cursor);

  return (
    <nav className="mt-4 flex justify-end" aria-label="Pagination">
      <a
        href={`/audit?${next.toString()}`}
        className="rounded-[var(--radius-sm)] border border-line px-3 py-1.5 text-[13px] text-ink-700 hover:bg-ink-50"
      >
        Older entries
      </a>
    </nav>
  );
}
