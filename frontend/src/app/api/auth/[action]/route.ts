import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE_URL } from '@/lib/api';

/**
 * A thin same-origin proxy for the three auth calls the browser has to make.
 *
 * The browser could call `:4100` directly — cookies ignore port and CORS is
 * configured for it — but this keeps the session cookie same-origin, which
 * means no preflight on the login path and one less origin inside the trust
 * boundary.
 *
 * **The proxy adds nothing and decides nothing.** It copies the request body
 * across, copies `Set-Cookie` back, and passes the status through untouched.
 * Every rule — the password policy, the identical answer for a wrong password
 * and an unknown account, the session lifetime — lives in the API and is
 * enforced there. If this file started making decisions, there would be two
 * places to check when authentication behaved unexpectedly, and one of them
 * would be wrong.
 */

/**
 * The upstream path each allowed action maps to.
 *
 * A map rather than a set, because invitation acceptance lives at
 * `/auth/invitations/accept` and interpolating the action name would either
 * miss it or require the browser to name a path — which is the pass-through
 * this allow-list exists to prevent.
 */
const ALLOWED_ACTIONS: Readonly<Record<string, string>> = {
  login: 'login',
  register: 'register',
  logout: 'logout',
  // Creates the session it runs under, which is why it is proxied at all: the
  // `Set-Cookie` has to reach the browser, and a server action's would land
  // on the server's own fetch.
  'accept-invitation': 'invitations/accept',
  // Rebinds the session cookie's active organisation. Proxied for the same
  // reason as the rest: the browser holds the cookie, and a server action's
  // fetch would send the server's own.
  'switch-organization': 'session/switch',
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await context.params;

  // An allow-list, not a pass-through. Without it this route would proxy any
  // path under `/v1/auth/` that a caller cared to name.
  const upstreamPath = ALLOWED_ACTIONS[action];

  if (upstreamPath === undefined) {
    return NextResponse.json(
      { error: { code: 'RESOURCE_NOT_FOUND', message: 'Not found.' } },
      { status: 404 },
    );
  }

  const body = action === 'logout' ? undefined : await request.text();

  const upstream = await fetch(`${API_BASE_URL}/v1/auth/${upstreamPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Logout needs the current session to know what to revoke.
      Cookie: request.headers.get('cookie') ?? '',
    },
    ...(body === undefined ? {} : { body }),
    cache: 'no-store',
  });

  const payload = upstream.status === 204 ? null : await upstream.text();

  const response = new NextResponse(payload, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });

  // `getSetCookie` rather than `get`: logout can send more than one, and
  // collapsing them into a comma-joined string produces a cookie the browser
  // silently ignores.
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append('Set-Cookie', cookie);
  }

  return response;
}
