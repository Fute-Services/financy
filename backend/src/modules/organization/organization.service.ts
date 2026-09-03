import {
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  depthOfPath,
  type OrganizationSummary,
  type OrganizationSettings,
  type UpdateOrganization,
} from '@financy/contracts';
import { CurrencyLockedError, NotFoundError } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
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
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

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
            version: true,
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
        baseCurrencyLocked: await this.isBaseCurrencyLocked(),
        countryCode: organization.countryCode,
        timezone: organization.timezone,
        fiscalYearStartMonth: organization.fiscalYearStartMonth,
        version: organization.version,
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

  /**
   * `PATCH /v1/organization` (docs/10 §5.4).
   *
   * Read, compare versions, write with the version in the `where` clause,
   * audit — all inside one transaction, so a concurrent save cannot land
   * between the check and the write, and the audit event cannot survive a
   * rolled-back change.
   *
   * The returned summary is the *written* row rather than the request body
   * merged onto the old one. They differ whenever the database normalised
   * something, and returning the body would tell the client its edit took
   * effect exactly as sent even when it did not.
   */
  async update(input: UpdateOrganization, expectedVersion: number): Promise<OrganizationSummary> {
    const id = getOrganizationId();

    // The guard binds the tenant before any handler runs, so an absent id
    // here is a wiring mistake upstream — not a request to be answered.
    if (id === undefined) {
      throw new Error('The organisation cannot be updated with no tenant context.');
    }

    // Refused before the transaction opens, because re-denominating an
    // organisation is not something an `If-Match` can make safe: the existing
    // amounts do not convert, they simply start meaning something else.
    if (input.baseCurrency !== undefined && (await this.isBaseCurrencyLocked())) {
      throw new CurrencyLockedError();
    }

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          name: true,
          legalName: true,
          baseCurrency: true,
          countryCode: true,
          timezone: true,
          fiscalYearStartMonth: true,
          version: true,
          createdAt: true,
        },
      });

      if (before === null) throw new NotFoundError('Organization');

      guardVersion('Organization', expectedVersion, before.version);

      const after = await tx.organization.update({
        // `version` in the `where`, not only in the check above. Between the
        // read and this line another transaction can commit; without it, that
        // request's change is overwritten and nobody is told.
        where: { id, version: expectedVersion },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.legalName === undefined ? {} : { legalName: input.legalName }),
          ...(input.baseCurrency === undefined ? {} : { baseCurrency: input.baseCurrency }),
          ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode }),
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
          ...(input.fiscalYearStartMonth === undefined
            ? {}
            : { fiscalYearStartMonth: input.fiscalYearStartMonth }),
          version: { increment: 1 },
        },
        select: {
          id: true,
          slug: true,
          name: true,
          legalName: true,
          baseCurrency: true,
          countryCode: true,
          timezone: true,
          fiscalYearStartMonth: true,
          version: true,
          createdAt: true,
        },
      });

      await this.audit.record(tx, {
        action: 'organization.updated',
        resourceType: 'organization',
        resourceId: id,
        // Only the fields that actually moved. A diff of every column makes
        // the audit log unreadable at exactly the moment somebody is reading
        // it to find out what one person changed.
        before: changedFields(before, after),
        after: changedFields(after, before),
      });

      return {
        id: after.id,
        slug: after.slug,
        name: after.name,
        legalName: after.legalName,
        baseCurrency: after.baseCurrency,
        baseCurrencyLocked: await this.isBaseCurrencyLocked(),
        countryCode: after.countryCode,
        timezone: after.timezone,
        fiscalYearStartMonth: after.fiscalYearStartMonth,
        version: after.version,
        createdAt: after.createdAt.toISOString(),
      };
    });
  }

  /**
   * Whether the base currency may still change.
   *
   * One method, called by both the read and the write, because the screen
   * disabling a field and the endpoint refusing it must never disagree — a
   * form that offers an edit the server rejects is worse than one that
   * explains why the field is locked.
   *
   * Always `false` today: nothing financial exists before Phase 2. When
   * transactions, expenses, and bills arrive, this becomes a existence check
   * across them, and every caller already asks the right question.
   */
  private async isBaseCurrencyLocked(): Promise<boolean> {
    return Promise.resolve(false);
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

/**
 * The fields of `source` that differ from `other`, for the audit record.
 *
 * Called twice — once each way — so the event carries a before and an after
 * containing the same key set. Scalar comparison is enough: every field on
 * this record is a string, a number, or null.
 */
function changedFields<T extends Record<string, unknown>>(
  source: T,
  other: T,
): Prisma.InputJsonObject {
  // A plain record while it is being assembled, cast once on the way out:
  // `InputJsonObject` has a read-only index signature, which is right for a
  // value Prisma is about to store and useless for one still being built.
  const changed: Record<string, Prisma.InputJsonValue> = {};

  for (const [key, value] of Object.entries(source)) {
    // `version` always differs and says nothing; `createdAt` never does.
    if (key === 'version' || key === 'createdAt') continue;
    if (value !== other[key]) changed[key] = value as Prisma.InputJsonValue;
  }

  return changed;
}
