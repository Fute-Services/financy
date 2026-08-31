'use client';

import Link from 'next/link';

import { Field, FormError, SubmitButton, text, useAuthSubmit } from '@/components/auth-form';

/**
 * Create an organisation.
 *
 * One form, one transaction on the server: organisation, roles, user,
 * `ORG_ADMIN` membership, a default legal entity, and the category tree — all
 * of it or none of it. A half-registered organisation has no administrator,
 * so nobody can invite anyone, and there is no screen that repairs it.
 *
 * The password hint states the rule the server actually enforces: twelve
 * characters, and nothing about digits or symbols. Composition rules push
 * people towards `Password1!` and measurably lower entropy, so the field asks
 * for length instead and means it.
 */
export default function RegisterPage(): React.JSX.Element {
  const { submit, pending, formError, fieldErrors } = useAuthSubmit('register');

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    void submit({
      organizationName: text(data, 'organizationName'),
      fullName: text(data, 'fullName'),
      email: text(data, 'email'),
      password: text(data, 'password'),
      baseCurrency: text(data, 'baseCurrency') || 'USD',
      countryCode: text(data, 'countryCode') || 'US',
    });
  }

  return (
    <>
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">
          Create your organisation
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          You will be its first administrator. Everything else can be changed later.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />

        <Field
          label="Organisation name"
          name="organizationName"
          autoComplete="organization"
          placeholder="Acme Ltd"
          errors={fieldErrors['organizationName']}
        />

        <Field
          label="Your name"
          name="fullName"
          autoComplete="name"
          placeholder="Ada Lovelace"
          errors={fieldErrors['fullName']}
        />

        <Field
          label="Work email"
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
          autoComplete="new-password"
          hint="At least 12 characters. A memorable phrase beats a short, complicated one."
          errors={fieldErrors['password']}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Base currency"
            name="baseCurrency"
            placeholder="USD"
            defaultValue="USD"
            /* Locked once any financial record exists, so it is asked for now
               rather than buried in settings where it looks changeable. */
            hint="Locked once you record spend."
            errors={fieldErrors['baseCurrency']}
          />
          <Field
            label="Country"
            name="countryCode"
            placeholder="US"
            defaultValue="US"
            hint="Two-letter code."
            errors={fieldErrors['countryCode']}
          />
        </div>

        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create organisation
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-[13px] text-ink-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-cobalt-600 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
