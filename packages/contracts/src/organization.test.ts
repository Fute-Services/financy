import { describe, expect, it } from 'vitest';

import {
  countryCodeSchema,
  depthOfPath,
  entitySummarySchema,
  organizationSettingsSchema,
  organizationSummarySchema,
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
