import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * Authentication, driven through real HTTP against a real PostgreSQL
 * (docs/16 §5).
 *
 * Mocking the database here would prove nothing worth knowing. The properties
 * under test — that a revoked session stops working, that a failure reveals
 * nothing about whether an account exists, that registration is atomic — are
 * all properties of the *whole* path: guard, service, transaction, and schema
 * constraints together.
 *
 * Skipped when no database is configured, always run in CI.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

/** Unique per run, so the suite can be re-run without cleaning up first. */
const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

function email(name: string): string {
  return `${name}-${RUN}@auth.test`;
}

/**
 * Assert a status, and say what came back when it is wrong.
 *
 * Supertest's `.expect(201)` reports "expected 201, got 500" and nothing
 * else. Against a remote database that is one push-and-wait cycle per guess:
 * the response body carries the error code and message the API actually
 * produced, and printing it turns a guessing game into a reading exercise.
 */
function expectStatus(response: request.Response, status: number): request.Response {
  if (response.status !== status) {
    throw new Error(
      `Expected ${String(status)} from ${response.request.method} ${response.request.url}, got ${String(response.status)}.
Body: ${JSON.stringify(response.body, null, 2)}`,
    );
  }

  return response;
}

describeWithDatabase('authentication', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    // The guard reads the session from a cookie, so the parser has to be here
    // too — `main.ts` registers it for the real server, and a test app that
    // skipped it would exercise a pipeline that does not exist in production.
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Register and return the session cookie. */
  async function register(name: string): Promise<{ cookie: string; body: SessionBody }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Org ${name} ${RUN}`,
          fullName: 'Ada Lovelace',
          email: email(name),
          password: PASSWORD,
        }),
      201,
    );

    return { cookie: cookieFrom(response), body: response.body as SessionBody };
  }

  describe('POST /v1/auth/register', () => {
    it('creates the organisation, the admin, and a working session', async () => {
      const { cookie, body } = await register('founder');

      expect(body.organization.name).toBe(`Org founder ${RUN}`);
      expect(body.membership.roleKey).toBe('ORG_ADMIN');
      expect(body.membership.scope).toBe('ORGANISATION');
      expect(cookie).toContain('financy_session=');

      // The permission set comes from what was actually seeded and granted,
      // not from the constant in `@financy/contracts`.
      expect(body.permissions).toContain('membership:manage_role');
      expect(body.permissions.length).toBeGreaterThan(30);
    });

    it('issues an httpOnly, SameSite=Lax cookie', async () => {
      const { cookie } = await register('cookie-shape');

      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
    });

    it('returns nothing that could carry a credential', async () => {
      const { body } = await register('no-secrets');
      const serialised = JSON.stringify(body);

      for (const forbidden of ['passwordHash', 'password', 'tokenHash', 'mfaSecret']) {
        expect(serialised).not.toContain(forbidden);
      }
    });

    it('refuses a second registration with the same email', async () => {
      await register('duplicate');

      const response = await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: 'Another Org',
          fullName: 'Someone Else',
          email: email('duplicate'),
          password: PASSWORD,
        })
        .expect(409);

      expect(response.body.error.code).toBe('MEMBERSHIP_EXISTS');
    });

    it('rejects a weak password with a field-keyed 422', async () => {
      const response = await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: 'Weak Org',
          fullName: 'Ada',
          email: email('weak'),
          password: 'short',
        })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.fields).toHaveProperty('password');
    });

    /**
     * `organizationId` is resolved from the session, never accepted. The field
     * does not exist on the schema, so a request carrying one is rejected
     * rather than having it silently ignored (docs/10 §1).
     */
    it('rejects a smuggled organizationId instead of ignoring it', async () => {
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: 'Smuggler',
          fullName: 'Ada',
          email: email('smuggle'),
          password: PASSWORD,
          organizationId: '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f',
        })
        .expect(422);
    });
  });

  describe('POST /v1/auth/login', () => {
    it('accepts the right password and returns the session', async () => {
      await register('login-ok');

      const response = await request(server)
        .post('/v1/auth/login')
        .send({ email: email('login-ok'), password: PASSWORD })
        .expect(200);

      expect(response.body.user.email).toBe(email('login-ok'));
      expect(cookieFrom(response)).toContain('financy_session=');
    });

    it('normalises the email, because addresses are case-insensitive', async () => {
      await register('casing');

      await request(server)
        .post('/v1/auth/login')
        .send({ email: email('casing').toUpperCase(), password: PASSWORD })
        .expect(200);
    });

    /**
     * The property that matters most on this endpoint. A different status, a
     * different message, or a different shape between "no such account" and
     * "wrong password" turns login into a list of who banks here.
     */
    it('answers identically for a wrong password and an unknown account', async () => {
      await register('enumeration');

      const wrongPassword = await request(server)
        .post('/v1/auth/login')
        .send({ email: email('enumeration'), password: 'definitely-not-the-password' })
        .expect(401);

      const unknownAccount = await request(server)
        .post('/v1/auth/login')
        .send({ email: email('no-such-user-at-all'), password: 'definitely-not-the-password' })
        .expect(401);

      expect(wrongPassword.body.error.code).toBe(unknownAccount.body.error.code);
      expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
      // Even the set of fields must match: an extra `details` on one and not
      // the other is itself a signal.
      const fieldsOf = (body: unknown) =>
        Object.keys((body as { error: Record<string, unknown> }).error).sort();

      expect(fieldsOf(wrongPassword.body)).toEqual(fieldsOf(unknownAccount.body));
    });

    it('sets no cookie on a failed attempt', async () => {
      const response = await request(server)
        .post('/v1/auth/login')
        .send({ email: email('no-cookie'), password: 'wrong' })
        .expect(401);

      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('GET /v1/auth/session', () => {
    it('returns the caller’s session', async () => {
      const { cookie } = await register('session-read');

      const response = await request(server)
        .get('/v1/auth/session')
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body.user.email).toBe(email('session-read'));
      expect(response.body.organizations).toHaveLength(1);
    });

    it('is 401 with no cookie', async () => {
      const response = await request(server).get('/v1/auth/session').expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('is 401 with a token that matches nothing', async () => {
      await request(server)
        .get('/v1/auth/session')
        .set('Cookie', 'financy_session=not-a-real-token')
        .expect(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    /**
     * Revoked server-side, not merely cleared from the browser. Clearing the
     * cookie alone would leave a token that still works for anyone who
     * captured it — which is the entire reason sessions are opaque and
     * server-held rather than JWTs.
     */
    it('revokes the session so the same cookie stops working', async () => {
      const { cookie } = await register('logout');

      await request(server).get('/v1/auth/session').set('Cookie', cookie).expect(200);
      await request(server).post('/v1/auth/logout').set('Cookie', cookie).expect(204);
      await request(server).get('/v1/auth/session').set('Cookie', cookie).expect(401);
    });

    it('clears the cookie as well', async () => {
      const { cookie } = await register('logout-cookie');

      const response = await request(server)
        .post('/v1/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      expect(String(response.headers['set-cookie'])).toMatch(/financy_session=;/);
    });

    it('needs a session of its own — it is not public', async () => {
      await request(server).post('/v1/auth/logout').expect(401);
    });

    it('leaves other sessions for the same user alone', async () => {
      const { cookie: first } = await register('two-devices');

      const second = cookieFrom(
        await request(server)
          .post('/v1/auth/login')
          .send({ email: email('two-devices'), password: PASSWORD })
          .expect(200),
      );

      await request(server).post('/v1/auth/logout').set('Cookie', first).expect(204);

      // Signing out of one device must not sign you out of the other.
      await request(server).get('/v1/auth/session').set('Cookie', second).expect(200);
    });
  });

  describe('tenant isolation', () => {
    /**
     * Two organisations registered separately must not see each other. This is
     * the shape every Phase 2 endpoint will be tested against; asserting it on
     * the session endpoint now means the foundation is known-good before
     * anything is built on it.
     */
    it('gives each registration its own organisation and role rows', async () => {
      const alpha = await register('tenant-a');
      const beta = await register('tenant-b');

      expect(alpha.body.organization.id).not.toBe(beta.body.organization.id);
      expect(alpha.body.membership.id).not.toBe(beta.body.membership.id);

      const alphaSession = await request(server)
        .get('/v1/auth/session')
        .set('Cookie', alpha.cookie)
        .expect(200);

      expect(alphaSession.body.organizations).toHaveLength(1);
      expect(alphaSession.body.organizations[0].id).toBe(alpha.body.organization.id);
    });
  });
});

interface SessionBody {
  user: { id: string; email: string; fullName: string };
  organization: { id: string; slug: string; name: string; baseCurrency: string };
  membership: { id: string; roleKey: string; scope: string };
  permissions: string[];
  organizations: Array<{ id: string }>;
}

function cookieFrom(response: request.Response): string {
  const header: unknown = response.headers['set-cookie'];
  const cookies: unknown[] = Array.isArray(header) ? header : [header];
  const session = cookies.find(
    (value): value is string => typeof value === 'string' && value.startsWith('financy_session='),
  );

  if (session === undefined) {
    throw new Error('No session cookie on the response.');
  }

  return session;
}
