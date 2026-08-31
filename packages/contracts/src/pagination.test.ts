import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorPaginationQuerySchema,
  decodeCursor,
  encodeCursor,
  offsetPaginationOf,
  offsetPaginationQuerySchema,
} from './pagination.js';

describe('cursor pagination query', () => {
  it('defaults the limit when absent', () => {
    expect(cursorPaginationQuerySchema.parse({}).limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('coerces the string a query string actually delivers', () => {
    expect(cursorPaginationQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  /**
   * Clamped, not rejected (docs/10 §2.5). A caller asking for more than we
   * serve has not made an error; they simply do not know the ceiling.
   */
  it('clamps an oversized limit instead of failing', () => {
    expect(cursorPaginationQuerySchema.parse({ limit: '10000' }).limit).toBe(MAX_PAGE_SIZE);
  });

  it('falls back to the default for nonsense rather than 500-ing later', () => {
    expect(cursorPaginationQuerySchema.parse({ limit: 'abc' }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(cursorPaginationQuerySchema.parse({ limit: '0' }).limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('rejects an unreasonably long cursor', () => {
    expect(cursorPaginationQuerySchema.safeParse({ cursor: 'x'.repeat(513) }).success).toBe(false);
  });
});

describe('offset pagination query', () => {
  it('defaults to the first page', () => {
    expect(offsetPaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('clamps the page size and floors the page number', () => {
    expect(offsetPaginationQuerySchema.parse({ page: '0', pageSize: '1000' })).toEqual({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
    });
  });
});

describe('cursors', () => {
  it('round-trips a payload', () => {
    const payload = { id: '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f', occurredAt: '2026-08-29' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('is base64url, so it survives a query string unescaped', () => {
    const cursor = encodeCursor({ note: 'aa?bb>>cc~~dd' });
    expect(cursor).not.toMatch(/[+/=]/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  it('returns null for a payload that is not an object', () => {
    expect(decodeCursor(encodeCursor([] as unknown as Record<string, unknown>))).toBeNull();
    expect(decodeCursor(Buffer.from('"a string"', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('null', 'utf8').toString('base64url'))).toBeNull();
  });

  it('returns null rather than throwing on a cursor we did not issue', () => {
    expect(decodeCursor('not base64 at all !!')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});

describe('offsetPaginationOf', () => {
  it('rounds the page count up', () => {
    expect(offsetPaginationOf(1, 50, 137)).toEqual({
      page: 1,
      pageSize: 50,
      totalCount: 137,
      totalPages: 3,
    });
  });

  it('reports zero pages for an empty collection', () => {
    expect(offsetPaginationOf(1, 50, 0).totalPages).toBe(0);
  });

  it('does not divide by zero', () => {
    expect(offsetPaginationOf(1, 0, 10).totalPages).toBe(0);
  });
});
