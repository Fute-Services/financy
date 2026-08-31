import type { LoginRequest, RegisterRequest, SessionResponse } from '@financy/contracts';
import { DEFAULT_CATEGORIES, ROLE_KEYS, flattenCategories } from '@financy/contracts';
import { MembershipExistsError, UnauthenticatedError, newId } from '@financy/core';
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

    return this.database.unscoped.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
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
        await this.recordFailedLogin(tx, user.id, user.failedLoginCount, now);
        throw new UnauthenticatedError('Email or password is incorrect.');
      }

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

  async logout(sessionId: string): Promise<void> {
    await this.database.unscoped.$transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId, 'USER_LOGOUT');
    });
  }

  /** The payload behind `GET /v1/auth/session`. */
  async describeSession(membershipId: string, expiresAt: Date): Promise<SessionResponse> {
    const membership = await this.database.unscoped.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: {
        id: true,
        scope: true,
        departmentId: true,
        user: { select: { id: true, email: true, fullName: true } },
        organization: { select: { id: true, slug: true, name: true, baseCurrency: true } },
        role: {
          select: {
            key: true,
            name: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

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
      permissions: membership.role.permissions.map((row) => row.permission.key).sort(),
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

    // `flattenCategories` emits parents before children, so a parent is always
    // already in the map by the time its child needs it.
    for (const category of flattenCategories(DEFAULT_CATEGORIES)) {
      const id = newId();

      await tx.category.create({
        data: {
          id,
          organizationId,
          key: category.key,
          name: category.name,
          isSystem: true,
          parentId: category.parentKey === null ? null : (idByKey.get(category.parentKey) ?? null),
        },
      });

      idByKey.set(category.key, id);
    }
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
