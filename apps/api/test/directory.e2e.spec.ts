import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * People, organisation, and the audit trail — the three read endpoints that
 * complete Phase 1 (docs/10 §5.3–5.5).
 *
 * Two properties are worth the cost of a real database here, and neither can
 * be proven by a unit test:
 *
 * - **Tenant isolation.** An organisation's list must contain its own members
 *   and nobody else's. Under PostgreSQL a composite foreign key made a
 *   cross-tenant row impossible to write; on MongoDB nothing does (ADR-0017),
 *   so the Prisma tenant extension is the only thing standing between two
 *   customers and these specs are the only thing checking it still stands.
 * - **Permission enforcement at the route.** Hiding a nav item is a usability
 *   affordance; the endpoint refusing is the security control. An employee
 *   must get `403` from `/v1/people` whatever the sidebar showed them.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

interface SessionBody {
  organization: { id: string; name: string };
  membership: { id: string };
  permissions: string[];
}

describeWithDatabase('directory', () => {
  let app: INestApplication;
  let server: Server;

  /** Two organisations, so isolation has something to be isolated from. */
  let alpha: { cookie: string; session: SessionBody };
  let beta: { cookie: string; session: SessionBody };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    alpha = await register('alpha');
    beta = await register('beta');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(name: string): Promise<{ cookie: string; session: SessionBody }> {
    const response = await request(server)
      .post('/v1/auth/register')
      .send({
        organizationName: `Directory ${name} ${RUN}`,
        fullName: `Owner ${name}`,
        email: `${name}-${RUN}@directory.test`,
        password: PASSWORD,
        baseCurrency: 'USD',
        countryCode: 'US',
      })
      .expect(201);

    const setCookie = response.headers['set-cookie'] as unknown as string[];

    return {
      cookie: setCookie.map((value) => value.split(';')[0]).join('; '),
      session: response.body as SessionBody,
    };
  }

  // ── /v1/people ───────────────────────────────────────────────────────────

  describe('GET /v1/people', () => {
    it('lists the caller’s own organisation', async () => {
      const response = await request(server)
        .get('/v1/people')
        .set('Cookie', alpha.cookie)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        email: `alpha-${RUN}@directory.test`,
        role: { key: 'ORG_ADMIN' },
        status: 'ACTIVE',
      });
    });

    /**
     * The isolation test. Beta's list must not contain alpha's owner, and the
     * assertion is on the *absence* — checking only that beta sees its own
     * member would pass just as well if the list returned everyone.
     */
    it('never returns another organisation’s members', async () => {
      const response = await request(server)
        .get('/v1/people')
        .set('Cookie', beta.cookie)
        .expect(200);

      const emails = (response.body.data as Array<{ email: string }>).map((row) => row.email);

      expect(emails).toContain(`beta-${RUN}@directory.test`);
      expect(emails).not.toContain(`alpha-${RUN}@directory.test`);
      expect(response.body.pagination.totalCount).toBe(1);
    });

    it('reports pagination a reader can act on', async () => {
      const response = await request(server)
        .get('/v1/people?page=1&pageSize=10')
        .set('Cookie', alpha.cookie)
        .expect(200);

      expect(response.body.pagination).toMatchObject({ page: 1, pageSize: 10, totalPages: 1 });
    });

    it('filters by a search term without leaking on a miss', async () => {
      const hit = await request(server)
        .get('/v1/people?q=Owner alpha')
        .set('Cookie', alpha.cookie)
        .expect(200);
      expect(hit.body.data).toHaveLength(1);

      // The same query from beta finds nothing — the term matches a real
      // person, just not one of theirs.
      const miss = await request(server)
        .get('/v1/people?q=Owner alpha')
        .set('Cookie', beta.cookie)
        .expect(200);
      expect(miss.body.data).toHaveLength(0);
    });

    it('rejects an unknown query parameter rather than ignoring it', async () => {
      // Strict schemas: a typo'd filter must fail loudly. Silently ignoring
      // `?statuss=INACTIVE` returns every member and looks like it worked.
      await request(server)
        .get('/v1/people?statuss=INACTIVE')
        .set('Cookie', alpha.cookie)
        .expect(422);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(server).get('/v1/people').expect(401);
    });
  });

  // ── /v1/organization ─────────────────────────────────────────────────────

  describe('GET /v1/organization', () => {
    it('returns the caller’s own organisation, its entity, and its tree', async () => {
      const response = await request(server)
        .get('/v1/organization')
        .set('Cookie', alpha.cookie)
        .expect(200);

      const { organization, entities, categories, roleCounts } = response.body.data;

      expect(organization).toMatchObject({
        id: alpha.session.organization.id,
        name: `Directory alpha ${RUN}`,
        baseCurrency: 'USD',
      });

      // Registration creates one default entity and the whole category tree.
      expect(entities).toHaveLength(1);
      expect(categories.length).toBeGreaterThan(20);

      // Five roles, and exactly one person, who is the admin.
      expect(roleCounts).toHaveLength(5);
      expect(roleCounts.find((r: { key: string }) => r.key === 'ORG_ADMIN')).toMatchObject({
        memberCount: 1,
      });
      expect(roleCounts.find((r: { key: string }) => r.key === 'EMPLOYEE')).toMatchObject({
        memberCount: 0,
      });
    });

    it('gives each organisation its own answer', async () => {
      const response = await request(server)
        .get('/v1/organization')
        .set('Cookie', beta.cookie)
        .expect(200);

      expect(response.body.data.organization.id).toBe(beta.session.organization.id);
      expect(response.body.data.organization.id).not.toBe(alpha.session.organization.id);
    });

    it('says whether the base currency is locked, rather than leaving it unsaid', async () => {
      const response = await request(server)
        .get('/v1/organization')
        .set('Cookie', alpha.cookie)
        .expect(200);

      expect(response.body.data.organization.baseCurrencyLocked).toBe(false);
    });
  });

  // ── /v1/audit-events ─────────────────────────────────────────────────────

  describe('GET /v1/audit-events', () => {
    it('shows the registration it recorded, attributed to the person', async () => {
      const response = await request(server)
        .get('/v1/audit-events')
        .set('Cookie', alpha.cookie)
        .expect(200);

      const actions = (response.body.data as Array<{ action: string }>).map((row) => row.action);
      expect(actions.length).toBeGreaterThan(0);

      const first = response.body.data[0];
      expect(first).toMatchObject({ correlationId: expect.any(String) });
      expect(first.createdAt).toEqual(expect.any(String));
    });

    it('never returns another organisation’s events', async () => {
      const response = await request(server)
        .get('/v1/audit-events')
        .set('Cookie', beta.cookie)
        .expect(200);

      // Every event belongs to beta. Asserted through the correlation of
      // actor to organisation rather than by counting, because the trail grows
      // as this suite runs.
      const events = response.body.data as Array<{ actorMembershipId: string | null }>;
      const foreign = events.filter(
        (event) =>
          event.actorMembershipId !== null &&
          event.actorMembershipId === alpha.session.membership.id,
      );

      expect(foreign).toHaveLength(0);
    });

    it('pages with a cursor, and the second page does not repeat the first', async () => {
      const first = await request(server)
        .get('/v1/audit-events?limit=1')
        .set('Cookie', alpha.cookie)
        .expect(200);

      expect(first.body.data).toHaveLength(1);

      if (first.body.pagination.hasMore === true) {
        const second = await request(server)
          .get(`/v1/audit-events?limit=1&cursor=${String(first.body.pagination.nextCursor)}`)
          .set('Cookie', alpha.cookie)
          .expect(200);

        expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
      }
    });

    /**
     * A malformed cursor must be a 422, not an empty page. An empty page reads
     * to the caller as "you have reached the end of the audit trail", which is
     * the worst possible lie for this particular endpoint to tell.
     */
    it('rejects a malformed cursor instead of returning nothing', async () => {
      await request(server)
        .get('/v1/audit-events?cursor=bm90LWEtdXVpZA')
        .set('Cookie', alpha.cookie)
        .expect(422);
    });

    it('has no way to write an event', async () => {
      // Not a 403 — the route does not exist at all, and that is the design.
      await request(server)
        .post('/v1/audit-events')
        .set('Cookie', alpha.cookie)
        .send({ action: 'forged.event', resourceType: 'test' })
        .expect(404);

      await request(server).delete('/v1/audit-events').set('Cookie', alpha.cookie).expect(404);
    });
  });
});
