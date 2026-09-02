'use client';

import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS } from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Status, mine, and a search box.
 *
 * "Mine" matters more here than on most screens: an employee raising a purchase
 * request wants their own three, and finance wants the department's forty. One
 * list serves both, and the toggle is what says which one you are looking at.
 */
export function OrderFilters(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    startTransition(() => {
      router.push(next.toString() === '' ? '/procurement' : `/procurement?${next.toString()}`);
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  const mine = params.get('mine') === 'true';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      <button
        type="button"
        aria-pressed={mine}
        onClick={() => apply('mine', mine ? '' : 'true')}
        className={`h-8 rounded-[var(--radius-sm)] border px-3 text-[13px] ${
          mine
            ? 'border-cobalt-500 bg-cobalt-50 text-cobalt-700'
            : 'border-line bg-white text-ink-600'
        }`}
      >
        Mine
      </button>

      <select
        aria-label="Status"
        className={control}
        value={params.get('status') ?? ''}
        onChange={(event) => apply('status', event.target.value)}
      >
        <option value="">Any status</option>
        {PURCHASE_ORDER_STATUSES.map((status) => (
          <option key={status} value={status}>
            {PURCHASE_ORDER_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Search purchase orders"
        placeholder="PO number or note"
        className={`${control} w-56`}
        defaultValue={params.get('q') ?? ''}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply('q', event.currentTarget.value.trim());
        }}
      />
    </div>
  );
}
