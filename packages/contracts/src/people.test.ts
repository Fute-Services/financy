import { describe, expect, it } from 'vitest';

import { MEMBERSHIP_SCOPES } from './permissions.js';
import {
  MEMBERSHIP_STATUSES,
  SCOPE_LABELS,
  STATUS_LABELS,
  listPeopleQuerySchema,
  personSchema,
} from './people.js';

const ID = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';

describe('labels', () => {
  /**
   * Every scope and status the contract accepts has a label. A missing one
   * renders as `undefined` in a table cell — which reads as a data problem to
   * the user and is invisible to the compiler, since indexing a `Record` by a
   * key it lacks is only an error under `noUncheckedIndexedAccess`.
   */
  it('labels every scope', () => {
    for (const scope of MEMBERSHIP_SCOPES) {
      expect(SCOPE_LABELS[scope]).toBeTruthy();
    }
    expect(Object.keys(SCOPE_LABELS)).toHaveLength(MEMBERSHIP_SCOPES.length);
  });

  it('labels every status', () => {
    for (const status of MEMBERSHIP_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
    expect(Object.keys(STATUS_LABELS)).toHaveLength(MEMBERSHIP_STATUSES.length);
  });

  /**
   * `INACTIVE` reads as "Deactivated" rather than "Inactive". The database
   * value describes a row; the label describes what happened to a person, and
   * those are not the same sentence.
   */
  it('describes a deactivated member in human terms', () => {
    expect(STATUS_LABELS.INACTIVE).toBe('Deactivated');
  });
});

describe('personSchema', () => {
  const valid = {
    id: ID,
    userId: ID,
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    role: { key: 'ORG_ADMIN', name: 'Organisation admin' },
    department: null,
    scope: 'ORGANISATION',
    status: 'ACTIVE',
    lastLoginAt: null,
    joinedAt: '2026-08-31T10:00:00.000Z',
    version: 1,
  };

  it('accepts a member with no department and no login yet', () => {
    expect(personSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a member in a department', () => {
    const result = personSchema.safeParse({
      ...valid,
      department: { id: ID, name: 'Engineering', code: 'ENG' },
    });

    expect(result.success).toBe(true);
  });

  it('accepts a department with no code, which is the common case', () => {
    const result = personSchema.safeParse({
      ...valid,
      department: { id: ID, name: 'Engineering', code: null },
    });

    expect(result.success).toBe(true);
  });

  /**
   * `lastLoginAt` is nullable, not optional. The two are different on the
   * wire: an absent key would let a client that forgot to send it look like a
   * member who has never signed in.
   */
  it('requires lastLoginAt to be present, even when null', () => {
    const { lastLoginAt: _omitted, ...withoutLogin } = valid;
    expect(personSchema.safeParse(withoutLogin).success).toBe(false);
  });

  it('rejects a role key outside the catalogue', () => {
    const result = personSchema.safeParse({
      ...valid,
      role: { key: 'SUPER_ADMIN', name: 'Super admin' },
    });

    expect(result.success).toBe(false);
  });

  it('lower-cases the email, so one address is one person', () => {
    const result = personSchema.parse({ ...valid, email: 'Ada@Example.COM' });
    expect(result.email).toBe('ada@example.com');
  });
});

describe('listPeopleQuerySchema', () => {
  it('defaults to the first page rather than requiring one', () => {
    const result = listPeopleQuerySchema.parse({});
    expect(result.page).toBe(1);
  });

  it('rejects an unknown parameter instead of ignoring it', () => {
    // The exact typo the filters rule exists for: `?statuss=INACTIVE` must
    // fail, not quietly return everybody.
    expect(listPeopleQuerySchema.safeParse({ statuss: 'INACTIVE' }).success).toBe(false);
  });

  it('trims a search term, because a trailing space finds nothing', () => {
    expect(listPeopleQuerySchema.parse({ q: '  ada  ' }).q).toBe('ada');
  });

  it('treats an empty search box as no filter at all', () => {
    expect(listPeopleQuerySchema.parse({ q: '' }).q).toBeUndefined();
  });

  it('rejects a status the database cannot store', () => {
    expect(listPeopleQuerySchema.safeParse({ status: 'SUSPENDED' }).success).toBe(false);
  });

  it('falls back to page one for a nonsensical page rather than failing', () => {
    // Pagination is not worth a 422. A junk `?page=` in a shared link should
    // show the list, not an error page.
    expect(listPeopleQuerySchema.parse({ page: 'abc' }).page).toBe(1);
  });
});
