import type { CategoryRecord, CreateCategory, UpdateCategory } from '@financy/contracts';
import {
  ArchivedRecordImmutableError,
  ConflictError,
  DuplicateNameError,
  ForbiddenError,
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

const CATEGORY_SELECT = {
  id: true,
  parentId: true,
  key: true,
  name: true,
  isSystem: true,
  archivedAt: true,
  version: true,
} as const;

interface CategoryRow {
  id: string;
  parentId: string | null;
  key: string;
  name: string;
  isSystem: boolean;
  archivedAt: Date | null;
  version: number;
}

/**
 * The spend category tree (task 1.5.4).
 *
 * Two rules here are stricter than a settings screen usually is, and both
 * exist because a category is not a label — it is what a policy branches on.
 *
 * **The key is create-only.** A policy rule says "airfare over 500 needs
 * finance approval" by naming `travel_airfare`. Editing that key would change
 * what every policy referring to it decides, with nothing in the policy's own
 * history to show why. The display name is editable, which is what people
 * actually want to change.
 *
 * **The tree is two levels.** One forces "Travel" to absorb airfare and
 * mileage, which have different policy treatment; deeper is a chart of
 * accounts, a different artefact with a different owner (Phase 6). A category
 * with a parent cannot itself be a parent.
 *
 * System categories — the seeded ones — may be archived by an organisation
 * that does not use them, but never renamed or re-keyed: a later deploy
 * reseeds by key, and a renamed system row would either be resurrected under
 * its old name or silently duplicated.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CategoryRecord[]> {
    const rows = await this.database.client.category.findMany({
      select: CATEGORY_SELECT,
      orderBy: [{ key: 'asc' }],
    });

    // Depth is walked from parents rather than read from a path: the tree is
    // at most two deep, so there is nothing to materialise.
    const isChild = new Set(rows.filter((row) => row.parentId !== null).map((row) => row.id));

    return rows.map((row) => toRecord(row, isChild.has(row.id) ? 1 : 0));
  }

  async get(id: string): Promise<CategoryRecord> {
    const row = await this.database.client.category.findFirst({
      where: { id },
      select: CATEGORY_SELECT,
    });

    if (row === null) throw new NotFoundError('Category');

    return toRecord(row, row.parentId === null ? 0 : 1);
  }

  async create(input: CreateCategory): Promise<CategoryRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const parentId = input.parentId ?? null;

      if (parentId !== null) {
        const parent = await tx.category.findFirst({
          where: { id: parentId, organizationId },
          select: { parentId: true, archivedAt: true },
        });

        if (parent === null) throw new NotFoundError('Category');

        if (parent.parentId !== null) {
          throw new ConflictError(
            'Categories are two levels deep. Choose a top-level category as the parent.',
          );
        }

        if (parent.archivedAt !== null) {
          throw new ConflictError('That parent category is archived. Restore it first.');
        }
      }

      // Checked here as well as by `@@unique([organizationId, key])`, so the
      // error names the field rather than surfacing as a constraint violation.
      const clash = await tx.category.findFirst({
        where: { organizationId, key: input.key },
        select: { id: true },
      });

      if (clash !== null) {
        throw new ConflictError(`Another category already uses the key "${input.key}".`);
      }

      await this.assertNameFree(tx, organizationId, input.name, parentId, null);

      const created = await tx.category.create({
        data: {
          id: newId(),
          organizationId,
          parentId,
          key: input.key,
          name: input.name,
          // Only the seed creates system categories. A client that could set
          // this could create a row a later deploy would try to own.
          isSystem: false,
        },
        select: CATEGORY_SELECT,
      });

      await this.audit.record(tx, {
        action: 'category.created',
        resourceType: 'category',
        resourceId: created.id,
        after: { key: created.key, name: created.name, parentId: created.parentId },
      });

      return toRecord(created, parentId === null ? 0 : 1);
    });
  }

  async update(
    id: string,
    input: UpdateCategory,
    expectedVersion: number,
  ): Promise<CategoryRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.category.findFirst({
        where: { id, organizationId },
        select: CATEGORY_SELECT,
      });

      if (before === null) throw new NotFoundError('Category');

      guardVersion('Category', expectedVersion, before.version);

      if (before.archivedAt !== null) throw new ArchivedRecordImmutableError('Category');

      if (before.isSystem) {
        throw new ForbiddenError(
          'A system category cannot be renamed. Archive it and create your own instead.',
        );
      }

      if (input.name !== undefined && input.name !== before.name) {
        await this.assertNameFree(tx, organizationId, input.name, before.parentId, id);
      }

      const after = await tx.category.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          version: { increment: 1 },
        },
        select: CATEGORY_SELECT,
      });

      await this.audit.record(tx, {
        action: 'category.updated',
        resourceType: 'category',
        resourceId: id,
        before: { name: before.name },
        after: { name: after.name },
      });

      return toRecord(after, after.parentId === null ? 0 : 1);
    });
  }

  /**
   * Archive, or restore.
   *
   * A system category may be archived — an organisation that never books
   * mileage should not have to look at it — but archiving a parent with live
   * children is refused, for the same reason it is for departments: the
   * cascade cannot be undone without guessing which children it took.
   */
  async setArchived(
    id: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<CategoryRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.category.findFirst({
        where: { id, organizationId },
        select: CATEGORY_SELECT,
      });

      if (before === null) throw new NotFoundError('Category');

      guardVersion('Category', expectedVersion, before.version);

      const isArchived = before.archivedAt !== null;

      if (isArchived === archived) {
        throw new InvalidStateTransitionError(
          'Category',
          isArchived ? 'ARCHIVED' : 'ACTIVE',
          archived ? 'ARCHIVED' : 'ACTIVE',
        );
      }

      if (archived) {
        const children = await tx.category.findMany({
          where: { organizationId, parentId: id },
          select: { archivedAt: true },
        });

        // Filtered here rather than with `archivedAt: null`: on MongoDB an
        // optional field never written is absent, and Prisma's `null` filter
        // does not match absent (ADR-0017), so that predicate would return
        // nothing and the guard would pass for every parent.
        if (children.some((child) => child.archivedAt === null)) {
          throw new ConflictError('This category still has sub-categories. Archive them first.');
        }
      }

      const after = await tx.category.update({
        where: { id, version: expectedVersion },
        data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
        select: CATEGORY_SELECT,
      });

      await this.audit.record(tx, {
        action: archived ? 'category.archived' : 'category.restored',
        resourceType: 'category',
        resourceId: id,
        before: { archivedAt: before.archivedAt?.toISOString() ?? null },
        after: { archivedAt: after.archivedAt?.toISOString() ?? null },
      });

      return toRecord(after, after.parentId === null ? 0 : 1);
    });
  }

  /** Names are unique among siblings, as they are in the department tree. */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    parentId: string | null,
    excludeId: string | null,
  ): Promise<void> {
    const clash = await tx.category.findFirst({
      where: {
        organizationId,
        parentId,
        name,
        ...(excludeId === null ? {} : { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    if (clash !== null) throw new DuplicateNameError('Category', name);
  }
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Categories cannot be written without a tenant context.');
  }

  return organizationId;
}

function toRecord(row: CategoryRow, depth: number): CategoryRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    key: row.key,
    name: row.name,
    isSystem: row.isSystem,
    depth,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    version: row.version,
  };
}
