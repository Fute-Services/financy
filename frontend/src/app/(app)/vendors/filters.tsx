'use client';

import { VENDOR_STATUSES, VENDOR_STATUS_LABELS } from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * A status filter and a search box, and nothing else.
 *
 * The search covers name, legal name, and tax id in one field rather than
 * offering three, because a person looking for a supplier has exactly one of
 * those in front of them and does not know which box it belongs in.
 */
export function VendorFilters(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    startTransition(() => {
      router.push(next.toString() === '' ? '/vendors' : `/vendors?${next.toString()}`);
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      <select
        aria-label="Status"
        className={control}
        value={params.get('status') ?? ''}
        onChange={(event) => apply('status', event.target.value)}
      >
        <option value="">Any status</option>
        {VENDOR_STATUSES.map((status) => (
          <option key={status} value={status}>
            {VENDOR_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Search suppliers"
        placeholder="Name, legal name, or tax ID"
        className={`${control} w-64`}
        defaultValue={params.get('q') ?? ''}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply('q', event.currentTarget.value.trim());
        }}
      />
    </div>
  );
}
