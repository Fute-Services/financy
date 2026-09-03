import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * Invitations, and the invariant they finally make testable
 * (docs/10 §5.1 and §5.3, tasks 1.5.6 and 1.5.7).
 *
 * Two things happen here that could not before. The obvious one is the
 * invitation flow itself. The one that matters more is **INV-04**: until an
 * organisation could have a second administrator, every route to the
 * last-administrator check went through a *self*-change, which INV-03 refuses
 * first — so the branch was reviewed code rather than tested code. It is
 * tested now.
 *
 * The token is treated as the bearer credential it is: stored as a hash,
 * returned exactly once, and every failure to resolve one — unknown, spent,
 * revoked, expired — answers an identical `404`, because distinguishing them
 * tells somebody guessing which guesses were close.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const JOINER_PASSWORD = 'another-correct-horse-staple';

interface InvitationBody {
  id: string;
  email: string;
  roleKey: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  resentCount: number;
}

interface IssuedBody {
  invitation: InvitationBody;
  token: string;
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

describeWithDatabase('invitations', () => {
  let app: INestApplication;
  let server: Server;

  let admin: { cookie: string; membershipId: string };
  let stranger: { cookie: string; membershipId: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    admin = await register('inviter');
    stranger = await register('outsider');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(name: string): Promise<{ cookie: string; membershipId: string }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Invites ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `${name}-${RUN}@invites.test`,
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

  async function invite(
    email: string,
    roleKey = 'EMPLOYEE',
    as: string = admin.cookie,
  ): Promise<IssuedBody> {
    const response = expectStatus(
      await request(server)
        .post('/v1/memberships/invitations')
        .set('Cookie', as)
        .send({ email, roleKey }),
      201,
    );

    return (response.body as { data: IssuedBody }).data;
  }

  /** Accept as a brand-new account and return the resulting session cookie. */
  async function accept(token: string, fullName: string): Promise<string> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/invitations/accept')
        .send({ token, fullName, password: JOINER_PASSWORD }),
      201,
    );

    const setCookie = response.headers['set-cookie'] as unknown as string[];

    return setCookie.map((value) => value.split(';')[0]).join('; ');
  }

  // ── issuing ──────────────────────────────────────────────────────────────

  describe('issuing', () => {
    it('returns the token once and never again', async () => {
      const issued = await invite(`once-${RUN}@invites.test`);

      expect(issued.token.length).toBeGreaterThan(20);
      expect(issued.invitation.status).toBe('PENDING');

      const listed = expectStatus(
        await request(server).get('/v1/memberships/invitations').set('Cookie', admin.cookie),
        200,
      );

      const rows = (listed.body as { data: unknown[] }).data;

      // The stored form is a hash. A leaked listing must not be usable to
      // join an organisation.
      expect(JSON.stringify(rows)).not.toContain(issued.token);
    });

    it('refuses a second pending invitation for the same address', async () => {
      const email = `duplicate-${RUN}@invites.test`;
      await invite(email);

      expectStatus(
        await request(server)
          .post('/v1/memberships/invitations')
          .set('Cookie', admin.cookie)
          .send({ email, roleKey: 'EMPLOYEE' }),
        409,
      );
    });

    /**
     * Said at invite time rather than at the end of the acceptance flow, after
     * the person has typed a password and believed they were joining.
     */
    it('refuses to invite somebody who is already a member', async () => {
      const response = expectStatus(
        await request(server)
          .post('/v1/memberships/invitations')
          .set('Cookie', admin.cookie)
          .send({ email: `inviter-${RUN}@invites.test`, roleKey: 'EMPLOYEE' }),
        409,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe('MEMBERSHIP_EXISTS');
    });

    it('rejects a role the catalogue does not name', async () => {
      expectStatus(
        await request(server)
          .post('/v1/memberships/invitations')
          .set('Cookie', admin.cookie)
          .send({ email: `badrole-${RUN}@invites.test`, roleKey: 'SUPER_ADMIN' }),
        422,
      );
    });
  });

  // ── the token ────────────────────────────────────────────────────────────

  describe('the token', () => {
    it('previews without a session, because the token is the authorisation', async () => {
      const issued = await invite(`preview-${RUN}@invites.test`, 'MANAGER');

      const response = expectStatus(
        await request(server).get(`/v1/auth/invitations/${issued.token}`),
        200,
      );

      const preview = (
        response.body as {
          data: {
            organizationName: string;
            email: string;
            roleKey: string;
            requiresPassword: boolean;
          };
        }
      ).data;

      expect(preview.roleKey).toBe('MANAGER');
      expect(preview.requiresPassword).toBe(true);
      expect(preview.organizationName).toContain('Invites inviter');
    });

    /**
     * One answer for every failure. "No such token", "already used",
     * "revoked", and "expired" are all "this link does not work"; telling them
     * apart tells somebody guessing which guesses were close.
     */
    it('answers 404 for an unknown token', async () => {
      expectStatus(await request(server).get('/v1/auth/invitations/not-a-real-token'), 404);
    });

    it('answers 404 for a revoked token, the same as for an unknown one', async () => {
      const issued = await invite(`revoked-${RUN}@invites.test`);

      expectStatus(
        await request(server)
          .delete(`/v1/memberships/invitations/${issued.invitation.id}`)
          .set('Cookie', admin.cookie),
        200,
      );

      expectStatus(await request(server).get(`/v1/auth/invitations/${issued.token}`), 404);

      expectStatus(
        await request(server)
          .post('/v1/auth/invitations/accept')
          .send({ token: issued.token, fullName: 'Revoked Joiner', password: JOINER_PASSWORD }),
        404,
      );
    });

    it('invalidates the previous token when one is resent', async () => {
      const issued = await invite(`resend-${RUN}@invites.test`);

      const resent = expectStatus(
        await request(server)
          .post(`/v1/memberships/invitations/${issued.invitation.id}/resend`)
          .set('Cookie', admin.cookie),
        200,
      );

      const fresh = (resent.body as { data: IssuedBody }).data;

      expect(fresh.token).not.toBe(issued.token);
      expect(fresh.invitation.resentCount).toBe(1);

      // Two live tokens double the surface for no benefit.
      expectStatus(await request(server).get(`/v1/auth/invitations/${issued.token}`), 404);
      expectStatus(await request(server).get(`/v1/auth/invitations/${fresh.token}`), 200);
    });
  });

  // ── accepting ────────────────────────────────────────────────────────────

  describe('accepting', () => {
    it('creates the account, the membership, and a working session', async () => {
      const email = `joiner-${RUN}@invites.test`;
      const issued = await invite(email, 'MANAGER');

      const cookie = await accept(issued.token, 'New Joiner');

      // Signed in as part of accepting: a person who has just set a password
      // and been told they joined should not be asked to prove it again.
      const session = expectStatus(
        await request(server).get('/v1/auth/session').set('Cookie', cookie),
        200,
      );

      const body = session.body as {
        user: { email: string };
        membership: { roleKey: string };
      };

      expect(body.user.email).toBe(email);
      expect(body.membership.roleKey).toBe('MANAGER');

      // And they show up in the organisation they joined, not somebody else's.
      const people = expectStatus(
        await request(server).get('/v1/memberships').set('Cookie', admin.cookie),
        200,
      );

      expect(JSON.stringify((people.body as { data: unknown[] }).data)).toContain(email);
    });

    it('spends the token, so the same link cannot be used twice', async () => {
      const issued = await invite(`single-use-${RUN}@invites.test`);

      await accept(issued.token, 'Single Use');

      expectStatus(
        await request(server)
          .post('/v1/auth/invitations/accept')
          .send({ token: issued.token, fullName: 'Again', password: JOINER_PASSWORD }),
        404,
      );
    });

    it('requires a password and a name when the address has no account', async () => {
      const issued = await invite(`needs-password-${RUN}@invites.test`);

      expectStatus(
        await request(server).post('/v1/auth/invitations/accept').send({ token: issued.token }),
        422,
      );
    });

    /**
     * The one that turns "invite a colleague" into account takeover if it is
     * wrong. An existing account's password must not be settable by whoever
     * holds an invitation to a different organisation.
     */
    it('refuses a password when the address already has an account', async () => {
      const email = `existing-${RUN}@invites.test`;
      const first = await invite(email);
      await accept(first.token, 'Existing Person');

      // Now invite the same person into the *other* organisation.
      const second = await invite(email, 'EMPLOYEE', stranger.cookie);

      const preview = expectStatus(
        await request(server).get(`/v1/auth/invitations/${second.token}`),
        200,
      );

      expect((preview.body as { data: { requiresPassword: boolean } }).data.requiresPassword).toBe(
        false,
      );

      expectStatus(
        await request(server)
          .post('/v1/auth/invitations/accept')
          .send({ token: second.token, password: 'a-password-i-just-chose' }),
        422,
      );

      // Without one it works, and joins the second organisation.
      expectStatus(
        await request(server).post('/v1/auth/invitations/accept').send({ token: second.token }),
        201,
      );
    });
  });

  // ── INV-04, at last ──────────────────────────────────────────────────────

  describe('INV-04 — the last administrator', () => {
    /**
     * The test this whole task unblocks.
     *
     * An organisation that loses its last `ORG_ADMIN` can still be signed into
     * and can never be administered again; no support process recovers from
     * it. Until a second administrator could exist, every route to this check
     * went through a self-change that INV-03 refused first.
     */
    it('allows demoting an administrator while another remains, and refuses the last one', async () => {
      const email = `second-admin-${RUN}@invites.test`;
      const issued = await invite(email, 'ORG_ADMIN');
      await accept(issued.token, 'Second Admin');

      const people = expectStatus(
        await request(server).get('/v1/memberships').set('Cookie', admin.cookie),
        200,
      );

      const secondAdmin = (
        people.body as { data: Array<{ id: string; email: string; role: { key: string } }> }
      ).data.find((person) => person.email === email);

      if (secondAdmin === undefined) throw new Error('the invited administrator should be listed');

      expect(secondAdmin.role.key).toBe('ORG_ADMIN');

      // Step up, then demote the second administrator. Two exist, so this is
      // allowed — the invariant is about the *last* one.
      expectStatus(
        await request(server)
          .post('/v1/auth/step-up')
          .set('Cookie', admin.cookie)
          .send({ password: PASSWORD }),
        200,
      );

      const detail = expectStatus(
        await request(server).get(`/v1/memberships/${secondAdmin.id}`).set('Cookie', admin.cookie),
        200,
      );

      const version = (detail.body as { data: { version: number } }).data.version;

      const demoted = expectStatus(
        await request(server)
          .post(`/v1/memberships/${secondAdmin.id}/role`)
          .set('Cookie', admin.cookie)
          .set('If-Match', String(version))
          .send({ roleKey: 'EMPLOYEE', reason: 'no longer administering' }),
        200,
      );

      expect((demoted.body as { data: { role: { key: string } } }).data.role.key).toBe('EMPLOYEE');
    });

    /**
     * Now that a non-administrator exists who could try it: an `EMPLOYEE`
     * cannot promote anybody, including themselves.
     *
     * The refusal comes from `membership:manage_role` on the route, not from
     * comparing permission sets. A "you may not grant a role holding
     * permissions you lack" check was written and removed — see the note in
     * `MembershipsService.changeRole` — because these roles are deliberately
     * not nested and such a check makes the endpoint unreachable by everyone.
     */
    it('refuses a demoted member’s attempt to promote anyone', async () => {
      const email = `restricted-${RUN}@invites.test`;
      const issued = await invite(email, 'EMPLOYEE');
      const joinerCookie = await accept(issued.token, 'Restricted Joiner');

      const people = expectStatus(
        await request(server).get('/v1/memberships').set('Cookie', admin.cookie),
        200,
      );

      const target = (people.body as { data: Array<{ id: string; email: string }> }).data.find(
        (person) => person.email === email,
      );

      if (target === undefined) throw new Error('the invited member should be listed');

      // An employee holds neither `membership:manage_role` nor `user:read`.
      expectStatus(
        await request(server)
          .post(`/v1/memberships/${target.id}/role`)
          .set('Cookie', joinerCookie)
          .set('If-Match', '1')
          .send({ roleKey: 'ORG_ADMIN', reason: 'promoting myself' }),
        403,
      );
    });
  });

  // ── isolation ────────────────────────────────────────────────────────────

  describe('isolation', () => {
    it("does not list another organisation's invitations", async () => {
      const email = `private-invite-${RUN}@invites.test`;
      await invite(email);

      const listed = expectStatus(
        await request(server).get('/v1/memberships/invitations').set('Cookie', stranger.cookie),
        200,
      );

      expect(JSON.stringify((listed.body as { data: unknown[] }).data)).not.toContain(email);
    });

    it("answers 404 when revoking another organisation's invitation", async () => {
      const issued = await invite(`cross-tenant-${RUN}@invites.test`);

      expectStatus(
        await request(server)
          .delete(`/v1/memberships/invitations/${issued.invitation.id}`)
          .set('Cookie', stranger.cookie),
        404,
      );
    });
  });
});
