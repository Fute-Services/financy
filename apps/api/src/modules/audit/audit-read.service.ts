import {
  AUDIT_EXPORT_MAX_ROWS,
  type AuditEvent,
  type ExportAuditEventsQuery,
  type ListAuditEventsQuery,
} from '@financy/contracts';
import { ValidationError } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';

export interface AuditPage {
  readonly items: AuditEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The columns every read here projects, named once so the list, the history,
 * and the export cannot drift into returning different shapes of the same
 * event.
 */
const AUDIT_SELECT = {
  id: true,
  action: true,
  resourceType: true,
  resourceId: true,
  actorType: true,
  actorLabel: true,
  actorMembershipId: true,
  before: true,
  after: true,
  metadata: true,
  ipAddress: true,
  correlationId: true,
  createdAt: true,
} as const;

/**
 * The ceiling on one record's history.
 *
 * High enough that no real record reaches it, low enough that a pathological
 * one cannot be used to pull the whole trail through an unpaginated route.
 */
const RECORD_HISTORY_LIMIT = 500;

interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorType: string;
  actorLabel: string | null;
  actorMembershipId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ipAddress: string | null;
  correlationId: string;
  createdAt: Date;
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    actorType: row.actorType as AuditEvent['actorType'],
    actorLabel: row.actorLabel,
    actorMembershipId: row.actorMembershipId,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    ipAddress: row.ipAddress,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reading the audit trail.
 *
 * Named `AuditReadService` to keep it distinct from `platform/audit`'s
 * `AuditService`, which only writes. The separation is deliberate and worth
 * preserving: the writer is injected into every module that mutates anything,
 * and giving that object a read method would eventually give it an update
 * method. Nothing in this file can write, and nothing in the writer can read.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: ListAuditEventsQuery): Promise<AuditPage> {
    const where = this.buildWhere(query);

    // One more than asked for. That extra row is how `hasMore` is answered
    // without a second `count` query — which on an append-only collection
    // would be both expensive and stale by the time it returned.
    const rows = await this.database.client.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined
        ? {}
        : { cursor: { id: this.decodeCursor(query.cursor) }, skip: 1 }),
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        actorType: true,
        actorLabel: true,
        actorMembershipId: true,
        before: true,
        after: true,
        metadata: true,
        ipAddress: true,
        correlationId: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      hasMore,
      nextCursor: hasMore && last !== undefined ? this.encodeCursor(last.id) : null,
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        actorType: row.actorType,
        actorLabel: row.actorLabel,
        actorMembershipId: row.actorMembershipId,
        before: row.before ?? null,
        after: row.after ?? null,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        ipAddress: row.ipAddress,
        correlationId: row.correlationId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Every event touching one record, oldest first (task 1.6.4).
   *
   * Chronological here, unlike the main list. The list answers "what has been
   * happening", which is a question about the recent past and reads newest
   * first; this answers "how did this record get into its current state",
   * which only makes sense read forwards.
   *
   * Not paginated. One record's history is bounded by how many times a person
   * edited it, and a paginated history is one a reader has to reassemble
   * before they can follow it. The cap exists so a pathological record cannot
   * be used to pull the whole trail through this route.
   */
  async history(resourceType: string, resourceId: string): Promise<AuditEvent[]> {
    const rows = await this.database.client.auditEvent.findMany({
      where: { resourceType, resourceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RECORD_HISTORY_LIMIT,
      select: AUDIT_SELECT,
    });

    return rows.map(toAuditEvent);
  }

  /**
   * The rows behind an export (task 1.6.2).
   *
   * Capped at `AUDIT_EXPORT_MAX_ROWS`, and the cap is not negotiable by the
   * caller. An unbounded export against a remote database is a way to take
   * the API down from an ordinary authenticated session, and somebody who
   * genuinely needs more can ask for a date range and repeat — which is also
   * what an auditor asking for "March" actually wants.
   *
   * The export **audits itself**, but that happens in the service that has a
   * transaction to write it in; this method only reads. Exporting an audit
   * trail is itself a privileged act and one of the more useful lines in the
   * trail, so the write is not optional — see `AuditExportService`.
   */
  async forExport(query: ExportAuditEventsQuery): Promise<AuditEvent[]> {
    const rows = await this.database.client.auditEvent.findMany({
      where: this.buildWhere({
        limit: AUDIT_EXPORT_MAX_ROWS,
        ...(query.action === undefined ? {} : { action: query.action }),
        ...(query.resourceType === undefined ? {} : { resourceType: query.resourceType }),
        ...(query.resourceId === undefined ? {} : { resourceId: query.resourceId }),
        ...(query.actorType === undefined ? {} : { actorType: query.actorType }),
        ...(query.actorMembershipId === undefined
          ? {}
          : { actorMembershipId: query.actorMembershipId }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.before === undefined ? {} : { before: query.before }),
      }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AUDIT_EXPORT_MAX_ROWS,
      select: AUDIT_SELECT,
    });

    return rows.map(toAuditEvent);
  }

  private buildWhere(query: ListAuditEventsQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (query.action !== undefined) where['action'] = query.action;
    if (query.resourceType !== undefined) where['resourceType'] = query.resourceType;
    if (query.resourceId !== undefined) where['resourceId'] = query.resourceId;
    if (query.actorType !== undefined) where['actorType'] = query.actorType;
    if (query.actorMembershipId !== undefined) {
      where['actorMembershipId'] = query.actorMembershipId;
    }

    // Half-open: `from` inclusive, `before` exclusive. Consecutive ranges then
    // tile the timeline exactly — no event counted twice, none missed, which
    // matters when someone is exporting a month at a time for an auditor.
    const createdAt: Record<string, Date> = {};
    if (query.from !== undefined) createdAt['gte'] = new Date(query.from);
    if (query.before !== undefined) createdAt['lt'] = new Date(query.before);
    if (Object.keys(createdAt).length > 0) where['createdAt'] = createdAt;

    return where;
  }

  /**
   * The cursor is an opaque encoding of the last id, not the id itself.
   *
   * Opaque so that no client comes to depend on its contents. The moment one
   * does, the shape of the cursor is a public contract and changing the sort
   * order becomes a breaking change.
   */
  private encodeCursor(id: string): string {
    return Buffer.from(id, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): string {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');

    // A malformed cursor is the client's error, not a 500. Without this check
    // it reaches Prisma as a `where: { id: '<rubbish>' }`, which returns an
    // empty page and looks to the reader like the end of the trail.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)) {
      throw new ValidationError({
        cursor: ['The cursor is not valid. Start from the first page.'],
      });
    }

    return decoded;
  }
}
