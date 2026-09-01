'use server';

import type { Delegation, Resource } from '@financy/contracts';

import { apiFetch } from '@/lib/api';
import { create, optional, runWrite, text, version, type FormState } from '@/lib/actions';

/**
 * The approval screen's writes.
 *
 * **Every path revalidates three routes**, and it has to: acting on a step
 * empties a row from the queue, changes the request's status on its own page,
 * and moves it in the spend list. Revalidating only the queue leaves the other
 * two rendering from a cache taken before the decision — which looks exactly
 * like the click having been ignored.
 *
 * The comment is validated by the API, which returns it keyed to the `comment`
 * field, so a rejection without a reason puts its message under the box rather
 * than in a banner.
 */

const PATHS = ['/approvals', '/spend'];

export async function actOnApproval(_previous: FormState, form: FormData): Promise<FormState> {
  const instanceId = text(form, 'instanceId');
  const action = text(form, 'action');

  return runWrite(
    [...PATHS, `/spend/${optional(form, 'subjectId') ?? ''}`],
    () =>
      create<Resource<{ settled: boolean; outcome: string | null }>>(
        `/approvals/${instanceId}/act`,
        { action, comment: optional(form, 'comment') ?? null },
      ),
    SUCCESS_MESSAGES[action] ?? 'Recorded.',
  );
}

/**
 * What to say afterwards, per action.
 *
 * Each says what happened *to the request*, not what happened to the step. The
 * person who pressed the button is deciding somebody's spend; "step approved"
 * describes the machinery, and "it still needs one more approval" describes
 * the thing they care about.
 */
const SUCCESS_MESSAGES: Readonly<Record<string, string>> = {
  APPROVE: 'Approved. If the chain has further steps, it has moved to the next one.',
  REJECT: 'Rejected. The chain is closed and nobody else is asked.',
  RETURN: 'Sent back. The requester can edit it and submit again.',
  OVERRIDE: 'Overridden. This is recorded as an override, not as an approval.',
};

export async function createDelegation(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    ['/approvals'],
    () =>
      create<Resource<Delegation>>('/approvals/delegations', {
        ...(optional(form, 'fromMembershipId') === undefined
          ? {}
          : { fromMembershipId: optional(form, 'fromMembershipId') }),
        toMembershipId: optional(form, 'toMembershipId'),
        // A date input gives a calendar day; the contract wants an instant.
        // Anchored to UTC midnight deliberately and consistently — anchoring
        // to the browser's midnight would make the same choice mean a
        // different moment depending on where the person happens to be.
        startsAt: toInstant(optional(form, 'startsAt'), '00:00:00'),
        endsAt: toInstant(optional(form, 'endsAt'), '23:59:59'),
        reason: optional(form, 'reason') ?? null,
      }),
    'Delegated. Chains opening in that window will go to them instead.',
  );
}

export async function revokeDelegation(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    ['/approvals'],
    () =>
      apiFetch<Resource<Delegation>>(`/approvals/delegations/${id}`, {
        method: 'DELETE',
        headers: { 'If-Match': String(version(form)) },
      }),
    'Revoked. It no longer applies to chains opening from now on.',
  );
}

function toInstant(day: string | undefined, time: string): string {
  if (day === undefined) return new Date().toISOString();

  // `.000Z` rather than a local offset: the stored instant must not depend on
  // where the process or the browser happens to be.
  return `${day}T${time}.000Z`;
}
