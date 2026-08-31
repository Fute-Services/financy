/**
 * Fiscal periods.
 *
 * Budgets, reports, and accounting exports are all period-bounded, and the
 * period boundary is a source of real bugs: a company whose fiscal year starts
 * in April has a "Q1" that is not the calendar's, and a report that silently
 * uses calendar quarters will disagree with the accounts.
 *
 * All dates here are handled in UTC. Timezone conversion happens only at the
 * presentation edge (NFR-I18N-004).
 */

export type PeriodGranularity = 'MONTH' | 'QUARTER' | 'YEAR';

export interface Period {
  readonly start: Date;
  /** Exclusive upper bound, so adjacent periods never overlap or gap. */
  readonly end: Date;
  readonly label: string;
  readonly granularity: PeriodGranularity;
}

function utc(year: number, monthIndex: number, day = 1): Date {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
}

/**
 * The fiscal year containing `date`.
 *
 * @param fiscalYearStartMonth 1–12. `1` means the fiscal year is the calendar year.
 * @returns The fiscal year's *label* year — the calendar year in which it ends,
 *   which is the common convention ("FY2027" starts April 2026 for an April start).
 */
export function fiscalYearOf(date: Date, fiscalYearStartMonth: number): number {
  assertMonth(fiscalYearStartMonth);
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  if (fiscalYearStartMonth === 1) return year;
  return month >= fiscalYearStartMonth ? year + 1 : year;
}

export function fiscalYearPeriod(fiscalYear: number, fiscalYearStartMonth: number): Period {
  assertMonth(fiscalYearStartMonth);
  const startYear = fiscalYearStartMonth === 1 ? fiscalYear : fiscalYear - 1;
  const start = utc(startYear, fiscalYearStartMonth - 1);
  const end = utc(startYear + 1, fiscalYearStartMonth - 1);
  return { start, end, label: `FY${fiscalYear}`, granularity: 'YEAR' };
}

/** The calendar month containing `date`. */
export function monthPeriod(date: Date): Period {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = utc(year, month);
  const end = utc(year, month + 1);
  return {
    start,
    end,
    label: `${year}-${String(month + 1).padStart(2, '0')}`,
    granularity: 'MONTH',
  };
}

/** The fiscal quarter containing `date`, relative to the fiscal year start. */
export function quarterPeriod(date: Date, fiscalYearStartMonth: number): Period {
  assertMonth(fiscalYearStartMonth);
  const fiscalYear = fiscalYearOf(date, fiscalYearStartMonth);
  const yearStart = fiscalYearPeriod(fiscalYear, fiscalYearStartMonth).start;

  const monthsElapsed =
    (date.getUTCFullYear() - yearStart.getUTCFullYear()) * 12 +
    (date.getUTCMonth() - yearStart.getUTCMonth());
  const quarterIndex = Math.floor(monthsElapsed / 3);

  const start = utc(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + quarterIndex * 3);
  const end = utc(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + (quarterIndex + 1) * 3);

  return { start, end, label: `FY${fiscalYear} Q${quarterIndex + 1}`, granularity: 'QUARTER' };
}

/** Every period of the given granularity within a fiscal year. */
export function periodsInFiscalYear(
  fiscalYear: number,
  fiscalYearStartMonth: number,
  granularity: PeriodGranularity,
): Period[] {
  const year = fiscalYearPeriod(fiscalYear, fiscalYearStartMonth);
  if (granularity === 'YEAR') return [year];

  const count = granularity === 'MONTH' ? 12 : 4;
  const step = granularity === 'MONTH' ? 1 : 3;
  const periods: Period[] = [];

  for (let i = 0; i < count; i += 1) {
    const start = utc(year.start.getUTCFullYear(), year.start.getUTCMonth() + i * step);
    periods.push(
      granularity === 'MONTH' ? monthPeriod(start) : quarterPeriod(start, fiscalYearStartMonth),
    );
  }
  return periods;
}

/** Half-open containment: `start <= date < end`. */
export function isWithinPeriod(date: Date, period: Period): boolean {
  return date.getTime() >= period.start.getTime() && date.getTime() < period.end.getTime();
}

/** `YYYY-MM-DD` in UTC. The wire format for date-only fields. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`fiscalYearStartMonth must be an integer 1-12, received ${month}.`);
  }
}
