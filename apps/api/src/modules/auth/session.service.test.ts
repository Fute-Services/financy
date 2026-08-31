import type { Prisma } from '@financy/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../platform/config/index.js';
import { SessionService } from './session.service.js';

/**
 * Session lifecycle, without a database.
 *
 * The revocation paths are unit-tested rather than left to the integration
 * suite because a bug lived here that the integration suite could not have
 * caught in isolation: filtering on `revokedAt: null` matches nothing on
 * MongoDB, so `logout` returned `204` and left the session working. These
 * assertions pin the shape of the query, which is the thing that was wrong.
 */

const USER = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';
const SESSION = '0192f3a1-9c2b-7d4e-8f01-aaaaaaaaaaaa';

function fakeTx(sessions: Array<{ id: string; revokedAt: Date | null }> = []) {
  const session = {
    create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: args.data['id'],
        idleExpiresAt: args.data['idleExpiresAt'],
        absoluteExpiresAt: args.data['absoluteExpiresAt'],
      }),
    ),
    findUnique: vi
      .fn()
      .mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(sessions.find((row) => row.id === where.id) ?? null),
      ),
    findMany: vi.fn().mockResolvedValue(sessions),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };

  return { tx: { session } as unknown as Prisma.TransactionClient, session };
}

function service(overrides: Record<string, unknown> = {}): SessionService {
  const config = new ConfigService({
    SESSION_IDLE_TIMEOUT_MINUTES: 30,
    SESSION_ABSOLUTE_TIMEOUT_HOURS: 12,
    ...overrides,
  } as never);

  return new SessionService(config);
}

describe('issue', () => {
  it('returns the plaintext token exactly once and stores only its hash', async () => {
    const { tx, session } = fakeTx();

    const issued = await service().issue(tx, USER, SESSION, {});

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const written = session.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(written['tokenHash']).toBeInstanceOf(Uint8Array);
    // The plaintext must not appear anywhere in what was persisted.
    expect(JSON.stringify(written)).not.toContain(issued.token);
  });

  it('sets an idle expiry inside the absolute one', async () => {
    const { tx, session } = fakeTx();

    await service().issue(tx, USER, SESSION, {});

    const written = session.create.mock.calls[0]?.[0].data as Record<string, Date>;
    expect(written['idleExpiresAt']!.getTime()).toBeLessThan(
      written['absoluteExpiresAt']!.getTime(),
    );
  });

  /**
   * PostgreSQL refused `idle > absolute` with a CHECK. MongoDB accepts it, so
   * the clamp here is now the only thing preventing a session whose idle
   * timeout can never fire.
   */
  it('clamps an idle window longer than the absolute one', async () => {
    const { tx, session } = fakeTx();

    await service({
      SESSION_IDLE_TIMEOUT_MINUTES: 60 * 24 * 7,
      SESSION_ABSOLUTE_TIMEOUT_HOURS: 1,
    }).issue(tx, USER, SESSION, {});

    const written = session.create.mock.calls[0]?.[0].data as Record<string, Date>;
    expect(written['idleExpiresAt']!.getTime()).toBe(written['absoluteExpiresAt']!.getTime());
  });

  it('records the address and agent when the request had them', async () => {
    const { tx, session } = fakeTx();

    await service().issue(tx, USER, SESSION, {
      ipAddress: '203.0.113.4',
      userAgent: 'Mozilla/5.0',
    });

    expect(session.create.mock.calls[0]?.[0].data).toMatchObject({
      ipAddress: '203.0.113.4',
      userAgent: 'Mozilla/5.0',
    });
  });
});

describe('revoke', () => {
  let subject: SessionService;

  beforeEach(() => {
    subject = service();
  });

  /**
   * The regression test. The query must select by primary key — filtering on
   * `revokedAt: null` matched zero documents on MongoDB, so logout silently
   * did nothing.
   */
  it('updates by id, never by a null filter', async () => {
    const { tx, session } = fakeTx([{ id: SESSION, revokedAt: null }]);

    await subject.revoke(tx, SESSION, 'USER_LOGOUT');

    expect(session.update).toHaveBeenCalledWith({
      where: { id: SESSION },
      data: expect.objectContaining({ revokedReason: 'USER_LOGOUT' }),
    });

    const where = session.update.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where).not.toHaveProperty('revokedAt');
  });

  it('leaves an already-revoked session alone, keeping the original reason', async () => {
    const revokedAt = new Date('2026-01-01T00:00:00.000Z');
    const { tx, session } = fakeTx([{ id: SESSION, revokedAt }]);

    await subject.revoke(tx, SESSION, 'USER_LOGOUT');

    expect(session.update).not.toHaveBeenCalled();
  });

  it('does nothing for a session that does not exist', async () => {
    const { tx, session } = fakeTx([]);

    await subject.revoke(tx, SESSION, 'USER_LOGOUT');

    expect(session.update).not.toHaveBeenCalled();
  });
});

describe('revokeAllForUser', () => {
  it('revokes every live session and reports the count', async () => {
    const { tx, session } = fakeTx([
      { id: 'a', revokedAt: null },
      { id: 'b', revokedAt: null },
    ]);
    session.updateMany.mockResolvedValue({ count: 2 });

    const count = await service().revokeAllForUser(tx, USER, 'PASSWORD_CHANGED');

    expect(count).toBe(2);
    expect(session.updateMany.mock.calls[0]?.[0].where).toEqual({ id: { in: ['a', 'b'] } });
  });

  /**
   * Changing a password should not sign you out of the device you changed it
   * on — the person who just proved they know the new one.
   */
  it('spares the current session when asked', async () => {
    const { tx, session } = fakeTx([
      { id: 'current', revokedAt: null },
      { id: 'other', revokedAt: null },
    ]);

    await service().revokeAllForUser(tx, USER, 'PASSWORD_CHANGED', 'current');

    expect(session.updateMany.mock.calls[0]?.[0].where).toEqual({ id: { in: ['other'] } });
  });

  it('skips sessions that are already revoked', async () => {
    const { tx, session } = fakeTx([
      { id: 'live', revokedAt: null },
      { id: 'dead', revokedAt: new Date() },
    ]);

    await service().revokeAllForUser(tx, USER, 'MEMBERSHIP_DEACTIVATED');

    expect(session.updateMany.mock.calls[0]?.[0].where).toEqual({ id: { in: ['live'] } });
  });

  it('writes nothing when there is nothing live', async () => {
    const { tx, session } = fakeTx([{ id: 'dead', revokedAt: new Date() }]);

    const count = await service().revokeAllForUser(tx, USER, 'MEMBERSHIP_DEACTIVATED');

    expect(count).toBe(0);
    expect(session.updateMany).not.toHaveBeenCalled();
  });
});
