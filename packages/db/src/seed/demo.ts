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
    const categoryIdByKey = new Map<string, string>();

    for (const category of flattenCategories(DEFAULT_CATEGORIES)) {
      const existing = await tx.category.findFirst({
        where: { organizationId, key: category.key },
        select: { id: true },
      });

      if (existing !== null) {
        categoryIdByKey.set(category.key, existing.id);
        continue;
      }

      const id = newId();
      await tx.category.create({
        data: {
          id,
          organizationId,
          key: category.key,
          name: category.name,
          isSystem: true,
          // `flattenCategories` emits parents before children, so the parent
          // is always already in the map.
          parentId:
            category.parentKey === null ? null : (categoryIdByKey.get(category.parentKey) ?? null),
        },
      });

      categoryIdByKey.set(category.key, id);
      result.categoriesCreated += 1;
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
