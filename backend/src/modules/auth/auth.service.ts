import type { LoginRequest, RegisterRequest, SessionResponse } from '@financy/contracts';
import { DEFAULT_CATEGORIES, ROLE_KEYS, flattenCategories } from '@financy/contracts';
import { MembershipExistsError, NotFoundError, UnauthenticatedError, newId } from '@financy/core';
import { provisionOrganizationRoles, type Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService, SecurityEventService } from '../../platform/audit/index.js';
import { ConfigService } from '../../platform/config/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext } from '../../platform/request-context/index.js';
import { PasswordService } from './password.service.js';
import { SessionService, type IssuedSession } from './session.service.js';

/** Consecutive failures before the account is locked (docs/12 §3.2). */
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

export interface AuthResult {
  readonly session: IssuedSession;
  readonly membershipId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly password: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly security: SecurityEventService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Register: organisation, user, roles, membership, entity, categories — all
   * of it, or none of it (FR-AUTH-001).
   *
   * One transaction because a half-registered organisation is unusable and
   * unrecoverable through the UI: an organisation with no admin cannot invite
   * anyone, and a user with no membership cannot sign in anywhere. There is no
   * screen to repair either.
   */
  async register(input: RegisterRequest): Promise<AuthResult> {
    const context = getContext();

    return this.database.unscoped.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });

      // Registration is the one place where revealing that an address is taken
      // is unavoidable — the alternative is silently not creating an account.
      // Rate limiting is what keeps it from being an enumeration oracle.
      if (existing !== null) {
        throw new MembershipExistsError();
      }

      const organizationId = newId();
      const userId = newId();
      const membershipId = newId();

      await tx.organization.create({
        data: {
          id: organizationId,
          slug: await this.uniqueSlug(tx, input.organizationName),
          name: input.organizationName,
          baseCurrency: input.baseCurrency,
          countryCode: input.countryCode,
        },
      });

      const roles = await provisionOrganizationRoles(tx, organizationId);
      const adminRoleId = roles.roleIdByKey.get('ORG_ADMIN');

      /* c8 ignore next 3 -- provisionOrganizationRoles creates all five. */
      if (adminRoleId === undefined) {
        throw new Error('ORG_ADMIN was not provisioned for the new organisation.');
      }

      await tx.user.create({
        data: {
          id: userId,
          email: input.email,
          passwordHash: await this.password.hash(input.password),
          fullName: input.fullName,
        },
      });

      await tx.membership.create({
        data: {
          id: membershipId,
          organizationId,
          userId,
          roleId: adminRoleId,
          // The founder sees everything; there is nobody else to scope against.
          scope: 'ORGANISATION',
        },
      });

      // A default legal entity, so the first spend record has something to
      // belong to without the user configuring anything first.
      await tx.entity.create({
        data: {
          id: newId(),
          organizationId,
          name: input.organizationName,
          countryCode: input.countryCode,
          functionalCurrency: input.baseCurrency,
        },
      });

      await this.createDefaultCategories(tx, organizationId);

      // The organisation and the membership are created by the same
      // transaction that audits them, so neither the tenant context nor the
      // actor exists yet — both are passed explicitly.
      for (const [action, resourceType, resourceId] of [
        ['organization.created', 'organization', organizationId],
        ['user.created', 'user', userId],
        ['membership.created', 'membership', membershipId],
      ] as const) {
        await this.audit.record(tx, {
          action,
          resourceType,
          resourceId,
          organizationId,
          actorMembershipId: membershipId,
          actorType: 'USER',
        });
      }

      const session = await this.sessions.issue(tx, userId, membershipId, {
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return { session, membershipId };
    });
  }

  /**
   * Log in.
   *
   * Every failure below returns the identical `UnauthenticatedError`, and the
   * hash comparison runs even when no user was found. Distinguishing "no such
   * account" from "wrong password" — in the message, the status, or the
   * response time — turns the endpoint into a list of who banks here
   * (FR-AUTH-008/009, docs/12 §3.2).
   */
  async login(input: LoginRequest): Promise<AuthResult> {
    const context = getContext();

    // The credential check runs **outside** a transaction, and that is the
    // fix for a bug this suite caught rather than a stylistic preference.
    //
    // It was all one transaction, with `recordFailedLogin` inside it and a
    // `throw` on the next line. The throw rolled the transaction back, taking
    // the failure bookkeeping with it — so `failedLoginCount` never
    // persisted, `MAX_FAILED_LOGINS` was never reached, and the account
    // lockout in docs/12 §3.2 did not exist. Nor did the `LOGIN_FAILED`
    // security event, which is the single signal that log is for. Nothing
    // about the response differed, so nothing showed it.
    //
    // Failure bookkeeping must therefore commit in a transaction of its own,
    // one that is not about to be rolled back by the rejection it describes.
    const user = await this.database.unscoped.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        passwordHash: true,
        failedLoginCount: true,
        lockedUntil: true,
        archivedAt: true,
      },
    });

    if (user === null) {
      // Same work, same elapsed time, same answer.
      await this.password.verifyDummy(input.password);
      throw new UnauthenticatedError('Email or password is incorrect.');
    }

    const now = new Date();
    const locked = user.lockedUntil !== null && user.lockedUntil > now;

    if (locked || user.archivedAt !== null) {
      await this.password.verifyDummy(input.password);
      throw new UnauthenticatedError('Email or password is incorrect.');
    }

    const valid = await this.password.verify(user.passwordHash, input.password);

    if (!valid) {
      await this.database.unscoped.$transaction(async (tx) => {
        await this.recordFailedLogin(tx, user.id, user.failedLoginCount, now);
      });

      throw new UnauthenticatedError('Email or password is incorrect.');
    }

    return this.database.unscoped.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, organizationId: true },
      });

      // A user with no active membership has been deactivated everywhere.
      // Same answer again: whether the account exists is not the question
      // being answered.
      if (membership === null) {
        throw new UnauthenticatedError('Email or password is incorrect.');
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: now,
          // Transparent upgrade when the cost parameters have moved on. This
          // is the only moment the plaintext is available.
          ...(this.password.needsRehash(user.passwordHash)
            ? { passwordHash: await this.password.hash(input.password) }
            : {}),
        },
      });

      const session = await this.sessions.issue(tx, user.id, membership.id, {
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      await this.security.record(tx, {
        type: 'LOGIN_SUCCEEDED',
        organizationId: membership.organizationId,
        userId: user.id,
        membershipId: membership.id,
      });

      return { session, membershipId: membership.id };
    });
  }

  /**
   * Re-prove the password on the session already in hand (FR-AUTH-010).
   *
   * Not a second login: no session is issued, no cookie changes. It stamps
   * `steppedUpAt` on the current session, which `@RequireStepUp()` routes
   * check against `STEP_UP_WINDOW_MINUTES`.
   *
   * **Without this, `@RequireStepUp()` is a permanent refusal.** Nothing else
   * in the application sets `steppedUpAt`, so every route carrying that
   * decorator would answer `403` to everyone, forever — a lock with no key,
   * which reads to an operator as a bug and to a developer as a reason to
   * remove the decorator.
   *
   * A failure here counts towards the same lockout as a failed login and
   * records a `STEP_UP_FAILED` event. Someone holding a stolen cookie and
   * guessing at the password is exactly the signal the security log exists
   * for, and it must not have an unlimited number of attempts merely because
   * it arrived through a different endpoint.
   */
  async stepUp(sessionId: string, password: string): Promise<Date> {
    // Read and verify outside a transaction, for the same reason `login`
    // does: the failure path records an attempt and then throws, and a throw
    // inside the transaction that wrote the record discards it.
    const session = await this.database.unscoped.session.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        activeMembership: { select: { id: true, organizationId: true } },
      },
    });

    // The guard resolved this session moments ago, so a miss means it was
    // revoked in between — an expired session, not a bad password.
    if (session === null) throw new UnauthenticatedError();

    const user = await this.database.unscoped.user.findUnique({
      where: { id: session.userId },
      select: { id: true, passwordHash: true, failedLoginCount: true, lockedUntil: true },
    });

    if (user === null) throw new UnauthenticatedError();

    const now = new Date();

    if (user.lockedUntil !== null && user.lockedUntil > now) {
      await this.password.verifyDummy(password);
      throw new UnauthenticatedError('Password is incorrect.');
    }

    const valid = await this.password.verify(user.passwordHash, password);

    if (!valid) {
      await this.database.unscoped.$transaction(async (tx) => {
        // The same lockout as a failed login. Someone holding a stolen cookie
        // and guessing at the password must not get unlimited attempts merely
        // because they arrived through a different endpoint.
        await this.recordFailedLogin(tx, user.id, user.failedLoginCount, now);

        if (session.activeMembership !== null) {
          await this.security.record(tx, {
            type: 'STEP_UP_FAILED',
            organizationId: session.activeMembership.organizationId,
            userId: user.id,
            membershipId: session.activeMembership.id,
          });
        }
      });

      throw new UnauthenticatedError('Password is incorrect.');
    }

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { steppedUpAt: now } });

      // Reset the counter, as a successful login does: the person has proven
      // who they are, and leaving nine failures banked would lock them out on
      // their next typo.
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    });

    return new Date(now.getTime() + this.config.get('STEP_UP_WINDOW_MINUTES') * 60_000);
  }

  async logout(sessionId: string): Promise<void> {
    await this.database.unscoped.$transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId, 'USER_LOGOUT');
    });
  }

  /**
   * Point the current session at a different organisation (docs/10 §5.1).
   *
   * The session is rebound rather than reissued: the same token, the same
   * expiries, a different `activeMembershipId`. Issuing a new session here
   * would silently reset the absolute timeout, so a person switching between
   * two companies all day would never be asked to sign in again.
   *
   * Three things this must not become, and each is a line below:
   *
   *  - **A way to enter an organisation you are not in.** The membership is
   *    looked up by `(organizationId, userId)`, so an id belonging to somebody
   *    else's company matches nothing.
   *  - **A way back into one you were removed from.** The membership has to be
   *    `ACTIVE`. A deactivated one still exists, and matching on the pair alone
   *    would make removal reversible by whoever still held the session.
   *  - **A way to carry authority across a tenant boundary.** `setActiveMembership`
   *    clears `steppedUpAt`, because having proved your password in one
   *    organisation is not proof for another.
   *
   * A miss answers `404`, not `403`. A `403` would confirm the organisation
   * exists, which is the cross-tenant leak docs/10 §6 exists to prevent.
   */
  async switchOrganization(sessionId: string, organizationId: string): Promise<string> {
    const membership = await this.database.unscoped.membership.findFirst({
      where: {
        organizationId,
        user: { sessions: { some: { id: sessionId } } },
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (membership === null) throw new NotFoundError('Organization');

    await this.database.unscoped.$transaction(async (tx) => {
      await this.sessions.setActiveMembership(tx, sessionId, membership.id);

      // Recorded in the organisation being *entered*, which is the log where
      // "who was acting here, and from when" has to be answerable. Both
      // overrides are needed: the request context still names the organisation
      // the caller is leaving, so the event would otherwise land in the wrong
      // tenant's log with the wrong membership as its actor.
      await this.audit.record(tx, {
        action: 'session.organization_switched',
        resourceType: 'session',
        resourceId: sessionId,
        after: { organizationId },
        organizationId,
        actorMembershipId: membership.id,
      });
    });

    return membership.id;
  }

  /** The payload behind `GET /v1/auth/session`. */
  /**
   * @param granted The permission set the guard already resolved for this
   *   request, when there is one.
   *
   *   Walking `role → role_permissions → permission` is by far the most
   *   expensive part of describing a session — around ninety rows across a
   *   relation Prisma cannot join on MongoDB, so it becomes a burst of round
   *   trips to the database. The guard has already paid for exactly that set
   *   before this method runs, and paying twice made `/auth/session` the
   *   slowest endpoint in the application at roughly a second, on a route the
   *   web app calls on **every** page render.
   *
   *   Absent for the public callers — login, register, invitation acceptance —
   *   which run before any guard and so have nothing to reuse.
   */
  async describeSession(
    membershipId: string,
    expiresAt: Date,
    granted?: ReadonlySet<string>,
  ): Promise<SessionResponse> {
    const membership = await this.database.unscoped.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: {
        id: true,
        scope: true,
        departmentId: true,
        roleId: true,
        user: { select: { id: true, email: true, fullName: true } },
        organization: { select: { id: true, slug: true, name: true, baseCurrency: true } },
        role: { select: { key: true, name: true } },
      },
    });

    const permissions =
      granted === undefined
        ? (
            await this.database.unscoped.rolePermission.findMany({
              where: { roleId: membership.roleId },
              select: { permission: { select: { key: true } } },
            })
          ).map((row) => row.permission.key)
        : [...granted];

    const organizations = await this.database.unscoped.membership.findMany({
      where: { userId: membership.user.id, status: 'ACTIVE' },
      select: {
        organization: { select: { id: true, slug: true, name: true } },
        role: { select: { key: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      user: membership.user,
      organization: membership.organization,
      membership: {
        id: membership.id,
        roleKey: asRoleKey(membership.role.key),
        roleName: membership.role.name,
        scope: membership.scope,
        departmentId: membership.departmentId,
      },
      // Resolved from what was actually seeded, never from the constant in
      // `@financy/contracts` — the database is the runtime authority, and a
      // drift between the two must show up rather than be papered over.
      permissions: [...permissions].sort(),
      organizations: organizations.map((row) => ({
        ...row.organization,
        roleKey: asRoleKey(row.role.key),
      })),
      isSandbox: this.config.get('CARD_PROVIDER') === 'mock',
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async recordFailedLogin(
    tx: Prisma.TransactionClient,
    userId: string,
    currentCount: number,
    now: Date,
  ): Promise<void> {
    const nextCount = currentCount + 1;
    const shouldLock = nextCount >= MAX_FAILED_LOGINS;

    await tx.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: nextCount,
        ...(shouldLock ? { lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) } : {}),
      },
    });

    // Security events are tenant-scoped, and a failed login has no session, so
    // the organisation is taken from any membership the user holds. A user
    // with none produces no event — there is no tenant to attribute it to.
    const membership = await tx.membership.findFirst({
      where: { userId },
      select: { id: true, organizationId: true },
    });

    if (membership === null) return;

    await this.security.record(tx, {
      type: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      organizationId: membership.organizationId,
      userId,
      membershipId: membership.id,
      metadata: { failedLoginCount: nextCount },
    });
  }

  /**
   * A URL-safe slug that is free.
   *
   * Collisions are resolved with a counter rather than random noise, because
   * `acme-2` is something a human can read out and `acme-x7f3` is not.
   */
  private async uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'org';

    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${String(suffix + 1)}`;
      const taken = await tx.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (taken === null) return candidate;
    }

    /* c8 ignore next 2 -- a hundred organisations of the same name. */
    return `${base}-${newId().slice(0, 8)}`;
  }

  private async createDefaultCategories(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    const idByKey = new Map<string, string>();

    /**
     * One insert for the whole tree.
     *
     * Ids are generated up front so a child can name its parent without
     * waiting for the parent's insert to return — `flattenCategories` emits
     * parents first, so the map is always populated in time.
     *
     * Inserting them one at a time is thirty-six round trips inside the
     * registration transaction. Against a local database that is free; against
     * a hosted one it is most of the five-second interactive-transaction
     * budget, and registration starts failing under no load at all.
     */
    const rows = flattenCategories(DEFAULT_CATEGORIES).map((category) => {
      const id = newId();
      idByKey.set(category.key, id);

      return {
        id,
        organizationId,
        key: category.key,
        name: category.name,
        isSystem: true,
        parentId: category.parentKey === null ? null : (idByKey.get(category.parentKey) ?? null),
      };
    });

    await tx.category.createMany({ data: rows });
  }
}

/**
 * Narrow a seeded role key to the contract's union.
 *
 * The database column is free text so Phase 6 can add custom roles without a
 * migration; the five system keys are the ones the contract knows about, and
 * anything else is a bug in provisioning rather than a value to pass through.
 */
function asRoleKey(key: string): (typeof ROLE_KEYS)[number] {
  const known = ROLE_KEYS.find((role) => role === key);

  /* c8 ignore next 3 -- only reachable once custom roles exist (Phase 6). */
  if (known === undefined) {
    throw new Error(`Membership holds unknown role "${key}".`);
  }

  return known;
}
