import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE_URL } from '@/lib/api';

/**
 * A same-origin proxy for the audit export.
 *
 * The export is a **file download**, which is why it is a route rather than a
 * server action: the browser has to receive the response itself, with its
 * `Content-Type` and `Content-Disposition` intact, so that its own download
 * handling applies. A server action would hand the bytes to the server's
 * fetch and leave the client reconstructing a blob — which loses progress on
 * a large file and puts a copy of the whole export in memory.
 *
 * Same-origin so the session cookie travels without CORS, exactly as the auth
 * proxy does.
 *
 * **It decides nothing.** The permission (`audit_event:export`), the row cap,
 * the self-auditing event, and the CSV escaping all live in the API. This
 * copies a query string across and copies a response back; a refusal arrives
 * as the API's own status and envelope.
 */

/** The parameters the export endpoint's strict schema names. Nothing else. */
const ALLOWED = new Set([
  'action',
  'resourceType',
  'resourceId',
  'actorType',
  'actorMembershipId',
  'from',
  'before',
  'format',
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = new URLSearchParams();

  // An allow-list, not a pass-through. The endpoint's schema is strict, so an
  // unrecognised parameter is a 422 — but forwarding whatever arrived would
  // also let a caller reach query parameters this screen never offers.
  for (const [key, value] of request.nextUrl.searchParams) {
    if (ALLOWED.has(key) && value !== '') query.set(key, value);
  }

  const upstream = await fetch(`${API_BASE_URL}/v1/audit-events/export?${query.toString()}`, {
    headers: {
      Accept: 'text/csv, application/json',
      Cookie: request.headers.get('cookie') ?? '',
    },
    cache: 'no-store',
  });

  const body = await upstream.text();

  if (!upstream.ok) {
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      // Passed through rather than re-derived. `attachment` in particular is
      // the API's decision: an audit export rendered inline in a browser is a
      // document from an untrusted source displayed by a trusting viewer.
      'Content-Type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition':
        upstream.headers.get('content-disposition') ?? 'attachment; filename="audit.csv"',
      // Kept so a caller can tell a complete export from one that hit the
      // ceiling without counting the lines themselves.
      ...(upstream.headers.get('x-row-count') === null
        ? {}
        : { 'X-Row-Count': upstream.headers.get('x-row-count') ?? '' }),
      ...(upstream.headers.get('x-truncated') === null
        ? {}
        : { 'X-Truncated': upstream.headers.get('x-truncated') ?? '' }),
    },
  });
}
