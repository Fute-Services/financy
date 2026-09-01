import type { Metadata } from 'next';
import { SCOPE_LABELS, type OffsetCollection, type Person } from '@financy/contracts';
import {
  Badge,
  Card,
  DataTable,
  FilteredEmptyState,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { PeopleFilters } from './filters';

export const metadata: Metadata = { title: 'People' };

/**
 * Everyone in this organisation.
 *
 * A server component reading `GET /v1/memberships` directly — no client fetch, no
 * loading skeleton, no chance of the browser and the server disagreeing about
 * who the caller is. The permission check below is a *usability* affordance;
 * the endpoint enforces `user:read` independently, so a caller who reaches
 * this URL without it gets a 403 from the API regardless of what this file
 * decides to render.
 *
 * Read-only, deliberately. Inviting someone, changing a role, and deactivating
 * a member each need an audit event and — for role changes — a self-elevation
 * refusal. They arrive with task 1.5. A button that skipped those would be
 * worse than no button (docs/19 §5).
 */

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined || single === '' ? undefined : single;
}

export default async function PeoplePage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'user:read')) {
    return (
      <>
        <PageHeader title="People" />
        <Card>
          <PermissionState permission="user:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const query = new URLSearchParams();

  // Only the parameters that were actually given. The API's query schema is
  // strict, so passing `q=` for an untouched search box would be a 422 rather
  // than an empty filter.
  const q = first(params['q']);
  const status = first(params['status']);
  const roleKey = first(params['roleKey']);
  const page = first(params['page']) ?? '1';

  if (q !== undefined) query.set('q', q);
  if (status !== undefined) query.set('status', status);
  if (roleKey !== undefined) query.set('roleKey', roleKey);
  query.set('page', page);
  query.set('pageSize', '25');

  const result = await apiFetch<OffsetCollection<Person>>(`/memberships?${query.toString()}`);
  const isFiltered = q !== undefined || status !== undefined || roleKey !== undefined;

  const columns: ReadonlyArray<Column<Person>> = [
    {
      key: 'name',
      header: 'Name',
      render: (person) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-900">{person.fullName}</div>
          <div className="truncate text-[12px] text-ink-500">{person.email}</div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (person) => <Badge tone="neutral">{person.role.name}</Badge>,
    },
    {
      key: 'department',
      header: 'Department',
      render: (person) =>
        person.department === null ? (
          <span className="text-ink-400">—</span>
        ) : (
          <span className="text-ink-700">{person.department.name}</span>
        ),
    },
    {
      key: 'scope',
      header: 'Can see',
      render: (person) => <span className="text-ink-600">{SCOPE_LABELS[person.scope]}</span>,
    },
    {
      key: 'lastLogin',
      header: 'Last seen',
      render: (person) =>
        // "Never" rather than a dash, because the two mean different things:
        // a member who has never signed in probably never received the email.
        person.lastLoginAt === null ? (
          <span className="text-ink-400">Never</span>
        ) : (
          <RelativeDate iso={person.lastLoginAt} />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      // `StatusBadge` derives its own label and tone from the status, so the
      // catalogue label is not passed in — two sources for one string is how
      // a table ends up saying "INACTIVE" in one column and "Deactivated" in
      // the next.
      render: (person) => <StatusBadge status={person.status} />,
    },
  ];

  const { totalCount, totalPages, page: currentPage } = result.pagination;

  return (
    <>
      <PageHeader
        title="People"
        description="Everyone with access to this organisation, and what each of them can see."
        count={`${String(totalCount)} ${totalCount === 1 ? 'person' : 'people'}`}
      />

      <PeopleFilters />

      <Card>
        <DataTable
          columns={columns}
          rows={result.data}
          rowKey={(person) => person.id}
          caption="People in this organisation"
          emptyState={isFiltered ? <FilteredEmptyState /> : undefined}
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
            <PageLink page={currentPage - 1} disabled={currentPage <= 1} label="Previous" />
            <PageLink page={currentPage + 1} disabled={currentPage >= totalPages} label="Next" />
          </div>
        </nav>
      )}
    </>
  );
}

/**
 * Rendered on the server, so the string is the same one the reader would have
 * seen had the page been generated a moment earlier — no hydration mismatch
 * from `Date.now()` moving between render and paint.
 */
function RelativeDate({ iso }: { iso: string }): React.JSX.Element {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);

  const label =
    days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? `${String(days)} days ago` : null;

  return (
    <time dateTime={iso} title={date.toISOString()} className="text-ink-600">
      {label ??
        date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
    </time>
  );
}

function PageLink({
  page,
  disabled,
  label,
}: {
  page: number;
  disabled: boolean;
  label: string;
}): React.JSX.Element {
  if (disabled) {
    return (
      <span className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-300">
        {label}
      </span>
    );
  }

  return (
    <a
      href={`/people?page=${String(page)}`}
      className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-700 hover:bg-ink-50"
    >
      {label}
    </a>
  );
}
