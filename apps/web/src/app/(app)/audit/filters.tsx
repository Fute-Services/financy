'use client';

import { ACTOR_TYPES, ACTOR_TYPE_LABELS, type ActorType } from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Filters for the audit trail.
 *
 * State lives in the URL, as it does on the people list, and for the same
 * reasons — shareable, bookmarkable, survives a refresh. It matters more
 * here: "show me everything that touched this membership last March" is a
 * link somebody pastes into a ticket, and a filter held in component state is
 * a link that arrives showing something else.
 *
 * **Changing a filter clears the cursor.** A cursor is a position in one
 * particular ordering of one particular query; carried across a filter change
 * it points into a result set that no longer exists, and the page comes back
 * empty for no reason the reader can see.
 */
export function AuditFilters({
  view,
  canReadSecurity,
  canExport,
}: {
  view: 'audit' | 'security';
  canReadSecurity: boolean;
  canExport: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(changes: Record<string, string>): void {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === '') next.delete(key);
      else next.set(key, value);
    }

    // A cursor describes a position in the *previous* query's ordering.
    // Carrying it across a filter change points it into a result set that no
    // longer exists, and the page returns empty with nothing to explain it.
    next.delete('cursor');

    startTransition(() => {
      router.push(next.toString() === '' ? '/audit' : `/audit?${next.toString()}`);
    });
  }

  const selectClass =
    'h-[30px] rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-[13px] text-ink-700';

  return (
    <div
      className="mb-4 flex flex-wrap items-end gap-3"
      data-pending={pending ? 'true' : undefined}
    >
      {canReadSecurity ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-view" className="text-[12px] font-medium text-ink-600">
            Showing
          </label>
          <select
            id="audit-view"
            className={selectClass}
            value={view}
            onChange={(event) => {
              // Switching view drops every filter: the two logs share no
              // field names, so an action filter carried onto the security
              // log would be a parameter the endpoint rejects.
              startTransition(() => {
                router.push(event.target.value === 'security' ? '/audit?view=security' : '/audit');
              });
            }}
          >
            <option value="audit">Changes (audit trail)</option>
            <option value="security">Sign-ins and attempts (security log)</option>
          </select>
        </div>
      ) : null}

      {view === 'audit' ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="audit-resource" className="text-[12px] font-medium text-ink-600">
              Resource
            </label>
            <select
              id="audit-resource"
              className={selectClass}
              value={params.get('resourceType') ?? ''}
              onChange={(event) => {
                apply({ resourceType: event.target.value });
              }}
            >
              <option value="">Anything</option>
              {[
                'organization',
                'entity',
                'department',
                'project',
                'category',
                'membership',
                'invitation',
                'user',
                'audit_event',
              ].map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="audit-actor" className="text-[12px] font-medium text-ink-600">
              Actor
            </label>
            <select
              id="audit-actor"
              className={selectClass}
              value={params.get('actorType') ?? ''}
              onChange={(event) => {
                apply({ actorType: event.target.value });
              }}
            >
              <option value="">Anyone</option>
              {ACTOR_TYPES.map((type: ActorType) => (
                <option key={type} value={type}>
                  {ACTOR_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="security-notable" className="text-[12px] font-medium text-ink-600">
            Which events
          </label>
          <select
            id="security-notable"
            className={selectClass}
            value={params.get('notableOnly') ?? ''}
            onChange={(event) => {
              apply({ notableOnly: event.target.value });
            }}
          >
            {/* Successful sign-ins are most of a healthy organisation's
                security log, so "concerning only" is the view somebody
                actually opens twice. */}
            <option value="">Everything</option>
            <option value="true">Concerning only</option>
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="audit-from" className="text-[12px] font-medium text-ink-600">
          From
        </label>
        <input
          id="audit-from"
          type="date"
          className={selectClass}
          defaultValue={(params.get('from') ?? '').slice(0, 10)}
          onChange={(event) => {
            // Midnight UTC. The range is half-open at the API — `from`
            // inclusive, `before` exclusive — so consecutive ranges tile the
            // timeline exactly rather than overlapping by a day.
            apply({ from: event.target.value === '' ? '' : `${event.target.value}T00:00:00.000Z` });
          }}
        />
      </div>

      {params.toString() !== '' ? (
        <button
          type="button"
          className="h-[30px] rounded-md px-2 text-[13px] text-ink-600 underline-offset-2 hover:underline"
          onClick={() => {
            startTransition(() => {
              router.push('/audit');
            });
          }}
        >
          Clear
        </button>
      ) : null}

      {canExport && view === 'audit' ? (
        <a
          // A plain link, not a fetch: the response is a file with a
          // `Content-Disposition`, and the browser's own download handling is
          // better than anything reconstructed from a blob — it survives a
          // large file, shows progress, and lands in the right folder.
          href={`/api/audit/export?${new URLSearchParams(exportParams(params)).toString()}`}
          className="ml-auto inline-flex h-[30px] items-center rounded-md border border-[var(--border-strong)] px-3 text-[13px] text-ink-700 hover:bg-ink-50"
        >
          Export CSV
        </a>
      ) : null}
    </div>
  );
}

/**
 * The filters the export understands.
 *
 * `cursor`, `limit`, and `view` are dropped: an export is not paginated, and
 * sending a parameter the endpoint's strict schema does not name is a 422
 * rather than an ignored field.
 */
function exportParams(params: URLSearchParams): Record<string, string> {
  const allowed = [
    'action',
    'resourceType',
    'resourceId',
    'actorType',
    'actorMembershipId',
    'from',
    'before',
  ];
  const out: Record<string, string> = {};

  for (const key of allowed) {
    const value = params.get(key);
    if (value !== null && value !== '') out[key] = value;
  }

  return out;
}
