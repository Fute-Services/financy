import 'server-only';

import { cache } from 'react';

import type { SessionResponse } from '@financy/contracts';

import { ApiError, apiFetch } from './api';

/**
 * The caller's session, from the API.
 *
 * `GET /v1/auth/session` returns the user, the active membership, and the
 * **server-resolved** permission set — resolved from what was actually granted
 * in the database, not from the constant in `@financy/contracts`. If the two
 * ever drift, the UI follows the database, which is the runtime authority.
 *
 * `server-only` at the top is load-bearing: this module reads the `httpOnly`
 * session cookie, and importing it into a client component would be a build
 * error rather than a subtle leak.
 *
 * Nothing here is a security boundary. The permission set decides what is
 * *rendered*; every endpoint re-checks independently, and the API suite proves
 * each denial without involving the frontend at all (docs/03 §7).
 */

/**
 * The session as the UI wants it: identical to the wire shape except that
 * `permissions` is a Set. A Set cannot cross the server/client boundary, so
 * the array is what travels and `SessionProvider` rebuilds it.
 */
export type Session = Omit<SessionResponse, 'permissions'> & {
  permissions: ReadonlySet<string>;
};

/**
 * Whether the caller holds a permission.
 *
 * Accepts either shape, because a server component has the array and a client
 * component has the Set, and making every call site know which it holds is how
 * one of them ends up checking the wrong thing.
 *
 * Rendering only. Never a control — the endpoint decides.
 */
export function can(
  session: { permissions: readonly string[] | ReadonlySet<string> },
  permission: string,
): boolean {
  const granted = session.permissions;

  return granted instanceof Set
    ? granted.has(permission)
    : (granted as readonly string[]).includes(permission);
}

/**
 * Returns `null` when there is no valid session, rather than throwing.
 *
 * Not being signed in is an ordinary state — it is most of the internet — and
 * the layout's response to it is a redirect, not an error page.
 */
/**
 * Returns the wire shape, not the Set-bearing one. It is passed straight into
 * a client component, and a Set does not survive serialisation — returning one
 * here produced an empty permission set in the browser with no error anywhere.
 */
/**
 * Wrapped in `cache`, which dedupes it **within a single render pass**.
 *
 * The layout asks for the session, and then every page under it asks again to
 * check a permission — so each render was making the same request two or three
 * times over. `cache` collapses those into one call and shares the result.
 *
 * It is not a cross-request cache and deliberately so: the memo lasts exactly
 * as long as the render, so a signed-out or role-changed user is never served
 * a stale session. Nothing about revocation changes.
 */
export const getSession = cache(async (): Promise<SessionResponse | null> => {
  try {
    return await apiFetch<SessionResponse>('/auth/session');
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }

    // Anything else — the API being down, a 500 — is a real failure and must
    // not be silently rendered as "signed out". That would send a signed-in
    // user to the login screen and make an outage look like a session bug.
    throw error;
  }
});
