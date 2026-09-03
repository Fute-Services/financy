import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * Projects and categories — the two dimensions spend is coded to
 * (docs/10 §5.4, task 1.5.4).
 *
 * The properties worth a real database:
 *
 * - **Cross-tenant references are refused.** A project may name an entity and
 *   a department. PostgreSQL made a cross-tenant reference impossible with a
 *   composite foreign key; on MongoDB nothing does (ADR-0017), so a
 *   `departmentId` pointing at another customer's department is a write the
 *   database would accept and only this service refuses.
 * - **A category key is create-only.** Policies name it. If a `PATCH` could
 *   change it, every policy referring to it would silently start deciding
 *   something else.
 * - **The category tree stays two levels deep**, which is a rule no schema
 *   expresses.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

interface ProjectBody {
  id: string;
  name: string;
  code: string | null;
  entityId: string | null;
  departmentId: string | null;
  status: 'ACTIVE' | 'CLOSED';
  startsOn: string | null;
  endsOn: string | null;
  archivedAt: string | null;
  version: number;
}

interface CategoryBody {
  id: string;
  parentId: string | null;
  key: string;
  name: string;
  isSystem: boolean;
  depth: number;
  archivedAt: string | null;
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

describeWithDatabase('projects and categories', () => {
  let app: INestApplication;
  let server: Server;

  let cookie: string;
  let strangerCookie: string;
  let departmentId: string;
  let strangerDepartmentId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    cookie = await register('owner');
    strangerCookie = await register('stranger');

    departmentId = (await createDepartment(`Engineering ${RUN}`, cookie)).id;
    strangerDepartmentId = (await createDepartment(`Stranger dept ${RUN}`, strangerCookie)).id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(name: string): Promise<string> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Projects ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `${name}-${RUN}@projects.test`,
          password: PASSWORD,
          baseCurrency: 'USD',
          countryCode: 'US',
        }),
      201,
    );

    const setCookie = response.headers['set-cookie'] as unknown as string[];

    return setCookie.map((value) => value.split(';')[0]).join('; ');
  }

  async function createDepartment(name: string, as: string): Promise<{ id: string }> {
    const response = expectStatus(
      await request(server).post('/v1/departments').set('Cookie', as).send({ name }),
      201,
    );

    return (response.body as { data: { id: string } }).data;
  }

  async function createProject(
    body: Record<string, unknown>,
    as: string = cookie,
  ): Promise<ProjectBody> {
    const response = expectStatus(
      await request(server).post('/v1/projects').set('Cookie', as).send(body),
      201,
    );

    return (response.body as { data: ProjectBody }).data;
  }

  async function getProject(id: string, as: string = cookie): Promise<ProjectBody> {
    const response = expectStatus(
      await request(server).get(`/v1/projects/${id}`).set('Cookie', as),
      200,
    );

    return (response.body as { data: ProjectBody }).data;
  }

  async function listCategories(as: string = cookie): Promise<CategoryBody[]> {
    const response = expectStatus(
      await request(server).get('/v1/categories').set('Cookie', as),
      200,
    );

    return (response.body as { data: CategoryBody[] }).data;
  }

  // ── projects ─────────────────────────────────────────────────────────────

  describe('projects', () => {
    it('creates one with a department and a date window', async () => {
      const project = await createProject({
        name: `Apollo ${RUN}`,
        code: `apollo-${RUN}`,
        departmentId,
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      });

      expect(project.status).toBe('ACTIVE');
      expect(project.code).toBe(`APOLLO-${RUN}`.toUpperCase());
      // Dates round-trip as calendar days, not as instants shifted by a
      // timezone somewhere between here and the database.
      expect(project.startsOn).toBe('2026-01-01');
      expect(project.endsOn).toBe('2026-12-31');
    });

    it('refuses a window that ends before it starts', async () => {
      expectStatus(
        await request(server)
          .post('/v1/projects')
          .set('Cookie', cookie)
          .send({ name: `Backwards ${RUN}`, startsOn: '2026-06-01', endsOn: '2026-05-01' }),
        422,
      );
    });

    /**
     * The schema sees only the fields it was sent, so a PATCH moving just
     * `endsOn` passes it. The service has both halves and is what catches it.
     */
    it('refuses a partial edit that inverts the window', async () => {
      const project = await createProject({
        name: `Window ${RUN}`,
        startsOn: '2026-06-01',
        endsOn: '2026-07-01',
      });

      expectStatus(
        await request(server)
          .patch(`/v1/projects/${project.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(project.version))
          .send({ endsOn: '2026-05-01' }),
        422,
      );
    });

    /**
     * The check that has no database behind it any more. A composite foreign
     * key used to make this write impossible; now only this service does.
     */
    it('refuses a department belonging to another organisation, as a 404', async () => {
      expectStatus(
        await request(server)
          .post('/v1/projects')
          .set('Cookie', cookie)
          .send({ name: `Cross-tenant ${RUN}`, departmentId: strangerDepartmentId }),
        404,
      );
    });

    it('refuses an archived department', async () => {
      const department = await createDepartment(`To be archived ${RUN}`, cookie);

      const fetched = expectStatus(
        await request(server).get(`/v1/departments/${department.id}`).set('Cookie', cookie),
        200,
      );

      expectStatus(
        await request(server)
          .post(`/v1/departments/${department.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String((fetched.body as { data: { version: number } }).data.version)),
        200,
      );

      expectStatus(
        await request(server)
          .post('/v1/projects')
          .set('Cookie', cookie)
          .send({ name: `Under archived dept ${RUN}`, departmentId: department.id }),
        409,
      );
    });

    /**
     * Closing and archiving are different events. A closed project is
     * finished and still belongs in reports; an archived one drops out of the
     * pickers. Collapsing them would make "this ended" and "this should never
     * have existed" the same line in the audit log.
     */
    it('closes, refuses a second close, and reopens', async () => {
      const project = await createProject({ name: `Closable ${RUN}` });

      const closed = expectStatus(
        await request(server)
          .post(`/v1/projects/${project.id}/close`)
          .set('Cookie', cookie)
          .set('If-Match', String(project.version)),
        200,
      );

      const closedBody = (closed.body as { data: ProjectBody }).data;
      expect(closedBody.status).toBe('CLOSED');

      expectStatus(
        await request(server)
          .post(`/v1/projects/${project.id}/close`)
          .set('Cookie', cookie)
          .set('If-Match', String(closedBody.version)),
        409,
      );

      const reopened = expectStatus(
        await request(server)
          .post(`/v1/projects/${project.id}/reopen`)
          .set('Cookie', cookie)
          .set('If-Match', String(closedBody.version)),
        200,
      );

      expect((reopened.body as { data: ProjectBody }).data.status).toBe('ACTIVE');
    });

    it('archives, and refuses to edit an archived project', async () => {
      const project = await createProject({ name: `Archivable project ${RUN}` });

      const archived = expectStatus(
        await request(server)
          .post(`/v1/projects/${project.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(project.version)),
        200,
      );

      const response = expectStatus(
        await request(server)
          .patch(`/v1/projects/${project.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String((archived.body as { data: ProjectBody }).data.version))
          .send({ name: `Renamed ${RUN}` }),
        409,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe(
        'ARCHIVED_RECORD_IMMUTABLE',
      );
    });

    it('keeps codes unique within the organisation and shared across them', async () => {
      const code = `SHARED-${RUN}`;

      await createProject({ name: `Coded mine ${RUN}`, code });
      await createProject({ name: `Coded theirs ${RUN}`, code }, strangerCookie);

      expectStatus(
        await request(server)
          .post('/v1/projects')
          .set('Cookie', cookie)
          .send({ name: `Coded twice ${RUN}`, code }),
        409,
      );
    });

    it("answers 404 for another organisation's project", async () => {
      const mine = await createProject({ name: `Private project ${RUN}` });

      expectStatus(
        await request(server).get(`/v1/projects/${mine.id}`).set('Cookie', strangerCookie),
        404,
      );

      // And it is still mine, unchanged.
      expect((await getProject(mine.id)).name).toBe(`Private project ${RUN}`);
    });
  });

  // ── categories ───────────────────────────────────────────────────────────

  describe('categories', () => {
    it('returns the seeded tree, marked as system and two levels deep', async () => {
      const categories = await listCategories();

      expect(categories.length).toBeGreaterThan(0);
      expect(categories.every((category) => category.isSystem)).toBe(true);
      expect(categories.every((category) => category.depth <= 1)).toBe(true);

      // Every child names a parent that is itself top-level.
      const byId = new Map(categories.map((category) => [category.id, category]));

      for (const category of categories) {
        if (category.parentId === null) continue;

        expect(byId.get(category.parentId)?.parentId).toBeNull();
      }
    });

    it('creates an organisation’s own category, not marked as a system one', async () => {
      const response = expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({ key: `custom_${RUN}`, name: 'Custom spend' }),
        201,
      );

      const created = (response.body as { data: CategoryBody }).data;

      // Only the seed creates system rows. A client that could set this could
      // create a row a later deploy would try to own.
      expect(created.isSystem).toBe(false);
      expect(created.depth).toBe(0);
    });

    it('refuses a third level', async () => {
      const parent = expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({ key: `level_one_${RUN}`, name: 'Level one' }),
        201,
      );

      const parentId = (parent.body as { data: CategoryBody }).data.id;

      const child = expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({ key: `level_two_${RUN}`, name: 'Level two', parentId }),
        201,
      );

      expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({
            key: `level_three_${RUN}`,
            name: 'Level three',
            parentId: (child.body as { data: CategoryBody }).data.id,
          }),
        409,
      );
    });

    /**
     * The key is what a policy names. A `PATCH` that could change it would
     * change what every policy referring to it decides, with nothing in the
     * policy's own history to show why.
     */
    it('rejects an attempt to change the key', async () => {
      const created = expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({ key: `immutable_key_${RUN}`, name: 'Immutable key' }),
        201,
      );

      const category = (created.body as { data: CategoryBody }).data;

      expectStatus(
        await request(server)
          .patch(`/v1/categories/${category.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(category.version))
          .send({ key: 'something_else' }),
        422,
      );

      // The display name, which is what people actually want to change, works.
      expectStatus(
        await request(server)
          .patch(`/v1/categories/${category.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(category.version))
          .send({ name: 'Renamed, same key' }),
        200,
      );
    });

    /**
     * A later deploy reseeds by key. A renamed system row would either be
     * resurrected under its old name or silently duplicated.
     */
    it('refuses to rename a system category but allows archiving it', async () => {
      const system = (await listCategories()).find(
        (category) => category.isSystem && category.parentId !== null,
      );

      if (system === undefined) throw new Error('the seed should have created system categories');

      const refused = expectStatus(
        await request(server)
          .patch(`/v1/categories/${system.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(system.version))
          .send({ name: 'Renamed system category' }),
        403,
      );

      expect((refused.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');

      expectStatus(
        await request(server)
          .post(`/v1/categories/${system.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(system.version)),
        200,
      );
    });

    /**
     * Built here rather than found among the seeded rows, so the test does not
     * depend on which categories an earlier test happened to archive.
     */
    it('refuses to archive a parent while live children remain', async () => {
      const parentResponse = expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({ key: `archivable_parent_${RUN}`, name: 'Archivable parent' }),
        201,
      );

      const parent = (parentResponse.body as { data: CategoryBody }).data;

      const childResponse = expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({
            key: `archivable_child_${RUN}`,
            name: 'Archivable child',
            parentId: parent.id,
          }),
        201,
      );

      const child = (childResponse.body as { data: CategoryBody }).data;

      expectStatus(
        await request(server)
          .post(`/v1/categories/${parent.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(parent.version)),
        409,
      );

      // Archive the child, and the parent becomes archivable.
      expectStatus(
        await request(server)
          .post(`/v1/categories/${child.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(child.version)),
        200,
      );

      expectStatus(
        await request(server)
          .post(`/v1/categories/${parent.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(parent.version)),
        200,
      );
    });

    it('keeps keys unique within an organisation and shared across them', async () => {
      const key = `shared_key_${RUN}`;

      expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({ key, name: 'Mine' }),
        201,
      );

      expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', strangerCookie)
          .send({ key, name: 'Theirs' }),
        201,
      );

      expectStatus(
        await request(server)
          .post('/v1/categories')
          .set('Cookie', cookie)
          .send({ key, name: 'Mine again' }),
        409,
      );
    });
  });
});
