import type { AuditEvent, ListAuditEventsQuery } from '@financy/contracts';
import { ValidationError } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';

export interface AuditPage {
  readonly items: AuditEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
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
