import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PolicyRepositoryService } from '../src/modules/policies/index.js';
import { DatabaseService } from '../src/platform/database/index.js';

/**
 * Spend requests and approvals, end to end (Epics 2.1–2.3).
 *
 * The properties worth a real database here are the ones that only exist when
 * policy, the approval chain, and the request are all in play at once:
 *
 * - **A draft cannot become approved except through submission.** Submission
 *   is what evaluates policy; a route that set a status directly would be a
 *   way around every control the product has.
 * - **The decision is stored verbatim.** Read back, it still names the rules
 *   that matched and the engine version that matched them — which is what
 *   makes "why did this need approval?" answerable later.
 * - **INV-02: the requester is never an approver of their own request**, even
 *   when the policy's role resolves to them.
 * - **Eligible means able to act.** A policy naming a role that cannot approve
 *   must fail at submission, not open a chain nobody can finish.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const JOINER_PASSWORD = 'another-correct-horse-staple';

function expectStatus(response: request.Response, status: number): request.Response {
  if (response.status !== status) {
    throw new Error(
      `Expected ${String(status)} from ${response.request.method} ${response.request.url}, got ${String(response.status)}.
Body: ${JSON.stringify(response.body, null, 2)}`,
    );
  }

  return response;
}

describeWithDatabase('spend requests and approvals', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let policies: PolicyRepositoryService;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let entityId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    policies = app.get(PolicyRepositoryService);

    owner = await register('owner');

    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', owner.cookie),
      200,
    );

    const first = (entities.body as { data: Array<{ id: string }> }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  async function register(
    name: string,
  ): Promise<{ cookie: string; organizationId: string; membershipId: string }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Spend ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `${name}-${RUN}@spend.test`,
          password: PASSWORD,
          baseCurrency: 'USD',
          countryCode: 'US',
        }),
      201,
    );

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const body = response.body as { organization: { id: string }; membership: { id: string } };

    return {
      cookie: setCookie.map((value) => value.split(';')[0]).join('; '),
      organizationId: body.organization.id,
      membershipId: body.membership.id,
    };
  }

  /** Invite somebody, accept, and return their session. */
  async function addMember(roleKey: string, fullName: string): Promise<string> {
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@spend.test`;

    const issued = expectStatus(
      await request(server)
        .post('/v1/memberships/invitations')
        .set('Cookie', owner.cookie)
        .send({ email, roleKey }),
      201,
    );

    const accepted = expectStatus(
      await request(server)
        .post('/v1/auth/invitations/accept')
        .send({
          token: (issued.body as { data: { token: string } }).data.token,
          fullName,
          password: JOINER_PASSWORD,
        }),
      201,
    );

    return (accepted.headers['set-cookie'] as unknown as string[])
      .map((value) => value.split(';')[0])
      .join('; ');
  }

  /**
   * Publish a policy directly.
   *
   * There is no authoring endpoint yet (task 2.1.8), and writing one purely so
   * a test could use it would be building an API to fit a test rather than a
   * user. The seam this exercises is the evaluator and the chain, and both
   * read from the same rows an endpoint would write.
   */
  async function publishPolicy(rule: Record<string, unknown>, name: string): Promise<void> {
    const policyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    await database.unscoped.policy.create({
      data: {
        id: policyId,
        organizationId: owner.organizationId,
        name,
        spendTypes: ['SPEND_REQUEST'],
        priority: 100,
        status: 'ACTIVE',
        currentVersionId: versionId,
      },
    });

    await database.unscoped.policyVersion.create({
      data: {
        id: versionId,
        organizationId: owner.organizationId,
        policyId,
        version: 1,
        publishedAt: new Date(),
        snapshot: { rules: [rule] } as never,
      },
    });

    /**
     * The cache is invalidated by hand here, and the reason is worth stating.
     *
     * The repository caches active versions for thirty seconds, and a policy
     * published through the API invalidates it as part of the write. This test
     * writes the rows directly — there is no authoring endpoint yet — so
     * nothing tells the cache. Without this the earlier tests, which populated
     * the cache with an empty list, would keep the new policy invisible for
     * half a minute and every assertion below would fail for a reason that has
     * nothing to do with what it is testing.
     */
    policies.invalidate(owner.organizationId);
  }

  async function draft(
    amount: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/spend-requests')
        .set('Cookie', owner.cookie)
        .send({
          amount: { amount, currency: 'USD' },
          entityId,
          purpose: 'Something the team needs',
          ...extra,
        }),
      201,
    );

    return (response.body as { data: { id: string } }).data;
  }

  // ── without any policy ───────────────────────────────────────────────────

  describe('with no policy at all', () => {
    it('creates a draft, and a draft is not approved', async () => {
      const created = await draft('100.00');

      const read = expectStatus(
        await request(server).get(`/v1/spend-requests/${created.id}`).set('Cookie', owner.cookie),
        200,
      );

      const record = (read.body as { data: { status: string; policyDecision: unknown } }).data;

      expect(record.status).toBe('DRAFT');
      // No decision until submission. A draft has not been evaluated, and
      // showing a decision it never received would be an invention.
      expect(record.policyDecision).toBeNull();
    });

    it('submits straight to approved when nothing requires a human', async () => {
      const created = await draft('100.00');

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '1'),
        200,
      );

      const record = (
        submitted.body as {
          data: {
            status: string;
            policyDecision: { verdict: string; evaluation: { engineVersion: string } };
          };
        }
      ).data;

      expect(record.status).toBe('APPROVED');
      expect(record.policyDecision.verdict).toBe('ALLOWED');
      // The engine version is stored with the decision, so it stays
      // interpretable if the merge semantics ever change.
      expect(record.policyDecision.evaluation.engineVersion).toBe('1.0.0');
    });

    it('refuses to submit twice', async () => {
      const created = await draft('100.00');

      expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '1'),
        200,
      );

      // The second attempt carries the version it read, so this is the state
      // machine refusing rather than the precondition.
      const again = expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '2'),
        409,
      );

      expect((again.body as { error: { code: string } }).error.code).toBe(
        'INVALID_STATE_TRANSITION',
      );
    });

    it('refuses to edit a request that has been submitted', async () => {
      const created = await draft('100.00');

      expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '1'),
        200,
      );

      // Editing underneath an approver would mean the approval was given for
      // something other than what was approved.
      expectStatus(
        await request(server)
          .patch(`/v1/spend-requests/${created.id}`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '2')
          .send({ purpose: 'Something else entirely' }),
        409,
      );
    });
  });

  // ── with a policy ────────────────────────────────────────────────────────

  describe('with a policy that requires approval over a limit', () => {
    let financeCookie: string;

    beforeAll(async () => {
      financeCookie = await addMember('FINANCE_ADMIN', 'Grace Finance');

      await publishPolicy(
        {
          id: crypto.randomUUID(),
          name: 'Over 1,000 needs finance',
          sequence: 1,
          terminal: false,
          condition: {
            type: 'COMPARISON',
            field: 'amountInBaseCurrency',
            operator: 'GT',
            value: { kind: 'money', amount: '1000.00', currency: 'USD' },
          },
          outcomes: [
            {
              type: 'REQUIRE_APPROVER',
              approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
              stepType: 'SINGLE',
              sequence: 1,
              timeoutHours: 48,
            },
            { type: 'REQUIRE_MEMO', minLength: 10 },
          ],
        },
        `Over 1000 ${RUN}`,
      );
    }, 120_000);

    it('leaves a request under the limit untouched by the rule', async () => {
      const created = await draft('999.00');

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '1'),
        200,
      );

      expect((submitted.body as { data: { status: string } }).data.status).toBe('APPROVED');
    });

    /**
     * The memo requirement is the requester's to fix, so it is a validation
     * failure naming the field — not a policy block naming a rule, which the
     * person could do nothing about.
     */
    it('refuses a submission missing the memo the policy requires', async () => {
      const created = await draft('5000.00');

      const refused = expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '1'),
        422,
      );

      const error = refused.body as {
        error: { code: string; details: { fields: Record<string, string[]> } };
      };

      expect(error.error.code).toBe('VALIDATION_FAILED');
      expect(error.error.details.fields['memo']).toBeDefined();

      // And it is still a draft, so the person can fix it.
      const read = expectStatus(
        await request(server).get(`/v1/spend-requests/${created.id}`).set('Cookie', owner.cookie),
        200,
      );

      expect((read.body as { data: { status: string } }).data.status).toBe('DRAFT');
    });

    it('opens a chain, and the whole journey settles the request', async () => {
      const created = await draft('5000.00', { memo: 'Four monitors for the platform desks' });

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '1'),
        200,
      );

      const record = (
        submitted.body as {
          data: {
            status: string;
            approvalInstanceId: string | null;
            policyDecision: { verdict: string; requirements: { approvalSteps: unknown[] } };
          };
        }
      ).data;

      expect(record.status).toBe('PENDING_APPROVAL');
      expect(record.policyDecision.verdict).toBe('ALLOWED_WITH_APPROVAL');
      expect(record.policyDecision.requirements.approvalSteps).toHaveLength(1);
      expect(record.approvalInstanceId).not.toBeNull();

      // It appears in the approver's queue, with enough of the subject to
      // decide without opening it.
      const queue = expectStatus(
        await request(server).get('/v1/approvals/queue').set('Cookie', financeCookie),
        200,
      );

      const item = (
        queue.body as {
          data: Array<{
            instanceId: string;
            subject: { reference: string; amount: string } | null;
          }>;
        }
      ).data.find((entry) => entry.instanceId === record.approvalInstanceId);

      expect(item).toBeDefined();
      expect(item?.subject?.amount).toContain('5000');

      // INV-02: the requester cannot approve their own request, even though
      // they are an administrator.
      expectStatus(
        await request(server)
          .post(`/v1/approvals/${record.approvalInstanceId ?? ''}/act`)
          .set('Cookie', owner.cookie)
          .send({ action: 'APPROVE' }),
        403,
      );

      const acted = expectStatus(
        await request(server)
          .post(`/v1/approvals/${record.approvalInstanceId ?? ''}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'APPROVE', comment: 'Within budget.' }),
        200,
      );

      expect((acted.body as { data: { outcome: string } }).data.outcome).toBe('APPROVED');

      // The subject moved with the chain, in the same transaction.
      const settled = expectStatus(
        await request(server).get(`/v1/spend-requests/${created.id}`).set('Cookie', owner.cookie),
        200,
      );

      const after = (settled.body as { data: { status: string; decidedAt: string | null } }).data;

      expect(after.status).toBe('APPROVED');
      expect(after.decidedAt).not.toBeNull();

      // And the queue no longer offers work that is done.
      const emptied = expectStatus(
        await request(server).get('/v1/approvals/queue').set('Cookie', financeCookie),
        200,
      );

      expect(
        (emptied.body as { data: Array<{ instanceId: string }> }).data.some(
          (entry) => entry.instanceId === record.approvalInstanceId,
        ),
      ).toBe(false);
    });

    it('rejects, and the rejection settles the request too', async () => {
      const created = await draft('6000.00', { memo: 'A thing we probably do not need' });

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${created.id}/submit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', '1'),
        200,
      );

      const instanceId =
        (submitted.body as { data: { approvalInstanceId: string | null } }).data
          .approvalInstanceId ?? '';

      expectStatus(
        await request(server)
          .post(`/v1/approvals/${instanceId}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'REJECT', comment: 'Not this quarter.' }),
        200,
      );

      const settled = expectStatus(
        await request(server).get(`/v1/spend-requests/${created.id}`).set('Cookie', owner.cookie),
        200,
      );

      expect((settled.body as { data: { status: string } }).data.status).toBe('REJECTED');
    });
  });
});
