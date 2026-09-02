'use client';

import { useActionState, useState } from 'react';
import type { BudgetLineRecord } from '@financy/contracts';
import { BudgetMeter, Button, FormMessage, Money } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { allocate } from '../actions';

/**
 * The periods, with allocation editable in place.
 *
 * ## One row opens at a time
 *
 * Editing is a small form that replaces the figure in the row it belongs to,
 * not a dialog. The number being changed and the numbers it has to make sense
 * against — committed, spent, remaining — stay on screen together, which is the
 * whole reason anybody is changing it.
 *
 * ## The version travels with the row
 *
 * Each line carries its own `version`, so two people editing different months
 * never collide and two people editing the same month do — the second is told
 * the number moved rather than adding to it.
 */
export function PeriodTable({
  budgetId,
  lines,
  currency,
  editable,
}: {
  budgetId: string;
  lines: readonly BudgetLineRecord[];
  currency: string;
  editable: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const [state, submit, pending] = useActionState(allocate, IDLE);

  return (
    <div>
      {state.status === 'error' && state.message !== undefined && (
        <div className="px-5 pt-4">
          <FormMessage>{state.message}</FormMessage>
        </div>
      )}

      <table className="w-full text-[13px]">
        <caption className="sr-only">Budget periods and their allocations</caption>
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-[11px] tracking-wide text-ink-500 uppercase">
            <th scope="col" className="px-5 py-2 text-left font-medium">
              Period
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Allocated
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Committed
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Spent
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Remaining
            </th>
            <th scope="col" className="w-[140px] px-5 py-2 text-left font-medium">
              Used
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {lines.map((line) => (
            <tr key={line.id}>
              <td className="px-5 py-2.5 text-ink-800">{periodLabel(line)}</td>
              <td className="tabular px-3 py-2.5 text-right">
                {editing === line.id ? (
                  <form action={submit} className="flex items-center justify-end gap-2">
                    <input type="hidden" name="budgetId" value={budgetId} />
                    <input type="hidden" name="lineId" value={line.id} />
                    <input type="hidden" name="currency" value={currency} />
                    <input type="hidden" name="version" value={String(line.version)} />
                    <input
                      name="amount"
                      aria-label={`Allocation for ${periodLabel(line)}`}
                      defaultValue={line.allocated.amount}
                      inputMode="decimal"
                      autoFocus
                      className="tabular h-8 w-28 rounded-[var(--radius-sm)] border border-line px-2 text-right"
                    />
                    <Button type="submit" size="sm" variant="primary" loading={pending}>
                      Set
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={!editable}
                    // Named, because the visible content is a formatted amount
                    // and "$1,000.00" tells a screen reader nothing about which
                    // period it would be editing.
                    aria-label={`Change the allocation for ${periodLabel(line)}`}
                    onClick={() => setEditing(line.id)}
                    className={
                      editable
                        ? 'rounded-[var(--radius-sm)] px-1 hover:bg-ink-50'
                        : 'cursor-default'
                    }
                  >
                    <Money amount={line.allocated.amount} currency={line.allocated.currency} />
                  </button>
                )}
              </td>
              <td className="tabular px-3 py-2.5 text-right text-ink-600">
                <Money amount={line.committed.amount} currency={line.committed.currency} />
              </td>
              <td className="tabular px-3 py-2.5 text-right text-ink-600">
                <Money amount={line.actual.amount} currency={line.actual.currency} />
              </td>
              <td className="tabular px-3 py-2.5 text-right font-medium text-ink-900">
                <Money amount={line.remaining.amount} currency={line.remaining.currency} />
              </td>
              <td className="px-5 py-2.5">
                <BudgetMeter percent={line.utilization ?? 0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "March 2026", or a range when the period is not a whole month.
 *
 * A row labelled with two ISO timestamps is accurate and unreadable, and the
 * period is the first thing somebody has to identify to know which number they
 * are editing.
 */
function periodLabel(line: BudgetLineRecord): string {
  const start = new Date(line.periodStart);
  const end = new Date(line.periodEnd);

  const month = (date: Date): string =>
    date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return month(start) === month(end) ? month(start) : `${month(start)} – ${month(end)}`;
}
