import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * The department tree — `/v1/departments` (docs/09 §7.6, task 1.5.3).
 *
 * The materialised `path` is the whole reason this suite exists. It is what
 * every scope check reads: a manager sees their subtree because their
 * department's path is a prefix of the rows they may see. Three ways it can
 * go wrong, none of which a unit test on `pathUnder` would catch:
 *
 * - **A move that does not rewrite descendants.** They keep claiming an
 *   ancestry that no longer exists, and every scope check beneath them then
 *   answers wrongly rather than failing.
 * - **A cycle.** Re-parenting a node beneath its own descendant detaches the
 *   subtree and makes the downward rewrite loop.
 * - **An undelimited path.** `/a/bc/` matching a query for `/a/b/` widens a
 *   manager's scope to a department they do not manage.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

interface DepartmentBody {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  path: string;
  depth: number;
  headMembershipId: string | null;
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

describeWithDatabase('departments', () => {
  let app: INestApplication;
  let server: Server;

  let cookie: string;
  let membershipId: string;
  let strangerCookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    const owner = await register('owner');
    cookie = owner.cookie;
    membershipId = owner.membershipId;
    strangerCookie = (await register('stranger')).cookie;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(name: string): Promise<{ cookie: string; membershipId: string }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Departments ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `${name}-${RUN}@departments.test`,
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

  async function create(
    name: string,
    extra: Record<string, unknown> = {},
    as: string = cookie,
  ): Promise<DepartmentBody> {
    const response = expectStatus(
      await request(server)
        .post('/v1/departments')
        .set('Cookie', as)
        .send({ name, ...extra }),
      201,
    );

    return (response.body as { data: DepartmentBody }).data;
  }

  async function list(as: string = cookie): Promise<DepartmentBody[]> {
    const response = expectStatus(
      await request(server).get('/v1/departments').set('Cookie', as),
      200,
    );

    return (response.body as { data: DepartmentBody[] }).data;
  }

  async function get(id: string, as: string = cookie): Promise<DepartmentBody> {
    const response = expectStatus(
      await request(server).get(`/v1/departments/${id}`).set('Cookie', as),
      200,
    );

    return (response.body as { data: DepartmentBody }).data;
  }

  // ── paths ────────────────────────────────────────────────────────────────

  describe('the materialised path', () => {
    it('delimits at both ends, so a prefix match cannot overreach', async () => {
      const root = await create(`Root ${RUN}`);

      expect(root.path).toBe(`/${root.id}/`);
      expect(root.depth).toBe(0);

      const child = await create(`Child ${RUN}`, { parentId: root.id });

      expect(child.path).toBe(`/${root.id}/${child.id}/`);
      expect(child.depth).toBe(1);
    });

    /**
     * The prefix property, stated as a test rather than assumed. Without the
     * trailing delimiter a query for one department's subtree matches any
     * sibling whose id happens to share a prefix.
     */
    it('makes a subtree exactly the rows whose path starts with the parent’s', async () => {
      const root = await create(`Prefix root ${RUN}`);
      const child = await create(`Prefix child ${RUN}`, { parentId: root.id });
      const grandchild = await create(`Prefix grandchild ${RUN}`, { parentId: child.id });
      const outsider = await create(`Prefix outsider ${RUN}`);

      const subtree = (await list()).filter((row) => row.path.startsWith(root.path));

      expect(subtree.map((row) => row.id).sort()).toEqual(
        [root.id, child.id, grandchild.id].sort(),
      );
      expect(subtree.map((row) => row.id)).not.toContain(outsider.id);
    });

    it('returns the tree in path order, so a parent always precedes its children', async () => {
      const rows = await list();
      const positions = new Map(rows.map((row, index) => [row.id, index]));

      for (const row of rows) {
        if (row.parentId === null) continue;

        const parentPosition = positions.get(row.parentId);
        expect(parentPosition).toBeDefined();
        expect(parentPosition).toBeLessThan(positions.get(row.id) ?? -1);
      }
    });
  });

  // ── moving ───────────────────────────────────────────────────────────────

  describe('moving a node', () => {
    /**
     * The property that matters most here. A move that updates only the moved
     * row leaves every descendant claiming an ancestry that no longer exists,
     * and nothing fails — the scope checks beneath them simply start
     * answering wrongly.
     */
    it('rewrites the path of every descendant, not just the moved node', async () => {
      const oldParent = await create(`Old parent ${RUN}`);
      const newParent = await create(`New parent ${RUN}`);

      const moving = await create(`Moving ${RUN}`, { parentId: oldParent.id });
      const child = await create(`Moving child ${RUN}`, { parentId: moving.id });
      const grandchild = await create(`Moving grandchild ${RUN}`, { parentId: child.id });

      expectStatus(
        await request(server)
          .patch(`/v1/departments/${moving.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(moving.version))
          .send({ parentId: newParent.id }),
        200,
      );

      expect((await get(moving.id)).path).toBe(`${newParent.path}${moving.id}/`);
      expect((await get(child.id)).path).toBe(`${newParent.path}${moving.id}/${child.id}/`);
      expect((await get(grandchild.id)).path).toBe(
        `${newParent.path}${moving.id}/${child.id}/${grandchild.id}/`,
      );

      // Depth is derived from the path, so it must have moved with it.
      expect((await get(grandchild.id)).depth).toBe(3);
    });

    it('promotes a node to a root when the parent is cleared', async () => {
      const parent = await create(`Demoting parent ${RUN}`);
      const node = await create(`Promoted ${RUN}`, { parentId: parent.id });
      const child = await create(`Promoted child ${RUN}`, { parentId: node.id });

      expectStatus(
        await request(server)
          .patch(`/v1/departments/${node.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(node.version))
          .send({ parentId: null }),
        200,
      );

      const promoted = await get(node.id);

      expect(promoted.parentId).toBeNull();
      expect(promoted.path).toBe(`/${node.id}/`);
      expect(promoted.depth).toBe(0);
      expect((await get(child.id)).path).toBe(`/${node.id}/${child.id}/`);
    });

    it('refuses to move a node beneath its own descendant', async () => {
      const root = await create(`Cycle root ${RUN}`);
      const child = await create(`Cycle child ${RUN}`, { parentId: root.id });

      const response = expectStatus(
        await request(server)
          .patch(`/v1/departments/${root.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(root.version))
          .send({ parentId: child.id }),
        409,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe('CYCLIC_HIERARCHY');
      // And nothing moved.
      expect((await get(root.id)).parentId).toBeNull();
    });

    it('refuses to make a node its own parent', async () => {
      const node = await create(`Self parent ${RUN}`);

      expectStatus(
        await request(server)
          .patch(`/v1/departments/${node.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(node.version))
          .send({ parentId: node.id }),
        409,
      );
    });
  });

  // ── names and codes ──────────────────────────────────────────────────────

  describe('names and codes', () => {
    /**
     * Two "Operations" under different parents is ordinary; two under the same
     * parent is a tree nobody can navigate, because the only thing telling the
     * rows apart on screen is an id the reader cannot see.
     */
    it('allows a repeated name under a different parent and refuses it under the same one', async () => {
      const first = await create(`Sibling home A ${RUN}`);
      const second = await create(`Sibling home B ${RUN}`);

      await create('Operations', { parentId: first.id });
      await create('Operations', { parentId: second.id });

      const response = expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', cookie)
          .send({ name: 'Operations', parentId: first.id }),
        409,
      );

      expect((response.body as { error: { code: string } }).error.code).toBe('DUPLICATE_NAME');
    });

    /**
     * A move can create the collision that the create-time check would have
     * caught — arriving by a different route, into a sibling set that already
     * holds the name.
     */
    it('refuses a move that would collide with an existing sibling name', async () => {
      const from = await create(`Move from ${RUN}`);
      const to = await create(`Move to ${RUN}`);

      const moving = await create('Shared child name', { parentId: from.id });
      await create('Shared child name', { parentId: to.id });

      expectStatus(
        await request(server)
          .patch(`/v1/departments/${moving.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(moving.version))
          .send({ parentId: to.id }),
        409,
      );
    });

    it('upper-cases a code and keeps it unique across the organisation', async () => {
      const created = await create(`Coded ${RUN}`, { code: `eng-${RUN}` });

      expect(created.code).toBe(`ENG-${RUN}`.toUpperCase());

      expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', cookie)
          .send({ name: `Coded twice ${RUN}`, code: `ENG-${RUN}` }),
        409,
      );
    });

    /**
     * Uniqueness of a code applies only when one is set. MongoDB's unique
     * index would treat every absent code as the same value and allow exactly
     * one uncoded department, which is not a rule anybody asked for.
     */
    it('allows any number of departments with no code at all', async () => {
      await create(`Uncoded one ${RUN}`);
      await create(`Uncoded two ${RUN}`);
      await create(`Uncoded three ${RUN}`);
    });
  });

  // ── heads ────────────────────────────────────────────────────────────────

  describe('the department head', () => {
    it('accepts a membership from this organisation', async () => {
      const department = await create(`Headed ${RUN}`, { headMembershipId: membershipId });
      expect(department.headMembershipId).toBe(membershipId);
    });

    /**
     * A 404, not a 403. A 403 confirms the membership exists somewhere, which
     * turns this field into a way to probe another tenant's ids.
     */
    it('answers 404 for a membership in another organisation', async () => {
      expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', strangerCookie)
          .send({ name: `Foreign head ${RUN}`, headMembershipId: membershipId }),
        404,
      );
    });
  });

  // ── archiving ────────────────────────────────────────────────────────────

  describe('archiving', () => {
    /**
     * Cascading would archive rows nobody asked about, and restoring the
     * parent afterwards cannot know which children the cascade archived and
     * which were already archived on their own.
     */
    it('refuses while live sub-departments remain, and allows it once they are gone', async () => {
      const parent = await create(`Archivable parent ${RUN}`);
      const child = await create(`Archivable child ${RUN}`, { parentId: parent.id });

      expectStatus(
        await request(server)
          .post(`/v1/departments/${parent.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(parent.version)),
        409,
      );

      expectStatus(
        await request(server)
          .post(`/v1/departments/${child.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(child.version)),
        200,
      );

      expectStatus(
        await request(server)
          .post(`/v1/departments/${parent.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(parent.version)),
        200,
      );
    });

    it('clears the head, because an archived department is headed by nobody', async () => {
      const department = await create(`Headed then archived ${RUN}`, {
        headMembershipId: membershipId,
      });

      const archived = expectStatus(
        await request(server)
          .post(`/v1/departments/${department.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(department.version)),
        200,
      );

      expect((archived.body as { data: DepartmentBody }).data.headMembershipId).toBeNull();
    });

    it('refuses to edit an archived department, and allows it after a restore', async () => {
      const department = await create(`Frozen department ${RUN}`);

      const archived = expectStatus(
        await request(server)
          .post(`/v1/departments/${department.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(department.version)),
        200,
      );

      const archivedVersion = (archived.body as { data: DepartmentBody }).data.version;

      const refused = expectStatus(
        await request(server)
          .patch(`/v1/departments/${department.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(archivedVersion))
          .send({ name: `Renamed while archived ${RUN}` }),
        409,
      );

      expect((refused.body as { error: { code: string } }).error.code).toBe(
        'ARCHIVED_RECORD_IMMUTABLE',
      );

      const restored = expectStatus(
        await request(server)
          .post(`/v1/departments/${department.id}/restore`)
          .set('Cookie', cookie)
          .set('If-Match', String(archivedVersion)),
        200,
      );

      expectStatus(
        await request(server)
          .patch(`/v1/departments/${department.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String((restored.body as { data: DepartmentBody }).data.version))
          .send({ name: `Renamed after restore ${RUN}` }),
        200,
      );
    });

    it('refuses to hang a new department under an archived parent', async () => {
      const parent = await create(`Archived parent ${RUN}`);

      expectStatus(
        await request(server)
          .post(`/v1/departments/${parent.id}/archive`)
          .set('Cookie', cookie)
          .set('If-Match', String(parent.version)),
        200,
      );

      expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', cookie)
          .send({ name: `Orphan ${RUN}`, parentId: parent.id }),
        409,
      );
    });
  });

  // ── isolation and concurrency ────────────────────────────────────────────

  describe('isolation and concurrency', () => {
    it("answers 404 for another organisation's department", async () => {
      const mine = await create(`Private department ${RUN}`);

      expectStatus(
        await request(server).get(`/v1/departments/${mine.id}`).set('Cookie', strangerCookie),
        404,
      );

      expectStatus(
        await request(server)
          .patch(`/v1/departments/${mine.id}`)
          .set('Cookie', strangerCookie)
          .set('If-Match', String(mine.version))
          .send({ name: 'Taken over' }),
        404,
      );
    });

    it("will not adopt another organisation's department as a parent", async () => {
      const mine = await create(`Cross-tenant parent ${RUN}`);

      expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', strangerCookie)
          .send({ name: `Cross-tenant child ${RUN}`, parentId: mine.id }),
        404,
      );
    });

    it('refuses the second of two edits made from the same version', async () => {
      const department = await create(`Contended ${RUN}`);

      expectStatus(
        await request(server)
          .patch(`/v1/departments/${department.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(department.version))
          .send({ name: `First writer ${RUN}` }),
        200,
      );

      const second = expectStatus(
        await request(server)
          .patch(`/v1/departments/${department.id}`)
          .set('Cookie', cookie)
          .set('If-Match', String(department.version))
          .send({ name: `Second writer ${RUN}` }),
        409,
      );

      expect((second.body as { error: { code: string } }).error.code).toBe('STALE_VERSION');
      expect((await get(department.id)).name).toBe(`First writer ${RUN}`);
    });

    it('rejects a client-supplied path, which is the server’s to derive', async () => {
      expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', cookie)
          .send({ name: `Path smuggler ${RUN}`, path: '/anything/' }),
        422,
      );
    });
  });
});
