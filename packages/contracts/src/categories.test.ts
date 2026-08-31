import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CATEGORIES,
  UNCATEGORISED_CATEGORY_KEY,
  flattenCategories,
  type CategoryTemplate,
} from './categories.js';

describe('the default tree', () => {
  const flat = flattenCategories();

  it('has unique keys throughout', () => {
    const keys = flat.map((row) => row.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);

    expect(duplicates, `Duplicate category keys: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('uses snake_case keys, which the seed writes verbatim', () => {
    for (const row of flat) {
      expect(row.key, row.key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('names every category', () => {
    for (const row of flat) {
      expect(row.name.length, row.key).toBeGreaterThan(0);
    }
  });

  /**
   * Two levels, deliberately. One forces "Travel" to absorb airfare and
   * mileage, which have different policy treatment; four is a chart of
   * accounts, which is a different artefact with a different owner.
   */
  it('is at most two levels deep', () => {
    const parentKeys = new Set(
      flat.filter((row) => row.parentKey !== null).map((r) => r.parentKey),
    );
    const topLevel = new Set(flat.filter((row) => row.parentKey === null).map((r) => r.key));

    for (const parent of parentKeys) {
      expect(topLevel.has(parent!), `${parent!} is a parent but not top-level`).toBe(true);
    }
  });

  it('includes the fallback category as a real row', () => {
    expect(flat.map((row) => row.key)).toContain(UNCATEGORISED_CATEGORY_KEY);
  });

  it('roots every parent reference in a key that exists', () => {
    const keys = new Set(flat.map((row) => row.key));

    for (const row of flat) {
      if (row.parentKey !== null) {
        expect(keys.has(row.parentKey), `${row.key} → ${row.parentKey}`).toBe(true);
      }
    }
  });
});

describe('flattenCategories', () => {
  const sample: readonly CategoryTemplate[] = [
    {
      key: 'a',
      name: 'A',
      children: [
        { key: 'a1', name: 'A1' },
        { key: 'a2', name: 'A2' },
      ],
    },
    { key: 'b', name: 'B' },
  ];

  it('flattens depth-first, parents before children', () => {
    expect(flattenCategories(sample)).toEqual([
      { key: 'a', name: 'A', parentKey: null },
      { key: 'a1', name: 'A1', parentKey: 'a' },
      { key: 'a2', name: 'A2', parentKey: 'a' },
      { key: 'b', name: 'B', parentKey: null },
    ]);
  });

  /**
   * The seed inserts in this order and resolves each parent from a map built
   * as it goes. A child emitted before its parent would be written with a null
   * parent and silently flatten the tree.
   */
  it('never emits a child before its parent', () => {
    const seen = new Set<string>();

    for (const row of flattenCategories(DEFAULT_CATEGORIES)) {
      if (row.parentKey !== null) {
        expect(seen.has(row.parentKey), `${row.key} came before ${row.parentKey}`).toBe(true);
      }
      seen.add(row.key);
    }
  });

  it('handles an empty tree', () => {
    expect(flattenCategories([])).toEqual([]);
  });

  it('treats a missing children array as a leaf', () => {
    expect(flattenCategories([{ key: 'solo', name: 'Solo' }])).toEqual([
      { key: 'solo', name: 'Solo', parentKey: null },
    ]);
  });

  it('carries the parent key down an explicitly nested call', () => {
    expect(flattenCategories([{ key: 'child', name: 'Child' }], 'parent')).toEqual([
      { key: 'child', name: 'Child', parentKey: 'parent' },
    ]);
  });
});
