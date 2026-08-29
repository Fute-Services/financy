import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Status badge.
 *
 * **Always carries a text label.** A colour-only indicator is not a status —
 * it fails for colour-blind users, in printed reports, and in greyscale
 * screenshots. The dot is decoration on top of the label, never instead of it.
 */

export type BadgeTone = 'neutral' | 'info' | 'pending' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-50 text-ink-600 border-ink-200',
  info: 'bg-[var(--color-info-fill)] text-[var(--color-info-text)] border-[var(--color-info-border)]',
  pending:
    'bg-[var(--color-pending-fill)] text-[var(--color-pending-text)] border-[var(--color-pending-border)]',
  success:
    'bg-[var(--color-success-fill)] text-[var(--color-success-text)] border-[var(--color-success-border)]',
  warning:
    'bg-[var(--color-warning-fill)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]',
  danger:
    'bg-[var(--color-danger-fill)] text-[var(--color-danger-text)] border-[var(--color-danger-border)]',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-[var(--radius-xs)] border px-2',
        'text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Maps a domain status to a tone, in one place.
 *
 * Centralised so that "approved" is the same green on every screen. Scattering
 * this mapping is how a status ends up green in one table and grey in another,
 * and users stop trusting the colour entirely.
 */
export function toneForStatus(status: string): BadgeTone {
  const key = status.toUpperCase();
  if (['APPROVED', 'REVIEWED', 'PAID', 'RECONCILED', 'ACTIVE', 'FULFILLED'].includes(key)) {
    return 'success';
  }
  if (['PENDING_APPROVAL', 'IN_REVIEW', 'PENDING', 'PROCESSING', 'SUBMITTED'].includes(key)) {
    return 'pending';
  }
  if (['NEEDS_RECEIPT', 'CHANGES_REQUESTED', 'ESCALATED', 'MISSING', 'REQUESTED'].includes(key)) {
    return 'warning';
  }
  if (['REJECTED', 'BLOCKED', 'FAILED', 'OVERSPENT', 'DECLINED', 'EXCEPTION'].includes(key)) {
    return 'danger';
  }
  if (['DRAFT', 'IMPORTED', 'UNREVIEWED', 'UNCODED'].includes(key)) return 'info';
  return 'neutral';
}

/** Renders an enum-shaped status as readable text: `PENDING_APPROVAL` → `Pending approval`. */
export function humanizeStatus(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface StatusBadgeProps extends Omit<BadgeProps, 'children' | 'tone'> {
  status: string;
}

export function StatusBadge({ status, ...rest }: StatusBadgeProps): React.JSX.Element {
  return (
    <Badge tone={toneForStatus(status)} dot {...rest}>
      {humanizeStatus(status)}
    </Badge>
  );
}
