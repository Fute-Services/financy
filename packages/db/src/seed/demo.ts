import { DEFAULT_CATEGORIES, flattenCategories } from '@financy/contracts';
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
}

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
 * **People are deliberately absent.** A membership needs a user, a user needs
 * an argon2id password hash, and the hasher lives in `apps/api` with the rest
 * of authentication (task 1.3.1) — it cannot move into this package, because
 * `@financy/core` is also compiled into the browser bundle and a native crypto
 * addon has no business there. Seeding a user with a hash the real verifier
 * cannot read would produce an account that exists and cannot sign in, which
 * is worse than no account. Demo people arrive with task 1.3.1.
 */
export async function seedDemo(prisma: PrismaClient): Promise<DemoSeedResult> {
  const result: DemoSeedResult = {
    organizationId: '',
    rolesCreated: 0,
    grantsAdded: 0,
    entitiesCreated: 0,
    departmentsCreated: 0,
    categoriesCreated: 0,
    projectsCreated: 0,
  };

  await prisma.$transaction(async (tx) => {
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
            category.parentKey === null ? null : (categoryIdByKey.get(category.parentKey) ?? null),
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
  });

  return result;
}
