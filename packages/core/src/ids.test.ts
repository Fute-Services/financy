import { describe, it, expect } from 'vitest';
import {
  generateId,
  newId,
  isValidId,
  idTimestamp,
  newCorrelationId,
  formatReference,
  type OrganizationId,
} from './ids.js';

describe('ids — UUID v7', () => {
  it('produces a syntactically valid uuid with version 7 and the RFC variant', () => {
    const id = generateId();
    expect(isValidId(id)).toBe(true);
    expect(id[14]).toBe('7'); // version nibble
    expect(['8', '9', 'a', 'b']).toContain(id[19]); // variant nibble
  });

  it('is unique across a large batch', () => {
    const ids = new Set(Array.from({ length: 20_000 }, generateId));
    expect(ids.size).toBe(20_000);
  });

  it('sorts chronologically as a string — the reason for v7 over v4', () => {
    // Lexicographic order must match creation order, so ids index like a
    // sequence and inserts stay at the right edge of the B-tree.
    const ids = Array.from({ length: 5_000 }, generateId);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('stays ordered within a single millisecond via the monotonic counter', () => {
    const ids: string[] = [];
    const start = Date.now();
    while (Date.now() === start && ids.length < 500) ids.push(generateId());
    expect(ids.length).toBeGreaterThan(1);
    expect([...ids].sort()).toEqual(ids);
  });

  it('embeds a recoverable creation timestamp', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();

    const timestamp = idTimestamp(id);
    expect(timestamp).not.toBeNull();
    expect(timestamp!.getTime()).toBeGreaterThanOrEqual(before);
    expect(timestamp!.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns null when asked for the timestamp of a non-v7 uuid', () => {
    expect(idTimestamp('550e8400-e29b-41d4-a716-446655440000')).toBeNull(); // v4
    expect(idTimestamp('not-a-uuid')).toBeNull();
  });

  it('rejects malformed ids', () => {
    for (const bad of ['', 'abc', '550e8400e29b41d4a716446655440000', '550e8400-e29b-41d4-a716']) {
      expect(isValidId(bad)).toBe(false);
    }
  });
});

describe('ids — branded types', () => {
  it('carries a brand at the type level while remaining a plain string at runtime', () => {
    const orgId = newId<OrganizationId>();
    expect(typeof orgId).toBe('string');
    expect(isValidId(orgId)).toBe(true);

    // The compile-time guarantee under test: a MembershipId cannot be passed
    // where an OrganizationId is expected. Swapping tenant identifiers is a
    // security bug that would otherwise type-check cleanly.
    const takesOrgId = (_id: OrganizationId): void => {};
    takesOrgId(orgId);
    // @ts-expect-error a bare string is not an OrganizationId
    takesOrgId('some-string');
  });
});

describe('ids — correlation ids', () => {
  it('generates unique v4 correlation ids', () => {
    const ids = new Set(Array.from({ length: 1_000 }, newCorrelationId));
    expect(ids.size).toBe(1_000);
    expect(isValidId([...ids][0] as string)).toBe(true);
  });
});

describe('ids — human-facing references', () => {
  it('formats a zero-padded, readable reference', () => {
    expect(formatReference('SR', 2026, 42)).toBe('SR-2026-0042');
    expect(formatReference('RB', 2026, 1)).toBe('RB-2026-0001');
    expect(formatReference('PO', 2026, 12345)).toBe('PO-2026-12345');
  });
});
