'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Form fields.
 *
 * Rules from docs/UI-DESIGN-SYSTEM.md §6.2, and one that is not in it:
 *
 * **The error message lives under the input, and the input is marked
 * invalid.** A banner at the top of a form saying "there were problems" makes
 * the reader hunt; an error under the box they typed in tells them where to
 * look without looking. `aria-describedby` and `aria-invalid` carry the same
 * information to a screen reader, so the two audiences get the same answer
 * rather than the sighted one getting a better one.
 *
 * **A disabled field explains itself.** A greyed-out box with no reason is
 * indistinguishable from a broken one — which is why `hint` exists and why
 * the base currency's lock travels in the API payload rather than being
 * inferred.
 *
 * **The DOM id comes from `useId()`, not from `name`.** Using the name read
 * better and was wrong the first time a page held two forms: the settings
 * screen has an organisation form, an entity dialog, and a department dialog,
 * and all three had a field called `name`. Three elements sharing an id is
 * invalid HTML, and the visible symptom is worse than the invalidity —
 * `<label for>` binds to whichever came first, so clicking a label focuses a
 * box in a different form and a screen reader announces the wrong field. A
 * generated id cannot collide, and `name` still decides what is submitted.
 *
 * That is also why this module is a client component: `useId` is a hook. The
 * consequence for tests is a good one — they select by label, which is what
 * the association exists for.
 */

export interface FieldShellProps {
  label: string;
  htmlFor: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children: React.ReactNode;
}

export function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
}: FieldShellProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-700">
        {label}
        {required ? (
          <span className="ml-1 text-[var(--color-danger-text)]" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children}

      {/* The hint disappears once there is an error: two lines of guidance
          under one box is one line too many, and the error is the one that
          needs reading now. */}
      {error !== undefined ? (
        <p id={`${htmlFor}-error`} className="text-[13px] text-[var(--color-danger-text)]">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${htmlFor}-hint`} className="text-[13px] text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-md border bg-[var(--surface-raised)] px-3 text-sm text-ink-800 ' +
  'placeholder:text-ink-400 transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-cobalt-500/30 focus:border-cobalt-500 ' +
  'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400';

function controlClass(invalid: boolean, extra?: string): string {
  return cn(
    CONTROL_BASE,
    invalid
      ? 'border-[var(--color-danger-border)] focus:border-[var(--color-danger-text)] focus:ring-[var(--color-danger-text)]/20'
      : 'border-[var(--border-strong)]',
    extra,
  );
}

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'id' | 'name'
> {
  name: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Input({
  name,
  label,
  hint,
  error,
  required,
  className,
  ...rest
}: InputProps): React.JSX.Element {
  const id = React.useId();
  const invalid = error !== undefined;

  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <input
        id={id}
        name={name}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined}
        className={controlClass(invalid, cn('h-[34px]', className))}
        {...rest}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'name'
> {
  name: string;
  label: string;
  options: readonly SelectOption[];
  hint?: string | undefined;
  error?: string | undefined;
  /** Rendered as a disabled first option, so "nothing chosen" is visible. */
  placeholder?: string | undefined;
}

export function Select({
  name,
  label,
  options,
  hint,
  error,
  required,
  placeholder,
  className,
  ...rest
}: SelectProps): React.JSX.Element {
  const id = React.useId();
  const invalid = error !== undefined;

  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <select
        id={id}
        name={name}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined}
        className={controlClass(invalid, cn('h-[34px]', className))}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export interface TextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'name'
> {
  name: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Textarea({
  name,
  label,
  hint,
  error,
  required,
  className,
  rows = 3,
  ...rest
}: TextareaProps): React.JSX.Element {
  const id = React.useId();
  const invalid = error !== undefined;

  return (
    <FieldShell label={label} htmlFor={id} hint={hint} error={error} required={required}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined}
        className={controlClass(invalid, cn('py-2 leading-relaxed', className))}
        {...rest}
      />
    </FieldShell>
  );
}

/**
 * The form-level message, for failures that belong to no single field.
 *
 * A stale `If-Match` is the archetype: nothing the person typed is wrong, and
 * pointing at a field would be a lie. `role="alert"` so it is announced when
 * it appears rather than only when focus happens to reach it.
 */
export function FormMessage({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'success';
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md border px-3 py-2 text-[13px]',
        tone === 'danger'
          ? 'border-[var(--color-danger-border)] bg-[var(--color-danger-fill)] text-[var(--color-danger-text)]'
          : 'border-[var(--color-success-border)] bg-[var(--color-success-fill)] text-[var(--color-success-text)]',
      )}
    >
      {children}
    </p>
  );
}
