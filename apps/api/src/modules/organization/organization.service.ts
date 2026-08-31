import {
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  depthOfPath,
  type OrganizationSettings,
} from '@financy/contracts';
import { NotFoundError } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';
import { getOrganizationId } from '../../platform/request-context/index.js';

/**
 * The organisation and its structure.
 *
 * One read assembling everything the settings screen shows. Four endpoints
 * would each be smaller, and the screen would then render in four stages with
 * three intermediate states nobody designed.
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly database: DatabaseService) {}

  async settings(): Promise<OrganizationSettings> {
    const client = this.database.client;

    // Independent reads, issued together. Sequentially this is six round trips
    // to a remote cluster; in parallel it is one wait.
    const [organization, entities, departments, categories, roles, memberCounts] =
      await Promise.all([
        // `where` is mandatory here, and the reason is easy to miss:
        // `Organization` is a **global** model in the tenant registry, because
        // scoping the tenant by its own tenant id would be circular. So the
        // extension adds no predicate, and a bare `findFirst()` returns
        // whichever organisation the database happened to return first —
        // somebody else's. The e2e suite caught exactly that. Access to an
        // organisation row is controlled by the caller's membership, which is
        // what `getOrganizationId()` reads.
        client.organization.findUnique({
          where: { id: getOrganizationId() },
          select: {
            id: true,
            slug: true,
            name: true,
            legalName: true,
            baseCurrency: true,
            countryCode: true,
            timezone: true,
            fiscalYearStartMonth: true,
            createdAt: true,
          },
        }),
        // No `where: { archivedAt: null }` on either of these, and that is not
        // an oversight.
        //
        // On MongoDB an optional field that was never written is **absent**,
        // and Prisma's `field: null` filter does not match absent — so that
        // predicate returns *nothing at all* for freshly created rows. It cost
        // a broken logout once already (ADR-0017), and it silently emptied
        // this screen until the e2e suite caught it. Archived rows are dropped
        // below, in JavaScript, which behaves the same on either substrate.
        client.entity.findMany({
          select: {
            id: true,
            name: true,
            registrationNumber: true,
            countryCode: true,
            functionalCurrency: true,
            status: true,
            archivedAt: true,
          },
          orderBy: [{ name: 'asc' }],
        }),
        client.department.findMany({
          select: {
            id: true,
            parentId: true,
            name: true,
            code: true,
            path: true,
            archivedAt: true,
          },
          // By path, so a parent always precedes its children and the client
          // can render the tree by indenting rows in the order given — no
          // second pass, no sorting in the browser.
          orderBy: [{ path: 'asc' }],
        }),
        client.category.findMany({
          select: { id: true, parentId: true, key: true, name: true, isSystem: true },
          orderBy: [{ name: 'asc' }],
        }),
        client.role.findMany({
          select: {
            key: true,
            name: true,
            description: true,
            _count: { select: { permissions: true } },
          },
        }),
        // Counted in JavaScript rather than with `groupBy`.
        //
        // `membership.groupBy({ by: [...], _count: { _all: true } })` makes
        // Prisma's MongoDB query engine panic outright — not an error, a
        // panic — so the aggregation cannot run in the database. Reading the
        // two columns and tallying them here is correct on any substrate and
        // costs nothing at this size: memberships are bounded by the number of
        // people in one organisation, and the projection is two ids per row.
        // Revisit if an organisation ever has enough members for this to
        // matter, by which point PostgreSQL is back and `groupBy` works.
        client.membership.findMany({ select: { roleId: true, departmentId: true } }),
      ]);

    if (organization === null) {
      // The tenant scope guarantees the id; a miss means the organisation was
      // deleted between authenticating and reading, which is a 404 and not a
      // 500 — the caller's session is fine, the resource is gone.
      throw new NotFoundError('Organization');
    }

    const liveDepartments = departments.filter((department) => department.archivedAt === null);

    const departmentMemberCounts = new Map<string, number>();
    const roleMemberCounts = new Map<string, number>();

    for (const row of memberCounts) {
      roleMemberCounts.set(row.roleId, (roleMemberCounts.get(row.roleId) ?? 0) + 1);

      if (row.departmentId !== null) {
        departmentMemberCounts.set(
          row.departmentId,
          (departmentMemberCounts.get(row.departmentId) ?? 0) + 1,
        );
      }
    }

    const rolesById = await this.roleMemberCountsByKey(roleMemberCounts);

    // The category tree's depth cannot come from a path — categories have no
    // materialised one, being at most two deep — so it is walked from parents.
    const categoryDepth = new Map<string, number>();
    for (const category of categories) {
      categoryDepth.set(
        category.id,
        category.parentId === null ? 0 : (categoryDepth.get(category.parentId) ?? 0) + 1,
      );
    }

    return {
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        legalName: organization.legalName,
        baseCurrency: organization.baseCurrency,
        // Nothing financial exists before Phase 2, so nothing can lock it yet.
        // Stated as a computed value rather than a hard `false` so that the
        // screen already renders the locked case correctly when it arrives.
        baseCurrencyLocked: false,
        countryCode: organization.countryCode,
        timezone: organization.timezone,
        fiscalYearStartMonth: organization.fiscalYearStartMonth,
        createdAt: organization.createdAt.toISOString(),
      },
      entities: entities
        .filter((entity) => entity.archivedAt === null)
        .map(({ archivedAt: _archivedAt, ...entity }) => entity),
      departments: liveDepartments.map((department) => ({
        id: department.id,
        parentId: department.parentId,
        name: department.name,
        code: department.code,
        path: department.path,
        depth: depthOfPath(department.path),
        memberCount: departmentMemberCounts.get(department.id) ?? 0,
      })),
      categories: categories.map((category) => ({
        id: category.id,
        parentId: category.parentId,
        key: category.key,
        name: category.name,
        isSystem: category.isSystem,
        depth: categoryDepth.get(category.id) ?? 0,
      })),
      roleCounts: ROLE_KEYS.map((key) => {
        const role = roles.find((candidate) => candidate.key === key);

        return {
          key,
          name: role?.name ?? key,
          description: role?.description ?? ROLE_DESCRIPTIONS[key],
          memberCount: rolesById.get(key) ?? 0,
          // From the catalogue rather than the join table when the role is
          // somehow absent, so the number shown is the number the code grants.
          permissionCount: role?._count.permissions ?? ROLE_PERMISSIONS[key].length,
        };
      }),
    };
  }

  /** Re-key the per-role counts from role id to role key. */
  private async roleMemberCountsByKey(byId: Map<string, number>): Promise<Map<string, number>> {
    if (byId.size === 0) return new Map();

    const roles = await this.database.client.role.findMany({
      where: { id: { in: [...byId.keys()] } },
      select: { id: true, key: true },
    });

    return new Map(roles.map((role) => [role.key, byId.get(role.id) ?? 0]));
  }
}
