'use client';

import { useState } from 'react';

/**
 * The shared machinery behind the login and register forms.
 *
 * Both post to the same-origin proxy, both surface field-level errors from the
 * API's `422` envelope, and both hand off to the app on success. Keeping that
 * in one place matters because the *error* path is the part that gets tested
 * least and matters most — a login screen that swallows a server message is a
 * support ticket that starts "it just doesn't work".
 */

export interface AuthFieldErrors {
  [field: string]: string[] | undefined;
}

export function useAuthSubmit(action: 'login' | 'register') {
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});

  async function submit(payload: Record<string, unknown>): Promise<void> {
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch(`/api/auth/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        /**
         * A full navigation, not `router.push`.
         *
         * `refresh()` and `push()` race: the refresh invalidates the router
         * cache while the push is already fetching the next route, so the
         * navigation could resolve against the *logged-out* cache, bounce off
         * the layout's redirect, and land back here. That is why signing in
         * used to take two clicks — the second one worked because the first
         * had warmed the cache.
         *
         * The session cookie has just been set by the response above, and a
         * document navigation is the one thing guaranteed to read it. It costs
         * a page load, once, on a transition that re-renders the entire shell
         * with a new identity anyway.
         */
        window.location.assign('/overview');
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string; details?: { fields?: AuthFieldErrors } };
      } | null;

      setFieldErrors(body?.error?.details?.fields ?? {});
      setFormError(body?.error?.message ?? 'Something went wrong. Please try again.');
    } catch {
      // A network failure, not an API response. Saying so is more useful than
      // a generic message that makes the user doubt their password.
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return { submit, pending, formError, fieldErrors };
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  placeholder,
  hint,
  errors,
  required = true,
  defaultValue,
  value,
  readOnly = false,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  errors?: string[] | undefined;
  required?: boolean;
  defaultValue?: string;
  /**
   * A fixed value the person cannot change — the invitation's email address
   * is the only one today. Shown rather than hidden: they need to see which
   * address they are joining as, and a hidden field would leave them
   * guessing after clicking a link from an inbox they may share.
   */
  value?: string;
  readOnly?: boolean;
}): React.JSX.Element {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const invalid = errors !== undefined && errors.length > 0;

  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-[13px] font-medium text-ink-700">
        {label}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        {...(value === undefined ? { defaultValue } : { value, readOnly: true })}
        readOnly={readOnly || value !== undefined}
        aria-invalid={invalid}
        // Both are announced, so a screen reader hears the requirement and the
        // failure rather than only one of them.
        aria-describedby={[hint ? hintId : null, invalid ? errorId : null]
          .filter(Boolean)
          .join(' ')}
        className={[
          'h-10 w-full rounded-[var(--radius-sm)] border bg-white px-3 text-sm text-ink-900',
          'placeholder:text-ink-400',
          invalid ? 'border-danger-border' : 'border-[var(--border-default)]',
          // A read-only field looks read-only. Styling it like an editable
          // box invites people to try, and then to wonder what is broken.
          readOnly || value !== undefined ? 'bg-ink-50 text-ink-600' : '',
        ].join(' ')}
      />

      {hint && !invalid && (
        <p id={hintId} className="mt-1.5 text-[12px] text-ink-500">
          {hint}
        </p>
      )}

      {invalid && (
        <p id={errorId} className="mt-1.5 text-[12px] text-danger-text">
          {errors.join('. ')}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }): React.JSX.Element | null {
  if (message === null) return null;

  return (
    <p
      // `alert`, so the failure is announced rather than only rendered — a
      // keyboard user who submitted and heard nothing has no idea why the page
      // did not move.
      role="alert"
      className="rounded-[var(--radius-sm)] border border-danger-border bg-danger-fill px-3 py-2.5 text-[13px] text-danger-text"
    >
      {message}
    </p>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel,
}: {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel: string;
}): React.JSX.Element {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 w-full rounded-[var(--radius-sm)] bg-cobalt-600 text-sm font-medium text-white transition-colors hover:bg-cobalt-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * Read a text field from a form.
 *
 * `FormData.get` returns `string | File | null`, so `String(...)` on it would
 * stringify a `File` to `[object Object]` and post that as someone's password.
 * Narrowing here means every call site gets a string or an empty one.
 */
export function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}
