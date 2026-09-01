import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * The rest of Epic 1.6 — export, per-record history, and the security log
 * (docs/10 §5.5, tasks 1.6.2 through 1.6.4).
 *
 * The property worth the most here is that **the export audits itself**.
 * Downloading an organisation's complete audit trail is a copy of every
 * privileged action anyone has taken, leaving the system; an export that left
 * no trace would be the one gap in the record that mattered most. It is also
 * the property most likely to be quietly lost in a refactor, because nothing
 * about the response changes when it goes.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

function expectStatus(response: request.Response, status: number): request.Response {
  if (response.status !== status) {
    throw new Error(
      `Expected ${String(status)} from ${response.request.method} ${response.request.url}, got ${String(response.status)}.
Body: ${JSON.stringify(response.body, null, 2)}`,
    );
  }

  return response;
}

describeWithDatabase('audit export, history, and the security log', () => {
  let app: INestApplication;
  let server: Server;

  let admin: { cookie: string; organizationId: string };
  let stranger: { cookie: string; organizationId: string };
  let entityId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    admin = await register('auditor-admin');
    stranger = await register('auditor-stranger');

    // Something with a history worth reading: created, renamed, archived.
    const created = expectStatus(
      await request(server)
        .post('/v1/entities')
        .set('Cookie', admin.cookie)
        .send({ name: `History subject ${RUN}`, countryCode: 'GB', functionalCurrency: 'GBP' }),
      201,
    );

    const entity = (created.body as { data: { id: string; version: number } }).data;
    entityId = entity.id;

    const renamed = expectStatus(
      await request(server)
        .patch(`/v1/entities/${entityId}`)
        .set('Cookie', admin.cookie)
        .set('If-Match', String(entity.version))
        .send({ name: `History subject renamed ${RUN}` }),
      200,
    );

    expectStatus(
      await request(server)
        .post(`/v1/entities/${entityId}/archive`)
        .set('Cookie', admin.cookie)
        .set('If-Match', String((renamed.body as { data: { version: number } }).data.version)),
      200,
    );
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(name: string): Promise<{ cookie: string; organizationId: string }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Audit ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `${name}-${RUN}@audit.test`,
          password: PASSWORD,
          baseCurrency: 'USD',
          countryCode: 'US',
        }),
      201,
    );

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const body = response.body as { organization: { id: string } };

    return {
      cookie: setCookie.map((value) => value.split(';')[0]).join('; '),
      organizationId: body.organization.id,
    };
  }

  // ── per-record history ───────────────────────────────────────────────────

  describe('per-record history', () => {
    it('returns every event for one record, oldest first', async () => {
      const response = expectStatus(
        await request(server)
          .get(`/v1/audit-events/entity/${entityId}`)
          .set('Cookie', admin.cookie),
        200,
      );

      const events = (response.body as { data: Array<{ action: string; createdAt: string }> }).data;

      expect(events.map((event) => event.action)).toEqual([
        'entity.created',
        'entity.updated',
        'entity.archived',
      ]);

      // Chronological: "how did this record get here" only reads forwards.
      const times = events.map((event) => Date.parse(event.createdAt));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('returns an empty history rather than a 404 for a record with none', async () => {
      const response = expectStatus(
        await request(server)
          .get(`/v1/audit-events/entity/${admin.organizationId}`)
          .set('Cookie', admin.cookie),
        200,
      );

      expect((response.body as { data: unknown[] }).data).toEqual([]);
    });

    it("shows nothing of another organisation's record", async () => {
      const response = expectStatus(
        await request(server)
          .get(`/v1/audit-events/entity/${entityId}`)
          .set('Cookie', stranger.cookie),
        200,
      );

      // Not a 404: the tenant predicate makes the history empty, and an empty
      // history is indistinguishable from a record that has none — which is
      // the whole point.
      expect((response.body as { data: unknown[] }).data).toEqual([]);
    });
  });

  // ── export ───────────────────────────────────────────────────────────────

  describe('export', () => {
    it('returns CSV with the contract’s columns and an attachment disposition', async () => {
      const response = expectStatus(
        await request(server)
          .get('/v1/audit-events/export?resourceType=entity')
          .set('Cookie', admin.cookie),
        200,
      );

      expect(response.headers['content-type']).toContain('text/csv');
      // Inline rendering would be a document from an untrusted source
      // displayed by a trusting viewer.
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['x-row-count']).toBeDefined();

      const body = response.text;
      const header = body.split('\r\n')[0];

      expect(header).toBe(
        'createdAt,action,resourceType,resourceId,actorType,actorLabel,actorMembershipId,ipAddress,correlationId',
      );
      expect(body).toContain('entity.created');
    });

    it('returns JSON when asked, because before/after cannot live in a cell', async () => {
      const response = expectStatus(
        await request(server)
          .get('/v1/audit-events/export?resourceType=entity&format=json')
          .set('Cookie', admin.cookie),
        200,
      );

      const events = JSON.parse(response.text) as Array<{ action: string; after: unknown }>;

      expect(Array.isArray(events)).toBe(true);
      expect(events.some((event) => event.action === 'entity.updated')).toBe(true);
    });

    /**
     * The property this suite exists for. Nothing about the response changes
     * when the self-audit is lost, so only a test that reads the trail back
     * will notice.
     */
    it('writes an audit event recording the export itself', async () => {
      expectStatus(
        await request(server)
          .get('/v1/audit-events/export?resourceType=entity&format=json')
          .set('Cookie', admin.cookie),
        200,
      );

      const trail = expectStatus(
        await request(server)
          .get('/v1/audit-events?action=audit_event.exported&limit=5')
          .set('Cookie', admin.cookie),
        200,
      );

      const events = (
        trail.body as { data: Array<{ action: string; metadata: Record<string, unknown> }> }
      ).data;

      expect(events.length).toBeGreaterThan(0);

      const latest = events[0];
      expect(latest?.action).toBe('audit_event.exported');
      // The filters and the count, not the rows: a copy of the export inside
      // the trail would double the trail on every download.
      expect(latest?.metadata['format']).toBe('json');
      expect(latest?.metadata['rowCount']).toBeGreaterThan(0);
      expect(latest?.metadata['filters']).toMatchObject({ resourceType: 'entity' });
    });

    /**
     * A cell beginning `=`, `+`, `-`, or `@` is executed as a formula by Excel
     * and Sheets on open. Audit fields carry user-chosen text, so an export is
     * a document written by one person and trusted by another.
     */
    it('neutralises a value that a spreadsheet would run as a formula', async () => {
      // An entity named as a formula. The name reaches the audit trail's
      // `after`, and the actor label and action reach CSV columns.
      expectStatus(
        await request(server)
          .post('/v1/entities')
          .set('Cookie', admin.cookie)
          .send({
            name: `=cmd|' /c calc'!A1 ${RUN}`,
            countryCode: 'GB',
            functionalCurrency: 'GBP',
          }),
        201,
      );

      const response = expectStatus(
        await request(server)
          .get('/v1/audit-events/export?resourceType=entity')
          .set('Cookie', admin.cookie),
        200,
      );

      // Every field is quoted, and nothing in the file opens a cell with a
      // bare formula character.
      for (const line of response.text.split('\r\n').slice(1)) {
        if (line === '') continue;

        for (const cell of line.split('","')) {
          const value = cell.replace(/^"|"$/g, '');
          if (value === '') continue;

          expect(/^[=+\-@]/.test(value)).toBe(false);
        }
      }
    });

    /**
     * `audit_event:export` is a separate permission from `audit_event:read`,
     * because a complete copy of the trail leaving the system is a different
     * act from reading a page of it.
     */
    it('is refused to a member who holds neither audit permission', async () => {
      const email = `no-export-${RUN}@audit.test`;

      const issued = expectStatus(
        await request(server)
          .post('/v1/memberships/invitations')
          .set('Cookie', admin.cookie)
          .send({ email, roleKey: 'EMPLOYEE' }),
        201,
      );

      const accepted = expectStatus(
        await request(server)
          .post('/v1/auth/invitations/accept')
          .send({
            token: (issued.body as { data: { token: string } }).data.token,
            fullName: 'No Export',
            password: 'another-correct-horse-staple',
          }),
        201,
      );

      const employeeCookie = (accepted.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; ');

      // An employee holds neither `audit_event:read` nor `audit_event:export`.
      expectStatus(
        await request(server).get('/v1/audit-events/export').set('Cookie', employeeCookie),
        403,
      );

      expectStatus(
        await request(server).get('/v1/audit-events').set('Cookie', employeeCookie),
        403,
      );

      // The security log too. `ORG_ADMIN` and `AUDITOR` hold all three of
      // these today; the permissions are nonetheless separate because "read a
      // page" and "take a complete copy out of the system" are different
      // acts, and a delegated role that should hold only the first is a
      // catalogue edit rather than a code change.
      expectStatus(
        await request(server).get('/v1/security-events').set('Cookie', employeeCookie),
        403,
      );
    });

    it('requires a session', async () => {
      expectStatus(await request(server).get('/v1/audit-events/export'), 401);
    });
  });

  // ── the security log ─────────────────────────────────────────────────────

  describe('the security log', () => {
    /**
     * Registration issues a session directly rather than going through
     * `login`, so it writes no `LOGIN_SUCCEEDED` — the sign-in has to be a
     * real one for there to be a row.
     */
    it('records a successful sign-in and shows it to an administrator', async () => {
      expectStatus(
        await request(server)
          .post('/v1/auth/login')
          .send({ email: `auditor-admin-${RUN}@audit.test`, password: PASSWORD }),
        200,
      );

      const response = expectStatus(
        await request(server)
          .get('/v1/security-events?type=LOGIN_SUCCEEDED&limit=10')
          .set('Cookie', admin.cookie),
        200,
      );

      const events = (response.body as { data: Array<{ type: string; actorLabel: string | null }> })
        .data;

      expect(events.some((event) => event.type === 'LOGIN_SUCCEEDED')).toBe(true);
      // The name is resolved at read time here, unlike the audit trail's
      // denormalised label: an operator looking at what is happening now
      // wants the name that is on the account today.
      expect(events[0]?.actorLabel).toContain('Owner auditor-admin');
    });

    /**
     * The regression test for a bug this suite found.
     *
     * The whole login flow ran in one transaction, with the failure
     * bookkeeping inside it and a `throw` on the next line. The throw rolled
     * the transaction back and took the record with it, so no `LOGIN_FAILED`
     * event was ever written — and, worse, `failedLoginCount` never
     * persisted, which meant the account lockout in docs/12 §3.2 did not
     * exist at all. Nothing about the response differed either way.
     */
    it('records a failed sign-in, which is the row an operator most wants', async () => {
      expectStatus(
        await request(server)
          .post('/v1/auth/login')
          .send({ email: `auditor-admin-${RUN}@audit.test`, password: 'wrong-password-entirely' }),
        401,
      );

      const response = expectStatus(
        await request(server)
          .get('/v1/security-events?type=LOGIN_FAILED&limit=10')
          .set('Cookie', admin.cookie),
        200,
      );

      const events = (response.body as { data: Array<{ type: string }> }).data;

      expect(events.some((event) => event.type === 'LOGIN_FAILED')).toBe(true);
    });

    /**
     * The other half of the same bug: the counter has to survive the
     * rejection, or the lockout can never be reached.
     */
    it('counts failed attempts across requests, so a lockout is reachable', async () => {
      const email = `lockout-${RUN}@audit.test`;

      const registered = expectStatus(
        await request(server)
          .post('/v1/auth/register')
          .send({
            organizationName: `Lockout ${RUN}`,
            fullName: 'Lockout Target',
            email,
            password: PASSWORD,
            baseCurrency: 'USD',
            countryCode: 'US',
          }),
        201,
      );

      const ownCookie = (registered.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; ');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        expectStatus(
          await request(server).post('/v1/auth/login').send({ email, password: 'wrong-again' }),
          401,
        );
      }

      const response = expectStatus(
        await request(server)
          .get('/v1/security-events?type=LOGIN_FAILED&limit=50')
          .set('Cookie', ownCookie),
        200,
      );

      const counts = (
        response.body as { data: Array<{ metadata: Record<string, unknown> }> }
      ).data.map((event) => event.metadata['failedLoginCount']);

      // Three attempts, and the counter climbed 1, 2, 3 — which is only true
      // if each one committed. Rolled back, every attempt would have written
      // nothing, and the lockout at MAX_FAILED_LOGINS would be unreachable.
      expect(counts).toHaveLength(3);
      expect([...counts].sort()).toEqual([1, 2, 3]);
    });

    /**
     * `LOGIN_SUCCEEDED` is deliberately absent from the notable list: in a
     * healthy organisation it is most of the collection, and a "concerning
     * events" view that is mostly successful logins is one nobody opens twice.
     */
    it('filters to the notable types without returning routine sign-ins', async () => {
      const response = expectStatus(
        await request(server)
          .get('/v1/security-events?notableOnly=true&limit=50')
          .set('Cookie', admin.cookie),
        200,
      );

      const events = (response.body as { data: Array<{ type: string }> }).data;

      expect(events.every((event) => event.type !== 'LOGIN_SUCCEEDED')).toBe(true);
    });

    it("shows nothing of another organisation's security log", async () => {
      const mine = expectStatus(
        await request(server).get('/v1/security-events?limit=50').set('Cookie', admin.cookie),
        200,
      );

      const theirs = expectStatus(
        await request(server).get('/v1/security-events?limit=50').set('Cookie', stranger.cookie),
        200,
      );

      const myIds = new Set(
        (mine.body as { data: Array<{ id: string }> }).data.map((event) => event.id),
      );

      for (const event of (theirs.body as { data: Array<{ id: string }> }).data) {
        expect(myIds.has(event.id)).toBe(false);
      }
    });

    it('rejects a cursor it did not issue', async () => {
      expectStatus(
        await request(server)
          .get('/v1/security-events?cursor=bm90LWEtY3Vyc29y')
          .set('Cookie', admin.cookie),
        422,
      );
    });
  });
});
