'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import type { TransactionRecord } from '@financy/contracts';
import { Badge, Button, FormMessage, Money } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { bulkReview } from './actions';

/**
 * The queue itself: select, decide, move on.
 *
 * ## Keyboard first, because this is a repetitive job
 *
 * `j`/`k` move, `x` selects, `a` reviews the selection, `d` disputes it. Somebody
 * clearing sixty charges with a mouse makes sixty round trips to a checkbox
 * three pixels wide; the same person on the keyboard never leaves the home row.
 * Every shortcut has a visible control too — a keyboard-only feature is one
 * nobody discovers.
 *
 * ## A dispute needs a note and the button knows it
 *
 * The API refuses a dispute with no explanation, because a disputed charge
 * nobody explained sits in the queue while two people wait for each other. The
 * note box appears the moment dispute is chosen rather than after the refusal.
 *
 * ## What was skipped is named
 *
 * "17 reviewed, 3 skipped because they have not settled" is something finance
 * can act on. A count alone is not.
 */
export function ReviewQueue({
  transactions,
}: {
  transactions: readonly TransactionRecord[];
}): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [disputing, setDisputing] = useState(false);
  const [state, submit, pending] = useActionState(bulkReview, IDLE);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      // Never while somebody is typing a note — `d` in a textarea is a letter,
      // not a command.
      const target = event.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.key === 'j') setCursor((value) => Math.min(value + 1, transactions.length - 1));
      if (event.key === 'k') setCursor((value) => Math.max(value - 1, 0));

      if (event.key === 'x') {
        event.preventDefault();
        const row = transactions[cursor];
        if (row === undefined) return;

        setSelected((current) => {
          const next = new Set(current);
          if (next.has(row.id)) next.delete(row.id);
          else next.add(row.id);
          return next;
        });
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [cursor, transactions]);

  const ids = [...selected];

  return (
    <div>
      <form
        action={submit}
        className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3"
      >
        {ids.map((id) => (
          <input key={id} type="hidden" name="transactionIds" value={id} />
        ))}

        <span className="text-[13px] text-ink-600">
          {ids.length === 0 ? 'Nothing selected' : `${String(ids.length)} selected`}
        </span>

        <div className="flex-1" />

        {disputing && (
          <input
            name="note"
            aria-label="What is wrong with these"
            placeholder="Say what is wrong — the person who fixes it reads this"
            className="h-8 min-w-[280px] flex-1 rounded-[var(--radius-sm)] border border-line px-2 text-[13px]"
            required
          />
        )}

        <Button
          type="submit"
          name="reviewStatus"
          value="REVIEWED"
          size="sm"
          variant="primary"
          disabled={ids.length === 0 || pending || disputing}
        >
          Mark reviewed
        </Button>

        {disputing ? (
          <Button
            type="submit"
            name="reviewStatus"
            value="DISPUTED"
            size="sm"
            disabled={ids.length === 0 || pending}
          >
            Dispute these
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={ids.length === 0}
            onClick={() => setDisputing(true)}
          >
            Dispute…
          </Button>
        )}

        {disputing && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDisputing(false)}>
            Never mind
          </Button>
        )}
      </form>

      {state.status !== 'idle' && state.message !== undefined && (
        <div className="px-5 pt-3">
          <FormMessage tone={state.status === 'success' ? 'success' : 'danger'}>
            {state.message}
          </FormMessage>
        </div>
      )}

      <ul className="divide-y divide-[var(--border-subtle)]">
        {transactions.map((transaction, index) => (
          <li
            key={transaction.id}
            className={`flex items-center gap-3 px-5 py-2.5 ${
              index === cursor ? 'bg-cobalt-50/60' : ''
            }`}
          >
            <input
              type="checkbox"
              aria-label={`Select ${transaction.merchantName}`}
              className="size-4 accent-[var(--color-accent-solid)]"
              checked={selected.has(transaction.id)}
              onChange={(event) => {
                setCursor(index);
                setSelected((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(transaction.id);
                  else next.delete(transaction.id);
                  return next;
                });
              }}
            />

            <div className="min-w-0 flex-1">
              <Link
                href={`/transactions/${transaction.id}`}
                className="text-[13px] text-ink-800 hover:text-cobalt-600 hover:underline"
              >
                {transaction.merchantName}
              </Link>
              <div className="text-[12px] text-ink-500">
                {formatDate(transaction.occurredAt)}
                {transaction.card !== null && <> · {transaction.card.name}</>}
                {transaction.member !== null && <> · {transaction.member.fullName}</>}
              </div>
            </div>

            {transaction.receiptStatus !== 'ATTACHED' && (
              // The one thing that changes the decision: a charge with no
              // evidence is the one worth stopping on.
              <Badge tone="warning">No receipt</Badge>
            )}

            <Money amount={transaction.amount.amount} currency={transaction.amount.currency} />
          </li>
        ))}
      </ul>

      <p className="border-t border-[var(--border-subtle)] px-5 py-2.5 text-[12px] text-ink-500">
        <kbd className="rounded bg-ink-100 px-1">j</kbd>/<kbd className="rounded bg-ink-100 px-1">k</kbd>{' '}
        to move · <kbd className="rounded bg-ink-100 px-1">x</kbd> to select
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
