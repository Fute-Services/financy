'use server';

import type {
  Invitation,
  IssuedInvitation,
  MembershipDetail,
  Resource,
  StepUpResponse,
} from '@financy/contracts';

import { apiFetch } from '@/lib/api';
import {
  create,
  optional,
  runWrite,
  text,
  version,
  writeWithVersion,
  type FormState,
} from '@/lib/actions';

/**
 * The people screen's writes.
 *
 * Two of these are unlike anything on the settings screen, and both
 * differences come from the API rather than from the UI.
 *
 * **A role change needs step-up.** The API answers `403 STEP_UP_REQUIRED`
 * until the caller has re-proved their password within the window, so the
 * form asks for it and posts both in one submission. Doing it as two visible
 * steps — "confirm your password", then "now pick a role" — would leave a
 * window in which the person is stepped up and has not yet decided, which is
 * exactly the state step-up exists to avoid.
 *
 * **An invitation returns a token, once.** It is shown to the inviter so they
 * can pass the link on, because the alternative is an invitation that is
 * silently dead whenever mail delivery fails. It is never stored client-side
 * and never appears again.
 */

const PEOPLE = '/people';

export async function inviteMember(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    [PEOPLE],
    () =>
      create<Resource<IssuedInvitation>>('/memberships/invitations', {
        email: optional(form, 'email'),
        roleKey: optional(form, 'roleKey'),
        departmentId: optional(form, 'departmentId') ?? null,
      }),
    'Invitation sent.',
  );
}

export async function revokeInvitation(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [PEOPLE],
    () => apiFetch<Resource<Invitation>>(`/memberships/invitations/${id}`, { method: 'DELETE' }),
    'Invitation revoked.',
  );
}

export async function resendInvitation(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [PEOPLE],
    () =>
      apiFetch<Resource<IssuedInvitation>>(`/memberships/invitations/${id}/resend`, {
        method: 'POST',
      }),
    'A fresh invitation link has been issued; the previous one no longer works.',
  );
}

/**
 * Change a role, stepping up first.
 *
 * The step-up and the change are one submission from the person's point of
 * view and two calls underneath. If the password is wrong, the step-up fails
 * and the role change never runs — which is the correct order: a failed
 * password must not leave a partially applied privilege change behind.
 */
export async function changeRole(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const password = text(form, 'password');

  return runWrite(
    [PEOPLE],
    async () => {
      await create<StepUpResponse>('/auth/step-up', { password });

      return writeWithVersion<Resource<MembershipDetail>>(
        `/memberships/${id}/role`,
        'POST',
        version(form),
        { roleKey: optional(form, 'roleKey'), reason: optional(form, 'reason') },
      );
    },
    'Role changed.',
  );
}

export async function deactivateMember(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [PEOPLE],
    () =>
      writeWithVersion<Resource<MembershipDetail>>(
        `/memberships/${id}/deactivate`,
        'POST',
        version(form),
        { reason: optional(form, 'reason') },
      ),
    'Member deactivated, and every session behind their account revoked.',
  );
}

export async function reactivateMember(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [PEOPLE],
    () =>
      writeWithVersion<Resource<MembershipDetail>>(
        `/memberships/${id}/reactivate`,
        'POST',
        version(form),
      ),
    'Member reactivated.',
  );
}
