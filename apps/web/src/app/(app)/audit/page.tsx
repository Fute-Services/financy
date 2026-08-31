import type { Metadata } from 'next';
import {
  ACTOR_TYPE_LABELS,
  describeAction,
  type AuditEvent,
  type CursorCollection,
} from '@financy/contracts';
import {
  Badge,
  Card,
  DataTable,
  FirstRunEmptyState,
  PermissionState,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Audit log' };

/**
 * The audit trail.
 *
 * Read-only, permanently. There is no write endpoint behind this screen and no
 * delete: an audit trail somebody can add to or prune is not evidence, and
 * this one exists to be evidence. Events are written by `AuditService` inside
 * the transaction that made the change, so a change and its record commit
 * together or not at all (ADR-0016).
 *
 * Paged with a cursor rather than page numbers. The collection is append-only,
 * so an offset shifts under the reader every time anything happens anywhere in
 * the organisation — "page 4" is a different four rows each time it loads.
 */

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const params = await searchParams;
  const cursorParam = params['cursor'];
  const cursor = Array.isArray(cursorParam) ? cursorParam[0] : cursorParam;

  const query = new URLSearchParams({ limit: '50' });
  if (cursor !== undefined && cursor !== '') query.set('cursor', cursor);

  const result = await apiFetch<CursorCollection<AuditEvent>>(`/audit-events?${query.toString()}`);

  const columns: ReadonlyArray<Column<AuditEvent>> = [
    {
      key: 'when',
      header: 'When',
      width: '180px',
      render: (event) => {
        const date = new Date(event.createdAt);
        return (
          <time dateTime={event.createdAt} className="tabular text-[12px] text-ink-600">
            {date.toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </time>
        );
      },
    },
    {
      key: 'action',
      header: 'What happened',
      render: (event) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-900">{describeAction(event.action)}</div>
          <code className="truncate text-[11px] text-ink-400">{event.action}</code>
        </div>
      ),
    },
    {
      key: 'actor',
      header: 'Who',
      render: (event) => (
        <div className="min-w-0">
          {/* The label was denormalised at write time, so it still reads
              correctly after the person leaves or changes their name. */}
          <div className="truncate text-ink-800">{event.actorLabel ?? '—'}</div>
          <div className="text-[11px] text-ink-400">{ACTOR_TYPE_LABELS[event.actorType]}</div>
        </div>
      ),
    },
    {
      key: 'resource',
      header: 'On what',
      render: (event) => (
        <div className="min-w-0">
          <div className="truncate text-ink-700">{event.resourceType}</div>
          {event.resourceId !== null && (
            <code className="truncate text-[11px] text-ink-400">
              {event.resourceId.slice(0, 8)}
            </code>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'From',
      align: 'right',
      render: (event) => (
        <span className="tabular text-[12px] text-ink-500">
          {event.ipAddress ?? <span className="text-ink-300">—</span>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change, who made it, and when. Written inside the transaction that made the change, and never editable."
        action={<Badge tone="neutral">Read-only</Badge>}
      />

      <Card>
        <DataTable
          columns={columns}
          rows={result.data}
          rowKey={(event) => event.id}
          caption="Audit events, newest first"
          density="compact"
          emptyState={
            <FirstRunEmptyState
              title="Nothing recorded yet"
              description="Entries appear here as soon as anyone changes something — a member added, a role changed, a policy published."
            />
          }
        />
      </Card>

      {result.pagination.hasMore && result.pagination.nextCursor !== null && (
        <nav className="mt-4 flex justify-end" aria-label="Pagination">
          <a
            href={`/audit?cursor=${encodeURIComponent(result.pagination.nextCursor)}`}
            className="rounded-[var(--radius-sm)] border border-line px-3 py-1.5 text-[13px] text-ink-700 hover:bg-ink-50"
          >
            Older entries
          </a>
        </nav>
      )}
    </>
  );
}
