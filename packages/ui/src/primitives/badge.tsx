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

/**
 * Fill, text, and an inset ring — the ring rather than a border so the chip's
 * height is the same whether or not a tone happens to define one, and so it
 * never adds a pixel to a table row's rhythm.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-50 text-ink-600 ring-ink-200/70',
  info: 'bg-[var(--color-info-fill)] text-[var(--color-info-text)] ring-[var(--color-info-border)]/60',
  pending:
    'bg-[var(--color-pending-fill)] text-[var(--color-pending-text)] ring-[var(--color-pending-border)]/60',
  success:
    'bg-[var(--color-success-fill)] text-[var(--color-success-text)] ring-[var(--color-success-border)]/60',
  warning:
    'bg-[var(--color-warning-fill)] text-[var(--color-warning-text)] ring-[var(--color-warning-border)]/60',
  danger:
    'bg-[var(--color-danger-fill)] text-[var(--color-danger-text)] ring-[var(--color-danger-border)]/60',
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
        /**
         * A pill, and the shape is doing real work.
         *
         * This was a 3px-radius rectangle with a 1px border — which is exactly
         * the shape of the outline button two columns over. On a table row
         * where "Active", "Posted" and "Change role" sit side by side, a
         * reader cannot tell from the shape which of the three they are meant
         * to click, and two of them are not clickable at all.
         *
         * A fully rounded, borderless chip is not decoration: rectangles with
         * borders read as controls, pills read as labels. The tone's fill and
         * text still carry the meaning, and the inset ring keeps the edge
         * legible on a tinted row without reintroducing a button's crispness.
         */
        'inline-flex h-5 items-center gap-1.5 rounded-full px-2',
        'text-xs font-medium whitespace-nowrap',
        'ring-1 ring-inset',
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
  /**
   * Overrides the humanised enum.
   *
   * `humanizeStatus` turns `INACTIVE` into "Inactive", which is right for most
   * states and wrong for that one: "inactive" reads as "has not logged in
   * lately", while a deactivated member has been signed out of every device
   * and cannot get back in. Where a domain has chosen its own word — the
   * membership catalogue says "Deactivated" — that word wins, and passing it
   * here keeps the tone and the dot without a second badge component.
   */
  label?: string | undefined;
}

export function StatusBadge({ status, label, ...rest }: StatusBadgeProps): React.JSX.Element {
  return (
    <Badge tone={toneForStatus(status)} dot {...rest}>
      {label ?? humanizeStatus(status)}
    </Badge>
  );
}
