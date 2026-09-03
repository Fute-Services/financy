import type { Prisma } from '@financy/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runWithContext } from '../request-context/index.js';
import { AuditService } from './audit.service.js';
import { SecurityEventService } from './security-event.service.js';

const ORG = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';
const MEMBERSHIP = '0192f3a1-9c2b-7d4e-8f01-aaaaaaaaaaaa';

/**
 * A transaction client that records what it was asked to write.
 *
 * Unit-testable because the interesting logic here is *resolution* — which
 * actor, which organisation, which correlation id — and none of that needs a
 * database. Whether the row is accepted once resolved is the database's
 * business, and `packages/db` proves that against real PostgreSQL.
 */
function fakeTx() {
  const auditEvent = { create: vi.fn().mockResolvedValue({}) };
  const securityEvent = { create: vi.fn().mockResolvedValue({}) };

  return {
    tx: { auditEvent, securityEvent } as unknown as Prisma.TransactionClient,
    auditEvent,
    securityEvent,
  };
}

function inRequest<T>(patch: Record<string, unknown>, fn: () => T): T {
  return runWithContext({ correlationId: 'corr-1', startedAt: Date.now(), ...patch }, fn);
}

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
  });

  describe('actor resolution', () => {
    it('takes the actor and organisation from the request context', async () => {
      const { tx, auditEvent } = fakeTx();

      await inRequest({ organizationId: ORG, membershipId: MEMBERSHIP }, () =>
        service.record(tx, { action: 'membership.role_changed', resourceType: 'membership' }),
      );

      expect(auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG,
          actorMembershipId: MEMBERSHIP,
          actorType: 'USER',
          action: 'membership.role_changed',
          correlationId: 'corr-1',
        }),
      });
    });

    /**
     * A service must not be able to claim a different actor than the session
     * driving the request — otherwise the audit trail records whatever the
     * caller felt like, which is not evidence.
     */
    it('carries the ip and user agent from the context, not from the caller', async () => {
      const { tx, auditEvent } = fakeTx();

      await inRequest(
        {
          organizationId: ORG,
          membershipId: MEMBERSHIP,
          ipAddress: '203.0.113.4',
          userAgent: 'Mozilla/5.0',
        },
        () => service.record(tx, { action: 'x.done', resourceType: 'x' }),
      );

      expect(auditEvent.create.mock.calls[0]?.[0].data).toMatchObject({
        ipAddress: '203.0.113.4',
        userAgent: 'Mozilla/5.0',
      });
    });

    /**
     * Registration audits an organisation and a membership created by the very
     * transaction writing the event, so neither the tenant context nor the
     * actor exists yet. Both can be supplied explicitly for exactly that case.
     */
    it('accepts an explicit organisation and actor, for registration', async () => {
      const { tx, auditEvent } = fakeTx();

      await service.record(tx, {
        action: 'organization.created',
        resourceType: 'organization',
        organizationId: ORG,
        actorMembershipId: MEMBERSHIP,
        actorType: 'USER',
      });

      expect(auditEvent.create.mock.calls[0]?.[0].data).toMatchObject({
        organizationId: ORG,
        actorMembershipId: MEMBERSHIP,
        correlationId: 'system',
      });
    });

    it('defaults to a SYSTEM actor when there is no membership', async () => {
      const { tx, auditEvent } = fakeTx();

      await inRequest({ organizationId: ORG }, () =>
        service.record(tx, {
          action: 'session.expired',
          resourceType: 'session',
          actorLabel: 'expiry-sweep',
        }),
      );

      expect(auditEvent.create.mock.calls[0]?.[0].data).toMatchObject({
        actorType: 'SYSTEM',
        actorMembershipId: null,
        actorLabel: 'expiry-sweep',
      });
    });

    /**
     * The database enforces this too, via `audit_actor_present`. Checking here
     * as well means the error names the action instead of surfacing as a
     * constraint violation from three layers down.
     */
    it('refuses a USER action with no membership, naming the action', async () => {
      const { tx, auditEvent } = fakeTx();

      await expect(
        inRequest({ organizationId: ORG }, () =>
          service.record(tx, {
            action: 'spend_request.approved',
            resourceType: 'spend_request',
            actorType: 'USER',
          }),
        ),
      ).rejects.toThrow(/spend_request\.approved/);

      expect(auditEvent.create).not.toHaveBeenCalled();
    });

    it('refuses to write with no organisation at all', async () => {
      const { tx, auditEvent } = fakeTx();

      await expect(service.record(tx, { action: 'x.done', resourceType: 'x' })).rejects.toThrow(
        /no organisation/i,
      );

      expect(auditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('the change itself', () => {
    it('records before and after when given them', async () => {
      const { tx, auditEvent } = fakeTx();

      await inRequest({ organizationId: ORG, membershipId: MEMBERSHIP }, () =>
        service.record(tx, {
          action: 'membership.role_changed',
          resourceType: 'membership',
          resourceId: MEMBERSHIP,
          before: { roleKey: 'EMPLOYEE' },
          after: { roleKey: 'MANAGER' },
          metadata: { reason: 'promotion' },
        }),
      );

      expect(auditEvent.create.mock.calls[0]?.[0].data).toMatchObject({
        resourceId: MEMBERSHIP,
        before: { roleKey: 'EMPLOYEE' },
        after: { roleKey: 'MANAGER' },
        metadata: { reason: 'promotion' },
      });
    });

    /**
     * An export has no before and no after — it changed nothing. Writing
     * explicit nulls would be indistinguishable from "we forgot to capture
     * it", so the keys are omitted and the column default stands.
     */
    it('omits before and after entirely for a read-style event', async () => {
      const { tx, auditEvent } = fakeTx();

      await inRequest({ organizationId: ORG, membershipId: MEMBERSHIP }, () =>
        service.record(tx, { action: 'audit_event.exported', resourceType: 'audit_event' }),
      );

      const data = auditEvent.create.mock.calls[0]?.[0].data as Record<string, unknown>;
      expect(data).not.toHaveProperty('before');
      expect(data).not.toHaveProperty('after');
      expect(data).not.toHaveProperty('metadata');
    });

    it('has no update and no delete — the absence is the control', () => {
      expect(Object.getOwnPropertyNames(AuditService.prototype).sort()).toEqual([
        'constructor',
        'record',
      ]);
    });
  });
});

describe('SecurityEventService', () => {
  it('records an attempt with the context it happened in', async () => {
    const { tx, securityEvent } = fakeTx();
    const service = new SecurityEventService();

    await inRequest({ ipAddress: '198.51.100.7', userAgent: 'curl/8' }, () =>
      service.record(tx, {
        type: 'LOGIN_FAILED',
        organizationId: ORG,
        metadata: { failedLoginCount: 3 },
      }),
    );

    expect(securityEvent.create.mock.calls[0]?.[0].data).toMatchObject({
      type: 'LOGIN_FAILED',
      organizationId: ORG,
      userId: null,
      membershipId: null,
      ipAddress: '198.51.100.7',
      correlationId: 'corr-1',
    });
  });

  /**
   * A failed login for an unknown address has neither a user nor a membership,
   * and is still worth recording — it is the shape of an attack.
   */
  it('works outside a request context', async () => {
    const { tx, securityEvent } = fakeTx();
    const service = new SecurityEventService();

    await service.record(tx, { type: 'SESSION_REVOKED', organizationId: ORG, userId: MEMBERSHIP });

    expect(securityEvent.create.mock.calls[0]?.[0].data).toMatchObject({
      correlationId: 'system',
      ipAddress: null,
      userAgent: null,
    });
  });
});
