import { describe, expect, it } from 'vitest';

import {
  categoryKeySchema,
  createCategorySchema,
  createProjectSchema,
  projectCodeSchema,
  updateCategorySchema,
  updateProjectSchema,
} from './projects.js';

describe('projectCodeSchema', () => {
  it('upper-cases and trims', () => {
    expect(projectCodeSchema.parse(' apollo-1 ')).toBe('APOLLO-1');
  });

  it.each(['-LEADING', 'WITH SPACE', 'WITH_UNDERSCORE', 'WITH/SLASH', ''])('rejects %s', (code) => {
    expect(projectCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe('createProjectSchema', () => {
  it('accepts a bare name', () => {
    expect(createProjectSchema.safeParse({ name: 'Apollo' }).success).toBe(true);
  });

  it('accepts a complete window', () => {
    expect(
      createProjectSchema.safeParse({
        name: 'Apollo',
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      }).success,
    ).toBe(true);
  });

  it('accepts a window that starts and ends on the same day', () => {
    expect(
      createProjectSchema.safeParse({
        name: 'One day',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
      }).success,
    ).toBe(true);
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      createProjectSchema.safeParse({
        name: 'Backwards',
        startsOn: '2026-06-01',
        endsOn: '2026-05-01',
      }).success,
    ).toBe(false);
  });

  /**
   * An open-ended project is ordinary. Only two present dates can be in the
   * wrong order, so one of them missing must not fail the check.
   */
  it('accepts a half-open window', () => {
    expect(createProjectSchema.safeParse({ name: 'Open', startsOn: '2026-01-01' }).success).toBe(
      true,
    );
    expect(createProjectSchema.safeParse({ name: 'Open', endsOn: '2026-01-01' }).success).toBe(
      true,
    );
  });

  it.each(['status', 'archivedAt', 'version', 'organizationId'])(
    'rejects the server-owned field %s',
    (field) => {
      expect(createProjectSchema.safeParse({ name: 'Apollo', [field]: 'x' }).success).toBe(false);
    },
  );

  it('rejects a timestamp where a calendar date belongs', () => {
    expect(
      createProjectSchema.safeParse({ name: 'Apollo', startsOn: '2026-01-01T00:00:00.000Z' })
        .success,
    ).toBe(false);
  });
});

describe('updateProjectSchema', () => {
  it('rejects an empty body', () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
  });

  /**
   * The schema sees only the fields it was sent, so a PATCH moving one end of
   * the window past an *existing* value passes here. The service holds both
   * halves and is what catches that; this test records the division of labour
   * so nobody later "fixes" the schema by making it reject a lone date.
   */
  it('accepts a lone endsOn, which the service checks against the stored start', () => {
    expect(updateProjectSchema.safeParse({ endsOn: '2020-01-01' }).success).toBe(true);
  });

  it('still rejects an inverted window when both ends are sent', () => {
    expect(
      updateProjectSchema.safeParse({ startsOn: '2026-06-01', endsOn: '2026-05-01' }).success,
    ).toBe(false);
  });
});

describe('categoryKeySchema', () => {
  it('lower-cases and trims', () => {
    expect(categoryKeySchema.parse('  Travel_Airfare  ')).toBe('travel_airfare');
  });

  it.each(['_leading', 'with-hyphen', 'with space', 'WITH.DOT', ''])('rejects %s', (key) => {
    expect(categoryKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('createCategorySchema', () => {
  it('accepts a key and a name', () => {
    expect(createCategorySchema.safeParse({ key: 'fuel', name: 'Fuel' }).success).toBe(true);
  });

  /**
   * Only the seed creates system categories. A client that could set this
   * could create a row a later deploy would try to own by key.
   */
  it('rejects a client-supplied isSystem', () => {
    expect(
      createCategorySchema.safeParse({ key: 'fuel', name: 'Fuel', isSystem: true }).success,
    ).toBe(false);
  });
});

describe('updateCategorySchema', () => {
  it('accepts a rename', () => {
    expect(updateCategorySchema.safeParse({ name: 'Renamed' }).success).toBe(true);
  });

  /**
   * A policy rule names the key. If a PATCH could change it, every policy
   * referring to it would silently start deciding something else, with
   * nothing in the policy's own history to show why.
   */
  it('rejects the key, which policies name and which is therefore create-only', () => {
    expect(updateCategorySchema.safeParse({ key: 'renamed' }).success).toBe(false);
  });

  /**
   * Moving a category between branches changes what every historical
   * transaction coded to it appears to have been. That is not an edit to a
   * lookup table.
   */
  it('rejects a re-parent', () => {
    expect(updateCategorySchema.safeParse({ parentId: null }).success).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
  });
});
