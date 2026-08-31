'use client';

import Link from 'next/link';

import { Field, FormError, SubmitButton, text, useAuthSubmit } from '@/components/auth-form';

/**
 * Sign in.
 *
 * Two things this screen deliberately does not do:
 *
 * - **It does not validate the password.** No length check, no strength meter.
 *   Applying the policy to an *attempt* rejects a guess before checking it,
 *   which tells the caller their guess was too short to be anybody's — and
 *   locks out every user whose password predates a rule change.
 * - **It does not distinguish "no such account" from "wrong password."** The
 *   API answers identically for both, and this screen shows exactly what it
 *   was told. Anything friendlier here would undo the defence.
 */
export default function LoginPage(): React.JSX.Element {
  const { submit, pending, formError, fieldErrors } = useAuthSubmit('login');

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    void submit({
      email: text(data, 'email'),
      password: text(data, 'password'),
    });
  }

  return (
    <>
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">Sign in</h1>
        <p className="mt-1.5 text-sm text-ink-500">Welcome back.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          errors={fieldErrors['email']}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          errors={fieldErrors['password']}
        />

        <SubmitButton pending={pending} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-[13px] text-ink-500">
        No account yet?{' '}
        <Link href="/register" className="font-medium text-cobalt-600 hover:underline">
          Create an organisation
        </Link>
      </p>
    </>
  );
}
