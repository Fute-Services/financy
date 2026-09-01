import type { CreateDelegation, Delegation, ListDelegationsQuery } from '@financy/contracts';
import { permissionsForRole, type RoleKey } from '@financy/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';

/**
 * Lending approval authority for a period (FR-APR-009, task 2.2.5).
 *
 * ## Three properties, and each of them prevents a specific abuse
 *
 * **Time-bounded.** An open-ended delegation is authority nobody remembers
 * granting, still live two years after the holiday it was created for. The end
 * date is required and the resolver only reads delegations whose window covers
 * the moment the chain opens.
 *
 * **Non-chaining.** A→B→C would mean C approves with A's authority through a
 * hop nobody reviewed. The resolver follows exactly one link, and this service
 * refuses to create the second one — refusing at authoring time is better,
 * because a delegation that silently does nothing looks exactly like one that
 * works.
 *
 * **Both parties recorded.** The action row carries the actor *and* the person
 * whose authority they used, so "who approved this?" has one answer and "under
 * whose authority?" has another.
 *
 * ## You may lend your own; lending somebody else's is a separate power
 *
 * The ordinary case is a person going on leave. Creating a delegation *from*
 * another member is an administrative act — it grants somebody authority the
 * holder never agreed to lend — so it needs `approval:delegate_any` and is
 * audited naming both.
 *
 * ## The delegate must be able to act
 *
 * Delegating to somebody whose role does not hold `approval:act` produces a
 * chain resolved to a person the route will refuse: a request stuck in a queue
 * forever with nothing saying why. Refused here, where the person choosing can
 * still be told.
 */
@Injectable()
export class DelegationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListDelegationsQuery, canSeeAll: boolean): Promise<Delegation[]> {
    const organizationId = requireOrganization();
    const membershipId = getContext()?.membershipId;
    const now = new Date();

    // `all` is honoured only for a caller who may read it. Silently narrowing
    // is better than a 403 here: the scope is a view preference, not a request
    // for data the caller named.
    const mine = query.scope === 'mine' || !canSeeAll;

    const rows = await this.database.unscoped.approvalDelegation.findMany({
      where: {
        organizationId,
        ...(mine && membershipId !== undefined
          ? { OR: [{ fromMembershipId: membershipId }, { toMembershipId: membershipId }] }
          : {}),
      },
      select: DELEGATION_SELECT,
      orderBy: [{ startsAt: 'desc' }],
    });

    return rows
      .map((row) => toRecord(row, now))
      .filter((record) => query.includeExpired === true || record.revokedAt === null);
  }

  async create(input: CreateDelegation, canDelegateOthers: boolean): Promise<Delegation> {
    const organizationId = requireOrganization();
    const actorMembershipId = getContext()?.membershipId;

    if (actorMembershipId === undefined) {
      throw new ForbiddenError('Only a member of this organisation can delegate approvals.');
    }

    const fromMembershipId = input.fromMembershipId ?? actorMembershipId;

    if (fromMembershipId !== actorMembershipId && !canDelegateOthers) {
      throw new ForbiddenError(
        'You can only lend your own approval authority. Delegating on somebody else’s behalf needs an administrator.',
      );
    }

    if (fromMembershipId === input.toMembershipId) {
      throw new ValidationError({
        toMembershipId: ['A delegation to yourself changes nothing.'],
      });
    }

    return this.database.unscoped.$transaction(async (tx) => {
      // `from` is loaded to prove it is a real, active membership in this
      // organisation before authority is attributed to it — a delegation from
      // an id that resolves to nobody is a row the resolver silently ignores
      // forever.
      const [from, to] = await Promise.all([
        this.loadMember(tx, organizationId, fromMembershipId),
        this.loadMember(tx, organizationId, input.toMembershipId),
      ]);

      if (!permissionsForRole(to.roleKey as RoleKey).has('approval:act')) {
        throw new ValidationError({
          toMembershipId: [
            `${to.fullName} cannot approve spend, so a chain delegated to them would never complete. Choose somebody who can.`,
          ],
        });
      }

      await this.assertNoChain(tx, organizationId, fromMembershipId, input.toMembershipId, input);

      const created = await tx.approvalDelegation.create({
        data: {
          id: newId(),
          organizationId,
          fromMembershipId,
          toMembershipId: input.toMembershipId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          reason: input.reason ?? null,
          revokedAt: null,
        },
        select: DELEGATION_SELECT,
      });

      await this.audit.record(tx, {
        action: 'approval.delegation_created',
        resourceType: 'approval_delegation',
        resourceId: created.id,
        after: {
          from: fromMembershipId,
          fromName: from.fullName,
          to: input.toMembershipId,
          toName: to.fullName,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          // Named in the record, because "an administrator lent somebody
          // else's approval authority" is the entry an auditor is looking for
          // and it is indistinguishable from an ordinary delegation without it.
          onBehalfOfAnother: fromMembershipId !== actorMembershipId,
        },
      });

      return toRecord(created, new Date());
    });
  }

  /**
   * Revoke, rather than delete.
   *
   * A chain resolved while the delegation was live named the delegate, and that
   * has to stay explicable. Revoking stops it applying from now on and leaves
   * the record of what it did.
   */
  async revoke(
    id: string,
    expectedVersion: number,
    canDelegateOthers: boolean,
  ): Promise<Delegation> {
    const organizationId = requireOrganization();
    const actorMembershipId = getContext()?.membershipId;

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.approvalDelegation.findFirst({
        where: { id, organizationId },
        select: DELEGATION_SELECT,
      });

      if (before === null) throw new NotFoundError('Delegation');

      guardVersion('Delegation', expectedVersion, before.version);

      if (before.fromMembershipId !== actorMembershipId && !canDelegateOthers) {
        throw new ForbiddenError('Only the person who lent this authority can take it back.');
      }

      if (before.revokedAt !== null) {
        throw new ConflictError('This delegation has already been revoked.');
      }

      const after = await tx.approvalDelegation.update({
        where: { id, version: expectedVersion },
        data: { revokedAt: new Date(), version: { increment: 1 } },
        select: DELEGATION_SELECT,
      });

      await this.audit.record(tx, {
        action: 'approval.delegation_revoked',
        resourceType: 'approval_delegation',
        resourceId: id,
        before: { revokedAt: null },
        after: { revokedAt: after.revokedAt?.toISOString() ?? null },
      });

      return toRecord(after, new Date());
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async loadMember(
    tx: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
  ): Promise<{ id: string; fullName: string; roleKey: string }> {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, organizationId, status: 'ACTIVE' },
      select: { id: true, role: { select: { key: true } }, user: { select: { fullName: true } } },
    });

    if (membership === null) throw new NotFoundError('Membership');

    return {
      id: membership.id,
      fullName: membership.user.fullName,
      roleKey: membership.role.key,
    };
  }

  /**
   * Refuse a delegation that would form a chain in either direction.
   *
   * Checked against overlapping windows only. Two delegations that never
   * coexist cannot chain, and refusing them would make it impossible to hand
   * authority back after a period of holding it.
   */
  private async assertNoChain(
    tx: Prisma.TransactionClient,
    organizationId: string,
    fromMembershipId: string,
    toMembershipId: string,
    window: { startsAt: string; endsAt: string },
  ): Promise<void> {
    const startsAt = new Date(window.startsAt);
    const endsAt = new Date(window.endsAt);

    const live = await tx.approvalDelegation.findMany({
      where: { organizationId },
      select: {
        id: true,
        fromMembershipId: true,
        toMembershipId: true,
        startsAt: true,
        endsAt: true,
        revokedAt: true,
      },
    });

    // Filtered in memory rather than in the query: on MongoDB an unwritten
    // optional field is absent, and `revokedAt: null` does not match absent —
    // which would let every never-revoked delegation through the check
    // (ADR-0017).
    const overlapping = live.filter(
      (delegation) =>
        delegation.revokedAt === null &&
        delegation.startsAt < endsAt &&
        delegation.endsAt > startsAt,
    );

    if (overlapping.some((delegation) => delegation.fromMembershipId === fromMembershipId)) {
      throw new ConflictError(
        'That person has already lent their approval authority for an overlapping period.',
      );
    }

    if (overlapping.some((delegation) => delegation.toMembershipId === fromMembershipId)) {
      throw new ConflictError(
        'Somebody has already delegated to that person for this period, and delegations do not chain — approving through two hops is authority nobody reviewed.',
      );
    }

    if (overlapping.some((delegation) => delegation.fromMembershipId === toMembershipId)) {
      throw new ConflictError(
        'The person you are delegating to has themselves delegated their authority away for this period, and delegations do not chain.',
      );
    }
  }
}

const DELEGATION_SELECT = {
  id: true,
  fromMembershipId: true,
  toMembershipId: true,
  startsAt: true,
  endsAt: true,
  reason: true,
  revokedAt: true,
  createdAt: true,
  version: true,
  from: { select: { user: { select: { fullName: true } } } },
  to: { select: { user: { select: { fullName: true } } } },
} as const;

interface DelegationRow {
  id: string;
  fromMembershipId: string;
  toMembershipId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  version: number;
  from: { user: { fullName: string } };
  to: { user: { fullName: string } };
}

function toRecord(row: DelegationRow, now: Date): Delegation {
  return {
    id: row.id,
    from: { membershipId: row.fromMembershipId, fullName: row.from.user.fullName },
    to: { membershipId: row.toMembershipId, fullName: row.to.user.fullName },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    // Computed here rather than left to the reader. "Starts in the future",
    // "expired", and "revoked" all render as "not in force", and a list where
    // the caller has to compare three dates to know which is which is a list
    // people misread.
    active: row.revokedAt === null && row.startsAt <= now && row.endsAt > now,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Delegations cannot be read or written without a tenant context.');
  }

  return organizationId;
}
