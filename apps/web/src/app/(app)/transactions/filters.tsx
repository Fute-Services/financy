'use client';

import {
  MATCH_STATUSES,
  MATCH_STATUS_LABELS,
  RECEIPT_STATUSES,
  RECEIPT_STATUS_LABELS,
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  TRANSACTION_STATUSES,
  TRANSACTION_STATUS_LABELS,
  type CardRecord,
} from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Four independent filters, one per status axis.
 *
 * Not one combined "state" picker. A charge is routinely settled, missing its
 * receipt, unreviewed, and uncoded at the same time, and the questions people
 * bring to this screen are conjunctions of those: "posted, no receipt" is the
 * chase list; "posted, unreviewed" is the finance queue. A single picker cannot
 * express either.
 *
 * A "needs attention" shortcut sits at the front, because that conjunction is
 * the one people ask for daily and assembling it from three dropdowns every
 * morning is how a queue stops being used.
 */
export function TransactionFilters({ cards }: { cards: readonly CardRecord[] }): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function push(next: URLSearchParams): void {
    next.delete('page');

    startTransition(() => {
      router.push(next.toString() === '' ? '/transactions' : `/transactions?${next.toString()}`);
    });
  }

  function apply(key: string, value: string): void {
    const next = new URLSearchParams(params.toString());

    if (value === '') next.delete(key);
    else next.set(key, value);

    push(next);
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  const needsAttention =
    params.get('status') === 'POSTED' &&
    params.get('reviewStatus') === 'PENDING' &&
    params.get('receiptStatus') === 'MISSING';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={needsAttention}
        onClick={() => {
          const next = new URLSearchParams(params.toString());

          if (needsAttention) {
            next.delete('status');
            next.delete('reviewStatus');
            next.delete('receiptStatus');
          } else {
            next.set('status', 'POSTED');
            next.set('reviewStatus', 'PENDING');
            next.set('receiptStatus', 'MISSING');
          }

          push(next);
        }}
        className={
          needsAttention
            ? 'h-8 rounded-[var(--radius-sm)] border border-cobalt-500 bg-cobalt-50 px-2.5 text-[13px] font-medium text-cobalt-700'
            : 'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2.5 text-[13px] text-ink-700 hover:bg-ink-50'
        }
      >
        Needs attention
      </button>

      <select
        aria-label="Filter by settlement"
        defaultValue={params.get('status') ?? ''}
        onChange={(event) => {
          apply('status', event.currentTarget.value);
        }}
        className={control}
      >
        <option value="">Any settlement</option>
        {TRANSACTION_STATUSES.map((status) => (
          <option key={status} value={status}>
            {TRANSACTION_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by review"
        defaultValue={params.get('reviewStatus') ?? ''}
        onChange={(event) => {
          apply('reviewStatus', event.currentTarget.value);
        }}
        className={control}
      >
        <option value="">Any review state</option>
        {REVIEW_STATUSES.map((status) => (
          <option key={status} value={status}>
            {REVIEW_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by receipt"
        defaultValue={params.get('receiptStatus') ?? ''}
        onChange={(event) => {
          apply('receiptStatus', event.currentTarget.value);
        }}
        className={control}
      >
        <option value="">Any receipt state</option>
        {RECEIPT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {RECEIPT_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by matching"
        defaultValue={params.get('matchStatus') ?? ''}
        onChange={(event) => {
          apply('matchStatus', event.currentTarget.value);
        }}
        className={control}
      >
        <option value="">Any match state</option>
        {MATCH_STATUSES.map((status) => (
          <option key={status} value={status}>
            {MATCH_STATUS_LABELS[status]}
          </option>
        ))}
      </select>

      {cards.length > 0 && (
        <select
          aria-label="Filter by card"
          defaultValue={params.get('cardId') ?? ''}
          onChange={(event) => {
            apply('cardId', event.currentTarget.value);
          }}
          className={control}
        >
          <option value="">Any card</option>
          {cards.map((card) => (
            <option key={card.id} value={card.id}>
              {card.name}
              {card.lastFour === null ? '' : ` ···· ${card.lastFour}`}
            </option>
          ))}
        </select>
      )}

      <span aria-live="polite" className="text-[12px] text-ink-400">
        {pending ? 'Filtering…' : ''}
      </span>
    </div>
  );
}
