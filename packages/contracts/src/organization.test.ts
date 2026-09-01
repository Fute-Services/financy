import { describe, expect, it } from 'vitest';

import {
  countryCodeSchema,
  createDepartmentSchema,
  createEntitySchema,
  depthOfPath,
  entitySummarySchema,
  isWithinSubtree,
  organizationSettingsSchema,
  organizationSummarySchema,
  pathUnder,
  updateDepartmentSchema,
  updateEntitySchema,
  updateOrganizationSchema,
} from './organization.js';

const ORG_ID = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';

describe('depthOfPath', () => {
  /**
   * The UI indents department rows by this number, so an off-by-one is a tree
   * that renders as a flat list or as a staircase — both of which look like a
   * data problem rather than an arithmetic one.
   */
  it.each([
    ['/', 0],
    ['/a/', 0],
    ['/a/b/', 1],
    ['/a/b/c/', 2],
  ])('%s is depth %i', (path, expected) => {
    expect(depthOfPath(path)).toBe(expected);
  });

  it('never returns a negative depth for an empty path', () => {
    // `''` should not happen — `path` is non-null in the schema — but a
    // negative padding would render the row outside its container, which is
    // a worse failure than a wrong indent.
    expect(depthOfPath('')).toBe(0);
  });

  it('is unaffected by a missing trailing slash', () => {
    expect(depthOfPath('/a/b')).toBe(depthOfPath('/a/b/'));
  });
});

describe('countryCodeSchema', () => {
  it('upper-cases and trims, so a form value normalises rather than failing', () => {
    expect(countryCodeSchema.parse(' gb ')).toBe('GB');
  });

  it.each(['USA', 'U', '12', ''])('rejects %s', (value) => {
    expect(countryCodeSchema.safeParse(value).success).toBe(false);
  });

  /**
   * Deliberately not checked against a list of real countries. The list
   * changes, a stale copy rejects a legitimate value, and the failure lands on
   * a customer who cannot finish registration.
   */
  it('accepts a shape-valid code that is not an assigned country', () => {
    expect(countryCodeSchema.safeParse('ZZ').success).toBe(true);
  });
});

describe('organizationSummarySchema', () => {
  const valid = {
    id: ORG_ID,
    slug: 'acme',
    name: 'Acme Ltd',
    legalName: null,
    baseCurrency: 'USD',
    baseCurrencyLocked: false,
    countryCode: 'US',
    timezone: 'America/New_York',
    fiscalYearStartMonth: 1,
    version: 1,
    createdAt: '2026-08-31T10:00:00.000Z',
  };

  it('accepts a complete summary', () => {
    expect(organizationSummarySchema.safeParse(valid).success).toBe(true);
  });

  it.each([0, 13, -1, 1.5])('rejects fiscal month %s', (month) => {
    expect(
      organizationSummarySchema.safeParse({ ...valid, fiscalYearStartMonth: month }).success,
    ).toBe(false);
  });

  /**
   * The lock flag travels with the value rather than being inferred by the
   * client. A client that guessed "locked if any spend exists" would need the
   * spend, and would guess wrong on the boundary.
   */
  it('requires the lock flag rather than defaulting it', () => {
    const { baseCurrencyLocked: _omitted, ...withoutFlag } = valid;
    expect(organizationSummarySchema.safeParse(withoutFlag).success).toBe(false);
  });
});

describe('entitySummarySchema', () => {
  const valid = {
    id: ORG_ID,
    name: 'Acme Europe BV',
    registrationNumber: null,
    countryCode: 'NL',
    functionalCurrency: 'EUR',
    status: 'ACTIVE',
  };

  it('accepts an entity with no registration number', () => {
    expect(entitySummarySchema.safeParse(valid).success).toBe(true);
  });

  /**
   * `INACTIVE` is not a state this schema has, and that is the point: the
   * database enum is `ACTIVE | ARCHIVED`, so accepting a third value here
   * would let the API describe a state it could never store.
   */
  it('rejects a status the database cannot store', () => {
    expect(entitySummarySchema.safeParse({ ...valid, status: 'INACTIVE' }).success).toBe(false);
  });
});

describe('organizationSettingsSchema', () => {
  it('accepts an organisation with nothing in it yet', () => {
    const result = organizationSettingsSchema.safeParse({
      organization: {
        id: ORG_ID,
        slug: 'new',
        name: 'New Co',
        legalName: null,
        baseCurrency: 'GBP',
        baseCurrencyLocked: false,
        countryCode: 'GB',
        timezone: 'UTC',
        fiscalYearStartMonth: 4,
        version: 1,
        createdAt: '2026-08-31T10:00:00.000Z',
      },
      entities: [],
      departments: [],
      categories: [],
      roleCounts: [],
    });

    expect(result.success).toBe(true);
  });
});

describe('updateOrganizationSchema', () => {
  it('accepts a single field', () => {
    expect(updateOrganizationSchema.safeParse({ name: 'Acme Group' }).success).toBe(true);
  });

  /**
   * An empty PATCH would burn a version and write an audit event describing
   * no change, which makes the audit log longer and less true at once.
   */
  it('rejects an empty body', () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
  });

  /**
   * The slug appears in URLs people bookmark. It is not in the schema, so a
   * client that sends one is told, rather than having it quietly dropped and
   * believing the rename worked.
   */
  it('rejects slug, which is not editable', () => {
    expect(updateOrganizationSchema.safeParse({ slug: 'renamed' }).success).toBe(false);
  });

  it('rejects the server-owned fields outright', () => {
    for (const field of ['id', 'version', 'createdAt', 'baseCurrencyLocked']) {
      expect(updateOrganizationSchema.safeParse({ name: 'Acme', [field]: 1 }).success).toBe(false);
    }
  });

  /**
   * `null` clears the legal name; omitting it leaves the existing one alone.
   * Collapsing the two would make "remove our legal name" impossible to say.
   */
  it('distinguishes clearing the legal name from not touching it', () => {
    expect(updateOrganizationSchema.safeParse({ legalName: null }).success).toBe(true);
  });

  /**
   * A key whose value is `undefined` carries no instruction — the service
   * skips an undefined field — so it must not count towards "at least one".
   * JSON cannot express this, but a client assembling the body in TypeScript
   * (`{ legalName: form.legalName || undefined }`) produces it constantly, and
   * letting it through is a write that changes nothing, burns a version, and
   * invalidates every other client's `If-Match`.
   */
  it('treats a key set to undefined as no field at all', () => {
    expect(updateOrganizationSchema.safeParse({ legalName: undefined }).success).toBe(false);
    expect(
      updateOrganizationSchema.safeParse({ name: 'Acme Group', legalName: undefined }).success,
    ).toBe(true);
  });

  it('normalises the country code rather than merely accepting it', () => {
    const result = updateOrganizationSchema.safeParse({ countryCode: ' in ' });
    expect(result.success && result.data.countryCode).toBe('IN');
  });

  it.each([0, 13, -1, 1.5])('rejects fiscal month %s', (month) => {
    expect(updateOrganizationSchema.safeParse({ fiscalYearStartMonth: month }).success).toBe(false);
  });
});

describe('createEntitySchema', () => {
  const valid = { name: 'Acme UK', countryCode: 'GB', functionalCurrency: 'GBP' };

  it('accepts the minimum an entity needs', () => {
    expect(createEntitySchema.safeParse(valid).success).toBe(true);
  });

  it('upper-cases the codes, so two spellings cannot become two values', () => {
    const result = createEntitySchema.safeParse({
      ...valid,
      countryCode: 'gb',
      functionalCurrency: 'gbp',
    });
    expect(result.success && result.data).toMatchObject({
      countryCode: 'GB',
      functionalCurrency: 'GBP',
    });
  });

  it.each(['name', 'countryCode', 'functionalCurrency'])('requires %s', (field) => {
    const { [field]: _omitted, ...rest } = valid as Record<string, unknown>;
    expect(createEntitySchema.safeParse(rest).success).toBe(false);
  });

  /**
   * `status` is the server's. A client that could post `ARCHIVED` here would
   * be able to create a record that never had an active life, which nothing
   * downstream expects to encounter.
   */
  it('rejects a client-supplied status', () => {
    expect(createEntitySchema.safeParse({ ...valid, status: 'ARCHIVED' }).success).toBe(false);
  });
});

describe('updateEntitySchema', () => {
  it('accepts a single field', () => {
    expect(updateEntitySchema.safeParse({ name: 'Acme UK Ltd' }).success).toBe(true);
  });

  it('rejects an empty body', () => {
    expect(updateEntitySchema.safeParse({}).success).toBe(false);
  });

  /**
   * Archiving is its own endpoint with its own guard — an organisation must
   * keep one active entity. A `status` field here would route around it.
   */
  it('rejects status, which has its own endpoint and its own guard', () => {
    expect(updateEntitySchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });
});

describe('pathUnder', () => {
  it('makes a root path from a null parent', () => {
    expect(pathUnder(null, 'a')).toBe('/a/');
  });

  it('appends to a parent path', () => {
    expect(pathUnder('/a/', 'b')).toBe('/a/b/');
  });

  /**
   * Both ends delimited, always. PostgreSQL enforced this with a `CHECK`;
   * MongoDB cannot, so it rests on this function being the only thing that
   * builds a path. Without the trailing slash, `/a/bc/` matches a query for
   * `/a/b/` and a manager's scope silently widens to a department they do not
   * manage.
   */
  it('delimits both ends at every depth', () => {
    const deep = pathUnder(pathUnder(pathUnder(null, 'a'), 'b'), 'c');

    expect(deep).toBe('/a/b/c/');
    expect(deep.startsWith('/')).toBe(true);
    expect(deep.endsWith('/')).toBe(true);
  });

  it('agrees with depthOfPath, which the UI indents by', () => {
    expect(depthOfPath(pathUnder(null, 'a'))).toBe(0);
    expect(depthOfPath(pathUnder(pathUnder(null, 'a'), 'b'))).toBe(1);
  });
});

describe('isWithinSubtree', () => {
  it('counts a node as inside its own subtree, which is what blocks a self-parent', () => {
    expect(isWithinSubtree('/a/', '/a/')).toBe(true);
  });

  it('recognises a descendant at any depth', () => {
    expect(isWithinSubtree('/a/b/c/', '/a/')).toBe(true);
  });

  it('does not treat an ancestor as a descendant', () => {
    expect(isWithinSubtree('/a/', '/a/b/')).toBe(false);
  });

  it('does not treat a sibling as a descendant', () => {
    expect(isWithinSubtree('/b/', '/a/')).toBe(false);
  });

  /**
   * The reason both ends are delimited, as an assertion rather than a comment.
   * With undelimited paths `/a/bc/` would read as being inside `/a/b`.
   */
  it('is not fooled by an id that begins with another id', () => {
    expect(isWithinSubtree(pathUnder(null, 'bc'), pathUnder(null, 'b'))).toBe(false);
  });
});

describe('createDepartmentSchema', () => {
  it('accepts a bare name, which makes a root', () => {
    expect(createDepartmentSchema.safeParse({ name: 'Engineering' }).success).toBe(true);
  });

  /**
   * `path` and `depth` are derived from `parentId`. A client that could send
   * a path could send one that disagrees with the parent it also sent, and
   * there is no correct way for the server to pick a winner.
   */
  it.each(['path', 'depth', 'memberCount', 'version'])('rejects the derived field %s', (field) => {
    expect(createDepartmentSchema.safeParse({ name: 'Engineering', [field]: 1 }).success).toBe(
      false,
    );
  });

  it('upper-cases a code', () => {
    const result = createDepartmentSchema.safeParse({ name: 'Engineering', code: ' eng-eu ' });
    expect(result.success && result.data.code).toBe('ENG-EU');
  });

  it.each(['-ENG', 'ENG EU', 'ENG_EU', 'ENG/EU'])('rejects the code %s', (code) => {
    expect(createDepartmentSchema.safeParse({ name: 'Engineering', code }).success).toBe(false);
  });
});

describe('updateDepartmentSchema', () => {
  it('rejects an empty body', () => {
    expect(updateDepartmentSchema.safeParse({}).success).toBe(false);
  });

  /**
   * `null` promotes the node to a root; omitting `parentId` leaves it where
   * it is. Collapsing the two would make "move this to the top" unsayable.
   */
  it('distinguishes clearing the parent from leaving it alone', () => {
    expect(updateDepartmentSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(updateDepartmentSchema.safeParse({ parentId: undefined }).success).toBe(false);
  });
});
