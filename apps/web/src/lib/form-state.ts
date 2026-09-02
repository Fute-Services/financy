/**
 * The shape every form on this app gets back from a server action.
 *
 * **Deliberately in its own module, with no `server-only` and no imports.**
 * A client component needs the type and the initial value to call
 * `useActionState`, and `lib/actions` cannot supply them: it imports
 * `next/cache` and marks itself server-only, so importing `IDLE` from there
 * pulled `revalidatePath` into the browser bundle and failed the build. That
 * failure was the useful kind — the alternative to splitting this out would
 * have been dropping `server-only`, which is the thing stopping the API
 * client and its session cookie from reaching the browser.
 *
 * Three failure states are distinguished, and the distinction is what the UI
 * needs:
 *
 * - `fields` — the API named a field. The message goes under that input.
 * - `message` — the API refused for a reason belonging to no field. A stale
 *   `If-Match` is the archetype: nothing typed is wrong, and pointing at an
 *   input would be a lie.
 * - `conflict` — specifically a lost race, so the UI can offer a reload
 *   rather than a retry. Retrying with the same stale version fails
 *   identically, and the person needs to see what changed first.
 */
export interface FormState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fields?: Record<string, string[]>;
  /** `STALE_VERSION`. Offer a reload, not a retry. */
  conflict?: boolean;
  /**
   * A one-time link the write produced, shown once and never recoverable.
   *
   * Only invitations use it. The acceptance token exists in exactly two
   * responses — the create and the resend — and is stored as a hash, so if
   * the inviter does not see it here they cannot get it back and must issue
   * a new invitation. That is why the dialog stays open on success instead of
   * closing like every other one.
   */
  link?: string;
  /**
   * The id of the record the write created.
   *
   * For the creates whose natural next step is the thing just created — a
   * policy that needs rules, a spend request that needs submitting. The dialog
   * navigates rather than closing back to a list where the person then has to
   * find the row they made a second ago.
   */
  createdId?: string;
  /**
   * The API's own error code, for the few forms whose next step depends on
   * *which* refusal this was.
   *
   * Most do not need it — the API writes a message for a person and the form
   * shows it. The exception is a refusal a person can legitimately override:
   * adding a supplier that looks like a duplicate is a decision only they can
   * make, and the form can only offer it if it knows that is what happened.
   */
  code?: string;
}

export const IDLE: FormState = { status: 'idle' };
