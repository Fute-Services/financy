'use client';

import { MEMBERSHIP_STATUSES, ROLE_KEYS, ROLE_LABELS, STATUS_LABELS } from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { text } from '@/components/auth-form';

/**
 * Search and filters for the people list.
 *
 * State lives in the URL rather than in React. That is what makes a filtered
 * view shareable, bookmarkable, and survivable across a refresh — the three
 * things people actually do with a filtered list, and the three things
 * component state silently breaks.
 *
 * Submitting navigates, so the server re-renders the table with the filter
 * applied. `useTransition` keeps the current rows on screen while that
 * happens, instead of blanking the table on every keystroke.
 */
export function PeopleFilters(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    // Any filter change returns to page one. Staying on page four of a list
    // that now has two pages shows an empty table and looks broken.
    next.delete('page');

    startTransition(() => {
      router.push(next.toString() === '' ? '/people' : `/people?${next.toString()}`);
    });
  }

  return (
    <form
      className="mb-4 flex flex-wrap items-center gap-2"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        // `text` rather than `String(data.get(...))`: a FormData entry can be a
        // File, and stringifying one yields "[object File]" — which would be
        // sent as a search term and match nothing, silently.
        apply('q', text(new FormData(event.currentTarget), 'q').trim());
      }}
    >
      <input
        type="search"
        name="q"
        defaultValue={params.get('q') ?? ''}
        placeholder="Search name or email"
        aria-label="Search people"
        className="h-8 w-64 rounded-[var(--radius-sm)] border border-line bg-white px-2.5 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-cobalt-500 focus:outline-none"
      />

      <select
        aria-label="Filter by role"
        defaultValue={params.get('roleKey') ?? ''}
        onChange={(event) => {
          apply('roleKey', event.currentTarget.value);
        }}
        className="h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 focus:border-cobalt-500 focus:outline-none"
      >
        <option value="">All roles</option>
        {ROLE_KEYS.map((key) => (
          <option key={key} value={key}>
            {ROLE_LABELS[key]}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by status"
        defaultValue={params.get('status') ?? ''}
        onChange={(event) => {
          apply('status', event.currentTarget.value);
        }}
        className="h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 focus:border-cobalt-500 focus:outline-none"
      >
        <option value="">Any status</option>
        {MEMBERSHIP_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      {/* Announced rather than merely animated, so the wait is legible to a
          screen reader as well as to the eye. */}
      <span aria-live="polite" className="text-[12px] text-ink-400">
        {pending ? 'Filtering…' : ''}
      </span>
    </form>
  );
}
