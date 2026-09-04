'use server';

import type { LeadReceipt, Resource } from '@financy/contracts';

import { toFormState, optional, type FormState } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

/**
 * A required field, as whatever the person typed.
 *
 * Deliberately not `text()` from `lib/actions`, which throws on a blank one.
 * That is the right behaviour for an app form, where a missing field means the
 * form itself is broken — but here a blank box is the most ordinary thing a
 * visitor can do, and it should come back as "Full name is required" under the
 * input rather than as the network-failure message a thrown `Error` produces.
 * Sending the empty string lets `createLeadSchema` name the field instead.
 */
function required(form: FormData, name: string): string {
  const value = form.get(name);

  return typeof value === 'string' ? value : '';
}

/**
 * Submit the demo request.
 *
 * Not `runWrite`, which every other write in this app goes through. Two of the
 * three things it does are wrong here:
 *
 *  - It revalidates paths on success. Nothing on the public site renders a
 *    lead, so there is no cache entry that has gone stale.
 *  - It returns the API's success message. The API has none to return — the
 *    response is the constant `{ received: true }` — so the message a person
 *    reads is written here, next to the form that shows it.
 *
 * The third thing it does — turning any failure into a `FormState` — is what
 * matters, and `toFormState` is imported directly for it. That keeps "what
 * does the user see when the server says no" answered in one place, including
 * for the two refusals this endpoint has of its own: a `422` naming a field,
 * and a `429` when somebody submits four times in an hour.
 */
export async function submitDemoRequest(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await apiFetch<Resource<LeadReceipt>>('/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: required(form, 'name'),
        email: required(form, 'email'),
        company: required(form, 'company'),
        teamSize: optional(form, 'teamSize'),
        brief: optional(form, 'brief'),
      }),
      /**
       * The one call in this application that sends no cookies.
       *
       * A signed-in person browsing the marketing site would otherwise attach
       * their session to an anonymous form post — pointlessly, since the route
       * is `@Public()` and reads nothing from it, and harmfully, because it
       * puts a live session token in a request that did not need one.
       */
      forwardSession: false,
    });
  } catch (error) {
    return toFormState(error);
  }

  return {
    status: 'success',
    message: 'Thanks — that reached us. Someone will reply within one working day.',
  };
}
