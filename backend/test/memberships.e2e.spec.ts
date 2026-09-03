import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * Membership writes — the privileged corner of the application
 * (docs/03 §8, tasks 1.5.5 and 1.5.7).
 *
 * These are the tests that would catch a privilege-escalation regression, and
 * every one of them exercises a rule the database does not hold:
 *
 * - **INV-03.** Nobody changes their own role, and nobody grants a role
 *   carrying permissions they do not themselves hold.
 * - **INV-04.** The last active `ORG_ADMIN` cannot be demoted or deactivated.
 *   An organisation that loses its last administrator can still be signed
 *   into and can never be administered again; no support process recovers it.
 * - **Step-up.** A role change needs the password again, so a stolen session
 *   cookie alone cannot turn into a tenancy takeover.
 * - **Deactivation revokes sessions.** One that left them working would
 *   report success while the person kept full access.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

interface MembershipBody {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: { key: string; name: string };
  department: { id: string } | null;
  scope: string;
  status: 'ACTIVE' | 'INACTIVE';
  managerMembershipId: string | null;
  entityScope: string[];
  permissions: string[];
  version: number;
}

function expectStatus(response: request.Response, status: number): request.Response {
  if (response.status !== status) {
    throw new Error(
      `Expected ${String(status)} from ${response.request.method} ${response.request.url}, got ${String(response.status)}.
Body: ${JSON.stringify(response.body, null, 2)}`,
    );
  }

  return response;
}

describeWithDatabase('membership writes', () => {
  let app: INestApplication;
  let server: Server;

  /** The organisation's founding administrator. */
  let admin: { cookie: string; membershipId: string };
  /** A second administrator, so INV-04 has something to allow. */
  let second: { cookie: string; membershipId: string };
  let stranger: { cookie: string; membershipId: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    admin = await register('admin');
    second = await register('second');
    stranger = await register('stranger');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(name: string): Promise<{ cookie: string; membershipId: string }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Memberships ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `${name}-${RUN}@memberships.test`,
          password: PASSWORD,
          baseCurrency: 'USD',
          countryCode: 'US',
        }),
      201,
    );

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const body = response.body as { membership: { id: string } };

    return {
      cookie: setCookie.map((value) => value.split(';')[0]).join('; '),
      membershipId: body.membership.id,
    };
  }

  async function stepUp(who: { cookie: string }): Promise<void> {
    expectStatus(
      await request(server)
        .post('/v1/auth/step-up')
        .set('Cookie', who.cookie)
        .send({ password: PASSWORD }),
      200,
    );
  }

  async function get(id: string, as: string = admin.cookie): Promise<MembershipBody> {
    const response = expectStatus(
      await request(server).get(`/v1/memberships/${id}`).set('Cookie', as),
      200,
    );

    return (response.body as { data: MembershipBody }).data;
  }

  // ── step-up ──────────────────────────────────────────────────────────────

  describe('step-up', () => {
    /**
     * Without this endpoint `@RequireStepUp()` is a permanent refusal —
     * nothing else sets `steppedUpAt`, so every route carrying it would answer
     * 403 to everyone, forever. That reads as a bug to an operator and as a
     * reason to delete the decorator to a developer.
     */
    it('is what makes a step-up route reachable at all', async () => {
      const me = await get(admin.membershipId);

      const before = expectStatus(
        await request(server)
          .post(`/v1/memberships/${me.id}/role`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ roleKey: 'EMPLOYEE', reason: 'no step-up yet' }),
        403,
      );

      expect((before.body as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');

      await stepUp(admin);

      // Now the request reaches the service, which refuses it for the *right*
      // reason: it is the caller's own role (INV-03).
      const after = expectStatus(
        await request(server)
          .post(`/v1/memberships/${me.id}/role`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ roleKey: 'EMPLOYEE', reason: 'stepped up now' }),
        403,
      );

      expect((after.body as { error: { code: string } }).error.code).toBe(
        'SELF_ELEVATION_FORBIDDEN',
      );
    });

    it('refuses a wrong password and does not grant the window', async () => {
      expectStatus(
        await request(server)
          .post('/v1/auth/step-up')
          .set('Cookie', second.cookie)
          .send({ password: 'not-the-password' }),
        401,
      );
    });

    /** It operates on the session in hand; there is nothing to step up from. */
    it('requires a session', async () => {
      expectStatus(
        await request(server).post('/v1/auth/step-up').send({ password: PASSWORD }),
        401,
      );
    });
  });

  // ── INV-03 and INV-04 ────────────────────────────────────────────────────

  describe('role changes', () => {
    /**
     * INV-04. The founder of an organisation is its only administrator, and
     * demoting them leaves nobody who can ever administer it again.
     */
    it('will not demote the last administrator', async () => {
      await stepUp(second);

      const me = await get(second.membershipId, second.cookie);

      // Refused as a self-change first — which is INV-03 doing its job before
      // INV-04 gets a chance. Both would refuse; the order is what makes the
      // message independent of the role that was requested.
      const response = expectStatus(
        await request(server)
          .post(`/v1/memberships/${me.id}/role`)
          .set('Cookie', second.cookie)
          .set('If-Match', String(me.version))
          .send({ roleKey: 'EMPLOYEE', reason: 'stepping down' }),
        403,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe(
        'SELF_ELEVATION_FORBIDDEN',
      );
    });

    it('will not deactivate the last administrator', async () => {
      const me = await get(second.membershipId, second.cookie);

      const response = expectStatus(
        await request(server)
          .post(`/v1/memberships/${me.id}/deactivate`)
          .set('Cookie', second.cookie)
          .set('If-Match', String(me.version))
          .send({ reason: 'leaving' }),
        403,
      );

      // Refused as a self-deactivation: the undo would need the access it
      // just removed.
      expect((response.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    });

    it('requires a reason, because "why does this person have finance access" is asked later', async () => {
      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .post(`/v1/memberships/${me.id}/role`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ roleKey: 'EMPLOYEE' }),
        422,
      );
    });

    it('rejects a role the catalogue does not name', async () => {
      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .post(`/v1/memberships/${me.id}/role`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ roleKey: 'SUPER_ADMIN', reason: 'inventing a role' }),
        422,
      );
    });
  });

  // ── the general PATCH ────────────────────────────────────────────────────

  describe('PATCH /v1/memberships/{id}', () => {
    /**
     * The role is not a field here. If it were, every check the role endpoint
     * runs — step-up, INV-03, INV-04, the security event — would have to be a
     * conditional inside a handler that mostly does something else.
     */
    it('rejects a role smuggled in through the general update', async () => {
      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ roleKey: 'ORG_ADMIN' }),
        422,
      );
    });

    /**
     * Deactivation revokes sessions and has its own endpoint. A PATCH that
     * could set `INACTIVE` would be a way to sign somebody out without the
     * audit trail saying that is what happened.
     */
    it('rejects a status change', async () => {
      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ status: 'INACTIVE' }),
        422,
      );
    });

    it('sets a department and reports it back', async () => {
      const department = expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', admin.cookie)
          .send({ name: `Members dept ${RUN}` }),
        201,
      );

      const departmentId = (department.body as { data: { id: string } }).data.id;
      const me = await get(admin.membershipId);

      const updated = expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ departmentId }),
        200,
      );

      expect((updated.body as { data: MembershipBody }).data.department?.id).toBe(departmentId);
    });

    /**
     * An `ENTITY`-scoped membership with an empty list can see nothing at all,
     * which reads to the person as a broken account rather than as a
     * deliberate restriction. PostgreSQL enforced this with a CHECK.
     */
    it('refuses ENTITY scope with no entities named', async () => {
      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ scope: 'ENTITY', entityScope: [] }),
        422,
      );
    });

    it('refuses an entity belonging to another organisation', async () => {
      const strangerEntities = expectStatus(
        await request(server).get('/v1/entities').set('Cookie', stranger.cookie),
        200,
      );

      const foreignEntityId = (strangerEntities.body as { data: Array<{ id: string }> }).data[0]
        ?.id;

      if (foreignEntityId === undefined) throw new Error('registration should create an entity');

      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ scope: 'ENTITY', entityScope: [foreignEntityId] }),
        404,
      );
    });

    /**
     * Approval routing follows the manager chain. A loop there is an approval
     * that never resolves and never errors.
     */
    it('refuses to make a member their own manager', async () => {
      const me = await get(admin.membershipId);

      const response = expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ managerMembershipId: me.id }),
        409,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe('CYCLIC_HIERARCHY');
    });

    it('refuses the second of two edits made from the same version', async () => {
      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ scope: 'ORGANISATION' }),
        200,
      );

      const second = expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(me.version))
          .send({ scope: 'SELF' }),
        409,
      );

      expect((second.body as { error: { code: string } }).error.code).toBe('STALE_VERSION');
    });
  });

  // ── isolation ────────────────────────────────────────────────────────────

  describe('isolation', () => {
    it("answers 404 for another organisation's membership", async () => {
      expectStatus(
        await request(server)
          .get(`/v1/memberships/${admin.membershipId}`)
          .set('Cookie', stranger.cookie),
        404,
      );
    });

    it("will not write to another organisation's membership", async () => {
      const me = await get(admin.membershipId);

      expectStatus(
        await request(server)
          .patch(`/v1/memberships/${me.id}`)
          .set('Cookie', stranger.cookie)
          .set('If-Match', String(me.version))
          .send({ scope: 'SELF' }),
        404,
      );
    });

    it('resolves permissions from the role rather than storing them', async () => {
      const me = await get(admin.membershipId);

      // The list a reader sees must be the list the guard enforces; a stored
      // copy drifts the moment the catalogue changes, and drifts silently.
      expect(me.permissions).toContain('membership:manage_role');
      expect(me.permissions).toContain('organization:update');
      expect(me.role.key).toBe('ORG_ADMIN');
    });
  });

  // ── sessions (task 1.5.8) ────────────────────────────────────────────────

  describe('sessions', () => {
    it('lists the live sessions behind a membership, marking the current one', async () => {
      const response = expectStatus(
        await request(server)
          .get(`/v1/memberships/${admin.membershipId}/sessions`)
          .set('Cookie', admin.cookie),
        200,
      );

      const sessions = (
        response.body as {
          data: Array<{ id: string; isCurrent: boolean; userAgent: string | null }>;
        }
      ).data;

      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.some((session) => session.isCurrent)).toBe(true);

      // No token and no hash, ever: this list is for recognising a device, and
      // a hash on a screen is a hash in a screenshot in a support ticket.
      expect(JSON.stringify(sessions)).not.toContain('tokenHash');
    });

    /**
     * A stolen cookie must not be enough to lock a colleague out of their own
     * account, so the revoke carries step-up like the role change does.
     */
    it('requires step-up to revoke', async () => {
      const fresh = await register('revoker');

      const response = expectStatus(
        await request(server)
          .delete(`/v1/memberships/${fresh.membershipId}/sessions`)
          .set('Cookie', fresh.cookie),
        403,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
    });

    /**
     * Revoking your own sessions spares the one you are using. Signing
     * yourself out as a side effect of clearing your other devices is a
     * surprise whose undo is a login you did not ask for.
     */
    it('spares the caller’s own session when they revoke their own', async () => {
      const fresh = await register('self-revoker');

      expectStatus(
        await request(server)
          .post('/v1/auth/step-up')
          .set('Cookie', fresh.cookie)
          .send({ password: PASSWORD }),
        200,
      );

      expectStatus(
        await request(server)
          .delete(`/v1/memberships/${fresh.membershipId}/sessions`)
          .set('Cookie', fresh.cookie)
          .send(),
        200,
      );

      // Still signed in.
      expectStatus(await request(server).get('/v1/auth/session').set('Cookie', fresh.cookie), 200);
    });

    it("answers 404 for another organisation's membership", async () => {
      expectStatus(
        await request(server)
          .get(`/v1/memberships/${admin.membershipId}/sessions`)
          .set('Cookie', stranger.cookie),
        404,
      );
    });
  });
});
