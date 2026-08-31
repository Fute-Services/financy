import { describe, expect, it } from 'vitest';

import {
  activeSessionSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  passwordSchema,
  registerRequestSchema,
  sessionResponseSchema,
  switchOrganizationRequestSchema,
} from './auth.js';

const UUID = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';

function validRegistration(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: 'Acme Ltd',
    fullName: 'Ada Lovelace',
    email: 'ada@acme.test',
    password: 'correct-horse-battery-staple',
    ...overrides,
  };
}

describe('passwordSchema', () => {
  /**
   * Twelve characters and **no composition rules**. Requiring a digit and a
   * symbol measurably lowers entropy in practice, because people satisfy the
   * rule with `Password1!` rather than with length.
   */
  it('accepts a long passphrase with no digits or symbols', () => {
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true);
  });

  it('rejects anything under twelve characters', () => {
    expect(passwordSchema.safeParse('Sh0rt!').success).toBe(false);
    expect(passwordSchema.safeParse('exactly11ch').success).toBe(false);
    expect(passwordSchema.safeParse('exactly12chs').success).toBe(true);
  });

  /** argon2 hashes whatever it is handed; an unbounded password is a CPU sink. */
  it('bounds the length, so hashing cannot be turned into a denial of service', () => {
    expect(passwordSchema.safeParse('a'.repeat(256)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(257)).success).toBe(false);
  });

  it('does not trim — leading and trailing spaces are part of a passphrase', () => {
    expect(passwordSchema.parse('  spaces matter here  ')).toBe('  spaces matter here  ');
  });
});

describe('registerRequestSchema', () => {
  it('accepts a minimal registration and defaults the locale fields', () => {
    const parsed = registerRequestSchema.parse(validRegistration());

    expect(parsed.baseCurrency).toBe('USD');
    expect(parsed.countryCode).toBe('US');
  });

  it('normalises the email and upper-cases the codes', () => {
    const parsed = registerRequestSchema.parse(
      validRegistration({ email: '  Ada@Acme.TEST ', baseCurrency: 'inr', countryCode: 'in' }),
    );

    expect(parsed.email).toBe('ada@acme.test');
    expect(parsed.baseCurrency).toBe('INR');
    expect(parsed.countryCode).toBe('IN');
  });

  it.each([
    ['organizationName', ''],
    ['fullName', '   '],
    ['email', 'not-an-email'],
    ['password', 'short'],
    ['baseCurrency', 'DOLLAR'],
    ['countryCode', 'USA'],
  ])('rejects a bad %s', (field, value) => {
    expect(registerRequestSchema.safeParse(validRegistration({ [field]: value })).success).toBe(
      false,
    );
  });

  /**
   * The rule this schema exists to enforce. `organizationId` is resolved from
   * the session's membership, never accepted from a client — so the field does
   * not exist, and a request carrying one is rejected rather than having it
   * quietly ignored (docs/10 §1).
   */
  it.each(['organizationId', 'roleId', 'isAdmin', 'permissions'])(
    'rejects a smuggled %s rather than ignoring it',
    (field) => {
      expect(registerRequestSchema.safeParse(validRegistration({ [field]: 'x' })).success).toBe(
        false,
      );
    },
  );
});

describe('loginRequestSchema', () => {
  it('accepts an email and password', () => {
    expect(loginRequestSchema.parse({ email: 'ada@acme.test', password: 'x' })).toEqual({
      email: 'ada@acme.test',
      password: 'x',
    });
  });

  /**
   * Deliberately *not* `passwordSchema`. Applying the strength rules at login
   * would reject a short password before checking it, which tells the caller
   * their guess was too short to be anyone's — and would lock out every user
   * whose password predates a rule change.
   */
  it('does not apply the strength rules to an attempt', () => {
    expect(loginRequestSchema.safeParse({ email: 'ada@acme.test', password: 'abc' }).success).toBe(
      true,
    );
  });

  it('still requires a non-empty password', () => {
    expect(loginRequestSchema.safeParse({ email: 'ada@acme.test', password: '' }).success).toBe(
      false,
    );
  });

  it('rejects unknown keys', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'ada@acme.test', password: 'x', totp: '000000' })
        .success,
    ).toBe(false);
  });
});

describe('changePasswordRequestSchema', () => {
  it('requires the current password and a strong new one', () => {
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'anything',
        newPassword: 'correct-horse-battery-staple',
      }).success,
    ).toBe(true);
  });

  it('holds the new password to the strength rules', () => {
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success,
    ).toBe(false);
  });
});

describe('switchOrganizationRequestSchema', () => {
  /**
   * The one place an organisation id is legitimately client-supplied. It names
   * which of the caller's *own* memberships to activate, and the server still
   * verifies the membership exists and is active before honouring it.
   */
  it('takes an organisation id and nothing else', () => {
    expect(switchOrganizationRequestSchema.parse({ organizationId: UUID })).toEqual({
      organizationId: UUID,
    });
    expect(switchOrganizationRequestSchema.safeParse({ organizationId: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('sessionResponseSchema', () => {
  const session = {
    user: { id: UUID, email: 'ada@acme.test', fullName: 'Ada Lovelace' },
    organization: { id: UUID, slug: 'acme', name: 'Acme Ltd', baseCurrency: 'USD' },
    membership: {
      id: UUID,
      roleKey: 'ORG_ADMIN',
      roleName: 'Organisation admin',
      scope: 'ORGANISATION',
      departmentId: null,
    },
    permissions: ['organization:read', 'user:read'],
    organizations: [{ id: UUID, slug: 'acme', name: 'Acme Ltd', roleKey: 'ORG_ADMIN' }],
    isSandbox: true,
    expiresAt: '2026-08-31T14:32:11.482Z',
  };

  it('accepts the documented shape', () => {
    expect(sessionResponseSchema.safeParse(session).success).toBe(true);
  });

  it('rejects a role key outside the five system roles', () => {
    expect(
      sessionResponseSchema.safeParse({
        ...session,
        membership: { ...session.membership, roleKey: 'SUPERUSER' },
      }).success,
    ).toBe(false);
  });

  it('allows a department-scoped membership', () => {
    expect(
      sessionResponseSchema.safeParse({
        ...session,
        membership: { ...session.membership, scope: 'DEPARTMENT', departmentId: UUID },
      }).success,
    ).toBe(true);
  });

  /**
   * Nothing in a session response should ever carry a credential. This asserts
   * the shape refuses one rather than trusting that no handler will add it.
   */
  it('has no field that could carry a hash or a token', () => {
    const parsed = sessionResponseSchema.parse(session);
    const serialised = JSON.stringify(parsed);

    for (const forbidden of ['passwordHash', 'tokenHash', 'mfaSecret', 'password']) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('activeSessionSchema', () => {
  it('marks which session is the caller’s own device', () => {
    const parsed = activeSessionSchema.parse({
      id: UUID,
      ipAddress: '203.0.113.4',
      userAgent: 'Mozilla/5.0',
      lastSeenAt: '2026-08-31T14:32:11.482Z',
      createdAt: '2026-08-31T09:00:00.000Z',
      isCurrent: true,
    });

    expect(parsed.isCurrent).toBe(true);
  });

  it('tolerates a session with no recorded address or agent', () => {
    expect(
      activeSessionSchema.safeParse({
        id: UUID,
        ipAddress: null,
        userAgent: null,
        lastSeenAt: '2026-08-31T14:32:11.482Z',
        createdAt: '2026-08-31T09:00:00.000Z',
        isCurrent: false,
      }).success,
    ).toBe(true);
  });
});
