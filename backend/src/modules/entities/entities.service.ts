import type { CreateEntity, EntityRecord, UpdateEntity } from '@financy/contracts';
import type { Prisma } from '@financy/db';
import {
  ArchivedRecordImmutableError,
  DuplicateNameError,
  InvalidStateTransitionError,
  LastActiveEntityError,
  NotFoundError,
  newId,
} from '@financy/core';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getOrganizationId } from '../../platform/request-context/index.js';

/** What every endpoint here returns, selected in one place so they agree. */
const ENTITY_SELECT = {
  id: true,
  name: true,
  registrationNumber: true,
  countryCode: true,
  functionalCurrency: true,
  status: true,
  archivedAt: true,
  version: true,
} as const;

interface EntityRow {
  id: string;
  name: string;
  registrationNumber: string | null;
  countryCode: string;
  functionalCurrency: string;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: Date | null;
  version: number;
}

/**
 * Legal entities (docs/10 §5.4, task 1.5.2).
 *
 * Entities are **archived, never deleted**. An entity is the counterparty on
 * every transaction, bill, and accounting export beneath it; deleting one
 * would orphan financial history a regulator can ask about years later.
 * `POST /entities/{id}/archive` is therefore the whole of the destructive
 * surface, and there is no `DELETE` route to be tempted by.
 */
@Injectable()
export class EntitiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Live entities, archived ones last.
   *
   * Archived rows are returned rather than hidden: an administrator looking
   * for an entity they archived last month needs to see that it exists and is
   * archived, not an empty list that reads as "it was deleted".
   */
  async list(): Promise<EntityRecord[]> {
    // No `where: { archivedAt: null }`. On MongoDB an optional field that was
    // never written is absent, and Prisma's `null` filter does not match
    // absent, so that predicate silently returns nothing for freshly created
    // rows (ADR-0017). `status` carries the same information and is always set.
    const rows = await this.database.client.entity.findMany({
      select: ENTITY_SELECT,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });

    return rows.map(toRecord);
  }

  async get(id: string): Promise<EntityRecord> {
    // `findFirst`, so the tenant predicate applies. `findUnique` on a primary
    // key bypasses it, and an id belonging to another organisation must be a
    // 404 rather than a row — a caller may never distinguish "does not exist"
    // from "exists, elsewhere".
    const row = await this.database.client.entity.findFirst({
      where: { id },
      select: ENTITY_SELECT,
    });

    if (row === null) throw new NotFoundError('Entity');

    return toRecord(row);
  }

  async create(input: CreateEntity): Promise<EntityRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      // Checked here as well as by `@@unique([organizationId, name])`, because
      // the index raises a Prisma error naming a constraint and the person
      // filling in the form needs to be told which field is wrong. The index
      // is what makes the check true under concurrency; this is what makes it
      // legible.
      const clash = await tx.entity.findFirst({
        where: { organizationId, name: input.name },
        select: { id: true },
      });

      if (clash !== null) {
        throw new DuplicateNameError('Entity', input.name);
      }

      const created = await tx.entity.create({
        data: {
          id: newId(),
          organizationId,
          name: input.name,
          registrationNumber: input.registrationNumber ?? null,
          countryCode: input.countryCode,
          functionalCurrency: input.functionalCurrency,
          status: 'ACTIVE',
        },
        select: ENTITY_SELECT,
      });

      await this.audit.record(tx, {
        action: 'entity.created',
        resourceType: 'entity',
        resourceId: created.id,
        after: {
          name: created.name,
          countryCode: created.countryCode,
          functionalCurrency: created.functionalCurrency,
        },
      });

      return toRecord(created);
    });
  }

  async update(id: string, input: UpdateEntity, expectedVersion: number): Promise<EntityRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.entity.findFirst({
        where: { id, organizationId },
        select: ENTITY_SELECT,
      });

      if (before === null) throw new NotFoundError('Entity');

      guardVersion('Entity', expectedVersion, before.version);

      // An archived entity is a historical record. Renaming it changes how it
      // reads in every export already produced from it, which is the one thing
      // archiving exists to prevent.
      if (before.status === 'ARCHIVED') {
        throw new ArchivedRecordImmutableError('Entity');
      }

      if (input.name !== undefined && input.name !== before.name) {
        const clash = await tx.entity.findFirst({
          where: { organizationId, name: input.name, id: { not: id } },
          select: { id: true },
        });

        if (clash !== null) {
          throw new DuplicateNameError('Entity', input.name);
        }
      }

      const after = await tx.entity.update({
        // `version` in the `where`, not only in `guardVersion` above. Between
        // the read and this line another transaction can commit; without it,
        // that request's change is overwritten and nobody is told.
        where: { id, version: expectedVersion },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.registrationNumber === undefined
            ? {}
            : { registrationNumber: input.registrationNumber }),
          ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode }),
          ...(input.functionalCurrency === undefined
            ? {}
            : { functionalCurrency: input.functionalCurrency }),
          version: { increment: 1 },
        },
        select: ENTITY_SELECT,
      });

      await this.audit.record(tx, {
        action: 'entity.updated',
        resourceType: 'entity',
        resourceId: id,
        before: diff(toRecord(before), toRecord(after)),
        after: diff(toRecord(after), toRecord(before)),
      });

      return toRecord(after);
    });
  }

  /**
   * Archive, or restore.
   *
   * One method with a direction rather than two, because the rule that
   * matters — an organisation keeps at least one active entity — is evaluated
   * against the same snapshot either way, and two implementations of one rule
   * drift.
   */
  async setArchived(id: string, archived: boolean, expectedVersion: number): Promise<EntityRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.entity.findFirst({
        where: { id, organizationId },
        select: ENTITY_SELECT,
      });

      if (before === null) throw new NotFoundError('Entity');

      guardVersion('Entity', expectedVersion, before.version);

      const target = archived ? 'ARCHIVED' : 'ACTIVE';

      if (before.status === target) {
        // A no-op archive is a genuine invalid transition — ACTIVE to ACTIVE —
        // and reporting it stops a double-click from looking like it worked.
        throw new InvalidStateTransitionError('Entity', before.status, target);
      }

      if (archived) {
        // Registration creates exactly one entity, and everything financial
        // hangs off one. An organisation with none can still be logged into
        // and still renders a settings screen, but no spend can be recorded
        // against anything — a dead end reachable by one button click, which
        // is worth refusing rather than supporting.
        const otherActive = await tx.entity.count({
          where: { organizationId, status: 'ACTIVE', id: { not: id } },
        });

        if (otherActive === 0) {
          throw new LastActiveEntityError();
        }
      }

      const after = await tx.entity.update({
        where: { id, version: expectedVersion },
        data: {
          status: target,
          archivedAt: archived ? new Date() : null,
          version: { increment: 1 },
        },
        select: ENTITY_SELECT,
      });

      await this.audit.record(tx, {
        action: archived ? 'entity.archived' : 'entity.restored',
        resourceType: 'entity',
        resourceId: id,
        before: { status: before.status },
        after: { status: after.status },
      });

      return toRecord(after);
    });
  }
}

/**
 * The organisation the request is bound to.
 *
 * Writes run on the unscoped client — `$transaction` on the scoped one would
 * still apply the predicate, but the id has to be written explicitly into
 * `create` anyway — so the tenant is read once, here, and every query below
 * carries it by hand. If the context is missing, that is a programming error
 * upstream of this service, not a request to be answered.
 */
function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Entities cannot be written without a tenant context.');
  }

  return organizationId;
}

function toRecord(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    name: row.name,
    registrationNumber: row.registrationNumber,
    countryCode: row.countryCode,
    functionalCurrency: row.functionalCurrency,
    status: row.status,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    version: row.version,
  };
}

/**
 * The fields of `source` that differ from `other`, for the audit record.
 *
 * Called twice — once each way — so the event's `before` and `after` carry the
 * same key set and a reader can see both sides of one change. `version` is
 * skipped: it always differs after a write and says nothing.
 */
function diff(source: EntityRecord, other: EntityRecord): Prisma.InputJsonObject {
  // Both sides are `EntityRecord`, not the raw row: every field is already a
  // string, a number, or null, so the comparison below is a plain `!==` with
  // no date-versus-string trap in it, and the values are exactly what the
  // audit reader will see rendered.
  //
  // Built as a mutable record and cast once on return — `InputJsonObject` has
  // a read-only index signature, which is right for a value Prisma is about
  // to store and useless for one still being assembled.
  const changed: Record<string, Prisma.InputJsonValue | null> = {};

  for (const key of AUDITED_FIELDS) {
    const mine = source[key];
    // `null` is written as JSON null rather than skipped: "the registration
    // number was cleared" and "the registration number was not touched" are
    // different events, and an omitted key cannot tell them apart.
    if (mine !== other[key]) changed[key] = mine;
  }

  return changed;
}

/**
 * The fields an audit event reports on.
 *
 * Listed rather than derived from the record, so that adding a field to
 * `EntityRecord` is a deliberate decision about whether it belongs in the
 * audit log. `version` is absent: it always differs after a write and tells a
 * reader nothing.
 */
const AUDITED_FIELDS = [
  'name',
  'registrationNumber',
  'countryCode',
  'functionalCurrency',
  'status',
  'archivedAt',
] as const satisfies readonly (keyof EntityRecord)[];
