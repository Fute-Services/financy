import type { ListPeopleQuery, Person } from '@financy/contracts';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';

export interface PeoplePage {
  readonly items: Person[];
  readonly total: number;
}

/**
 * Reading the organisation's members.
 *
 * Every query here goes through {@link DatabaseService.client}, the
 * tenant-scoped client, which injects `organizationId` from the request
 * context. There is no code path in this file that could return a member of
 * another organisation, because there is no code path in this file that names
 * an organisation at all — the omission is the safety property.
 */
@Injectable()
export class PeopleService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: ListPeopleQuery): Promise<PeoplePage> {
    const where = this.buildWhere(query);

    // Count and page in parallel. They are independent reads, and against a
    // remote database two sequential round trips is twice the latency for no
    // consistency benefit — a member added between them changes the total by
    // one, which no reader can tell from a member added a moment later.
    const [total, memberships] = await Promise.all([
      this.database.client.membership.count({ where }),
      this.database.client.membership.findMany({
        where,
        select: {
          id: true,
          userId: true,
          scope: true,
          status: true,
          createdAt: true,
          version: true,
          user: { select: { email: true, fullName: true, lastLoginAt: true } },
          role: { select: { key: true, name: true } },
          department: { select: { id: true, name: true, code: true } },
        },
        // By name, because that is how a person looks someone up. Ties broken
        // by id so the order is total: without that, two people called Alex
        // can swap places between pages and one of them is never seen.
        orderBy: [{ user: { fullName: 'asc' } }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      items: memberships.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        email: membership.user.email,
        fullName: membership.user.fullName,
        role: { key: membership.role.key, name: membership.role.name },
        department:
          membership.department === null
            ? null
            : {
                id: membership.department.id,
                name: membership.department.name,
                code: membership.department.code,
              },
        scope: membership.scope,
        status: membership.status,
        lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
        joinedAt: membership.createdAt.toISOString(),
        version: membership.version,
      })),
    } as PeoplePage;
  }

  /**
   * The filter, built once and used by both the count and the page.
   *
   * Sharing it is not a tidiness preference: a count computed under a
   * different predicate than the page it describes produces pagination that
   * claims a page five which is empty, and nobody ever finds out why.
   */
  private buildWhere(query: ListPeopleQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (query.status !== undefined) where['status'] = query.status;
    if (query.departmentId !== undefined) where['departmentId'] = query.departmentId;
    if (query.roleKey !== undefined) where['role'] = { key: query.roleKey };

    if (query.q !== undefined && query.q !== '') {
      // Name or email, case-insensitively. MongoDB has no `citext`, so the
      // insensitivity is asked for explicitly here rather than assumed from
      // the column type — see ADR-0017.
      where['user'] = {
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
        ],
      };
    }

    return where;
  }
}
