import { DEFAULT_CATEGORIES, flattenCategories, type RoleKey } from '@financy/contracts';
import { newId } from '@financy/core';

import type { PrismaClient } from '../client.js';
import { provisionOrganizationRoles } from './roles.js';

export interface DemoSeedResult {
  rolesCreated: number;
  grantsAdded: number;
  organizationId: string;
  entitiesCreated: number;
  departmentsCreated: number;
  categoriesCreated: number;
  projectsCreated: number;
  peopleCreated: number;
  membershipsCreated: number;
}

/**
 * How to hash a demo password.
 *
 * Passed in rather than imported. argon2 is a native addon living in
 * `apps/api`, and `@financy/db` is also compiled into contexts that must not
 * pull one in — the architecture lint rules exist to stop exactly that. The
 * caller that has a hasher supplies it; `pnpm db:seed` does not, and simply
 * seeds no people.
 */
export interface DemoSeedOptions {
  hashPassword?: (plaintext: string) => Promise<string>;
}

/**
 * The password every demo account shares.
 *
 * Exported so a test or a script can sign in without duplicating a literal
 * that would then drift. It is a demo credential in a seed that refuses to run
 * outside local, test, and development — not a secret.
 */
export const DEMO_PASSWORD = 'financy-demo-2026-access';

interface PersonTemplate {
  email: string;
  fullName: string;
  /**
   * Typed against the catalogue, not a string. The first draft of this list
   * invented `FINANCE_MANAGER` and `DEPARTMENT_MANAGER`, which typechecked
   * happily and failed at the end of a two-minute transaction against a remote
   * database. A wrong key is now a compile error.
   */
  roleKey: RoleKey;
  departmentCode?: string;
}

/**
 * One person per role, so the permission model is demonstrable rather than
 * merely asserted. Signing in as the auditor and finding the settings screen
 * refused is the only way anyone believes RBAC works.
 */
const DEMO_PEOPLE: readonly PersonTemplate[] = [
  { email: 'demo@financy.app', fullName: 'Ada Lovelace', roleKey: 'ORG_ADMIN' },
  { email: 'finance@acme.test', fullName: 'Grace Hopper', roleKey: 'FINANCE_ADMIN' },
  {
    email: 'manager@acme.test',
    fullName: 'Katherine Johnson',
    roleKey: 'MANAGER',
    departmentCode: 'ENG',
  },
  {
    email: 'employee@acme.test',
    fullName: 'Margaret Hamilton',
    roleKey: 'EMPLOYEE',
    departmentCode: 'ENG-PLT',
  },
  { email: 'auditor@acme.test', fullName: 'Mary Jackson', roleKey: 'AUDITOR' },
];

const ORGANIZATION_SLUG = 'acme';

/** `/parent-id/child-id/` — see the `path` column on `Department`. */
function childPath(parentPath: string, id: string): string {
  return `${parentPath}${id}/`;
}

interface DepartmentTemplate {
  code: string;
  name: string;
  children?: DepartmentTemplate[];
}

const DEPARTMENTS: readonly DepartmentTemplate[] = [
  {
    code: 'ENG',
    name: 'Engineering',
    children: [
      { code: 'ENG-PLT', name: 'Platform' },
      { code: 'ENG-APP', name: 'Product' },
    ],
  },
  { code: 'SAL', name: 'Sales' },
  { code: 'MKT', name: 'Marketing' },
  { code: 'FIN', name: 'Finance' },
  { code: 'OPS', name: 'Operations' },
];

/**
 * A realistic demo organisation.
 *
 * Never runs outside local, test, and development — the entrypoint refuses
 * otherwise, rather than trusting a deployment checklist.
 *
 * Idempotent by natural key (slug, code, key) so re-running it converges
 * instead of accumulating a second Acme. It does not delete anything: a
 * developer who edited a demo department to reproduce a bug should not lose
 * that work to the next `pnpm db:seed`.
 *
 * **People are seeded only when a hasher is supplied.** A membership needs a
 * user and a user needs an argon2id hash, but argon2 is a native addon that
 * lives in `apps/api` and must not be pulled into this package. So the caller
 * passes `hashPassword` in: `pnpm db:seed:demo` does not have one and seeds
 * structure alone, while `pnpm --filter @financy/api seed:demo` does and seeds
 * the five demo accounts. A user written with a hash the real verifier cannot
 * read would be an account that exists and cannot sign in, which is worse than
 * no account at all.
 */
export async function seedDemo(
  prisma: PrismaClient,
  options: DemoSeedOptions = {},
): Promise<DemoSeedResult> {
  const result: DemoSeedResult = {
    organizationId: '',
    rolesCreated: 0,
    grantsAdded: 0,
    entitiesCreated: 0,
    departmentsCreated: 0,
    categoriesCreated: 0,
    projectsCreated: 0,
    peopleCreated: 0,
    membershipsCreated: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      // ── Organisation ──────────────────────────────────────────────────────
      const organization = await tx.organization.upsert({
        where: { slug: ORGANIZATION_SLUG },
        create: {
          id: newId(),
          slug: ORGANIZATION_SLUG,
          name: 'Acme Ltd',
          legalName: 'Acme Limited',
          baseCurrency: 'USD',
          countryCode: 'US',
          timezone: 'America/New_York',
          fiscalYearStartMonth: 1,
        },
        update: {},
        select: { id: true },
      });

      const organizationId = organization.id;
      result.organizationId = organizationId;

      // ── Roles ─────────────────────────────────────────────────────────────
      // Per-organisation, so this is what registration will do too.
      const roles = await provisionOrganizationRoles(tx, organizationId);
      result.rolesCreated = roles.rolesCreated;
      result.grantsAdded = roles.grantsAdded;

      // ── Entities ──────────────────────────────────────────────────────────
      // Two, with different functional currencies, because a single-entity demo
      // hides every currency bug until the day a second entity is added.
      const entities = [
        { name: 'Acme Ltd', countryCode: 'US', functionalCurrency: 'USD' },
        { name: 'Acme Europe BV', countryCode: 'NL', functionalCurrency: 'EUR' },
      ];

      for (const entity of entities) {
        const existing = await tx.entity.findFirst({
          where: { organizationId, name: entity.name },
          select: { id: true },
        });

        if (existing === null) {
          await tx.entity.create({
            data: { id: newId(), organizationId, ...entity },
          });
          result.entitiesCreated += 1;
        }
      }

      // ── Departments ───────────────────────────────────────────────────────
      async function createDepartments(
        templates: readonly DepartmentTemplate[],
        parentId: string | null,
        parentPath: string,
      ): Promise<void> {
        for (const template of templates) {
          const existing = await tx.department.findFirst({
            where: { organizationId, code: template.code },
            select: { id: true, path: true },
          });

          let id: string;
          let path: string;

          if (existing === null) {
            id = newId();
            path = childPath(parentPath, id);

            await tx.department.create({
              data: {
                id,
                organizationId,
                parentId,
                code: template.code,
                name: template.name,
                path,
              },
            });
            result.departmentsCreated += 1;
          } else {
            id = existing.id;
            path = existing.path;
          }

          await createDepartments(template.children ?? [], id, path);
        }
      }

      await createDepartments(DEPARTMENTS, null, '/');

      // ── Categories ────────────────────────────────────────────────────────
      // The same tree every organisation gets at registration, applied here
      // directly so the demo matches a freshly registered organisation.
      // One read and one write, rather than two round trips per category.
      // Thirty-six of each against a remote database is several seconds, and an
      // interactive transaction does not have several seconds to spare.
      const existingCategories = await tx.category.findMany({
        where: { organizationId },
        select: { id: true, key: true },
      });

      const categoryIdByKey = new Map(existingCategories.map((row) => [row.key, row.id]));

      // Ids are generated up front so a child can reference its parent without
      // waiting for the parent's insert to return. `flattenCategories` emits
      // parents before children, so the map is always populated in time.
      const newCategories = flattenCategories(DEFAULT_CATEGORIES)
        .filter((category) => !categoryIdByKey.has(category.key))
        .map((category) => {
          const id = newId();
          categoryIdByKey.set(category.key, id);

          return {
            id,
            organizationId,
            key: category.key,
            name: category.name,
            isSystem: true,
            parentId:
              category.parentKey === null
                ? null
                : (categoryIdByKey.get(category.parentKey) ?? null),
          };
        });

      if (newCategories.length > 0) {
        await tx.category.createMany({ data: newCategories });
        result.categoriesCreated = newCategories.length;
      }

      // ── Projects ──────────────────────────────────────────────────────────
      const engineering = await tx.department.findFirst({
        where: { organizationId, code: 'ENG' },
        select: { id: true },
      });

      const projects = [
        { code: 'PRJ-PLATFORM', name: 'Platform rebuild', departmentId: engineering?.id ?? null },
        { code: 'PRJ-EXPANSION', name: 'EU expansion', departmentId: null },
      ];

      for (const project of projects) {
        const existing = await tx.project.findFirst({
          where: { organizationId, code: project.code },
          select: { id: true },
        });

        if (existing === null) {
          await tx.project.create({
            data: {
              id: newId(),
              organizationId,
              code: project.code,
              name: project.name,
              departmentId: project.departmentId,
            },
          });
          result.projectsCreated += 1;
        }
      }

      // ── People ────────────────────────────────────────────────────────────
      // Skipped entirely when no hasher was supplied. Seeding a user with a
      // hash the real verifier cannot read produces an account that exists and
      // cannot sign in, which is worse than no account.
      const { hashPassword } = options;
      if (hashPassword === undefined) return;

      // Hashed once. argon2id is deliberately expensive — five hashes of the
      // same string is five times the cost for no benefit.
      const passwordHash = await hashPassword(DEMO_PASSWORD);

      for (const person of DEMO_PEOPLE) {
        // By email, which is the natural key. An address may already exist from
        // a registration done by hand, and re-seeding must not fail on it or
        // quietly reset that person's password.
        let user = await tx.user.findUnique({
          where: { email: person.email },
          select: { id: true },
        });

        if (user === null) {
          user = await tx.user.create({
            data: {
              id: newId(),
              email: person.email,
              passwordHash,
              fullName: person.fullName,
              emailVerifiedAt: new Date(),
            },
            select: { id: true },
          });
          result.peopleCreated += 1;
        }

        const roleId = roles.roleIdByKey.get(person.roleKey);

        /* c8 ignore next 5 -- provisionOrganizationRoles writes all five keys. */
        if (roleId === undefined) {
          throw new Error(
            `Demo person ${person.email} wants role ${person.roleKey}, which was not provisioned.`,
          );
        }

        const departmentId =
          person.departmentCode === undefined
            ? null
            : ((
                await tx.department.findFirst({
                  where: { organizationId, code: person.departmentCode },
                  select: { id: true },
                })
              )?.id ?? null);

        const existingMembership = await tx.membership.findFirst({
          where: { organizationId, userId: user.id },
          select: { id: true },
        });

        if (existingMembership === null) {
          await tx.membership.create({
            data: { id: newId(), organizationId, userId: user.id, roleId, departmentId },
          });
          result.membershipsCreated += 1;
        }
      }
    },
    {
      // The default five seconds is a local-database default. This transaction
      // provisions five roles and 185 grants, writes 36 categories, and hashes
      // an argon2id password, all against a remote cluster.
      maxWait: 30_000,
      timeout: 120_000,
    },
  );

  return result;
}
