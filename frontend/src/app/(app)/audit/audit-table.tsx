'use client';

import { useState } from 'react';
import { ACTOR_TYPE_LABELS, describeAction, type AuditEvent } from '@financy/contracts';
import { FirstRunEmptyState } from '@financy/ui';

/**
 * The audit trail, with each row expandable to its before and after.
 *
 * **The detail is inline, not a dialog.** Reading an audit trail is comparing
 * one entry with its neighbours — "who changed this, and what happened just
 * before?" — and a modal hides exactly the context that makes the answer
 * meaningful. Expanding in place keeps the surrounding rows on screen.
 *
 * The before/after payloads are rendered as JSON rather than prettified into
 * sentences. They are arbitrary shapes, they were redacted at write time by
 * the service that wrote them, and a prose rendering would have to guess at
 * field names — guessing wrong in an audit log is worse than being terse.
 */
/**
 * Audit timestamps are rendered in **UTC**, explicitly.
 *
 * Not a style choice. `toLocaleString` without a zone uses the runtime's own,
 * and this table is a client component — so the server rendered IST and the
 * browser rendered UTC, React found the two markups disagreed, and bailed out
 * of hydrating the whole subtree. The visible symptom was not a wrong time: it
 * was the filters silently not navigating, because the client tree they lived
 * in had been discarded.
 *
 * UTC is also the right answer on its own terms. An operator reading this next
 * to the API's logs is correlating absolute instants, and a row that says
 * 11:59 to one reader and 06:29 to another is a row two people cannot discuss.
 * The exact instant is in `dateTime` either way.
 */
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'UTC',
};

export function AuditTable({ events }: { events: readonly AuditEvent[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <FirstRunEmptyState
        title="Nothing recorded yet"
        description="Entries appear here as soon as anyone changes something — a member added, a role changed, a policy published."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Audit events, newest first</caption>
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-[13px] text-ink-500">
            <th scope="col" className="px-4 py-2 font-medium">
              When
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              What happened
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Who
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              On what
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              From
            </th>
          </tr>
        </thead>

        <tbody>
          {events.map((event) => {
            const open = expanded === event.id;
            const hasDetail =
              event.before !== null ||
              event.after !== null ||
              Object.keys(event.metadata).length > 0;

            return [
              <tr key={event.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2 align-top">
                  <time dateTime={event.createdAt} className="tabular text-[12px] text-ink-600">
                    {new Date(event.createdAt).toLocaleString('en-GB', TIME_FORMAT)} UTC
                  </time>
                </td>

                <td className="px-4 py-2 align-top">
                  {hasDetail ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => {
                        setExpanded(open ? null : event.id);
                      }}
                      className="text-left"
                    >
                      <span className="font-medium text-ink-900 underline-offset-2 hover:underline">
                        {describeAction(event.action)}
                      </span>
                      <span className="ml-1.5 text-[11px] text-ink-400">{open ? '▾' : '▸'}</span>
                      <span className="block truncate text-[11px] text-ink-400">
                        <code>{event.action}</code>
                      </span>
                    </button>
                  ) : (
                    <>
                      <span className="font-medium text-ink-900">
                        {describeAction(event.action)}
                      </span>
                      <span className="block truncate text-[11px] text-ink-400">
                        <code>{event.action}</code>
                      </span>
                    </>
                  )}
                </td>

                <td className="px-4 py-2 align-top">
                  {/* Denormalised at write time, so it still reads correctly
                      after the person leaves or changes their name. */}
                  <div className="truncate text-ink-800">{event.actorLabel ?? '—'}</div>
                  <div className="text-[11px] text-ink-400">
                    {ACTOR_TYPE_LABELS[event.actorType]}
                  </div>
                </td>

                <td className="px-4 py-2 align-top">
                  <div className="truncate text-ink-700">{event.resourceType}</div>
                  {event.resourceId !== null ? (
                    <code className="truncate text-[11px] text-ink-400">
                      {event.resourceId.slice(0, 8)}
                    </code>
                  ) : null}
                </td>

                <td className="px-4 py-2 text-right align-top">
                  <span className="tabular text-[12px] text-ink-500">
                    {event.ipAddress ?? <span className="text-ink-300">—</span>}
                  </span>
                </td>
              </tr>,

              open ? (
                <tr key={`${event.id}-detail`} className="border-b border-[var(--border-subtle)]">
                  <td colSpan={5} className="bg-ink-50/50 px-4 py-3">
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <Payload label="Before" value={event.before} />
                      <Payload label="After" value={event.after} />
                      {Object.keys(event.metadata).length > 0 ? (
                        <Payload label="Context" value={event.metadata} />
                      ) : null}
                      <div>
                        <dt className="text-[12px] font-medium text-ink-500">Correlation id</dt>
                        <dd className="mt-1">
                          {/* The thread through the logs. An operator reading
                              this row and an operator reading the API's logs
                              are looking at the same request. */}
                          <code className="text-[11px] text-ink-600">{event.correlationId}</code>
                        </dd>
                      </div>
                    </dl>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function Payload({ label, value }: { label: string; value: unknown }): React.JSX.Element {
  return (
    <div>
      <dt className="text-[12px] font-medium text-ink-500">{label}</dt>
      <dd className="mt-1">
        {value === null || value === undefined ? (
          <span className="text-[12px] text-ink-400">—</span>
        ) : (
          <pre className="overflow-x-auto rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2 text-[11px] leading-relaxed text-ink-700">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </dd>
    </div>
  );
}
