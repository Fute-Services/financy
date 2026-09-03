import {
  NOTABLE_SECURITY_EVENT_TYPES,
  type ListSecurityEventsQuery,
  type SecurityEvent,
} from '@financy/contracts';
import { ValidationError } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';

export interface SecurityEventPage {
  readonly items: SecurityEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Reading the security log (task 1.6.3).
 *
 * Read-only, like the audit trail and for the same reason: `SecurityEventService`
 * in the platform layer exposes no update and no delete, so the only thing
 * that can happen to a row is that it is written. This service cannot write,
 * and that one is injected into everything that authenticates — keeping them
 * apart is what stops "record a login" and "edit a login" ending up on the
 * same object.
 *
 * The actor's name is resolved **at read time** here, which is the opposite
 * of the audit trail's denormalised `actorLabel`, and the difference is the
 * point. The audit trail is evidence: it must read the same in five years,
 * after the person has left and been renamed. This is an operator looking at
 * what is happening now, who wants the name that is on the account today.
 */
@Injectable()
export class SecurityEventReadService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: ListSecurityEventsQuery): Promise<SecurityEventPage> {
    const where = this.buildWhere(query);

    // One more than asked for, so `hasMore` is answered without a second
    // `count` — which on an append-only collection is both expensive and
    // stale by the time it returns.
    const rows = await this.database.client.securityEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined
        ? {}
        : { cursor: { id: decodeCursor(query.cursor) }, skip: 1 }),
      select: {
        id: true,
        type: true,
        userId: true,
        membershipId: true,
        ipAddress: true,
        userAgent: true,
        metadata: true,
        correlationId: true,
        createdAt: true,
        user: { select: { fullName: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      hasMore,
      nextCursor: hasMore && last !== undefined ? encodeCursor(last.id) : null,
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        userId: row.userId,
        membershipId: row.membershipId,
        // Null for a failed login against an address with no account — which
        // is exactly the case an operator most wants to see, so the row is
        // returned rather than filtered out for lacking a name.
        actorLabel: row.user?.fullName ?? null,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        correlationId: row.correlationId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private buildWhere(query: ListSecurityEventsQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (query.type !== undefined) where['type'] = query.type;
    else if (query.notableOnly === true) {
      // `LOGIN_SUCCEEDED` is absent from the notable list on purpose: in a
      // healthy organisation it is most of the collection, and a "concerning
      // events" view that is mostly successful logins is one nobody opens
      // twice.
      where['type'] = { in: [...NOTABLE_SECURITY_EVENT_TYPES] };
    }

    if (query.userId !== undefined) where['userId'] = query.userId;
    if (query.membershipId !== undefined) where['membershipId'] = query.membershipId;

    if (query.from !== undefined || query.before !== undefined) {
      where['createdAt'] = {
        ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
        // Exclusive, so consecutive ranges neither overlap nor gap.
        ...(query.before === undefined ? {} : { lt: new Date(query.before) }),
      };
    }

    return where;
  }
}

/**
 * The cursor is the row id, base64url-encoded.
 *
 * Encoded so it reads as an opaque token rather than an id a client might be
 * tempted to construct, and decoded strictly so a malformed one is a 422
 * rather than a query against a nonsense value.
 */
function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');

  // A malformed cursor is the client's error, not a 500. Without this check
  // it reaches Prisma as `where: { id: '<rubbish>' }`, which returns an empty
  // page and looks to the reader like the end of the log — the one failure
  // mode a security log must not have.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)) {
    throw new ValidationError({
      cursor: ['The cursor is not valid. Start from the first page.'],
    });
  }

  return decoded;
}
