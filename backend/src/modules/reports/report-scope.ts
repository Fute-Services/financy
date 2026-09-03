import type { ReportFilters } from '@financy/contracts';
import { fiscalYearOf } from '@financy/core';

/**
 * Intersect what was asked for with what is allowed — always in that direction
 * (docs/15 §4).
 *
 * A manager who asks for the Sales department gets **nothing**, not Sales' data
 * and not an error. An error would confirm that a department called Sales
 * exists and that they are not in it, which is a fact they are not entitled to
 * and which a determined person can turn into an organisation chart.
 */
export function intersectIds(
  requested: readonly string[] | undefined,
  allowed: readonly string[] | null,
): string[] | undefined {
  if (allowed === null) return requested === undefined ? undefined : [...requested];
  if (requested === undefined) return [...allowed];

  const permitted = new Set(allowed);

  return requested.filter((id) => permitted.has(id));
}

/**
 * The period a report covers.
 *
 * Presets resolve here, on the server, against the organisation's fiscal year.
 * A browser that computed "this quarter" would compute the *calendar* quarter,
 * and for an organisation whose year starts in April that is a different three
 * months from the one their accounts use.
 */
export function resolvePeriod(
  filters: ReportFilters,
  now: Date,
  fiscalYearStartMonth: number,
): { from: Date; to: Date; label: string } {
  const startOfDay = (date: Date): Date =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  const endOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );

  switch (filters.datePreset) {
    case 'CUSTOM': {
      // Both are required for a custom range, and the schema cannot say so
      // without making them required for every preset. Falling back to the
      // month is the safe reading: it is a narrower window than the caller
      // asked for, never a wider one.
      const from =
        filters.dateFrom === undefined
          ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
          : new Date(`${filters.dateFrom}T00:00:00.000Z`);

      const to =
        filters.dateTo === undefined
          ? endOfToday
          : new Date(`${filters.dateTo}T23:59:59.999Z`);

      return { from, to, label: `${toDay(from)} – ${toDay(to)}` };
    }

    case 'MTD': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from, to: endOfToday, label: monthLabel(from) };
    }

    case 'QTD': {
      const fiscalYear = fiscalYearOf(now, fiscalYearStartMonth);
      const yearStart = fiscalYearStart(fiscalYear, fiscalYearStartMonth);
      const elapsed =
        (now.getUTCFullYear() - yearStart.getUTCFullYear()) * 12 +
        (now.getUTCMonth() - yearStart.getUTCMonth());
      const quarter = Math.floor(elapsed / 3);
      const from = new Date(
        Date.UTC(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + quarter * 3, 1),
      );

      return { from, to: endOfToday, label: `FY${String(fiscalYear)} Q${String(quarter + 1)}` };
    }

    case 'YTD': {
      const fiscalYear = fiscalYearOf(now, fiscalYearStartMonth);
      return {
        from: fiscalYearStart(fiscalYear, fiscalYearStartMonth),
        to: endOfToday,
        label: `FY${String(fiscalYear)}`,
      };
    }

    case 'LAST_30D': {
      const from = startOfDay(new Date(now.getTime() - 29 * 86_400_000));
      return { from, to: endOfToday, label: 'The last 30 days' };
    }

    case 'LAST_QUARTER': {
      const fiscalYear = fiscalYearOf(now, fiscalYearStartMonth);
      const yearStart = fiscalYearStart(fiscalYear, fiscalYearStartMonth);
      const elapsed =
        (now.getUTCFullYear() - yearStart.getUTCFullYear()) * 12 +
        (now.getUTCMonth() - yearStart.getUTCMonth());
      const quarter = Math.floor(elapsed / 3) - 1;
      const from = new Date(
        Date.UTC(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + quarter * 3, 1),
      );
      const to = new Date(
        Date.UTC(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + (quarter + 1) * 3, 1) - 1,
      );

      return { from, to, label: `FY${String(fiscalYear)} Q${String(quarter + 1)}` };
    }

    case 'LAST_YEAR': {
      const fiscalYear = fiscalYearOf(now, fiscalYearStartMonth) - 1;
      const from = fiscalYearStart(fiscalYear, fiscalYearStartMonth);
      const to = new Date(fiscalYearStart(fiscalYear + 1, fiscalYearStartMonth).getTime() - 1);

      return { from, to, label: `FY${String(fiscalYear)}` };
    }

    default: {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from, to: endOfToday, label: monthLabel(from) };
    }
  }
}

/** The bucket a date falls in, as a label the report groups by. */
export function intervalLabel(date: Date, interval: ReportFilters['interval']): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  switch (interval) {
    case 'DAY':
      return date.toISOString().slice(0, 10);
    case 'WEEK': {
      // ISO-ish: the Monday of the week the date falls in. Weeks numbered by
      // their start date rather than by an index, because "week 34" needs a
      // calendar to interpret and "2026-08-17" does not.
      const day = (date.getUTCDay() + 6) % 7;
      const monday = new Date(Date.UTC(year, month, date.getUTCDate() - day));
      return monday.toISOString().slice(0, 10);
    }
    case 'QUARTER':
      return `${String(year)}-Q${String(Math.floor(month / 3) + 1)}`;
    case 'MONTH':
      return `${String(year)}-${String(month + 1).padStart(2, '0')}`;
  }
}

function fiscalYearStart(fiscalYear: number, fiscalYearStartMonth: number): Date {
  const startYear = fiscalYearStartMonth === 1 ? fiscalYear : fiscalYear - 1;
  return new Date(Date.UTC(startYear, fiscalYearStartMonth - 1, 1));
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
