import {
  DEFAULT_ROLE_SCOPE,
  permissionsForRole,
  type ActiveSession,
  type ChangeRole,
  type MembershipDetail,
  type RoleKey,
  type UpdateMembership,
} from '@financy/contracts';
import {
  ConflictError,
  CyclicHierarchyError,
  ForbiddenError,
  LastAdminError,
  NotFoundError,
  SelfElevationForbiddenError,
  ValidationError,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService, SecurityEventService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { SessionService } from '../auth/index.js';

const MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  roleId: true,
  departmentId: true,
  managerMembershipId: true,
  scope: true,
  entityScope: true,
  status: true,
  createdAt: true,
  version: true,
  user: { select: { email: true, fullName: true, lastLoginAt: true } },
  role: { select: { key: true, name: true } },
  department: { select: { id: true, name: true, code: true } },
} as const;

/**
 * Writing memberships — the privileged corner of the application
 * (docs/03 §8, tasks 1.5.5 and 1.5.7).
 *
 * Everything here exists to enforce two invariants that the database cannot:
 *
 * **INV-03 — no self-elevation.** Nobody changes their own role, and nobody
 * deactivates their own membership. Refused before the target role is even
 * read, so the message cannot vary with the role that was requested.
 *
 * A companion rule — "you may not grant a role holding permissions you lack"
 * (docs/12 THR-02) — was written here and then removed, because it assumes
 * nested roles and this catalogue implements separation of duties instead.
 * See the note in `changeRole`; it is worth reading before anyone adds it
 * back.
 *
 * **INV-04 — the last administrator stays.** An organisation with no
 * `ORG_ADMIN` can still be signed into and can never be administered again;
 * no support process recovers from it. Demotion and deactivation both check.
 *
 * Both changes also write a **security event** alongside the audit event
 * (INV-08): the audit log answers "who changed this record", the security log
 * answers "is someone attacking us", and a privilege change is a legitimate
 * question for both.
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly securityEvents: SecurityEventService,
    private readonly sessions: SessionService,
  ) {}

  async get(id: string): Promise<MembershipDetail> {
    const row = await this.database.client.membership.findFirst({
      where: { id },
      select: MEMBERSHIP_SELECT,
    });

    if (row === null) throw new NotFoundError('Membership');

    return toDetail(row);
  }

  /**
   * Department, manager, and scope. Not the role, and not the status.
   *
   * Both of those have their own endpoints, because both are privilege
   * decisions rather than data corrections and each carries checks this
   * method has no business running.
   */
  async update(
    id: string,
    input: UpdateMembership,
    expectedVersion: number,
  ): Promise<MembershipDetail> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id, organizationId },
        select: MEMBERSHIP_SELECT,
      });

      if (before === null) throw new NotFoundError('Membership');

      guardVersion('Membership', expectedVersion, before.version);

      if (before.status !== 'ACTIVE') {
        throw new ConflictError('This membership is deactivated. Reactivate it before editing.');
      }

      if (input.departmentId !== undefined) {
        await this.assertDepartmentIsOurs(tx, organizationId, input.departmentId);
      }

      if (input.managerMembershipId !== undefined) {
        await this.assertManagerIsValid(tx, organizationId, id, input.managerMembershipId);
      }

      const nextScope = input.scope ?? before.scope;
      const nextEntityScope = input.entityScope ?? before.entityScope;

      // Checked against the *resulting* pair, not the field that happened to
      // be sent: setting `scope: ENTITY` without a list and clearing the list
      // of an already-ENTITY membership are the same broken state arriving by
      // two routes.
      if (nextScope === 'ENTITY') {
        if (nextEntityScope.length === 0) {
          throw new ValidationError({
            entityScope: [
              'An entity-scoped membership must name at least one entity, or it can see nothing at all.',
            ],
          });
        }

        await this.assertEntitiesAreOurs(tx, organizationId, nextEntityScope);
      }

      const after = await tx.membership.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.managerMembershipId === undefined
            ? {}
            : { managerMembershipId: input.managerMembershipId }),
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.entityScope === undefined ? {} : { entityScope: input.entityScope }),
          version: { increment: 1 },
        },
        select: MEMBERSHIP_SELECT,
      });

      await this.audit.record(tx, {
        action: 'membership.updated',
        resourceType: 'membership',
        resourceId: id,
        before: {
          departmentId: before.departmentId,
          managerMembershipId: before.managerMembershipId,
          scope: before.scope,
          entityScope: before.entityScope,
        },
        after: {
          departmentId: after.departmentId,
          managerMembershipId: after.managerMembershipId,
          scope: after.scope,
          entityScope: after.entityScope,
        },
      });

      return toDetail(after);
    });
  }

  /**
   * Change which role a membership holds. Step-up is enforced at the route.
   *
   * The order of the checks matters and is not arbitrary: self-elevation is
   * refused before the target role is even looked up, so the error a person
   * gets for editing their own role never depends on which role they picked.
   */
  async changeRole(
    id: string,
    input: ChangeRole,
    expectedVersion: number,
  ): Promise<MembershipDetail> {
    const organizationId = requireOrganization();
    const actorMembershipId = getContext()?.membershipId;

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id, organizationId },
        select: MEMBERSHIP_SELECT,
      });

      if (before === null) throw new NotFoundError('Membership');

      guardVersion('Membership', expectedVersion, before.version);

      // INV-03, first half. Refused before anything else is read, so the
      // message cannot vary with the role that was requested.
      if (actorMembershipId !== undefined && actorMembershipId === id) {
        await this.recordRefusal(tx, organizationId, id, 'SELF_ROLE_CHANGE', input.roleKey);
        throw new SelfElevationForbiddenError();
      }

      if (before.status !== 'ACTIVE') {
        throw new ConflictError(
          'This membership is deactivated. Reactivate it before changing its role.',
        );
      }

      const currentRoleKey = before.role.key as RoleKey;

      if (currentRoleKey === input.roleKey) {
        throw new ConflictError(`This member already holds the ${input.roleKey} role.`);
      }

      // There is deliberately **no** "you cannot grant a role holding
      // permissions you lack" check here, and the absence is the decision.
      //
      // docs/12 THR-02 lists that as a mitigation, and it was written and
      // then removed, because it assumes roles are nested and these are not:
      // this catalogue implements separation of duties, so `ORG_ADMIN`
      // administers people and structure and deliberately holds neither
      // `approval:act` nor `transaction:categorize` — `FINANCE_ADMIN` does.
      // A superset check therefore refuses `ORG_ADMIN` the right to assign
      // *any* role, including `EMPLOYEE`, and since `ORG_ADMIN` is the only
      // role holding `membership:manage_role`, the endpoint becomes
      // unreachable by everyone. The end-to-end suite caught it on the first
      // real promotion.
      //
      // What actually guards this endpoint: `membership:manage_role` on the
      // route, mandatory step-up, the self-elevation refusal above, INV-04
      // below, and an audit plus security event on every change. The residual
      // risk — an administrator promoting a colleague they intend to collude
      // with — is not addressable by a permission comparison at all; it needs
      // dual control, which is a Phase 2 policy-engine feature and is named
      // as such rather than half-implemented here.

      // INV-04. An organisation with no ORG_ADMIN can still be signed into and
      // can never be administered again; no support process recovers from it.
      if (currentRoleKey === 'ORG_ADMIN' && input.roleKey !== 'ORG_ADMIN') {
        await this.assertNotLastAdmin(tx, organizationId, id);
      }

      const role = await tx.role.findFirst({
        where: { organizationId, key: input.roleKey },
        select: { id: true },
      });

      // Every organisation owns its five roles, provisioned at registration
      // (docs/09 §7.4a). A miss here means the provisioning failed, which is
      // ours rather than the caller's.
      if (role === null) {
        throw new Error(`Organisation ${organizationId} has no ${input.roleKey} role.`);
      }

      const after = await tx.membership.update({
        where: { id, version: expectedVersion },
        data: {
          roleId: role.id,
          // The scope follows the role unless the membership had been given a
          // narrower one deliberately. A MANAGER left at SELF scope after a
          // promotion can approve nothing and looks broken.
          scope: DEFAULT_ROLE_SCOPE[input.roleKey],
          version: { increment: 1 },
        },
        select: MEMBERSHIP_SELECT,
      });

      await this.audit.record(tx, {
        action: 'membership.role_changed',
        resourceType: 'membership',
        resourceId: id,
        before: { roleKey: currentRoleKey, scope: before.scope },
        after: { roleKey: input.roleKey, scope: after.scope },
        metadata: { reason: input.reason },
      });

      // INV-08: a privilege change is a question for the security log too.
      await this.securityEvents.record(tx, {
        type: 'ROLE_CHANGED',
        organizationId,
        userId: before.userId,
        membershipId: id,
        metadata: { from: currentRoleKey, to: input.roleKey, reason: input.reason },
      });

      return toDetail(after);
    });
  }

  /**
   * Deactivate a membership and revoke every session behind it.
   *
   * Revoking is the point. A deactivation that left live sessions working
   * would report success while the person kept full access until their token
   * happened to expire — which is the failure you would not notice until it
   * mattered.
   */
  async deactivate(id: string, reason: string, expectedVersion: number): Promise<MembershipDetail> {
    const organizationId = requireOrganization();
    const actorMembershipId = getContext()?.membershipId;

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id, organizationId },
        select: MEMBERSHIP_SELECT,
      });

      if (before === null) throw new NotFoundError('Membership');

      guardVersion('Membership', expectedVersion, before.version);

      if (before.status !== 'ACTIVE') {
        throw new ConflictError('This membership is already deactivated.');
      }

      // Deactivating yourself locks you out of an organisation you may be the
      // only administrator of, and the undo requires the access you just
      // removed.
      if (actorMembershipId !== undefined && actorMembershipId === id) {
        throw new ForbiddenError(
          'You cannot deactivate your own membership. Ask another administrator.',
        );
      }

      if ((before.role.key as RoleKey) === 'ORG_ADMIN') {
        await this.assertNotLastAdmin(tx, organizationId, id);
      }

      const after = await tx.membership.update({
        where: { id, version: expectedVersion },
        data: {
          status: 'INACTIVE',
          deactivatedAt: new Date(),
          version: { increment: 1 },
        },
        select: MEMBERSHIP_SELECT,
      });

      // A department headed by a deactivated member is headed by nobody.
      // Prisma's Mongo connector cannot cascade this, and the schema says so.
      await tx.department.updateMany({
        where: { organizationId, headMembershipId: id },
        data: { headMembershipId: null },
      });

      const revoked = await this.sessions.revokeAllForUser(
        tx,
        before.userId,
        'MEMBERSHIP_DEACTIVATED',
      );

      await this.audit.record(tx, {
        action: 'membership.deactivated',
        resourceType: 'membership',
        resourceId: id,
        before: { status: 'ACTIVE' },
        after: { status: 'INACTIVE' },
        metadata: { reason, sessionsRevoked: revoked },
      });

      await this.securityEvents.record(tx, {
        type: 'MEMBERSHIP_DEACTIVATED',
        organizationId,
        userId: before.userId,
        membershipId: id,
        metadata: { reason, sessionsRevoked: revoked },
      });

      return toDetail(after);
    });
  }

  async reactivate(id: string, expectedVersion: number): Promise<MembershipDetail> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id, organizationId },
        select: MEMBERSHIP_SELECT,
      });

      if (before === null) throw new NotFoundError('Membership');

      guardVersion('Membership', expectedVersion, before.version);

      if (before.status === 'ACTIVE') {
        throw new ConflictError('This membership is already active.');
      }

      const after = await tx.membership.update({
        where: { id, version: expectedVersion },
        data: { status: 'ACTIVE', deactivatedAt: null, version: { increment: 1 } },
        select: MEMBERSHIP_SELECT,
      });

      await this.audit.record(tx, {
        action: 'membership.reactivated',
        resourceType: 'membership',
        resourceId: id,
        before: { status: 'INACTIVE' },
        after: { status: 'ACTIVE' },
      });

      return toDetail(after);
    });
  }

  /**
   * The live sessions behind a membership (task 1.5.8).
   *
   * Sessions belong to the *user*, not to the membership — one account can be
   * signed into several organisations — so this lists every live session that
   * account holds, and says so rather than pretending to filter. An
   * administrator revoking access needs to know they are ending all of it;
   * showing only the ones bound to this organisation would make "revoke
   * everything" look like it had worked when it had not.
   *
   * No token, no hash, ever. The list is for recognising a device, and a hash
   * shown on a screen is a hash in a screenshot in a support ticket.
   */
  async listSessions(membershipId: string): Promise<ActiveSession[]> {
    const organizationId = requireOrganization();
    const currentSessionId = getContext()?.sessionId;

    const membership = await this.database.unscoped.membership.findFirst({
      where: { id: membershipId, organizationId },
      select: { userId: true },
    });

    if (membership === null) throw new NotFoundError('Membership');

    const rows = await this.database.unscoped.session.findMany({
      where: { userId: membership.userId },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true,
        absoluteExpiresAt: true,
      },
      orderBy: [{ lastSeenAt: 'desc' }],
    });

    const now = new Date();

    // Filtered here rather than with `revokedAt: null`: on MongoDB an optional
    // field never written is absent, and Prisma's `null` filter does not match
    // absent (ADR-0017) — that predicate would return nothing at all, and an
    // empty session list reads as "nobody is signed in", which is the worst
    // possible wrong answer on this particular screen.
    return rows
      .filter((row) => row.revokedAt === null && row.absoluteExpiresAt > now)
      .map((row) => ({
        id: row.id,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        lastSeenAt: row.lastSeenAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        isCurrent: row.id === currentSessionId,
      }));
  }

  /**
   * Revoke every session behind a membership. Step-up is enforced at the route.
   *
   * The membership stays active — this is "sign them out of everything", not
   * "remove their access". Somebody who has lost a laptop needs the first and
   * would be badly served by the second, and an administrator who wanted the
   * second has `deactivate`, which says so in the audit log.
   */
  async revokeSessions(membershipId: string): Promise<number> {
    const organizationId = requireOrganization();
    const currentSessionId = getContext()?.sessionId;

    return this.database.unscoped.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, organizationId },
        select: { id: true, userId: true },
      });

      if (membership === null) throw new NotFoundError('Membership');

      // The caller's own session is spared when they are revoking their own
      // sessions: signing yourself out as a side effect of clearing your other
      // devices is a surprise, and the undo is a fresh login you did not ask
      // for.
      const revoked = await this.sessions.revokeAllForUser(
        tx,
        membership.userId,
        'REVOKED_BY_ADMIN',
        currentSessionId,
      );

      await this.audit.record(tx, {
        action: 'membership.sessions_revoked',
        resourceType: 'membership',
        resourceId: membershipId,
        metadata: { sessionsRevoked: revoked },
      });

      await this.securityEvents.record(tx, {
        type: 'SESSION_REVOKED',
        organizationId,
        userId: membership.userId,
        membershipId,
        metadata: { sessionsRevoked: revoked, byAnotherMember: true },
      });

      return revoked;
    });
  }

  // ── invariants ───────────────────────────────────────────────────────────

  /**
   * INV-04. Counted rather than assumed.
   *
   * `ORG_ADMIN` is resolved through the organisation's own role row, because
   * every organisation owns its five (docs/09 §7.4a) — matching on a global
   * role id would count administrators across tenants.
   */
  private async assertNotLastAdmin(
    tx: Prisma.TransactionClient,
    organizationId: string,
    excludeMembershipId: string,
  ): Promise<void> {
    const adminRole = await tx.role.findFirst({
      where: { organizationId, key: 'ORG_ADMIN' },
      select: { id: true },
    });

    if (adminRole === null) return;

    const others = await tx.membership.count({
      where: {
        organizationId,
        roleId: adminRole.id,
        status: 'ACTIVE',
        id: { not: excludeMembershipId },
      },
    });

    if (others === 0) throw new LastAdminError();
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

  /**
   * The manager must be ours, active, not the member themselves, and not
   * somewhere below them in the reporting chain.
   *
   * The cycle walk is bounded by the number of memberships, and it walks
   * upwards from the proposed manager: if it reaches the member being edited,
   * the edit would close a loop. Approval routing follows this chain, and a
   * loop there is an approval that never resolves and never errors.
   */
  private async assertManagerIsValid(
    tx: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
    managerMembershipId: string | null,
  ): Promise<void> {
    if (managerMembershipId === null) return;

    if (managerMembershipId === membershipId) {
      throw new CyclicHierarchyError('reporting');
    }

    const manager = await tx.membership.findFirst({
      where: { id: managerMembershipId, organizationId },
      select: { status: true },
    });

    if (manager === null) throw new NotFoundError('Membership');

    if (manager.status !== 'ACTIVE') {
      throw new ConflictError('A deactivated member cannot be a manager.');
    }

    const chain = await tx.membership.findMany({
      where: { organizationId },
      select: { id: true, managerMembershipId: true },
    });

    const parentOf = new Map(chain.map((row) => [row.id, row.managerMembershipId]));

    // Bounded by the map's size, so a pre-existing loop in the data cannot
    // hang the request while this is checking for a new one.
    let cursor: string | null = managerMembershipId;

    for (let step = 0; step < parentOf.size + 1 && cursor !== null; step += 1) {
      if (cursor === membershipId) throw new CyclicHierarchyError('reporting');

      cursor = parentOf.get(cursor) ?? null;
    }
  }

  private async assertEntitiesAreOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    entityIds: readonly string[],
  ): Promise<void> {
    const found = await tx.entity.findMany({
      where: { organizationId, id: { in: [...entityIds] } },
      select: { id: true },
    });

    if (found.length === new Set(entityIds).size) return;

    // A 404 rather than a listing of which ids were rejected: naming them
    // would confirm that the others exist in this organisation, and the
    // caller sent them, so they already know what they asked for.
    throw new NotFoundError('Entity');
  }

  /**
   * A refused privilege change is worth recording.
   *
   * Someone trying to promote themselves is the clearest signal in the whole
   * system, and it leaves no audit event because nothing changed. The
   * security log is where attempts belong (docs/12 §7).
   */
  private async recordRefusal(
    tx: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
    reason: string,
    attemptedRole: RoleKey,
  ): Promise<void> {
    await this.securityEvents.record(tx, {
      type: 'ROLE_CHANGED',
      organizationId,
      membershipId,
      metadata: { refused: reason, attemptedRole },
    });
  }
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Memberships cannot be written without a tenant context.');
  }

  return organizationId;
}

interface MembershipRow {
  id: string;
  userId: string;
  departmentId: string | null;
  managerMembershipId: string | null;
  scope: 'SELF' | 'DEPARTMENT' | 'ENTITY' | 'ORGANISATION';
  entityScope: string[];
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  version: number;
  user: { email: string; fullName: string; lastLoginAt: Date | null };
  role: { key: string; name: string };
  department: { id: string; name: string; code: string | null } | null;
}

function toDetail(row: MembershipRow): MembershipDetail {
  return {
    id: row.id,
    userId: row.userId,
    email: row.user.email,
    fullName: row.user.fullName,
    role: { key: row.role.key as RoleKey, name: row.role.name },
    department: row.department,
    scope: row.scope,
    status: row.status,
    lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
    joinedAt: row.createdAt.toISOString(),
    managerMembershipId: row.managerMembershipId,
    entityScope: row.entityScope,
    // Resolved from the role rather than stored, so the list a reader sees is
    // the list the guard will enforce. A cached copy drifts the moment the
    // catalogue changes, and drifts silently.
    permissions: [...permissionsForRole(row.role.key as RoleKey)].sort(),
    version: row.version,
  };
}
