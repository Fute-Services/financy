import { cookies } from 'next/headers';

/**
 * The server-side API client.
 *
 * Every call to the API goes through the Next server, never from the browser
 * directly. That is a deliberate choice, not an accident of rendering:
 *
 * - The session cookie is `httpOnly`, so browser JavaScript cannot read it —
 *   which is the property that removes the XSS token-theft class entirely.
 *   Calling the API from the browser would work (cookies ignore port, and CORS
 *   is configured), but it puts a second origin in the trust boundary for no
 *   gain.
 * - Same-origin means no preflight on every request, and no CORS
 *   misconfiguration to get wrong later.
 * - A page can render with data already in it, rather than flashing a skeleton
 *   while the browser makes the round trip the server could have made.
 *
 * `ApiError` carries the code from the error envelope, so a caller branches on
 * `UNAUTHENTICATED` rather than on a status it inferred.
 */

const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:4100';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: { fields?: Record<string, string[]> };
  };
}

/**
 * Call the API with the caller's session attached.
 *
 * `cache: 'no-store'` on everything. This is a financial application: a cached
 * approval queue or a cached balance is a figure someone acts on that is no
 * longer true, and Next's default is to cache aggressively.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { forwardSession?: boolean } = {},
): Promise<T> {
  const { forwardSession = true, ...requestInit } = init;

  const headers = new Headers(requestInit.headers);
  headers.set('Accept', 'application/json');

  if (forwardSession) {
    const jar = await cookies();
    const cookieHeader = jar
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');

    if (cookieHeader !== '') headers.set('Cookie', cookieHeader);
  }

  const response = await fetch(`${API_BASE_URL}/v1${path}`, {
    ...requestInit,
    headers,
    cache: 'no-store',
  });

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = body as ErrorEnvelope | null;

    throw new ApiError(
      response.status,
      envelope?.error.code ?? 'INTERNAL_ERROR',
      envelope?.error.message ?? 'Something went wrong.',
      envelope?.error.details?.fields,
    );
  }

  return body as T;
}

export { API_BASE_URL };
