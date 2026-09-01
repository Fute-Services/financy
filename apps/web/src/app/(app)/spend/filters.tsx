'use client';

import { SPEND_STATUS_LABELS, type SpendRequestStatus } from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Status and scope, in the URL.
 *
 * The same reasoning as the people screen: a filtered view has to be
 * shareable, bookmarkable, and survive a refresh, and component state silently
 * breaks all three. "Which requests were you looking at?" is a question people
 * answer by pasting a link.
 *
 * The scope toggle only appears for somebody who may read the whole
 * organisation. Rendering it disabled for everybody else would advertise a
 * capability as a locked door; the API refuses it independently either way.
 */
export function SpendFilters({
  statuses,
  canSeeAll,
}: {
  statuses: readonly SpendRequestStatus[];
  canSeeAll: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    // Back to page one on any change. Staying on page four of a list that now
    // has two shows an empty table and looks broken.
    next.delete('page');

    startTransition(() => {
      router.push(next.toString() === '' ? '/spend' : `/spend?${next.toString()}`);
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by status"
        defaultValue={params.get('status') ?? ''}
        onChange={(event) => {
          apply('status', event.currentTarget.value);
        }}
        className={control}
      >
        <option value="">Any status</option>
        {statuses.map((status) => (
          <option key={status} value={status}>
            {SPEND_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      {canSeeAll && (
        <select
          aria-label="Whose requests to show"
          defaultValue={params.get('scope') ?? 'mine'}
          onChange={(event) => {
            apply('scope', event.currentTarget.value);
          }}
          className={control}
        >
          <option value="mine">Mine</option>
          <option value="all">Everyone&rsquo;s</option>
        </select>
      )}

      <span aria-live="polite" className="text-[12px] text-ink-400">
        {pending ? 'Filtering…' : ''}
      </span>
    </div>
  );
}
