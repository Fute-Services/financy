import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type InvitationPreview,
  type Resource,
} from '@financy/contracts';

import { ApiError, apiFetch } from '@/lib/api';
import { AcceptForm } from './accept-form';

export const metadata: Metadata = { title: 'Accept invitation' };

/**
 * The invitation acceptance screen (task 1.7.6).
 *
 * Signed out, and reached only with a token — which *is* the authorisation:
 * it determines which organisation is being joined, so there is no session to
 * scope by and nothing a visitor without a token can learn.
 *
 * **The preview is fetched on the server before anything is rendered.** The
 * alternative — render a form, then discover on submit that the link is dead
 * — asks somebody to choose a password before telling them the invitation
 * expired. And the preview is what decides whether a password is asked for at
 * all: an address that already has an account must not be able to have its
 * password set by whoever holds an invitation to a different organisation.
 *
 * Every failure to resolve the token — unknown, spent, revoked, expired —
 * gets the same page, because the API answers all four with the same `404`.
 * Telling them apart would tell somebody guessing which guesses were close.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;

  let preview: InvitationPreview;

  try {
    // `forwardSession: false` — the token is the credential here, and a
    // visitor who happens to be signed in as somebody else must not have that
    // session influence what this page shows.
    const response = await apiFetch<Resource<InvitationPreview>>(
      `/auth/invitations/${encodeURIComponent(token)}`,
      { forwardSession: false },
    );

    preview = response.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return <DeadLink />;

    throw error;
  }

  return (
    <>
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">
          Join {preview.organizationName}
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          You have been invited as{' '}
          <strong className="text-ink-700">{ROLE_LABELS[preview.roleKey]}</strong>.{' '}
          {ROLE_DESCRIPTIONS[preview.roleKey]}
        </p>
      </div>

      <AcceptForm token={token} preview={preview} />

      <p className="mt-6 text-center text-[13px] text-ink-500">
        This link expires{' '}
        {new Date(preview.expiresAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
        })}
        , and works once.
      </p>
    </>
  );
}

/**
 * One page for every way a token can fail to resolve.
 *
 * It does not say which, because the API does not tell it — and would not,
 * for the same reason. What it does say is the thing the person can act on:
 * ask whoever invited them to send another.
 */
function DeadLink(): React.JSX.Element {
  return (
    <>
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">
          This invitation link does not work
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          It may have been used already, withdrawn, or simply expired — invitations last three days.
          Ask whoever invited you to send a new one.
        </p>
      </div>

      <Link
        href="/login"
        className="inline-flex h-[34px] items-center rounded-md border border-[var(--border-strong)] px-3.5 text-sm text-ink-700 hover:bg-ink-50"
      >
        Go to sign in
      </Link>
    </>
  );
}
