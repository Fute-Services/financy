/**
 * Pagination.
 *
 * Two strategies, chosen per endpoint and never mixed within one
 * (docs/10 §2.5):
 *
 * - **Cursor** for large or append-heavy collections — transactions, audit
 *   events, notifications. Stable under concurrent inserts, which offset
 *   pagination is not: a row inserted at the head shifts every later page and
 *   silently hides a record from whoever is reading page two.
 * - **Offset** for small bounded collections — departments, entities, roles —
 *   where a total count and page numbers are worth more than stability.
 *
 * There is no unpaginated list endpoint anywhere in the API.
 */

import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * `limit` above the maximum is **clamped, not rejected** (docs/10 §2.5).
 *
 * Rejecting would fail a caller who asked for more data than we serve, which
 * is not an error on their part — they simply do not know our ceiling. Every
 * response reports the `limit` actually applied, so nobody has to guess.
 */
const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .catch(DEFAULT_PAGE_SIZE)
  .transform((value) => Math.min(value, MAX_PAGE_SIZE))
  .default(DEFAULT_PAGE_SIZE);

export const cursorPaginationQuerySchema = z.object({
  limit: limitSchema,
  cursor: z.string().min(1).max(512).optional(),
});

export const offsetPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: limitSchema,
});

export const cursorPaginationSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.int(),
});

export const offsetPaginationSchema = z.object({
  page: z.int(),
  pageSize: z.int(),
  totalCount: z.int(),
  totalPages: z.int(),
});

export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;
export type OffsetPaginationQuery = z.infer<typeof offsetPaginationQuerySchema>;
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
export type OffsetPagination = z.infer<typeof offsetPaginationSchema>;

/**
 * Cursors are opaque to the client on purpose.
 *
 * base64url-encoded JSON, not a bare id: it keeps the encoding free to gain a
 * sort key or a tiebreaker later without changing the contract, and it stops
 * callers building cursors by hand and depending on an internal detail.
 */
/**
 * base64url, without `Buffer`.
 *
 * This package is imported by `frontend` as well as `backend` — it is the
 * shared contract, so every module in it has to run in both. `Buffer` is a
 * Node global; reaching for it here fails the browser build as soon as
 * anything pulls in this module, even though the cursor itself is only ever
 * produced and consumed by the server.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Decode a cursor, returning `null` when it is not one we produced.
 *
 * A malformed cursor is a `422` decided by the caller of this function, never
 * a thrown `SyntaxError` surfacing as a `500`.
 */
export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor)));
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;
    return decoded as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function offsetPaginationOf(
  page: number,
  pageSize: number,
  totalCount: number,
): OffsetPagination {
  return {
    page,
    pageSize,
    totalCount,
    totalPages: pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0,
  };
}
