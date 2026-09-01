import type { CreateProject, ProjectRecord, UpdateProject } from '@financy/contracts';
import {
  ArchivedRecordImmutableError,
  ConflictError,
  DuplicateNameError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getOrganizationId } from '../../platform/request-context/index.js';

const PROJECT_SELECT = {
  id: true,
  name: true,
  code: true,
  entityId: true,
  departmentId: true,
  status: true,
  startsOn: true,
  endsOn: true,
  archivedAt: true,
  version: true,
} as const;

interface ProjectRow {
  id: string;
  name: string;
  code: string | null;
  entityId: string | null;
  departmentId: string | null;
  status: 'ACTIVE' | 'CLOSED';
  startsOn: Date | null;
  endsOn: Date | null;
  archivedAt: Date | null;
  version: number;
}

/**
 * Projects — the second dimension spend is coded to (task 1.5.4).
 *
 * A project may name an entity and a department, and both are validated
 * against the caller's own organisation. That check is the entire reason this
 * service is longer than a CRUD wrapper: PostgreSQL made a cross-tenant
 * reference impossible with a composite foreign key, and on MongoDB nothing
 * does (ADR-0017), so a `projects.departmentId` pointing at another
 * customer's department is a write the database would happily accept.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ProjectRecord[]> {
    const rows = await this.database.client.project.findMany({
      select: PROJECT_SELECT,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });

    return rows.map(toRecord);
  }

  async get(id: string): Promise<ProjectRecord> {
    const row = await this.database.client.project.findFirst({
      where: { id },
      select: PROJECT_SELECT,
    });

    if (row === null) throw new NotFoundError('Project');

    return toRecord(row);
  }

  async create(input: CreateProject): Promise<ProjectRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      await this.assertNameFree(tx, organizationId, input.name, null);
      await this.assertCodeFree(tx, organizationId, input.code ?? null, null);
      await this.assertEntityIsOurs(tx, organizationId, input.entityId ?? null);
      await this.assertDepartmentIsOurs(tx, organizationId, input.departmentId ?? null);

      const created = await tx.project.create({
        data: {
          id: newId(),
          organizationId,
          name: input.name,
          code: input.code ?? null,
          entityId: input.entityId ?? null,
          departmentId: input.departmentId ?? null,
          status: 'ACTIVE',
          startsOn: toDate(input.startsOn ?? null),
          endsOn: toDate(input.endsOn ?? null),
        },
        select: PROJECT_SELECT,
      });

      await this.audit.record(tx, {
        action: 'project.created',
        resourceType: 'project',
        resourceId: created.id,
        after: { name: created.name, code: created.code, departmentId: created.departmentId },
      });

      return toRecord(created);
    });
  }

  async update(id: string, input: UpdateProject, expectedVersion: number): Promise<ProjectRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.project.findFirst({
        where: { id, organizationId },
        select: PROJECT_SELECT,
      });

      if (before === null) throw new NotFoundError('Project');

      guardVersion('Project', expectedVersion, before.version);

      if (before.archivedAt !== null) throw new ArchivedRecordImmutableError('Project');

      if (input.name !== undefined && input.name !== before.name) {
        await this.assertNameFree(tx, organizationId, input.name, id);
      }

      if (input.code !== undefined && input.code !== before.code) {
        await this.assertCodeFree(tx, organizationId, input.code, id);
      }

      if (input.entityId !== undefined) {
        await this.assertEntityIsOurs(tx, organizationId, input.entityId);
      }

      if (input.departmentId !== undefined) {
        await this.assertDepartmentIsOurs(tx, organizationId, input.departmentId);
      }

      // The schema checks the window only against the fields it was sent. A
      // PATCH moving just `endsOn` to before an existing `startsOn` passes it
      // and has to be caught here, where both halves are known.
      this.assertWindowOrder(
        input.startsOn === undefined ? toIsoDate(before.startsOn) : input.startsOn,
        input.endsOn === undefined ? toIsoDate(before.endsOn) : input.endsOn,
      );

      const after = await tx.project.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.code === undefined ? {} : { code: input.code }),
          ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.startsOn === undefined ? {} : { startsOn: toDate(input.startsOn) }),
          ...(input.endsOn === undefined ? {} : { endsOn: toDate(input.endsOn) }),
          version: { increment: 1 },
        },
        select: PROJECT_SELECT,
      });

      await this.audit.record(tx, {
        action: 'project.updated',
        resourceType: 'project',
        resourceId: id,
        before: diff(toRecord(before), toRecord(after)),
        after: diff(toRecord(after), toRecord(before)),
      });

      return toRecord(after);
    });
  }

  /**
   * Close, or reopen.
   *
   * Distinct from archiving: a **closed** project is finished and still shows
   * in reports; an **archived** one was created in error or is no longer
   * relevant and drops out of the pickers. Collapsing them would make
   * "this project ended" and "this project should never have existed" the
   * same event in the audit log.
   */
  async setStatus(
    id: string,
    status: 'ACTIVE' | 'CLOSED',
    expectedVersion: number,
  ): Promise<ProjectRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.project.findFirst({
        where: { id, organizationId },
        select: PROJECT_SELECT,
      });

      if (before === null) throw new NotFoundError('Project');

      guardVersion('Project', expectedVersion, before.version);

      if (before.archivedAt !== null) throw new ArchivedRecordImmutableError('Project');

      if (before.status === status) {
        throw new InvalidStateTransitionError('Project', before.status, status);
      }

      const after = await tx.project.update({
        where: { id, version: expectedVersion },
        data: { status, version: { increment: 1 } },
        select: PROJECT_SELECT,
      });

      await this.audit.record(tx, {
        action: status === 'CLOSED' ? 'project.closed' : 'project.reopened',
        resourceType: 'project',
        resourceId: id,
        before: { status: before.status },
        after: { status: after.status },
      });

      return toRecord(after);
    });
  }

  async setArchived(
    id: string,
    archived: boolean,
    expectedVersion: number,
  ): Promise<ProjectRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.project.findFirst({
        where: { id, organizationId },
        select: PROJECT_SELECT,
      });

      if (before === null) throw new NotFoundError('Project');

      guardVersion('Project', expectedVersion, before.version);

      const isArchived = before.archivedAt !== null;

      if (isArchived === archived) {
        throw new InvalidStateTransitionError(
          'Project',
          isArchived ? 'ARCHIVED' : before.status,
          archived ? 'ARCHIVED' : 'ACTIVE',
        );
      }

      const after = await tx.project.update({
        where: { id, version: expectedVersion },
        data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
        select: PROJECT_SELECT,
      });

      await this.audit.record(tx, {
        action: archived ? 'project.archived' : 'project.restored',
        resourceType: 'project',
        resourceId: id,
        before: { archivedAt: before.archivedAt?.toISOString() ?? null },
        after: { archivedAt: after.archivedAt?.toISOString() ?? null },
      });

      return toRecord(after);
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private assertWindowOrder(startsOn: string | null, endsOn: string | null): void {
    if (startsOn === null || endsOn === null) return;
    if (endsOn >= startsOn) return;

    throw new ValidationError({ endsOn: ['A project cannot end before it starts.'] });
  }

  private async assertNameFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    excludeId: string | null,
  ): Promise<void> {
    const clash = await tx.project.findFirst({
      where: { organizationId, name, ...(excludeId === null ? {} : { id: { not: excludeId } }) },
      select: { id: true },
    });

    if (clash !== null) throw new DuplicateNameError('Project', name);
  }

  private async assertCodeFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    code: string | null,
    excludeId: string | null,
  ): Promise<void> {
    if (code === null) return;

    const clash = await tx.project.findFirst({
      where: { organizationId, code, ...(excludeId === null ? {} : { id: { not: excludeId } }) },
      select: { id: true },
    });

    if (clash !== null) {
      throw new ConflictError(`Another project already uses the code "${code}".`);
    }
  }

  /**
   * The entity must be ours, and active.
   *
   * A 404 rather than a 403 for one belonging to another organisation: the
   * field must not become a way to test whether an id exists elsewhere
   * (docs/10 §6).
   */
  private async assertEntityIsOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    entityId: string | null,
  ): Promise<void> {
    if (entityId === null) return;

    const entity = await tx.entity.findFirst({
      where: { id: entityId, organizationId },
      select: { status: true },
    });

    if (entity === null) throw new NotFoundError('Entity');

    if (entity.status !== 'ACTIVE') {
      throw new ConflictError('That entity is archived. Choose an active one.');
    }
  }

  private async assertDepartmentIsOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    departmentId: string | null,
  ): Promise<void> {
    if (departmentId === null) return;

    const department = await tx.department.findFirst({
      where: { id: departmentId, organizationId },
      select: { archivedAt: true },
    });

    if (department === null) throw new NotFoundError('Department');

    if (department.archivedAt !== null) {
      throw new ConflictError('That department is archived. Choose an active one.');
    }
  }
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Projects cannot be written without a tenant context.');
  }

  return organizationId;
}

/**
 * `YYYY-MM-DD` to the instant the database stores.
 *
 * Midnight UTC, deliberately and consistently. A project starting "on the
 * 3rd" starts on the 3rd; anchoring it to the server's local midnight would
 * make the stored value depend on where the process happens to run, and a
 * deploy to a different region would move every project's window by a day.
 */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

/** Back out again, taking the UTC calendar day rather than the local one. */
function toIsoDate(value: Date | null): string | null {
  return value === null ? null : (value.toISOString().split('T')[0] ?? null);
}

function toRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    entityId: row.entityId,
    departmentId: row.departmentId,
    status: row.status,
    startsOn: toIsoDate(row.startsOn),
    endsOn: toIsoDate(row.endsOn),
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    version: row.version,
  };
}

const AUDITED_FIELDS = [
  'name',
  'code',
  'entityId',
  'departmentId',
  'status',
  'startsOn',
  'endsOn',
  'archivedAt',
] as const satisfies readonly (keyof ProjectRecord)[];

function diff(source: ProjectRecord, other: ProjectRecord): Prisma.InputJsonObject {
  const changed: Record<string, Prisma.InputJsonValue | null> = {};

  for (const key of AUDITED_FIELDS) {
    const mine = source[key];
    if (mine !== other[key]) changed[key] = mine;
  }

  return changed;
}
