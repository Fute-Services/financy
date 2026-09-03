import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Surfaces.
 *
 * Bordered, not shadowed. A card sitting flat on a page is not floating above
 * it, and a shadow that implies depth which does not exist is decoration
 * pretending to be information (docs/UI-DESIGN-SYSTEM.md §4.3).
 */

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--border-default)]',
        'bg-[var(--surface-raised)] shadow-[var(--shadow-elev-1)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] leading-6 font-semibold tracking-[-0.01em] text-ink-900">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn('p-5', className)} {...rest}>
      {children}
    </div>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────

/**
 * Optional props are written `?: T | undefined` rather than `?: T` because the
 * repository runs with `exactOptionalPropertyTypes`. Without the explicit
 * `undefined`, a caller cannot spread a value that may legitimately be absent —
 * which is the common case when the figure comes from an API response.
 */
export type KpiTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface KpiCardProps {
  label: string;
  /** Pre-formatted by the caller — usually a <Money> element. Never computed here. */
  value: React.ReactNode;
  /** Change against the comparison period, e.g. `"+12.4%"`. */
  delta?: string | undefined;
  deltaDirection?: 'up' | 'down' | 'flat' | undefined;
  /** Whether an increase is good. Spend going up is not. */
  deltaIsGood?: boolean | undefined;
  hint?: string | undefined;
  /**
   * What kind of number this is.
   *
   * Drives a single rule of colour along the top edge — and it is **not**
   * decoration, which the design system forbids. A tile whose count is
   * something somebody has to clear reads differently from one that is simply
   * a total, and at a glance across four tiles that difference is the only
   * thing the eye needs. `neutral` draws no rule at all, so a dashboard of
   * plain totals stays plain.
   */
  tone?: KpiTone | undefined;
}

const TONE_RULE: Readonly<Record<KpiTone, string>> = {
  neutral: 'bg-ink-200',
  accent: 'bg-[var(--color-cobalt-500)]',
  success: 'bg-[var(--color-success-text)]',
  warning: 'bg-[var(--color-warning-text)]',
  danger: 'bg-[var(--color-danger-text)]',
};

export function KpiCard({
  label,
  value,
  delta,
  deltaDirection = 'flat',
  deltaIsGood = true,
  hint,
  tone = 'neutral',
}: KpiCardProps): React.JSX.Element {
  const positive = deltaDirection === 'up' ? deltaIsGood : !deltaIsGood;

  const deltaTone =
    deltaDirection === 'flat'
      ? 'bg-ink-100 text-ink-600'
      : positive
        ? 'bg-[var(--color-success-fill)] text-[var(--color-success-text)]'
        : 'bg-[var(--color-danger-fill)] text-[var(--color-danger-text)]';

  return (
    <Card className="relative overflow-hidden p-4">
      {/* One hairline of colour, and only when the tone says the number is a
          kind of thing rather than just a total. */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-x-0 top-0 h-[3px]', TONE_RULE[tone])}
      />

      <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-500 uppercase">
        {label}
      </p>

      {/* Bigger, and tabular so a column of tiles does not jitter as figures
          change. This is the number people came to read. */}
      <p className="tabular mt-2.5 text-[26px] leading-8 font-semibold tracking-[-0.02em] text-ink-900">
        {value}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
              deltaTone,
            )}
          >
            {/* Arrow AND sign — direction is never carried by colour alone. */}
            <span aria-hidden="true">
              {deltaDirection === 'up' ? '↑' : deltaDirection === 'down' ? '↓' : '→'}
            </span>
            {delta}
          </span>
        )}
        {hint && <span className="text-[12px] text-ink-400">{hint}</span>}
      </div>
    </Card>
  );
}

// ── Budget meter ─────────────────────────────────────────────────────────

/**
 * Utilisation meter with semantic thresholds.
 *
 * `percent` is computed by the server. This renders it; it does not derive it
 * from an allocated/spent pair, because that would be arithmetic on money in
 * the browser.
 */
export function BudgetMeter({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}): React.JSX.Element {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const tone =
    percent > 100
      ? 'bg-[var(--color-danger-text)]'
      : percent >= 90
        ? 'bg-[var(--color-warning-text)]'
        : percent >= 75
          ? 'bg-[var(--color-chart-4)]'
          : 'bg-[var(--color-success-text)]';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
        role="meter"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Budget utilisation ${Math.round(percent)} percent`}
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${clamped}%` }} />
      </div>
      {/* The number is always present — the bar alone is not readable in
          greyscale or by a screen reader scanning a table. */}
      <span className="tabular w-10 shrink-0 text-right text-xs text-ink-600">
        {Math.round(percent)}%
      </span>
    </div>
  );
}
