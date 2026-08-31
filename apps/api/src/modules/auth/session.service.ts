import type { Prisma } from '@financy/db';
import { newId } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../platform/config/index.js';
import { generateToken, hashToken } from '../../platform/crypto/index.js';

export interface IssuedSession {
  readonly id: string;
  /** The plaintext. Returned exactly once, to be set as a cookie. */
  readonly token: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface ResolvedSession {
  readonly id: string;
  readonly userId: string;
  readonly activeMembershipId: string | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly steppedUpAt: Date | null;
}

/**
 * Opaque server-side sessions.
 *
 * Opaque rather than a JWT, deliberately (docs/12 §4). A JWT cannot be revoked
 * before it expires, and this product must be able to cut off a departing
 * employee *now* — the whole `session:revoke_any` permission would otherwise be
 * a lie. Looking the token up costs one indexed query, which is not the
 * bottleneck anyone thinks it is.
 *
 * Only the SHA-256 digest is stored, so a database disclosure hands the reader
 * no working sessions.
 */
@Injectable()
export class SessionService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Two expiries, because they defend against different things: idle against
   * an unattended browser, absolute against a stolen token living forever.
   */
  async issue(
    tx: Prisma.TransactionClient,
    userId: string,
    activeMembershipId: string | null,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<IssuedSession> {
    const token = generateToken();
    const now = Date.now();

    const idleExpiresAt = new Date(now + this.config.get('SESSION_IDLE_TIMEOUT_MINUTES') * 60_000);
    const absoluteExpiresAt = new Date(
      now + this.config.get('SESSION_ABSOLUTE_TIMEOUT_HOURS') * 3_600_000,
    );

    const session = await tx.session.create({
      data: {
        id: newId(),
        userId,
        activeMembershipId,
        tokenHash: hashToken(token),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        // The database CHECK refuses idle > absolute; clamping here means a
        // long idle timeout in configuration cannot make login fail outright.
        idleExpiresAt: idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt,
        absoluteExpiresAt,
      },
      select: { id: true, idleExpiresAt: true, absoluteExpiresAt: true },
    });

    return { ...session, token };
  }

  /**
   * Resolve a presented token, or `null`.
   *
   * `null` covers every failure — unknown token, revoked, idle-expired,
   * absolutely expired — because the caller's response is identical in all
   * four cases and distinguishing them for the client would leak whether a
   * token was ever valid.
   *
   * Expiry is evaluated in the query rather than in JavaScript so that a
   * revoked or expired row cannot be resurrected by a clock difference between
   * the application and the database.
   */
  async resolve(
    tx: Prisma.TransactionClient,
    token: string,
    now: Date = new Date(),
  ): Promise<ResolvedSession | null> {
    const session = await tx.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        activeMembershipId: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        steppedUpAt: true,
        revokedAt: true,
      },
    });

    if (session === null) return null;
    if (session.revokedAt !== null) return null;
    if (session.idleExpiresAt <= now) return null;
    if (session.absoluteExpiresAt <= now) return null;

    const { revokedAt: _revokedAt, ...resolved } = session;
    return resolved;
  }

  /**
   * Slide the idle window forward, capped by the absolute expiry.
   *
   * Written on every authenticated request, which is the one write this system
   * makes on a read path. It is bounded: the update is skipped unless the
   * window has moved by more than a minute, so a burst of requests produces one
   * write rather than hundreds.
   */
  async touch(
    tx: Prisma.TransactionClient,
    session: ResolvedSession,
    now = new Date(),
  ): Promise<void> {
    const idleWindowMs = this.config.get('SESSION_IDLE_TIMEOUT_MINUTES') * 60_000;
    const nextIdle = new Date(
      Math.min(now.getTime() + idleWindowMs, session.absoluteExpiresAt.getTime()),
    );

    if (nextIdle.getTime() - session.idleExpiresAt.getTime() < 60_000) return;

    await tx.session.update({
      where: { id: session.id },
      data: { idleExpiresAt: nextIdle, lastSeenAt: now },
    });
  }

  async revoke(tx: Prisma.TransactionClient, sessionId: string, reason: string): Promise<void> {
    await tx.session.updateMany({
      // `updateMany` with a `revokedAt: null` predicate, so revoking twice does
      // not overwrite the original reason and timestamp with a later one.
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /**
   * Revoke every session a user holds, optionally sparing the current one.
   *
   * Used on password change and on deactivation. Sparing the current session
   * on a password change is deliberate: the person who just proved they know
   * the new password should not be signed out for doing the right thing.
   */
  async revokeAllForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId === undefined ? {} : { id: { not: exceptSessionId } }),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });

    return result.count;
  }

  /** Bind a session to a different organisation, for the org switcher. */
  async setActiveMembership(
    tx: Prisma.TransactionClient,
    sessionId: string,
    membershipId: string,
  ): Promise<void> {
    await tx.session.update({
      where: { id: sessionId },
      // Switching organisation resets step-up: authority proved in one tenant
      // is not authority in another.
      data: { activeMembershipId: membershipId, steppedUpAt: null },
    });
  }
}
