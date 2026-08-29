import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Money display.
 *
 * **This component performs no arithmetic, and has no prop that would permit
 * it.** It takes an already-computed amount and formats it. That is the design
 * system enforcing docs/15-REPORTING-ANALYTICS.md §1 and ADR-0013: every
 * financial figure is computed by the server, because a browser-side sum is
 * unauditable, scope-blind (it can only add up what was fetched, and
 * pagination silently truncates that), and will drift between components.
 *
 * The amount arrives as a **string** — `JSON.parse` produces doubles, so a
 * monetary JSON number is already corrupt by the time it reaches here.
 */

const CURRENCY_EXPONENT: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
};

function exponentFor(currency: string): number {
  return CURRENCY_EXPONENT[currency] ?? 2;
}

export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Decimal string, e.g. `"2400.0000"`. Never a number. */
  amount: string;
  /** ISO 4217 code. */
  currency: string;
  /** Show the code alongside the symbol: `$2,400.00 USD`. */
  showCode?: boolean;
  /** Drop the minor units for compact display (KPI tiles). */
  compact?: boolean;
  /** Colour negatives with the danger token. */
  colorNegative?: boolean;
  locale?: string;
}

export function Money({
  amount,
  currency,
  showCode = false,
  compact = false,
  colorNegative = false,
  locale = 'en-US',
  className,
  ...rest
}: MoneyProps): React.JSX.Element {
  const numeric = Number.parseFloat(amount);
  const isNegative = numeric < 0;
  const exponent = exponentFor(currency);

  // Formatting only. Number.parseFloat is acceptable here and nowhere else:
  // the value is already final, and Intl needs a number to format.
  const formatted = Number.isFinite(numeric)
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: compact ? 0 : exponent,
        maximumFractionDigits: compact ? 0 : exponent,
      })
        .format(numeric)
        // A true minus sign, not a hyphen. Parenthesised negatives alone are
        // not accessible and read badly in a scanned column.
        .replace('-', '−')
    : '—';

  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        isNegative && colorNegative && 'text-[var(--color-danger-text)]',
        className,
      )}
      {...rest}
    >
      {formatted}
      {showCode && <span className="ml-1 text-ink-500">{currency}</span>}
    </span>
  );
}

/**
 * A value that is genuinely unknown.
 *
 * Deliberately not `0` — zero is a claim, and "we have no data" is a different
 * statement from "the amount is nothing".
 */
export function NoValue({ reason }: { reason?: string }): React.JSX.Element {
  return (
    <span className="text-ink-400" title={reason ?? 'No value recorded'}>
      &mdash;
    </span>
  );
}
