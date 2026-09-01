import {
  depthOfPath,
  isWithinSubtree,
  pathUnder,
  type CreateDepartment,
  type DepartmentRecord,
  type UpdateDepartment,
} from '@financy/contracts';
import {
  ArchivedRecordImmutableError,
  ConflictError,
  CyclicHierarchyError,
  DuplicateNameError,
  InvalidStateTransitionError,
  NotFoundError,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getOrganizationId } from '../../platform/request-context/index.js';

const DEPARTMENT_SELECT = {
  id: true,
  parentId: true,
  name: true,
  code: true,
  path: true,
  headMembershipId: true,
  archivedAt: true,
  version: true,
} as const;

interface DepartmentRow {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  path: string;
  headMembershipId: string | null;
  archivedAt: Date | null;
  version: number;
}

/**
 * The department tree (docs/09 §7.6, docs/10 §5.4, task 1.5.3).
 *
 * Three things here are worth more attention than their line count suggests.
 *
 * **The `path` is derived, never sent.** It is `/root-id/child-id/`,
 * delimited at both ends, and it exists so a subtree read is one `startsWith`
 * instead of a recursive query. PostgreSQL enforced the delimiters with a
 * `CHECK`; on MongoDB nothing does, and an undelimited path makes `/a/bc/`
 * match a query for `/a/b/` — which silently widens a manager's scope to a
 * department they do not manage. `pathUnder` is the only thing that builds
 * one, and it is shared with the client.
 *
 * **A move rewrites the whole subtree.** Re-parenting a node changes the path
 * of every descendant, and the rewrite happens in the same transaction as the
 * move. A partial rewrite leaves descendants claiming an ancestry that no
 * longer exists, and every scope check beneath them then answers wrongly
 * rather than failing.
 *
 * **A cycle is refused before anything is written.** Re-parenting a node
 * beneath its own descendant detaches that subtree from the tree and makes
 * the downward rewrite loop. `isWithinSubtree` is the check, and it runs on
 * the paths rather than by walking parents, so it costs one comparison
 * regardless of depth.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The whole tree, in path order.
   *
   * Ordered by path, so a parent always precedes its children and a client
   * renders the tree by indenting rows in the order given — no second pass,
   * no sorting in the browser.
   */
  async list(): Promise<DepartmentRecord[]> {
    const rows = await this.database.client.department.findMany({
      select: DEPARTMENT_SELECT,
      orderBy: [{ path: 'asc' }],
    });

    return rows.map(toRecord);
  }

  async get(id: string): Promise<DepartmentRecord> {
    const row = await this.database.client.department.findFirst({
      where: { id },
      select: DEPARTMENT_SELECT,
    });

    if (row === null) throw new NotFoundError('Department');

    return toRecord(row);
  }

  async create(input: CreateDepartment): Promise<DepartmentRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const parent = await this.resolveParent(tx, organizationId, input.parentId ?? null);

      await this.assertNameFree(tx, organizationId, input.name, parent?.id ?? null, null);
      await this.assertCodeFree(tx, organizationId, input.code ?? null, null);
      await this.assertHeadIsOurs(tx, organizationId, input.headMembershipId ?? null);

      // The id is generated here rather than by the database, because the path
      // contains it and the row cannot be written until the path is known.
      const id = newId();

      const created = await tx.department.create({
        data: {
          id,
          organizationId,
          parentId: parent?.id ?? null,
          name: input.name,
          code: input.code ?? null,
          headMembershipId: input.headMembershipId ?? null,
          path: pathUnder(parent?.path ?? null, id),
        },
        select: DEPARTMENT_SELECT,
      });

      await this.audit.record(tx, {
        action: 'department.created',
        resourceType: 'department',
        resourceId: id,
        after: { name: created.name, code: created.code, parentId: created.parentId },
      });

      return toRecord(created);
    });
  }

  async update(
    id: string,
    input: UpdateDepartment,
    expectedVersion: number,
  ): Promise<DepartmentRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.department.findFirst({
        where: { id, organizationId },
        select: DEPARTMENT_SELECT,
      });

      if (before === null) throw new NotFoundError('Department');

      guardVersion('Department', expectedVersion, before.version);

      if (before.archivedAt !== null) throw new ArchivedRecordImmutableError('Department');

      // `undefined` means "leave it"; `null` means "make it a root". The two
      // must not collapse, or clearing a parent becomes impossible to express.
      const reparenting = input.parentId !== undefined && input.parentId !== before.parentId;
      const parent = reparenting
        ? await this.resolveParent(tx, organizationId, input.parentId ?? null)
        : null;

      if (reparenting && parent !== null) {
        // The cycle check, on paths rather than by walking parents: one
        // comparison regardless of depth. A node may not move beneath itself
        // or beneath any of its own descendants.
        if (isWithinSubtree(parent.path, before.path)) {
          throw new CyclicHierarchyError('Department');
        }
      }

      const nextParentId = reparenting ? (parent?.id ?? null) : before.parentId;

      if (input.name !== undefined && input.name !== before.name) {
        await this.assertNameFree(tx, organizationId, input.name, nextParentId, id);
      } else if (reparenting) {
        // Moving a node into a sibling set that already has this name is the
        // same collision arriving by a different route.
        await this.assertNameFree(tx, organizationId, before.name, nextParentId, id);
      }

      if (input.code !== undefined && input.code !== before.code) {
        await this.assertCodeFree(tx, organizationId, input.code, id);
      }

      if (input.headMembershipId !== undefined) {
        await this.assertHeadIsOurs(tx, organizationId, input.headMembershipId);
      }

      const nextPath = reparenting ? pathUnder(parent?.path ?? null, id) : before.path;

      const after = await tx.department.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.code === undefined ? {} : { code: input.code }),
          ...(input.headMembershipId === undefined
            ? {}
            : { headMembershipId: input.headMembershipId }),
          ...(reparenting ? { parentId: nextParentId, path: nextPath } : {}),
          version: { increment: 1 },
        },
        select: DEPARTMENT_SELECT,
      });

      const movedCount = reparenting
        ? await this.rewriteSubtree(tx, organizationId, before.path, nextPath)
        : 0;

      await this.audit.record(tx, {
        action: reparenting ? 'department.moved' : 'department.updated',
        resourceType: 'department',
        resourceId: id,
        before: diff(toRecord(before), toRecord(after)),
        after: diff(toRecord(after), toRecord(before)),
        // How many descendants had their ancestry rewritten. A move that
        // silently re-homed forty people should not read the same in the log
        // as one that re-homed nobody.
        ...(reparenting ? { metadata: { descendantsRepathed: movedCount } } : {}),
      });

      return toRecord(after);
    });
  }

  /**
   * Archive, or restore.
   *
   * Archiving refuses while the department still has live children or active
   * members. Cascading would archive rows nobody asked about — and on the way
   * back, restoring the parent cannot know which children were archived by
   * the cascade and which were already archived on their own.
   */
  async setArchived(
    id: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<DepartmentRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.department.findFirst({
        where: { id, organizationId },
        select: DEPARTMENT_SELECT,
      });

      if (before === null) throw new NotFoundError('Department');

      guardVersion('Department', expectedVersion, before.version);

      const isArchived = before.archivedAt !== null;

      if (isArchived === archived) {
        throw new InvalidStateTransitionError(
          'Department',
          isArchived ? 'ARCHIVED' : 'ACTIVE',
          archived ? 'ARCHIVED' : 'ACTIVE',
        );
      }

      if (archived) {
        const children = await tx.department.findMany({
          where: { organizationId, parentId: id },
          select: { id: true, archivedAt: true },
        });

        // Filtered here rather than with `archivedAt: null`, because on
        // MongoDB an optional field never written is absent and Prisma's
        // `null` filter does not match absent (ADR-0017) — that predicate
        // would return nothing and the guard would pass for every parent.
        if (children.some((child) => child.archivedAt === null)) {
          throw new ConflictError(
            'This department still has sub-departments. Archive or move them first.',
          );
        }

        const members = await tx.membership.count({
          where: { organizationId, departmentId: id, status: 'ACTIVE' },
        });

        if (members > 0) {
          throw new ConflictError(
            `This department still has ${String(members)} active member${members === 1 ? '' : 's'}. Move them to another department first.`,
          );
        }
      }

      const after = await tx.department.update({
        where: { id, version: expectedVersion },
        data: {
          archivedAt: archived ? new Date() : null,
          // A department nobody heads, once archived. Leaving the head in
          // place makes an archived department keep appearing in that
          // person's "departments I head", which is not true any more.
          ...(archived ? { headMembershipId: null } : {}),
          version: { increment: 1 },
        },
        select: DEPARTMENT_SELECT,
      });

      await this.audit.record(tx, {
        action: archived ? 'department.archived' : 'department.restored',
        resourceType: 'department',
        resourceId: id,
        before: { archivedAt: before.archivedAt?.toISOString() ?? null },
        after: { archivedAt: after.archivedAt?.toISOString() ?? null },
      });

      return toRecord(after);
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Rewrite every descendant's path after a move.
   *
   * One read of the subtree and one update per row, inside the caller's
   * transaction. Prisma's MongoDB connector cannot express "replace a prefix"
   * in an `updateMany`, so the substitution happens here; the subtree of one
   * organisation's department tree is small enough that this is a non-issue,
   * and doing it wrong is not.
   */
  private async rewriteSubtree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    oldPath: string,
    newPath: string,
  ): Promise<number> {
    const descendants = await tx.department.findMany({
      // `startsWith` on the *old* path, read before the parent row was
      // updated — the descendants still carry it.
      where: { organizationId, path: { startsWith: oldPath } },
      select: { id: true, path: true },
    });

    let rewritten = 0;

    for (const descendant of descendants) {
      // The moved node itself was already updated by the caller.
      if (descendant.path === oldPath) continue;

      await tx.department.update({
        where: { id: descendant.id },
        data: { path: newPath + descendant.path.slice(oldPath.length) },
      });

      rewritten += 1;
    }

    return rewritten;
  }

  /** The parent row, or `null` for a root. A missing parent is a 404. */
  private async resolveParent(
    tx: Prisma.TransactionClient,
    organizationId: string,
    parentId: string | null,
  ): Promise<{ id: string; path: string } | null> {
    if (parentId === null) return null;

    const parent = await tx.department.findFirst({
      where: { id: parentId, organizationId },
      select: { id: true, path: true, archivedAt: true },
    });

    // A 404 rather than a 403 for a parent in another organisation: a caller
    // must not learn that an id exists somewhere (docs/10 §6).
    if (parent === null) throw new NotFoundError('Department');

    if (parent.archivedAt !== null) {
      throw new ConflictError('That parent department is archived. Restore it first.');
    }

    return { id: parent.id, path: parent.path };
  }

  /**
   * Names are unique among siblings, not across the organisation.
   *
   * Two departments called "Operations" under different parents is ordinary;
   * two under the same parent is a tree nobody can navigate, because the only
   * thing distinguishing the rows on screen is an id the reader cannot see.
   */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    parentId: string | null,
    excludeId: string | null,
  ): Promise<void> {
    const clash = await tx.department.findFirst({
      where: {
        organizationId,
        parentId,
        name,
        ...(excludeId === null ? {} : { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    if (clash !== null) throw new DuplicateNameError('Department', name);
  }

  /**
   * Codes are unique across the organisation when set.
   *
   * Enforced here rather than by a unique index: MongoDB treats every missing
   * value in a unique index as the same value, so `@@unique([organizationId,
   * code])` would allow exactly one department without a code — a rule nobody
   * asked for (see the schema comment on `departments`).
   */
  private async assertCodeFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    code: string | null,
    excludeId: string | null,
  ): Promise<void> {
    if (code === null) return;

    const clash = await tx.department.findFirst({
      where: {
        organizationId,
        code,
        ...(excludeId === null ? {} : { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    if (clash !== null) {
      throw new ConflictError(`Another department already uses the code "${code}".`);
    }
  }

  /** The head must be an active membership of this organisation. */
  private async assertHeadIsOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    headMembershipId: string | null,
  ): Promise<void> {
    if (headMembershipId === null) return;

    const membership = await tx.membership.findFirst({
      where: { id: headMembershipId, organizationId },
      select: { status: true },
    });

    // 404, not 403: the field must not become a way to test whether a
    // membership id exists in some other organisation.
    if (membership === null) throw new NotFoundError('Membership');

    if (membership.status !== 'ACTIVE') {
      throw new ConflictError('A deactivated member cannot head a department.');
    }
  }
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Departments cannot be written without a tenant context.');
  }

  return organizationId;
}

function toRecord(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    path: row.path,
    depth: depthOfPath(row.path),
    headMembershipId: row.headMembershipId,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    version: row.version,
  };
}

/** The audited fields, listed so adding one to the record is a decision. */
const AUDITED_FIELDS = [
  'name',
  'code',
  'parentId',
  'path',
  'headMembershipId',
  'archivedAt',
] as const satisfies readonly (keyof DepartmentRecord)[];

function diff(source: DepartmentRecord, other: DepartmentRecord): Prisma.InputJsonObject {
  const changed: Record<string, Prisma.InputJsonValue | null> = {};

  for (const key of AUDITED_FIELDS) {
    const mine = source[key];
    if (mine !== other[key]) changed[key] = mine;
  }

  return changed;
}
