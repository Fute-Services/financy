'use client';

import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  REPORT_INTERVALS,
  type ReportKey,
} from '@financy/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * The shared filter bar.
 *
 * ## Presets first, custom dates second
 *
 * "This quarter" is what somebody actually wants, and it is resolved on the
 * **server** against the organisation's fiscal year — a browser computing it
 * would compute the calendar quarter, which is the wrong three months for
 * anybody whose year does not start in January.
 *
 * ## The filters live in the URL
 *
 * So a report can be sent to a colleague as a link and they see the same
 * figures, subject to their own scope. A filter set held in component state
 * produces screenshots instead of links, and screenshots are how two people end
 * up quoting different numbers at each other.
 */
export function ReportFilterBar({ reportKey }: { reportKey: ReportKey }): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(changes: Record<string, string>): void {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === '') next.delete(key);
      else next.set(key, value);
    }

    next.delete('page');

    startTransition(() => {
      router.push(
        next.toString() === '' ? `/reports/${reportKey}` : `/reports/${reportKey}?${next.toString()}`,
      );
    });
  }

  const control =
    'h-8 rounded-[var(--radius-sm)] border border-line bg-white px-2 text-[13px] text-ink-700 ' +
    'focus:border-cobalt-500 focus:outline-none';

  const preset = params.get('datePreset') ?? 'MTD';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-pending={pending || undefined}>
      <select
        aria-label="Period"
        className={control}
        value={preset}
        onChange={(event) => apply({ datePreset: event.target.value })}
      >
        {DATE_PRESETS.map((option) => (
          <option key={option} value={option}>
            {DATE_PRESET_LABELS[option]}
          </option>
        ))}
      </select>

      {preset === 'CUSTOM' && (
        <>
          <input
            type="date"
            aria-label="From"
            className={control}
            defaultValue={params.get('dateFrom') ?? ''}
            onChange={(event) => apply({ dateFrom: event.target.value })}
          />
          <input
            type="date"
            aria-label="To"
            className={control}
            defaultValue={params.get('dateTo') ?? ''}
            onChange={(event) => apply({ dateTo: event.target.value })}
          />
        </>
      )}

      {reportKey === 'spend-total' && (
        <select
          aria-label="Grouped by"
          className={control}
          value={params.get('interval') ?? 'MONTH'}
          onChange={(event) => apply({ interval: event.target.value })}
        >
          {REPORT_INTERVALS.map((interval) => (
            <option key={interval} value={interval}>
              {interval.charAt(0) + interval.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      )}

      <input
        aria-label="Currency"
        placeholder="Currency"
        maxLength={3}
        className={`${control} w-24 uppercase`}
        defaultValue={params.get('currency') ?? ''}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            apply({ currency: event.currentTarget.value.trim().toUpperCase() });
          }
        }}
      />

      {[...params.keys()].length > 0 && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push(`/reports/${reportKey}`))}
          className="h-8 rounded-[var(--radius-sm)] px-2 text-[13px] text-ink-500 hover:text-ink-800"
        >
          Clear
        </button>
      )}
    </div>
  );
}
