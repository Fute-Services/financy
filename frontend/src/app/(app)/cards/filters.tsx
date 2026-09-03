'use client';

import { CARD_STATUSES, CARD_STATUS_LABELS } from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Status and name search, in the URL.
 *
 * Same reasoning as everywhere else in this app: a filtered view has to be
 * shareable, bookmarkable, and survive a refresh, and component state silently
 * breaks all three.
 */
export function CardFilters(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    next.delete('page');

    startTransition(() => {
      router.push(next.toString() === '' ? '/cards' : `/cards?${next.toString()}`);
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2.5 text-[13px] text-ink-700 ' +
    'placeholder:text-ink-400 focus:border-cobalt-500 focus:outline-none';

  return (
    <form
      className="mb-4 flex flex-wrap items-center gap-2"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();

        const value = new FormData(event.currentTarget).get('q');
        // Narrowed rather than stringified: `FormData.get` can return a File,
        // and `String(file)` would be sent as a search term matching nothing.
        apply('q', typeof value === 'string' ? value.trim() : '');
      }}
    >
      <input
        type="search"
        name="q"
        defaultValue={params.get('q') ?? ''}
        placeholder="Search card names"
        aria-label="Search cards"
        className={`${control} w-56`}
      />

      <select
        aria-label="Filter by status"
        defaultValue={params.get('status') ?? ''}
        onChange={(event) => {
          apply('status', event.currentTarget.value);
        }}
        className={control}
      >
        <option value="">Any status</option>
        {CARD_STATUSES.map((status) => (
          <option key={status} value={status}>
            {CARD_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <span aria-live="polite" className="text-[12px] text-ink-400">
        {pending ? 'Filtering…' : ''}
      </span>
    </form>
  );
}
