import { newId } from '@financy/core';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { provisionOrganizationRoles } from '../src/seed/roles.js';

/**
 * What the database enforces — and, deliberately, what it does not.
 *
 * Under PostgreSQL this file proved thirteen guarantees: composite foreign
 * keys refusing a cross-tenant reference, `CHECK` constraints on formats and
 * ranges, and `REVOKE UPDATE, DELETE` making the audit trail immutable. On
 * MongoDB **none of those exist**, and all thirteen failed the moment the
 * connector changed.
 *
 * Deleting them quietly would have been the worst outcome. A file that once
 * said "cross-tenant references are impossible" and now says nothing reads,
 * six months on, as though nobody ever considered it. So the assertions that
 * no longer hold are **inverted** rather than removed: they assert that the
 * database now accepts what it used to refuse, and they name the application
 * code carrying the guarantee instead.
 *
 * If one of those inverted tests ever starts failing, something has begun
 * enforcing the rule again — which is good news, and worth noticing.
 */

const DATABASE_URL = process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL'];

const describeWithDatabase = DATABASE_URL === undefined ? describe.skip : describe;

/** Four bytes, as `Uint8Array<ArrayBuffer>`, which is what Prisma's `Bytes` wants. */
function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(new ArrayBuffer(values.length));
  buffer.set(values);
  return buffer;
}

describeWithDatabase('database guarantees', () => {
  let prisma: PrismaClient;

  const ORG_A = newId();
  const ORG_B = newId();
  const DEPT_A = newId();
  const USER = newId();
  const suffix = newId().slice(0, 8);

  /**
   * MongoDB has no rollback fixture here, so rows are tracked and removed.
   * The PostgreSQL suite wrapped every test in a transaction it threw out —
   * cleaner, order-independent, and not available now.
   */
  const cleanups: Array<() => Promise<unknown>> = [];

  function track(remove: () => Promise<unknown>): void {
    cleanups.push(remove);
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    await prisma.$connect();

    await prisma.organization.createMany({
      data: [ORG_A, ORG_B].map((id, index) => ({
        id,
        slug: `verify-${String(index)}-${suffix}`,
        name: `Verify ${String(index)}`,
        baseCurrency: 'USD',
        countryCode: 'US',
        updatedAt: new Date(),
      })),
    });

    await prisma.department.create({
      data: {
        id: DEPT_A,
        organizationId: ORG_A,
        name: 'Dept A',
        path: `/${DEPT_A}/`,
        updatedAt: new Date(),
      },
    });

    await prisma.user.create({
      data: {
        id: USER,
        email: `verify-${suffix}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: 'Verify User',
        updatedAt: new Date(),
      },
    });

    await prisma.$transaction(async (tx) => {
      await provisionOrganizationRoles(tx, ORG_A);
      await provisionOrganizationRoles(tx, ORG_B);
    });
  }, 90_000);

  afterAll(async () => {
    for (const remove of cleanups.reverse()) await remove().catch(() => null);

    const organizationIds = { in: [ORG_A, ORG_B] };

    await prisma?.rolePermission.deleteMany({
      where: { role: { organizationId: organizationIds } },
    });
    await prisma?.role.deleteMany({ where: { organizationId: organizationIds } });
    await prisma?.membership.deleteMany({ where: { organizationId: organizationIds } });
    await prisma?.department.deleteMany({ where: { organizationId: organizationIds } });
    await prisma?.securityEvent.deleteMany({ where: { organizationId: organizationIds } });
    await prisma?.auditEvent.deleteMany({ where: { organizationId: organizationIds } });
    await prisma?.session.deleteMany({ where: { userId: USER } });
    await prisma?.user.deleteMany({ where: { id: USER } });
    await prisma?.organization.deleteMany({ where: { id: organizationIds } });

    await prisma?.$disconnect();
  }, 90_000);

  async function employeeRoleId(organizationId: string): Promise<string> {
    const role = await prisma.role.findFirst({
      where: { key: 'EMPLOYEE', organizationId },
      select: { id: true },
    });

    /* c8 ignore next 3 -- provisioned in the fixture above. */
    if (role === null) throw new Error(`No EMPLOYEE role for ${organizationId}.`);

    return role.id;
  }

  // ── Still enforced ───────────────────────────────────────────────────────

  describe('unique indexes, which MongoDB does enforce', () => {
    it('refuses two roles with the same key in one organisation', async () => {
      await expect(
        prisma.role.create({
          data: {
            id: newId(),
            organizationId: ORG_A,
            key: 'ORG_ADMIN',
            name: 'Impostor',
            isSystem: true,
            updatedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/unique/i);
    });

    it('refuses a second membership for the same user in one organisation', async () => {
      const id = newId();

      await prisma.membership.create({
        data: {
          id,
          organizationId: ORG_A,
          userId: USER,
          roleId: await employeeRoleId(ORG_A),
          updatedAt: new Date(),
        },
      });
      track(() => prisma.membership.delete({ where: { id } }));

      await expect(
        prisma.membership.create({
          data: {
            id: newId(),
            organizationId: ORG_A,
            userId: USER,
            roleId: await employeeRoleId(ORG_A),
            updatedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/unique/i);
    });

    it('refuses a duplicate session token', async () => {
      const tokenHash = bytes(9, 9, 9, 9);
      const now = Date.now();
      const id = newId();

      await prisma.session.create({
        data: {
          id,
          userId: USER,
          tokenHash,
          idleExpiresAt: new Date(now + 3_600_000),
          absoluteExpiresAt: new Date(now + 7_200_000),
        },
      });
      track(() => prisma.session.delete({ where: { id } }));

      await expect(
        prisma.session.create({
          data: {
            id: newId(),
            userId: USER,
            tokenHash,
            idleExpiresAt: new Date(now + 3_600_000),
            absoluteExpiresAt: new Date(now + 7_200_000),
          },
        }),
      ).rejects.toThrow(/unique/i);
    });
  });

  // ── No longer enforced ───────────────────────────────────────────────────

  describe('guarantees the database no longer carries', () => {
    /**
     * The most serious loss. PostgreSQL used a composite foreign key
     * `(department_id, organization_id)`, so a membership could not name
     * another organisation's department however wrong the code was. What
     * stands between tenants now is the Prisma tenant extension on reads and
     * the services on writes — both application code, both fallible.
     */
    it('accepts a membership pointing at another organisation’s department', async () => {
      const id = newId();

      const membership = await prisma.membership.create({
        data: {
          id,
          organizationId: ORG_B,
          userId: USER,
          roleId: await employeeRoleId(ORG_B),
          departmentId: DEPT_A, // belongs to ORG_A
          updatedAt: new Date(),
        },
      });
      track(() => prisma.membership.delete({ where: { id } }));

      expect(membership.departmentId).toBe(DEPT_A);
      expect(membership.organizationId).toBe(ORG_B);
    });

    it('accepts a currency code that is not ISO-4217', async () => {
      const id = newId();

      const organization = await prisma.organization.create({
        data: {
          id,
          slug: `bad-ccy-${suffix}`,
          name: 'Bad',
          baseCurrency: 'us ',
          countryCode: 'US',
          updatedAt: new Date(),
        },
      });
      track(() => prisma.organization.delete({ where: { id } }));

      // `currencyCodeSchema` rejects this long before it gets here. The
      // database itself would take anything at all.
      expect(organization.baseCurrency).toBe('us ');
    });

    it('accepts a department that is its own parent', async () => {
      const id = newId();

      const department = await prisma.department.create({
        data: {
          id,
          organizationId: ORG_A,
          parentId: id,
          name: 'Self',
          path: `/${id}/`,
          updatedAt: new Date(),
        },
      });
      track(() => prisma.department.delete({ where: { id } }));

      expect(department.parentId).toBe(id);
    });

    it('accepts a session whose idle expiry outlasts its absolute expiry', async () => {
      const id = newId();
      const now = Date.now();

      const session = await prisma.session.create({
        data: {
          id,
          userId: USER,
          tokenHash: bytes(1, 2, 3, 4),
          idleExpiresAt: new Date(now + 2 * 86_400_000),
          absoluteExpiresAt: new Date(now + 3_600_000),
        },
      });
      track(() => prisma.session.delete({ where: { id } }));

      expect(session.idleExpiresAt.getTime()).toBeGreaterThan(session.absoluteExpiresAt.getTime());
    });

    /**
     * Under PostgreSQL the application role held no `UPDATE` grant here, so
     * tampering failed at the database whatever the code did. Immutability now
     * rests entirely on `AuditService` exposing no method that could rewrite a
     * row — a convention, not a permission.
     */
    it('allows an audit event to be edited', async () => {
      const id = newId();

      await prisma.auditEvent.create({
        data: {
          id,
          organizationId: ORG_A,
          actorType: 'SYSTEM',
          actorLabel: 'verify',
          action: 'test.performed',
          resourceType: 'test',
          correlationId: 'verify',
        },
      });
      track(() => prisma.auditEvent.delete({ where: { id } }));

      const tampered = await prisma.auditEvent.update({
        where: { id },
        data: { action: 'tampered' },
      });

      expect(tampered.action).toBe('tampered');
    });

    /**
     * There is no `citext`. Uniqueness of an address holds only because
     * `emailSchema` lower-cases before the write.
     */
    it('treats two casings of one email as two accounts', async () => {
      const address = `Case-${suffix}@Example.test`;
      const first = newId();
      const second = newId();

      await prisma.user.create({
        data: {
          id: first,
          email: address,
          passwordHash: 'x',
          fullName: 'First',
          updatedAt: new Date(),
        },
      });
      track(() => prisma.user.delete({ where: { id: first } }));

      await prisma.user.create({
        data: {
          id: second,
          email: address.toLowerCase(),
          passwordHash: 'x',
          fullName: 'Second',
          updatedAt: new Date(),
        },
      });
      track(() => prisma.user.delete({ where: { id: second } }));

      const both = await prisma.user.findMany({
        where: { id: { in: [first, second] } },
        select: { id: true },
      });

      expect(both).toHaveLength(2);
    });
  });

  // ── The semantic that cost real time ─────────────────────────────────────

  describe('null versus absent', () => {
    /**
     * The regression test for a security bug.
     *
     * An optional field that was never set is **absent** from a MongoDB
     * document, and Prisma's `field: null` filter does not match absent — so
     * `updateMany({ where: { revokedAt: null } })` matched nothing, logout
     * returned `204`, and the session stayed fully usable. The identical code
     * was correct against PostgreSQL, which is what made it dangerous.
     */
    it('does not match an unset optional field with a null filter', async () => {
      const id = newId();
      const now = Date.now();

      await prisma.session.create({
        data: {
          id,
          userId: USER,
          tokenHash: bytes(7, 7, 7, 7),
          idleExpiresAt: new Date(now + 3_600_000),
          absoluteExpiresAt: new Date(now + 7_200_000),
        },
      });
      track(() => prisma.session.delete({ where: { id } }));

      // It reads back as null…
      const read = await prisma.session.findUnique({
        where: { id },
        select: { revokedAt: true },
      });
      expect(read?.revokedAt).toBeNull();

      // …and is still not matched by a null filter.
      const withNullFilter = await prisma.session.updateMany({
        where: { id, revokedAt: null },
        data: { revokedReason: 'SHOULD_NOT_APPLY' },
      });
      expect(withNullFilter.count).toBe(0);

      // Which is why `SessionService.revoke` reads first and updates by id.
      const byId = await prisma.session.updateMany({
        where: { id },
        data: { revokedReason: 'APPLIED' },
      });
      expect(byId.count).toBe(1);
    });
  });
});
