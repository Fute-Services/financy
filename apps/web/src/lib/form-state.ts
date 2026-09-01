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
}

export const IDLE: FormState = { status: 'idle' };
