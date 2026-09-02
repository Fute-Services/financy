'use client';

import { BILL_STATUSES, BILL_STATUS_LABELS } from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * A status filter, an overdue shortcut, and a search box.
 *
 * "Overdue" earns a button rather than a dropdown entry because it is the
 * question this screen is opened to answer, and assembling it from a status and
 * a date every morning is how a queue stops being used.
 */
export function BillFilters(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    startTransition(() => {
      router.push(next.toString() === '' ? '/bills' : `/bills?${next.toString()}`);
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  const overdue = params.get('overdue') === 'true';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      <button
        type="button"
        aria-pressed={overdue}
        onClick={() => apply('overdue', overdue ? '' : 'true')}
        className={`h-8 rounded-[var(--radius-sm)] border px-3 text-[13px] ${
          overdue
            ? 'border-cobalt-500 bg-cobalt-50 text-cobalt-700'
            : 'border-line bg-white text-ink-600'
        }`}
      >
        Overdue
      </button>

      <select
        aria-label="Status"
        className={control}
        value={params.get('status') ?? ''}
        onChange={(event) => apply('status', event.target.value)}
      >
        <option value="">Any status</option>
        {BILL_STATUSES.map((status) => (
          <option key={status} value={status}>
            {BILL_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Search bills"
        placeholder="Invoice number or note"
        className={`${control} w-56`}
        defaultValue={params.get('q') ?? ''}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply('q', event.currentTarget.value.trim());
        }}
      />
    </div>
  );
}
