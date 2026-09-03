'use client';

import {
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
} from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Status, payment method, and whose.
 *
 * "Mine" is a toggle rather than a person picker: the question somebody with
 * `expense:read_all` actually asks is "what have I claimed" against "what is
 * waiting on me", and a dropdown of forty names answers neither.
 */
export function ExpenseFilters(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    next.delete('page');

    startTransition(() => {
      router.push(next.toString() === '' ? '/expenses' : `/expenses?${next.toString()}`);
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
      <select
        aria-label="Status"
        className={control}
        value={params.get('status') ?? ''}
        onChange={(event) => apply('status', event.target.value)}
        disabled={pending}
      >
        <option value="">Any status</option>
        {EXPENSE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {EXPENSE_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <select
        aria-label="Payment method"
        className={control}
        value={params.get('paymentMethod') ?? ''}
        onChange={(event) => apply('paymentMethod', event.target.value)}
        disabled={pending}
      >
        <option value="">Paid any way</option>
        {EXPENSE_PAYMENT_METHODS.map((method) => (
          <option key={method} value={method}>
            {EXPENSE_PAYMENT_METHOD_LABELS[method]}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-[13px] text-ink-600">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-accent-solid)]"
          checked={params.get('mine') === 'true'}
          onChange={(event) => apply('mine', event.target.checked ? 'true' : '')}
          disabled={pending}
        />
        Only mine
      </label>
    </div>
  );
}
