'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { InvitationPreview } from '@financy/contracts';

import { Field, FormError, SubmitButton, text } from '@/components/auth-form';

/**
 * Accepting an invitation.
 *
 * It posts to the same-origin proxy rather than to a server action, because
 * the response carries a `Set-Cookie` that has to reach the browser: this is
 * the one write in the application that *creates* the session it runs under.
 * A server action would have the cookie land on the server's fetch and never
 * on the visitor.
 *
 * **The password fields appear only when the address has no account.** The
 * preview says which, and the API refuses a password for an address that
 * already has one — without that refusal, "invite a colleague" would be a way
 * to set the password of an account somebody else controls. Rendering the
 * fields anyway and hoping the person leaves them blank would turn a security
 * property into a matter of etiquette.
 */
export function AcceptForm({
  token,
  preview,
}: {
  token: string;
  preview: InvitationPreview;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const data = new FormData(event.currentTarget);

    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          ...(preview.requiresPassword
            ? { fullName: text(data, 'fullName'), password: text(data, 'password') }
            : {}),
        }),
      });

      if (response.ok) {
        // `refresh()` before `push()`: the shell reads the session on the
        // server, and without it Next serves the cached signed-out render.
        router.refresh();
        router.push('/overview');
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string; details?: { fields?: Record<string, string[]> } };
      } | null;

      setFieldErrors(body?.error?.details?.fields ?? {});
      setFormError(body?.error?.message ?? 'Something went wrong. Please try again.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-4"
      noValidate
    >
      <FormError message={formError} />

      <Field
        label="Email"
        name="email"
        type="email"
        value={preview.email}
        readOnly
        hint="The invitation was sent to this address and cannot be redirected."
      />

      {preview.requiresPassword ? (
        <>
          <Field
            label="Your name"
            name="fullName"
            autoComplete="name"
            placeholder="Ada Lovelace"
            errors={fieldErrors['fullName']}
          />

          <Field
            label="Choose a password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters. Length beats symbols."
            errors={fieldErrors['password']}
          />
        </>
      ) : (
        <p className="rounded-md border border-[var(--border-subtle)] bg-ink-50/50 px-3 py-2 text-[13px] text-ink-600">
          You already have a Financy account for this address. Accepting adds this organisation to
          it — your existing password is unchanged.
        </p>
      )}

      <SubmitButton
        pending={pending}
        pendingLabel={preview.requiresPassword ? 'Creating your account…' : 'Joining…'}
      >
        {preview.requiresPassword ? 'Create account and join' : 'Join organisation'}
      </SubmitButton>
    </form>
  );
}
