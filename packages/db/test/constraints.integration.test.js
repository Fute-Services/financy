'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const core_1 = require('@financy/core');
const client_1 = require('@prisma/client');
const vitest_1 = require('vitest');
const roles_js_1 = require('../src/seed/roles.js');
/**
 * The guarantees the database enforces, tested against a real PostgreSQL.
 *
 * Every constraint here is hand-written in the migration and **invisible to
 * Prisma** — no type error, no schema validation, and no other test would
 * notice if one silently failed to apply. A mocked repository cannot
 * demonstrate that a composite foreign key refuses a cross-tenant reference;
 * only the database can (docs/16 §4).
 *
 * Each test attempts the violation the constraint exists to prevent and
 * asserts that PostgreSQL refused. Everything runs inside a transaction that
 * is rolled back, so the suite is order-independent and leaves no rows behind.
 */
const DATABASE_URL = process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL'];
/**
 * Skipped rather than failed when no database is configured.
 *
 * A developer running `pnpm test` before provisioning PostgreSQL should see
 * the unit suite pass, not a wall of connection errors that teaches them to
 * ignore red. CI always sets `DATABASE_URL`, so these always run there — which
 * is what stops "skipped" from becoming "never runs".
 */
const describeWithDatabase =
  DATABASE_URL === undefined ? vitest_1.describe.skip : vitest_1.describe;
/** A rolled-back transaction, so nothing here can touch committed data. */
const ROLLBACK = Symbol('rollback');
describeWithDatabase('database guarantees', () => {
  let prisma;
  /** Seeded once per suite, inside each test's own rolled-back transaction. */
  const ORG_A = (0, core_1.newId)();
  const ORG_B = (0, core_1.newId)();
  const DEPT_A = (0, core_1.newId)();
  const USER = (0, core_1.newId)();
  (0, vitest_1.beforeAll)(async () => {
    prisma = new client_1.PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
  });
  (0, vitest_1.afterAll)(async () => {
    await prisma?.$disconnect();
  });
  /**
   * Run `body` against a transaction that is always rolled back.
   *
   * Prisma has no "rollback at the end" option, so the rollback is forced by
   * throwing a sentinel the wrapper swallows. The alternative — deleting rows
   * afterwards — cannot clean up `audit_events`, because `DELETE` on it is
   * exactly what this suite proves is denied.
   */
  async function inRolledBackTransaction(body) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.organization.createMany({
          data: [
            {
              id: ORG_A,
              slug: `verify-a-${ORG_A.slice(0, 8)}`,
              name: 'Verify A',
              baseCurrency: 'USD',
              countryCode: 'US',
              updatedAt: new Date(),
            },
            {
              id: ORG_B,
              slug: `verify-b-${ORG_B.slice(0, 8)}`,
              name: 'Verify B',
              baseCurrency: 'USD',
              countryCode: 'US',
              updatedAt: new Date(),
            },
          ],
        });
        await tx.department.create({
          data: {
            id: DEPT_A,
            organizationId: ORG_A,
            name: 'Dept A',
            path: `/${DEPT_A}/`,
            updatedAt: new Date(),
          },
        });
        await tx.user.create({
          data: {
            id: USER,
            email: `verify-${USER.slice(0, 8)}@example.test`,
            passwordHash: 'not-a-real-hash',
            fullName: 'Verify User',
            updatedAt: new Date(),
          },
        });
        // Both organisations get their own roles, exactly as registration
        // will. It also means the cross-tenant tests below have a valid
        // same-organisation role to use, so the only thing left that can fail
        // is the reference actually under test.
        await (0, roles_js_1.provisionOrganizationRoles)(tx, ORG_A);
        await (0, roles_js_1.provisionOrganizationRoles)(tx, ORG_B);
        await body(tx);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  }
  async function employeeRoleId(tx, organizationId) {
    const role = await tx.role.findFirst({
      where: { key: 'EMPLOYEE', organizationId },
      select: { id: true },
    });
    /* c8 ignore next 3 -- provisioned by the fixture above. */
    if (role === null) {
      throw new Error(`No EMPLOYEE role for organisation ${organizationId}.`);
    }
    return role.id;
  }
  (0, vitest_1.describe)('the audit trail is evidence', () => {
    (0, vitest_1.it)('refuses a USER action that does not name its actor', async () => {
      await inRolledBackTransaction(async (tx) => {
        await (0, vitest_1.expect)(
          tx.auditEvent.create({
            data: {
              id: (0, core_1.newId)(),
              organizationId: ORG_A,
              actorType: 'USER',
              action: 'test.performed',
              resourceType: 'test',
              correlationId: 'verify',
            },
          }),
        ).rejects.toThrow(/audit_actor_present/);
      });
    });
    (0, vitest_1.it)('permits a SYSTEM action without a membership — a job has none', async () => {
      await inRolledBackTransaction(async (tx) => {
        const created = await tx.auditEvent.create({
          data: {
            id: (0, core_1.newId)(),
            organizationId: ORG_A,
            actorType: 'SYSTEM',
            actorLabel: 'verify-job',
            action: 'test.performed',
            resourceType: 'test',
            correlationId: 'verify',
          },
        });
        (0, vitest_1.expect)(created.actorMembershipId).toBeNull();
      });
    });
    /**
     * The immutability guarantee, and the reason it is a *grant* rather than a
     * trigger: there is no code path to audit, no flag to get wrong, and no
     * way for application code to opt out of it.
     */
    (0, vitest_1.it)('denies UPDATE on audit_events', async () => {
      await inRolledBackTransaction(async (tx) => {
        const id = (0, core_1.newId)();
        await tx.auditEvent.create({
          data: {
            id,
            organizationId: ORG_A,
            actorType: 'SYSTEM',
            actorLabel: 'verify-job',
            action: 'test.performed',
            resourceType: 'test',
            correlationId: 'verify',
          },
        });
        await (0, vitest_1.expect)(
          tx.auditEvent.update({ where: { id }, data: { action: 'tampered' } }),
        ).rejects.toThrow(/permission denied/i);
      });
    });
    (0, vitest_1.it)('denies DELETE on audit_events', async () => {
      await inRolledBackTransaction(async (tx) => {
        const id = (0, core_1.newId)();
        await tx.auditEvent.create({
          data: {
            id,
            organizationId: ORG_A,
            actorType: 'SYSTEM',
            actorLabel: 'verify-job',
            action: 'test.performed',
            resourceType: 'test',
            correlationId: 'verify',
          },
        });
        await (0, vitest_1.expect)(tx.auditEvent.delete({ where: { id } })).rejects.toThrow(
          /permission denied/i,
        );
      });
    });
    (0, vitest_1.it)('denies UPDATE on security_events', async () => {
      await inRolledBackTransaction(async (tx) => {
        const id = (0, core_1.newId)();
        await tx.securityEvent.create({
          data: {
            id,
            organizationId: ORG_A,
            type: 'LOGIN_SUCCEEDED',
            correlationId: 'verify',
          },
        });
        await (0, vitest_1.expect)(
          tx.securityEvent.update({ where: { id }, data: { type: 'LOGIN_FAILED' } }),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });
  (0, vitest_1.describe)('cross-tenant references are structurally impossible', () => {
    /**
     * The strongest of the four isolation layers, and the only one that holds
     * when application code is wrong. Layers 1 and 2 are the request context
     * and the Prisma extension; both are application code and both can have
     * bugs. This one is the schema.
     */
    (0, vitest_1.it)(
      'refuses a membership pointing at another organisation’s department',
      async () => {
        await inRolledBackTransaction(async (tx) => {
          await (0, vitest_1.expect)(
            tx.membership.create({
              data: {
                id: (0, core_1.newId)(),
                organizationId: ORG_B,
                userId: USER,
                roleId: await employeeRoleId(tx, ORG_B),
                departmentId: DEPT_A,
                updatedAt: new Date(),
              },
            }),
          ).rejects.toThrow(/foreign key/i);
        });
      },
    );
    (0, vitest_1.it)('permits the same reference within one organisation', async () => {
      await inRolledBackTransaction(async (tx) => {
        const created = await tx.membership.create({
          data: {
            id: (0, core_1.newId)(),
            organizationId: ORG_A,
            userId: USER,
            roleId: await employeeRoleId(tx, ORG_A),
            departmentId: DEPT_A,
            updatedAt: new Date(),
          },
        });
        (0, vitest_1.expect)(created.departmentId).toBe(DEPT_A);
      });
    });
  });
  (0, vitest_1.describe)('domain invariants', () => {
    (0, vitest_1.it)('refuses two roles with the same key in one organisation', async () => {
      await inRolledBackTransaction(async (tx) => {
        await (0, vitest_1.expect)(
          tx.role.create({
            data: {
              id: (0, core_1.newId)(),
              organizationId: ORG_A,
              key: 'ORG_ADMIN',
              name: 'Impostor',
              isSystem: true,
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/unique/i);
      });
    });
    (0, vitest_1.it)('refuses a currency code that is not ISO-4217', async () => {
      await inRolledBackTransaction(async (tx) => {
        await (0, vitest_1.expect)(
          tx.organization.create({
            data: {
              id: (0, core_1.newId)(),
              slug: `bad-ccy-${(0, core_1.newId)().slice(0, 8)}`,
              name: 'Bad',
              baseCurrency: 'us ',
              countryCode: 'US',
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/iso4217/i);
      });
    });
    (0, vitest_1.it)('refuses a fiscal year starting in month 13', async () => {
      await inRolledBackTransaction(async (tx) => {
        await (0, vitest_1.expect)(
          tx.organization.create({
            data: {
              id: (0, core_1.newId)(),
              slug: `bad-fy-${(0, core_1.newId)().slice(0, 8)}`,
              name: 'Bad',
              baseCurrency: 'USD',
              countryCode: 'US',
              fiscalYearStartMonth: 13,
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/fiscal_month_range/i);
      });
    });
    /**
     * Subtree reads are `path LIKE '/a/b/%'`. An undelimited path makes
     * '/a/bc/' match a query for '/a/b/', silently widening a manager's scope
     * — the exact failure the column exists to avoid.
     */
    (0, vitest_1.it)('refuses an undelimited department path', async () => {
      await inRolledBackTransaction(async (tx) => {
        await (0, vitest_1.expect)(
          tx.department.create({
            data: {
              id: (0, core_1.newId)(),
              organizationId: ORG_A,
              name: 'Bad path',
              path: 'nodelimiters',
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/path_delimited/i);
      });
    });
    (0, vitest_1.it)('refuses a department that is its own parent', async () => {
      await inRolledBackTransaction(async (tx) => {
        const id = (0, core_1.newId)();
        await (0, vitest_1.expect)(
          tx.department.create({
            data: {
              id,
              organizationId: ORG_A,
              parentId: id,
              name: 'Self',
              path: `/${id}/`,
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/not_own_parent/i);
      });
    });
    /**
     * Otherwise the scope predicate resolves to an empty set and the member
     * sees nothing — which reads as a data bug rather than a misconfiguration.
     */
    (0, vitest_1.it)('refuses an ENTITY-scoped membership with no entities', async () => {
      await inRolledBackTransaction(async (tx) => {
        await (0, vitest_1.expect)(
          tx.membership.create({
            data: {
              id: (0, core_1.newId)(),
              organizationId: ORG_A,
              userId: USER,
              roleId: await employeeRoleId(tx, ORG_A),
              scope: 'ENTITY',
              entityScope: [],
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/entity_scope_present/i);
      });
    });
    (0, vitest_1.it)(
      'refuses a session whose idle expiry outlasts its absolute expiry',
      async () => {
        await inRolledBackTransaction(async (tx) => {
          const now = Date.now();
          await (0, vitest_1.expect)(
            tx.session.create({
              data: {
                id: (0, core_1.newId)(),
                userId: USER,
                tokenHash: Buffer.from([1, 2, 3]),
                idleExpiresAt: new Date(now + 2 * 86_400_000),
                absoluteExpiresAt: new Date(now + 3_600_000),
              },
            }),
          ).rejects.toThrow(/idle_before_absolute/i);
        });
      },
    );
    (0, vitest_1.it)('refuses a version below 1', async () => {
      await inRolledBackTransaction(async (tx) => {
        await (0, vitest_1.expect)(
          tx.organization.create({
            data: {
              id: (0, core_1.newId)(),
              slug: `bad-ver-${(0, core_1.newId)().slice(0, 8)}`,
              name: 'Bad',
              baseCurrency: 'USD',
              countryCode: 'US',
              version: 0,
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/version_positive/i);
      });
    });
  });
  (0, vitest_1.describe)('case-insensitive identity', () => {
    /**
     * `citext`, so `Ada@acme.com` and `ada@acme.com` are one account. Without
     * it, an attacker registers the same address in different case and gets a
     * second account that looks like the first to every human reading a list.
     */
    (0, vitest_1.it)('treats email as case-insensitive', async () => {
      await inRolledBackTransaction(async (tx) => {
        const email = `Case-${(0, core_1.newId)().slice(0, 8)}@Example.test`;
        await tx.user.create({
          data: {
            id: (0, core_1.newId)(),
            email,
            passwordHash: 'x',
            fullName: 'First',
            updatedAt: new Date(),
          },
        });
        await (0, vitest_1.expect)(
          tx.user.create({
            data: {
              id: (0, core_1.newId)(),
              email: email.toLowerCase(),
              passwordHash: 'x',
              fullName: 'Second',
              updatedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/unique/i);
      });
    });
  });
});
//# sourceMappingURL=constraints.integration.test.js.map
