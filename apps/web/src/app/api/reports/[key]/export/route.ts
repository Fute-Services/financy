import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE_URL } from '@/lib/api';

/**
 * A same-origin proxy for a report export.
 *
 * The same shape as the audit export, and for the same reason: a download has
 * to reach the browser as a response, with its `Content-Type` and
 * `Content-Disposition` intact, so the browser's own download handling
 * applies. A server action would hand the bytes to the server's fetch and leave
 * the client rebuilding a blob in memory.
 *
 * **It decides nothing.** The permission (`report:export`), the scope
 * intersection, the audit event that records the exact filter set, and the
 * formula escaping all live in the API. This copies a query string across and
 * copies a response back.
 */

/** The parameters the report filter schema names. Nothing else. */
const ALLOWED = new Set([
  'datePreset',
  'dateFrom',
  'dateTo',
  'entityIds',
  'departmentIds',
  'memberIds',
  'categoryIds',
  'projectIds',
  'paymentMethods',
  'currencyMode',
  'currency',
  'interval',
  'amountMin',
  'amountMax',
  'q',
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const { key } = await params;

  // An allow-list, not a pass-through: the filter schema is strict, so an
  // unrecognised parameter is a 422, and forwarding whatever arrived would let
  // a caller reach parameters this screen never offers.
  const query = new URLSearchParams();

  for (const [name, value] of request.nextUrl.searchParams) {
    if (ALLOWED.has(name) && value !== '') query.set(name, value);
  }

  // The key is a path segment, so it is encoded rather than interpolated: it
  // arrives from the URL and the API answers 404 for anything not in its
  // catalogue.
  const upstream = await fetch(
    `${API_BASE_URL}/v1/reports/${encodeURIComponent(key)}/export?${query.toString()}`,
    {
      headers: {
        Accept: 'text/csv, application/json',
        Cookie: request.headers.get('cookie') ?? '',
      },
      cache: 'no-store',
    },
  );

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
      'Content-Type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      // `attachment` is the API's decision and is passed through: a CSV
      // rendered inline is a document from an untrusted source displayed by a
      // trusting viewer.
      'Content-Disposition':
        upstream.headers.get('content-disposition') ??
        `attachment; filename="${encodeURIComponent(key)}.csv"`,
    },
  });
}
