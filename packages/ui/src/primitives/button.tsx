import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Button.
 *
 * Rules from docs/UI-DESIGN-SYSTEM.md §6.1:
 *  - One `primary` per view.
 *  - Labels are verb phrases ("Submit request"), never "OK".
 *  - A destructive action is never the primary in a form.
 *  - Loading keeps the label and the button's width, so the layout does not
 *    jump and the user can still read what they clicked.
 */

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-subtle'
  | 'link';

export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-cobalt-600 text-white hover:bg-cobalt-700 active:bg-cobalt-800 disabled:bg-ink-100 disabled:text-ink-400',
  secondary:
    'bg-[var(--surface-raised)] text-ink-700 border border-[var(--border-strong)] hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-400',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-400',
  danger:
    'bg-[var(--color-danger-text)] text-white hover:brightness-110 active:brightness-95 disabled:bg-ink-100 disabled:text-ink-400',
  'danger-subtle':
    'bg-[var(--color-danger-fill)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)] hover:brightness-97',
  link: 'bg-transparent text-cobalt-500 hover:text-cobalt-700 hover:underline p-0 h-auto',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-[13px] gap-1.5',
  md: 'h-[34px] px-3.5 text-sm gap-2',
  lg: 'h-10 px-4 text-[15px] gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // `aria-busy` matters: a screen reader user otherwise gets no signal
      // that the click was registered and is in flight.
      aria-busy={loading || undefined}
      disabled={disabled ?? loading}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-sm)] font-medium',
        'transition-colors duration-100 ease-out',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        variant !== 'link' && SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});

function Spinner(): React.JSX.Element {
  return (
    <svg
      className="size-3.5 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
