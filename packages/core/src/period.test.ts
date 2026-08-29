import { describe, it, expect } from 'vitest';
import {
  fiscalYearOf,
  fiscalYearPeriod,
  monthPeriod,
  quarterPeriod,
  periodsInFiscalYear,
  isWithinPeriod,
  toDateString,
} from './period.js';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('period — fiscal year', () => {
  it('equals the calendar year when the fiscal year starts in January', () => {
    expect(fiscalYearOf(d('2026-01-01'), 1)).toBe(2026);
    expect(fiscalYearOf(d('2026-12-31'), 1)).toBe(2026);
  });

  it('labels by the year the fiscal year ends, for a non-January start', () => {
    // April start: April 2026 through March 2027 is "FY2027".
    expect(fiscalYearOf(d('2026-04-01'), 4)).toBe(2027);
    expect(fiscalYearOf(d('2026-03-31'), 4)).toBe(2026);
    expect(fiscalYearOf(d('2027-03-31'), 4)).toBe(2027);
    expect(fiscalYearOf(d('2027-04-01'), 4)).toBe(2028);
  });

  it('produces a half-open period so adjacent years never overlap or gap', () => {
    const fy = fiscalYearPeriod(2027, 4);
    expect(toDateString(fy.start)).toBe('2026-04-01');
    expect(toDateString(fy.end)).toBe('2027-04-01');
    expect(fy.label).toBe('FY2027');

    const next = fiscalYearPeriod(2028, 4);
    expect(fy.end.getTime()).toBe(next.start.getTime());
  });

  it('rejects an out-of-range start month rather than wrapping it', () => {
    expect(() => fiscalYearOf(d('2026-01-01'), 0)).toThrow(RangeError);
    expect(() => fiscalYearOf(d('2026-01-01'), 13)).toThrow(RangeError);
    expect(() => fiscalYearOf(d('2026-01-01'), 1.5)).toThrow(RangeError);
  });
});

describe('period — month', () => {
  it('bounds the calendar month', () => {
    const p = monthPeriod(d('2026-08-15'));
    expect(toDateString(p.start)).toBe('2026-08-01');
    expect(toDateString(p.end)).toBe('2026-09-01');
    expect(p.label).toBe('2026-08');
  });

  it('handles the December-to-January rollover', () => {
    const p = monthPeriod(d('2026-12-15'));
    expect(toDateString(p.end)).toBe('2027-01-01');
  });
});

describe('period — quarter', () => {
  it('uses calendar quarters when the fiscal year starts in January', () => {
    expect(quarterPeriod(d('2026-02-15'), 1).label).toBe('FY2026 Q1');
    expect(quarterPeriod(d('2026-05-15'), 1).label).toBe('FY2026 Q2');
    expect(quarterPeriod(d('2026-11-15'), 1).label).toBe('FY2026 Q4');
  });

  it('shifts quarters to the fiscal year — the bug a calendar-quarter report would produce', () => {
    // With an April start, May is Q2 of the calendar year but Q1 of the
    // fiscal year. A report using calendar quarters would disagree with the
    // accounts, silently.
    const q = quarterPeriod(d('2026-05-15'), 4);
    expect(q.label).toBe('FY2027 Q1');
    expect(toDateString(q.start)).toBe('2026-04-01');
    expect(toDateString(q.end)).toBe('2026-07-01');

    expect(quarterPeriod(d('2027-02-15'), 4).label).toBe('FY2027 Q4');
  });
});

describe('period — enumeration', () => {
  it('produces twelve contiguous months covering the fiscal year exactly', () => {
    const months = periodsInFiscalYear(2027, 4, 'MONTH');
    expect(months).toHaveLength(12);
    expect(toDateString(months[0]!.start)).toBe('2026-04-01');
    expect(toDateString(months[11]!.end)).toBe('2027-04-01');

    for (let i = 1; i < months.length; i += 1) {
      expect(months[i]!.start.getTime()).toBe(months[i - 1]!.end.getTime());
    }
  });

  it('produces four contiguous quarters', () => {
    const quarters = periodsInFiscalYear(2027, 4, 'QUARTER');
    expect(quarters).toHaveLength(4);
    expect(quarters.map((q) => q.label)).toEqual([
      'FY2027 Q1',
      'FY2027 Q2',
      'FY2027 Q3',
      'FY2027 Q4',
    ]);
  });

  it('produces the single year period for YEAR granularity', () => {
    expect(periodsInFiscalYear(2027, 4, 'YEAR')).toHaveLength(1);
  });
});

describe('period — containment', () => {
  it('is half-open: start is inside, end is not', () => {
    const august = monthPeriod(d('2026-08-15'));
    expect(isWithinPeriod(d('2026-08-01'), august)).toBe(true);
    expect(isWithinPeriod(d('2026-08-31'), august)).toBe(true);
    expect(isWithinPeriod(d('2026-09-01'), august)).toBe(false);
    expect(isWithinPeriod(d('2026-07-31'), august)).toBe(false);
  });
});

describe('period — serialisation', () => {
  it('formats date-only values as YYYY-MM-DD in UTC', () => {
    expect(toDateString(new Date('2026-08-29T23:59:59.999Z'))).toBe('2026-08-29');
  });
});
