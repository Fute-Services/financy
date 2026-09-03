import { isReadOnlyPermission } from '@financy/contracts';
import {
  AuditorReadOnlyError,
  ForbiddenError,
  SessionExpiredError,
  StepUpRequiredError,
  UnauthenticatedError,
} from '@financy/core';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import type { Request } from 'express';

import { ConfigService } from '../config/index.js';
import { DatabaseService } from '../database/index.js';
import { hashToken } from '../crypto/index.js';
import { enterContext } from '../request-context/index.js';
import { PERMISSION_KEY, PUBLIC_KEY, STEP_UP_KEY } from './decorators.js';

/**
 * The one guard that resolves identity, tenancy, permission, and step-up.
 *
 * Deliberately one class rather than the four the architecture diagram names.
 * They must run in a fixed order — session, then organisation, then
 * permission, then step-up — and four separate guards make that order an
 * emergent property of registration order, which is exactly the kind of thing
 * that gets reordered by accident. The ordering matters: a caller must never
 * be told whether a resource exists in another organisation, so the tenant
 * binding happens before any permission check can produce a distinguishable
 * answer (docs/08 §4.4).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /**
   * Role grants, kept in memory for a minute at a time.
   *
   * ## Why this is cached at all
   *
   * Walking `role → role_permissions → permission` is a two-level relation
   * load that MongoDB cannot join, so Prisma issues it as a burst of round
   * trips — and this guard runs on **every authenticated request**. Against a
   * hosted database that burst was the single largest cost in the application,
   * paid before any handler had done a thing.
   *
   * ## Why caching it is safe
   *
   * `role_permissions` has no runtime write path. The only thing that changes
   * a role's grants is the system seed (`packages/db/src/seed/roles.ts`), which
   * an operator runs deliberately. There is no API by which a role can gain or
   * lose a permission mid-request, so there is no revocation this could delay.
   *
   * ## Why it still expires
   *
   * A minute, so that a seed run against a live database takes effect without
   * a restart. Bounded rather than permanent: "it needs a redeploy to pick up"
   * is the kind of operational surprise that gets discovered at the worst
   * moment.
   *
   * **This is not a session cache.** The session, the membership, and its
   * status are read from the database on every single request exactly as
   * before — a revoked session or a deactivated membership still dies
   * immediately, which is the property server-side sessions exist for.
   */
  private readonly rolePermissions = new Map<string, { granted: Set<string>; readAt: number }>();

  private static readonly ROLE_CACHE_TTL_MS = 60_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {}

  private async permissionsForRole(roleId: string): Promise<Set<string>> {
    const cached = this.rolePermissions.get(roleId);

    if (cached !== undefined && Date.now() - cached.readAt < AuthGuard.ROLE_CACHE_TTL_MS) {
      // Copied, so a handler that mutates what it was given cannot poison the
      // grants every later request is checked against.
      return new Set(cached.granted);
    }

    const rows = await this.database.unscoped.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });

    const granted = new Set(rows.map((row) => row.permission.key));

    this.rolePermissions.set(roleId, { granted, readAt: Date.now() });

    return new Set(granted);
  }

  /**
   * Why a request was rejected.
   *
   * The client sees one indistinguishable message for every rejection —
   * telling it which check failed would say whether a token was ever valid.
   * The log is where the difference belongs, because an operator debugging a
   * support ticket needs exactly what an attacker must not have.
   */
  private reject(reason: string, error: Error): never {
    this.logger.debug({ authRejection: reason }, 'Request rejected by AuthGuard');
    throw error;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [handler, controller]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.readToken(request);

    if (token === undefined) this.reject('no session cookie', new UnauthenticatedError());

    // Session resolution runs unscoped by necessity: it is the thing that
    // establishes the tenant context everything else is scoped by.
    const session = await this.database.unscoped.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        steppedUpAt: true,
        activeMembership: {
          select: {
            id: true,
            organizationId: true,
            status: true,
            roleId: true,
            role: { select: { key: true } },
          },
        },
      },
    });

    if (session === null) this.reject('token matches no session', new UnauthenticatedError());

    const now = new Date();
    if (session.revokedAt !== null) this.reject('session revoked', new SessionExpiredError());
    if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
      this.reject('session expired', new SessionExpiredError());
    }

    const membership = session.activeMembership;

    // A session whose membership was deactivated is over, immediately — not at
    // its next expiry. That is the whole point of server-side sessions.
    if (membership === null || membership.status !== 'ACTIVE') {
      this.reject('membership missing or inactive', new SessionExpiredError());
    }

    // Layer 1 of tenant isolation: the organisation comes from the membership
    // on the session and from nowhere else. Nothing the client sent is
    // consulted, so there is nothing for it to influence.
    const granted = await this.permissionsForRole(membership.roleId);

    enterContext({
      organizationId: membership.organizationId,
      membershipId: membership.id,
      userId: session.userId,
      sessionId: session.id,
      // Published so a handler can ask about a *second* permission without
      // re-reading `role_permissions`. It never replaces the check below: this
      // is the resolved set, and the gate is still the decorator.
      permissions: granted,
    });

    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      handler,
      controller,
    ]);

    /**
     * INV-05, enforced independently of the permission set.
     *
     * The auditor role holds no mutating permission, and a test asserts that.
     * This is the second mechanism: even if a grant were added by mistake — a
     * bad seed, a hand-edited row — every non-`GET` from an auditor is refused
     * here. Two mechanisms that can fail separately is the point.
     */
    if (membership.role.key === 'AUDITOR' && !isSafeMethod(request.method)) {
      throw new AuditorReadOnlyError();
    }

    if (required !== undefined && !granted.has(required)) {
      // A permission the caller lacks within their own organisation is a
      // genuine 403. Cross-tenant access is a 404, and is handled by the
      // repository predicate rather than here — by the time a query runs, the
      // other organisation's rows are not in scope to be found.
      throw new ForbiddenError();
    }

    if (
      required !== undefined &&
      membership.role.key === 'AUDITOR' &&
      !isReadOnlyPermission(required)
    ) {
      throw new AuditorReadOnlyError();
    }

    const needsStepUp = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [
      handler,
      controller,
    ]);

    if (needsStepUp === true) {
      const windowMs = this.config.get('STEP_UP_WINDOW_MINUTES') * 60_000;
      const fresh =
        session.steppedUpAt !== null && now.getTime() - session.steppedUpAt.getTime() < windowMs;

      if (!fresh) throw new StepUpRequiredError();
    }

    return true;
  }

  private readToken(request: Request): string | undefined {
    const cookieName = this.config.get('SESSION_COOKIE_NAME');
    // `@types/express` declares `cookies` as `any`, so it is narrowed here
    // rather than trusted. A repeated cookie parses as an array, and treating
    // that as a token would hand the session lookup something it cannot hash.
    const cookies = (request as unknown as { cookies?: Record<string, unknown> }).cookies;
    const value = cookies?.[cookieName];

    return typeof value === 'string' ? value : undefined;
  }
}

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}
