import {
  DEFAULT_ROLE_SCOPE,
  INVITATION_RESEND_LIMIT_PER_DAY,
  INVITATION_TTL_HOURS,
  type AcceptInvitation,
  type CreateInvitation,
  type Invitation,
  type InvitationPreview,
  type IssuedInvitation,
  type RoleKey,
} from '@financy/contracts';
import {
  ConflictError,
  MembershipExistsError,
  NotFoundError,
  RateLimitError,
  UnauthenticatedError,
  ValidationError,
  newId,
} from '@financy/core';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { generateToken, hashToken } from '../../platform/crypto/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { PasswordService } from '../auth/index.js';
import { SessionService, type IssuedSession } from '../auth/session.service.js';

const INVITATION_SELECT = {
  id: true,
  email: true,
  departmentId: true,
  invitedByMembershipId: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  deletedAt: true,
  resentCount: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { key: true } },
} as const;

interface InvitationRow {
  id: string;
  email: string;
  departmentId: string | null;
  invitedByMembershipId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  deletedAt: Date | null;
  resentCount: number;
  createdAt: Date;
  role: { key: string };
}

export interface AcceptedInvitation {
  readonly session: IssuedSession;
  readonly membershipId: string;
}

/**
 * Invitations (docs/10 §5.1 and §5.3, task 1.5.6).
 *
 * **The token is a bearer credential and is stored as a hash.** Anyone
 * holding the plaintext can join the organisation as the invited person, so
 * the database keeps only `sha-256(token)` — a dump of the invitations
 * collection is then useless for joining anything. The plaintext exists in
 * exactly two responses, the create and the resend, and is unrecoverable
 * afterwards.
 *
 * **Acceptance is deliberately not a login.** It resolves the invitation by
 * token, not by anything the caller claims about themselves, and refuses a
 * password when the address already has an account — otherwise accepting an
 * invitation would be a way to overwrite the password of an account somebody
 * else controls, which turns "invite a colleague" into account takeover.
 *
 * **Nothing is deleted.** A spent or revoked invitation is evidence that
 * somebody was invited, by whom, and when; the row survives with a timestamp
 * saying which happened.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly password: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async list(): Promise<Invitation[]> {
    const rows = await this.database.client.invitation.findMany({
      select: INVITATION_SELECT,
      orderBy: [{ createdAt: 'desc' }],
    });

    // Soft-deleted rows are filtered here rather than with `deletedAt: null`:
    // on MongoDB an optional field never written is absent, and Prisma's
    // `null` filter does not match absent (ADR-0017), so that predicate would
    // return nothing at all.
    return rows.filter((row) => row.deletedAt === null).map(toInvitation);
  }

  async create(input: CreateInvitation): Promise<IssuedInvitation> {
    const organizationId = requireOrganization();
    const invitedByMembershipId = getContext()?.membershipId;

    if (invitedByMembershipId === undefined) {
      throw new Error('An invitation must name the membership that sent it.');
    }

    return this.database.unscoped.$transaction(async (tx) => {
      // Already a member? Say so rather than issuing a token that would fail
      // at the end of the acceptance flow, after the person has typed a
      // password and believed they were joining.
      const existing = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });

      if (existing !== null) {
        const membership = await tx.membership.findFirst({
          where: { organizationId, userId: existing.id },
          select: { id: true },
        });

        if (membership !== null) throw new MembershipExistsError();
      }

      const pending = await tx.invitation.findMany({
        where: { organizationId, email: input.email },
        select: { id: true, acceptedAt: true, revokedAt: true, deletedAt: true, expiresAt: true },
      });

      const now = new Date();
      const live = pending.find(
        (row) =>
          row.deletedAt === null &&
          row.acceptedAt === null &&
          row.revokedAt === null &&
          row.expiresAt > now,
      );

      if (live !== undefined) {
        throw new ConflictError(
          'That address already has a pending invitation. Resend or revoke it instead.',
        );
      }

      if (input.departmentId !== undefined && input.departmentId !== null) {
        const department = await tx.department.findFirst({
          where: { id: input.departmentId, organizationId },
          select: { archivedAt: true },
        });

        if (department === null) throw new NotFoundError('Department');

        if (department.archivedAt !== null) {
          throw new ConflictError('That department is archived. Choose an active one.');
        }
      }

      const role = await tx.role.findFirst({
        where: { organizationId, key: input.roleKey },
        select: { id: true },
      });

      if (role === null) {
        throw new Error(`Organisation ${organizationId} has no ${input.roleKey} role.`);
      }

      const token = generateToken();

      const created = await tx.invitation.create({
        data: {
          id: newId(),
          organizationId,
          email: input.email,
          roleId: role.id,
          departmentId: input.departmentId ?? null,
          invitedByMembershipId,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + INVITATION_TTL_HOURS * 3_600_000),
        },
        select: INVITATION_SELECT,
      });

      await this.audit.record(tx, {
        action: 'invitation.created',
        resourceType: 'invitation',
        resourceId: created.id,
        // The email is here because who was invited is the whole point of the
        // event. The token is not, and never is: an audit log a support
        // engineer can read is not a place to put a live credential.
        after: { email: created.email, roleKey: input.roleKey },
      });

      return { invitation: toInvitation(created), token };
    });
  }

  /**
   * Issue a fresh token for the same invitation.
   *
   * The old token stops working, which is the point: a resend usually means
   * the first link went astray, and leaving two live tokens doubles the
   * surface for no benefit.
   */
  async resend(id: string): Promise<IssuedInvitation> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.invitation.findFirst({
        where: { id, organizationId },
        select: { ...INVITATION_SELECT, updatedAt: true },
      });

      if (before === null || before.deletedAt !== null) throw new NotFoundError('Invitation');

      if (before.acceptedAt !== null) {
        throw new ConflictError('That invitation has already been accepted.');
      }

      if (before.revokedAt !== null) {
        throw new ConflictError('That invitation was revoked. Send a new one instead.');
      }

      // Three per day (docs/10 §5.3). Counted against the row's own resend
      // tally and reset by the calendar day of the last change, so a stalled
      // invitation cannot be used to mail somebody indefinitely.
      const sameDay =
        before.updatedAt.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);

      if (sameDay && before.resentCount >= INVITATION_RESEND_LIMIT_PER_DAY) {
        throw new RateLimitError(3_600, {
          details: { limit: INVITATION_RESEND_LIMIT_PER_DAY, window: 'day' },
        });
      }

      const token = generateToken();
      const now = new Date();

      const after = await tx.invitation.update({
        where: { id },
        data: {
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + INVITATION_TTL_HOURS * 3_600_000),
          resentCount: sameDay ? before.resentCount + 1 : 1,
        },
        select: INVITATION_SELECT,
      });

      await this.audit.record(tx, {
        action: 'invitation.resent',
        resourceType: 'invitation',
        resourceId: id,
        metadata: { resentCount: after.resentCount },
      });

      return { invitation: toInvitation(after), token };
    });
  }

  async revoke(id: string): Promise<Invitation> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.invitation.findFirst({
        where: { id, organizationId },
        select: INVITATION_SELECT,
      });

      if (before === null || before.deletedAt !== null) throw new NotFoundError('Invitation');

      if (before.acceptedAt !== null) {
        throw new ConflictError('That invitation has already been accepted.');
      }

      if (before.revokedAt !== null) {
        throw new ConflictError('That invitation is already revoked.');
      }

      const after = await tx.invitation.update({
        where: { id },
        data: { revokedAt: new Date() },
        select: INVITATION_SELECT,
      });

      await this.audit.record(tx, {
        action: 'invitation.revoked',
        resourceType: 'invitation',
        resourceId: id,
        after: { email: before.email },
      });

      return toInvitation(after);
    });
  }

  /**
   * The acceptance screen's preflight, by token.
   *
   * Runs unscoped and public, because the token *is* the authorisation and it
   * determines which organisation is being joined — there is no session yet
   * to scope by. It returns the organisation's name, the address the
   * invitation was sent to, and whether a password is needed: all three are
   * things the token holder already knows or is about to be told, and none of
   * them reveals anything about an address they did not receive a token for.
   */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.database.unscoped.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        email: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        deletedAt: true,
        role: { select: { key: true } },
        organization: { select: { name: true } },
      },
    });

    // One answer for "no such token", "already used", "revoked", and
    // "expired". They are all "this link does not work", and distinguishing
    // them tells someone guessing at tokens which guesses were close.
    if (invitation === null || !isUsable(invitation, new Date())) {
      throw new NotFoundError('Invitation');
    }

    const user = await this.database.unscoped.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });

    return {
      organizationName: invitation.organization.name,
      email: invitation.email,
      roleKey: invitation.role.key as RoleKey,
      requiresPassword: user === null,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Accept, creating the account if there is not one, and sign in.
   *
   * Runs on the unscoped client for the same reason `preview` does: the token
   * establishes the tenant, so there is nothing to scope by until it has been
   * resolved.
   */
  async accept(input: AcceptInvitation): Promise<AcceptedInvitation> {
    const context = getContext();

    return this.database.unscoped.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(input.token) },
        select: {
          id: true,
          organizationId: true,
          email: true,
          roleId: true,
          departmentId: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          deletedAt: true,
          role: { select: { key: true } },
        },
      });

      if (invitation === null || !isUsable(invitation, new Date())) {
        throw new NotFoundError('Invitation');
      }

      const existing = await tx.user.findUnique({
        where: { email: invitation.email },
        select: { id: true, archivedAt: true },
      });

      let userId: string;

      if (existing === null) {
        if (input.password === undefined) {
          throw new ValidationError({
            password: ['This address has no account yet, so a password is required.'],
          });
        }

        if (input.fullName === undefined) {
          throw new ValidationError({ fullName: ['Required when creating a new account.'] });
        }

        userId = newId();

        await tx.user.create({
          data: {
            id: userId,
            email: invitation.email,
            fullName: input.fullName,
            passwordHash: await this.password.hash(input.password),
          },
        });
      } else {
        // Refused, not ignored. An accepted password on an existing account
        // would make "invite a colleague" a way to set the password of an
        // account somebody else controls.
        if (input.password !== undefined) {
          throw new ValidationError({
            password: [
              'This address already has an account. Sign in instead of setting a password.',
            ],
          });
        }

        if (existing.archivedAt !== null) throw new UnauthenticatedError();

        userId = existing.id;
      }

      // The unique index on (organizationId, userId) makes this true under
      // concurrency; the check is here so the error names the situation.
      const already = await tx.membership.findFirst({
        where: { organizationId: invitation.organizationId, userId },
        select: { id: true },
      });

      if (already !== null) throw new MembershipExistsError();

      const membershipId = newId();

      await tx.membership.create({
        data: {
          id: membershipId,
          organizationId: invitation.organizationId,
          userId,
          roleId: invitation.roleId,
          departmentId: invitation.departmentId,
          scope: DEFAULT_ROLE_SCOPE[invitation.role.key as RoleKey],
          status: 'ACTIVE',
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      await this.audit.record(tx, {
        action: 'invitation.accepted',
        resourceType: 'membership',
        resourceId: membershipId,
        // The actor is the person joining, whose membership is created by this
        // same transaction — so it is named explicitly rather than read from a
        // request context that has none yet.
        actorMembershipId: membershipId,
        actorType: 'USER',
        organizationId: invitation.organizationId,
        after: { email: invitation.email, roleKey: invitation.role.key },
        metadata: { invitationId: invitation.id },
      });

      const session = await this.sessions.issue(tx, userId, membershipId, {
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return { session, membershipId };
    });
  }
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Invitations cannot be written without a tenant context.');
  }

  return organizationId;
}

/** Pending, unrevoked, unexpired, and not soft-deleted. */
function isUsable(
  invitation: {
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    deletedAt: Date | null;
  },
  now: Date,
): boolean {
  return (
    invitation.deletedAt === null &&
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    invitation.expiresAt > now
  );
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    roleKey: row.role.key as RoleKey,
    departmentId: row.departmentId,
    invitedByMembershipId: row.invitedByMembershipId,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    resentCount: row.resentCount,
    createdAt: row.createdAt.toISOString(),
    // Derived here rather than by the client, so "expired" cannot mean one
    // thing on the screen and another at the endpoint.
    status:
      row.acceptedAt !== null
        ? 'ACCEPTED'
        : row.revokedAt !== null
          ? 'REVOKED'
          : row.expiresAt <= new Date()
            ? 'EXPIRED'
            : 'PENDING',
  };
}
