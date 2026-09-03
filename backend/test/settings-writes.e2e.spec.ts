import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * The settings writes — `PATCH /v1/organization` and `/v1/entities`
 * (docs/10 §5.4, roadmap tasks 1.5.1 and 1.5.2).
 *
 * Three properties need a real database and cannot be shown by a unit test:
 *
 * - **Optimistic concurrency actually concurs.** `guardVersion` comparing two
 *   integers is trivially unit-testable and proves nothing about whether the
 *   version reaches the `where` clause. Only a second write against the same
 *   row shows that.
 * - **The audit event commits with its change.** Both are written in one
 *   transaction; a test that reads the trail back is what shows the
 *   transaction is real rather than two sequential writes.
 * - **Tenant isolation on a write.** A cross-tenant `PATCH` must be a `404`,
 *   not a `403` and certainly not a success. On MongoDB nothing in the
 *   database enforces that (ADR-0017) — only the Prisma tenant extension and
 *   an explicit `organizationId` in every predicate.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

interface Registered {
  cookie: string;
  organizationId: string;
}

interface EntityBody {
  id: string;
  name: string;
  registrationNumber: string | null;
  countryCode: string;
  functionalCurrency: string;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null;
  version: number;
}

/**
 * Assert a status, and say what came back when it is wrong.
 *
 * Supertest's `.expect(200)` reports "expected 200, got 409" and nothing else.
 * Against a remote database that is one push-and-wait cycle per guess; the
 * body carries the error code the API actually produced.
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

describeWithDatabase('settings writes', () => {
  let app: INestApplication;
  let server: Server;

  /** Two organisations, so isolation has something to be isolated from. */
  let owner: Registered;
  let stranger: Registered;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    owner = await register('owner');
    stranger = await register('stranger');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(name: string): Promise<Registered> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Settings ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `${name}-${RUN}@settings.test`,
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

  /** The organisation as the settings screen reads it, version included. */
  async function readOrganization(who: Registered): Promise<{ name: string; version: number }> {
    const response = expectStatus(
      await request(server).get('/v1/organization').set('Cookie', who.cookie),
      200,
    );

    return (response.body as { data: { organization: { name: string; version: number } } }).data
      .organization;
  }

  async function createEntity(who: Registered, name: string): Promise<EntityBody> {
    const response = expectStatus(
      await request(server)
        .post('/v1/entities')
        .set('Cookie', who.cookie)
        .send({ name, countryCode: 'GB', functionalCurrency: 'GBP' }),
      201,
    );

    return (response.body as { data: EntityBody }).data;
  }

  // ── PATCH /v1/organization ───────────────────────────────────────────────

  describe('PATCH /v1/organization', () => {
    it('writes the change and hands back the version to send next', async () => {
      const before = await readOrganization(owner);

      const response = expectStatus(
        await request(server)
          .patch('/v1/organization')
          .set('Cookie', owner.cookie)
          .set('If-Match', String(before.version))
          .send({ legalName: 'Owner Holdings Ltd', timezone: 'Europe/London' }),
        200,
      );

      const after = (response.body as { data: { legalName: string; version: number } }).data;

      expect(after.legalName).toBe('Owner Holdings Ltd');
      expect(after.version).toBe(before.version + 1);
    });

    /**
     * The point of the whole mechanism. Two administrators load the settings
     * screen, both save; the second must be told rather than silently winning.
     */
    it('refuses the second of two saves made from the same version', async () => {
      const before = await readOrganization(owner);

      expectStatus(
        await request(server)
          .patch('/v1/organization')
          .set('Cookie', owner.cookie)
          .set('If-Match', String(before.version))
          .send({ name: `First writer ${RUN}` }),
        200,
      );

      const second = expectStatus(
        await request(server)
          .patch('/v1/organization')
          .set('Cookie', owner.cookie)
          .set('If-Match', String(before.version))
          .send({ name: `Second writer ${RUN}` }),
        409,
      );

      expect((second.body as { error: { code: string } }).error.code).toBe('STALE_VERSION');

      // And the first writer's value survived — the refusal is not cosmetic.
      expect((await readOrganization(owner)).name).toBe(`First writer ${RUN}`);
    });

    /**
     * A missing precondition is a client that has not been taught to send one.
     * Defaulting to "no precondition" would make the mechanism opt-in, and the
     * lost edit it prevents is invisible when it happens.
     */
    it('rejects a write with no If-Match at all', async () => {
      const response = expectStatus(
        await request(server)
          .patch('/v1/organization')
          .set('Cookie', owner.cookie)
          .send({ name: 'No precondition' }),
        422,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a body carrying a field the contract does not name', async () => {
      const { version } = await readOrganization(owner);

      expectStatus(
        await request(server)
          .patch('/v1/organization')
          .set('Cookie', owner.cookie)
          .set('If-Match', String(version))
          .send({ slug: 'renamed' }),
        422,
      );
    });

    /**
     * The audit event and the change are written in one transaction. Reading
     * the trail back is what distinguishes that from two writes that merely
     * usually both happen.
     */
    it('records what changed, and only what changed', async () => {
      const before = await readOrganization(owner);

      expectStatus(
        await request(server)
          .patch('/v1/organization')
          .set('Cookie', owner.cookie)
          .set('If-Match', String(before.version))
          .send({ fiscalYearStartMonth: 4 }),
        200,
      );

      const trail = expectStatus(
        await request(server).get('/v1/audit-events?limit=5').set('Cookie', owner.cookie),
        200,
      );

      const events = (
        trail.body as {
          data: Array<{
            action: string;
            after: Record<string, unknown> | null;
          }>;
        }
      ).data;

      const event = events.find((candidate) => candidate.action === 'organization.updated');

      expect(event).toBeDefined();
      expect(event?.after).toEqual({ fiscalYearStartMonth: 4 });
    });
  });

  // ── /v1/entities ─────────────────────────────────────────────────────────

  describe('/v1/entities', () => {
    it('creates an entity, normalising the codes on the way in', async () => {
      const response = expectStatus(
        await request(server)
          .post('/v1/entities')
          .set('Cookie', owner.cookie)
          .send({ name: `Lower case codes ${RUN}`, countryCode: 'gb', functionalCurrency: 'gbp' }),
        201,
      );

      const entity = (response.body as { data: EntityBody }).data;

      // Two spellings of one country must not become two values; every
      // downstream comparison is exact-match.
      expect(entity.countryCode).toBe('GB');
      expect(entity.functionalCurrency).toBe('GBP');
      expect(entity.version).toBe(1);
    });

    it('refuses a duplicate name with a code the form can act on', async () => {
      const name = `Duplicate ${RUN}`;
      await createEntity(owner, name);

      const response = expectStatus(
        await request(server)
          .post('/v1/entities')
          .set('Cookie', owner.cookie)
          .send({ name, countryCode: 'GB', functionalCurrency: 'GBP' }),
        409,
      );

      const error = (response.body as { error: { code: string; details: { field: string } } })
        .error;

      expect(error.code).toBe('DUPLICATE_NAME');
      // The field is named, so the message can sit under the input rather
      // than in a banner the person has to map back to a box themselves.
      expect(error.details.field).toBe('name');
    });

    /**
     * Two organisations may each have an entity called "Holdings". The
     * uniqueness rule is per-organisation, and a global one would leak the
     * existence of another customer's records through a name collision.
     */
    it('scopes name uniqueness to the organisation', async () => {
      const name = `Shared name ${RUN}`;

      await createEntity(owner, name);
      await createEntity(stranger, name);
    });

    it('archives, refuses a second archive, and restores', async () => {
      const entity = await createEntity(owner, `Archivable ${RUN}`);

      const archived = expectStatus(
        await request(server)
          .post(`/v1/entities/${entity.id}/archive`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(entity.version)),
        200,
      );

      const archivedBody = (archived.body as { data: EntityBody }).data;
      expect(archivedBody.status).toBe('ARCHIVED');
      expect(archivedBody.archivedAt).not.toBeNull();

      // A double-click must not look like it worked.
      const again = expectStatus(
        await request(server)
          .post(`/v1/entities/${entity.id}/archive`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(archivedBody.version)),
        409,
      );

      expect((again.body as { error: { code: string } }).error.code).toBe(
        'INVALID_STATE_TRANSITION',
      );

      const restored = expectStatus(
        await request(server)
          .post(`/v1/entities/${entity.id}/restore`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(archivedBody.version)),
        200,
      );

      expect((restored.body as { data: EntityBody }).data.status).toBe('ACTIVE');
    });

    /**
     * Archiving exists so history reads the same way tomorrow as it did when
     * it was written. Editing an archived row retroactively rewrites every
     * export already produced from it.
     */
    it('refuses to edit an archived entity', async () => {
      const entity = await createEntity(owner, `Frozen ${RUN}`);

      const archived = expectStatus(
        await request(server)
          .post(`/v1/entities/${entity.id}/archive`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(entity.version)),
        200,
      );

      const response = expectStatus(
        await request(server)
          .patch(`/v1/entities/${entity.id}`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String((archived.body as { data: EntityBody }).data.version))
          .send({ name: `Renamed while archived ${RUN}` }),
        409,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe(
        'ARCHIVED_RECORD_IMMUTABLE',
      );
    });

    /**
     * Registration creates exactly one entity, and everything financial hangs
     * off one. An organisation with none is a dead end reachable by a single
     * button click.
     */
    it('will not archive the last active entity', async () => {
      const listed = expectStatus(
        await request(server).get('/v1/entities').set('Cookie', stranger.cookie),
        200,
      );

      const entities = (listed.body as { data: EntityBody[] }).data.filter(
        (entity) => entity.status === 'ACTIVE',
      );

      // Archive every active entity but the last, then try the last.
      for (const entity of entities.slice(0, -1)) {
        expectStatus(
          await request(server)
            .post(`/v1/entities/${entity.id}/archive`)
            .set('Cookie', stranger.cookie)
            .set('If-Match', String(entity.version)),
          200,
        );
      }

      const last = entities[entities.length - 1];
      if (last === undefined) throw new Error('registration should have created an entity');

      const response = expectStatus(
        await request(server)
          .post(`/v1/entities/${last.id}/archive`)
          .set('Cookie', stranger.cookie)
          .set('If-Match', String(last.version)),
        409,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe('LAST_ACTIVE_ENTITY');
    });

    /**
     * A cross-tenant write is a `404`, never a `403`. A `403` confirms the row
     * exists somewhere, which is exactly the fact a tenant boundary is
     * supposed to withhold (docs/10 §6).
     */
    it("answers 404 for another organisation's entity", async () => {
      const entity = await createEntity(owner, `Private to owner ${RUN}`);

      expectStatus(
        await request(server).get(`/v1/entities/${entity.id}`).set('Cookie', stranger.cookie),
        404,
      );

      expectStatus(
        await request(server)
          .patch(`/v1/entities/${entity.id}`)
          .set('Cookie', stranger.cookie)
          .set('If-Match', String(entity.version))
          .send({ name: 'Taken over' }),
        404,
      );

      // And the row is untouched.
      const mine = expectStatus(
        await request(server).get(`/v1/entities/${entity.id}`).set('Cookie', owner.cookie),
        200,
      );

      expect((mine.body as { data: EntityBody }).data.name).toBe(`Private to owner ${RUN}`);
    });

    it('lists only the calling organisation’s entities', async () => {
      const name = `Owner only ${RUN}`;
      await createEntity(owner, name);

      const response = expectStatus(
        await request(server).get('/v1/entities').set('Cookie', stranger.cookie),
        200,
      );

      const names = (response.body as { data: EntityBody[] }).data.map((entity) => entity.name);

      expect(names).not.toContain(name);
    });
  });
});
