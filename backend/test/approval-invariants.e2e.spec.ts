import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PolicyRepositoryService } from '../src/modules/policies/index.js';
import { DatabaseService } from '../src/platform/database/index.js';
import { QUEUE_PORT, type QueuePort } from '../src/platform/queue/index.js';

/**
 * INV-02 and concurrency (SEC-07, FR-APR-004, FR-APR-011; docs/16 §5).
 *
 * ## Why four paths and not one
 *
 * "You cannot approve your own request" is easy to enforce once and easy to
 * lose four different ways, because a chain names *specifications* rather than
 * people and every specification resolves through a different code path:
 *
 * 1. **Directly** — a rule names the requester's own role, and they are in it.
 * 2. **Through a role** — the requester holds the role the policy named, along
 *    with other people.
 * 3. **Through the manager chain** — a manager raises a request that their own
 *    position is meant to approve.
 * 4. **Through a delegation** — an eligible approver delegates to the very
 *    person who raised it.
 *
 * The fourth is the one that gets missed, and it is the one somebody could
 * arrange deliberately: A is asked to approve, A delegates to B, B is the
 * requester. The resolver excludes the requester before *and* after
 * delegation for exactly this reason, and this suite is what keeps both
 * exclusions honest.
 *
 * ## Concurrency
 *
 * Two approvers pressing at the same instant is the ordinary case in a
 * parallel step, not an edge case. Exactly one completion, and the loser gets
 * an answer that says what happened rather than a second success.
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

describeWithDatabase('the approval invariants', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let policies: PolicyRepositoryService;
  let queue: QueuePort;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let entityId: string;

  /** Two finance admins, so a step can name a role that resolves to two people. */
  let graceCookie: string;
  let graceMembershipId: string;
  let felixCookie: string;
  let felixMembershipId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    policies = app.get(PolicyRepositoryService);
    queue = app.get<QueuePort>(QUEUE_PORT);

    owner = await register();

    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', owner.cookie),
      200,
    );

    const first = (entities.body as { data: Array<{ id: string }> }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;

    const grace = await addMember('FINANCE_ADMIN', 'Grace Finance');
    graceCookie = grace.cookie;
    graceMembershipId = grace.membershipId;

    const felix = await addMember('FINANCE_ADMIN', 'Felix Finance');
    felixCookie = felix.cookie;
    felixMembershipId = felix.membershipId;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  // ── harness ──────────────────────────────────────────────────────────────

  async function register(): Promise<{
    cookie: string;
    organizationId: string;
    membershipId: string;
  }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Invariants ${RUN}`,
          fullName: 'Olivia Owner',
          email: `inv-owner-${RUN}@inv.test`,
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

  async function addMember(
    roleKey: string,
    fullName: string,
  ): Promise<{ cookie: string; membershipId: string }> {
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@inv.test`;

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

    return {
      cookie: (accepted.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; '),
      membershipId: (accepted.body as { membership: { id: string } }).membership.id,
    };
  }

  /**
   * Publish one policy, replacing whatever was live.
   *
   * Each test in this file needs a different chain, and leaving the previous
   * one active would make every request match two policies — which is a fine
   * thing to test and not what any of these are testing.
   */
  let published = 0;

  async function publishOnly(
    name: string,
    outcomes: readonly Record<string, unknown>[],
  ): Promise<void> {
    published += 1;
    await database.unscoped.policy.updateMany({
      where: { organizationId: owner.organizationId },
      data: { status: 'ARCHIVED' },
    });

    const policyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    await database.unscoped.policy.create({
      data: {
        id: policyId,
        organizationId: owner.organizationId,
        name: `${name} ${RUN}-${String(published)}`,
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
        snapshot: {
          rules: [
            {
              id: crypto.randomUUID(),
              name,
              sequence: 1,
              terminal: false,
              condition: {
                type: 'COMPARISON',
                field: 'amountInBaseCurrency',
                operator: 'GT',
                value: { kind: 'money', amount: '100.00', currency: 'USD' },
              },
              outcomes,
            },
          ],
        } as never,
      },
    });

    policies.invalidate(owner.organizationId);
  }

  interface Submitted {
    id: string;
    status: string;
    instanceId: string | null;
  }

  async function submit(cookie: string, purpose: string, amount = '900.00'): Promise<Submitted> {
    const created = expectStatus(
      await request(server)
        .post('/v1/spend-requests')
        .set('Cookie', cookie)
        .send({ amount: { amount, currency: 'USD' }, entityId, purpose }),
      201,
    );

    const id = (created.body as { data: { id: string } }).data.id;

    const submitted = await request(server)
      .post(`/v1/spend-requests/${id}/submit`)
      .set('Cookie', cookie)
      .set('If-Match', '1');

    if (submitted.status !== 200) {
      return { id, status: `HTTP ${String(submitted.status)}`, instanceId: null };
    }

    await queue.drain();

    const body = (submitted.body as { data: { status: string; approvalInstanceId: string | null } })
      .data;

    return { id, status: body.status, instanceId: body.approvalInstanceId };
  }

  async function eligibleFor(instanceId: string): Promise<string[]> {
    const step = await database.unscoped.approvalStep.findFirst({
      where: { organizationId: owner.organizationId, approvalInstanceId: instanceId, sequence: 1 },
      select: { eligibleMembershipIds: true },
    });

    return step?.eligibleMembershipIds ?? [];
  }

  // ── INV-02, four ways ────────────────────────────────────────────────────

  describe('a person cannot approve their own request (INV-02, SEC-07)', () => {
    it('when the policy names the role they hold, and somebody else holds it too', async () => {
      await publishOnly('Finance approves', [
        {
          type: 'REQUIRE_APPROVER',
          approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
          stepType: 'SINGLE',
          sequence: 1,
          timeoutHours: 48,
        },
      ]);

      // Grace is a finance admin raising a request that finance must approve.
      const raised = await submit(graceCookie, 'Grace asks finance to approve Grace');

      expect(raised.instanceId).not.toBeNull();

      const eligible = await eligibleFor(raised.instanceId ?? '');

      // Excluded from the chain at resolution — not merely refused later. A
      // request that opened a step naming its own requester would sit in their
      // queue looking actionable.
      expect(eligible).not.toContain(graceMembershipId);
      expect(eligible).toContain(felixMembershipId);

      const refused = expectStatus(
        await request(server)
          .post(`/v1/approvals/${raised.instanceId ?? ''}/act`)
          .set('Cookie', graceCookie)
          .send({ action: 'APPROVE' }),
        403,
      );

      expect((refused.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    });

    it('when they are the only person the policy could have named', async () => {
      await publishOnly('The owner approves', [
        {
          type: 'REQUIRE_APPROVER',
          approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
          stepType: 'SINGLE',
          sequence: 1,
          timeoutHours: 48,
        },
      ]);

      // Both finance admins are deactivated for the length of this test, so
      // the role resolves to Grace alone — and Grace is the requester.
      await database.unscoped.membership.update({
        where: { id: felixMembershipId },
        data: { status: 'INACTIVE' },
      });

      try {
        const raised = await submit(graceCookie, 'Nobody left to approve it');

        // `UNRESOLVABLE_APPROVER` at submission, not a chain nobody can
        // finish. The failure is legible and it happens while the policy
        // author can still be told.
        expect(raised.status).toBe('HTTP 422');
      } finally {
        await database.unscoped.membership.update({
          where: { id: felixMembershipId },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('when their own manager position is what the policy named', async () => {
      await publishOnly('The requester’s manager approves', [
        {
          type: 'REQUIRE_APPROVER',
          approver: { kind: 'MANAGER_CHAIN', position: 1 },
          stepType: 'SINGLE',
          sequence: 1,
          timeoutHours: 48,
        },
      ]);

      // Grace is her own manager — a data state that occurs after a
      // reorganisation more often than anybody expects.
      await database.unscoped.membership.update({
        where: { id: graceMembershipId },
        data: { managerMembershipId: graceMembershipId },
      });

      try {
        const raised = await submit(graceCookie, 'Approving myself through my own manager slot');

        // The manager chain resolved to the requester, so the step had nobody
        // in it — refused at submission rather than opened.
        expect(raised.status).toBe('HTTP 422');
      } finally {
        await database.unscoped.membership.update({
          where: { id: graceMembershipId },
          data: { managerMembershipId: null },
        });
      }
    });

    it('when an approver delegates their authority back to the requester', async () => {
      await publishOnly('Finance approves', [
        {
          type: 'REQUIRE_APPROVER',
          approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
          stepType: 'SINGLE',
          sequence: 1,
          timeoutHours: 48,
        },
      ]);

      // Felix hands his approval authority to Grace. Grace then raises a
      // request that finance must approve — which is the arrangement somebody
      // would make on purpose.
      const starts = new Date(Date.now() - 3_600_000).toISOString();
      const ends = new Date(Date.now() + 7 * 86_400_000).toISOString();

      const delegation = expectStatus(
        await request(server).post('/v1/approvals/delegations').set('Cookie', felixCookie).send({
          toMembershipId: graceMembershipId,
          startsAt: starts,
          endsAt: ends,
          reason: 'On leave',
        }),
        201,
      );

      const delegationId = (delegation.body as { data: { id: string } }).data.id;

      try {
        const raised = await submit(graceCookie, 'Delegated straight back to me');

        // Felix's authority now points at Grace, and Grace is the requester —
        // so after delegation there is nobody left. The exclusion *after*
        // delegation is what catches this; excluding only before would have
        // opened a step Grace could act on.
        expect(raised.status).toBe('HTTP 422');
      } finally {
        // Revoked with its version, and asserted rather than hoped for: a
        // delegation left in place would quietly redirect Felix's authority to
        // Grace for every test after this one, and the failure would land
        // somewhere unrelated — which is how it was found.
        expectStatus(
          await request(server)
            .delete(`/v1/approvals/delegations/${delegationId}`)
            .set('Cookie', felixCookie)
            .set('If-Match', '1'),
          200,
        );
      }
    });
  });

  // ── FR-APR-011 ───────────────────────────────────────────────────────────

  describe('two approvers acting at the same instant (FR-APR-011)', () => {
    it('completes the step once and tells the other what happened', async () => {
      await publishOnly('Either finance admin approves', [
        {
          type: 'REQUIRE_APPROVER',
          approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
          stepType: 'PARALLEL_ANY',
          sequence: 1,
          timeoutHours: 48,
        },
      ]);

      const raised = await submit(owner.cookie, 'Two approvers, one instant');
      const instanceId = raised.instanceId ?? '';

      const eligible = await eligibleFor(instanceId);
      expect(eligible.sort()).toEqual([graceMembershipId, felixMembershipId].sort());

      // Fired together, not one after the other. Sequential calls would test
      // the state machine; simultaneous ones test the thing that actually
      // breaks.
      const [first, second] = await Promise.all([
        request(server)
          .post(`/v1/approvals/${instanceId}/act`)
          .set('Cookie', graceCookie)
          .send({ action: 'APPROVE' }),
        request(server)
          .post(`/v1/approvals/${instanceId}/act`)
          .set('Cookie', felixCookie)
          .send({ action: 'APPROVE' }),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);

      // Exactly one success. The loser gets a refusal that says the step is no
      // longer actionable, rather than a second success that would advance the
      // chain twice.
      expect(statuses[0]).toBe(200);
      expect(statuses[1]).toBeGreaterThanOrEqual(400);

      const loser = first.status === 200 ? second : first;

      expect(['STEP_NOT_ACTIONABLE', 'INVALID_STATE_TRANSITION']).toContain(
        (loser.body as { error: { code: string } }).error.code,
      );

      // One action recorded, not two.
      const actions = await database.unscoped.approvalAction.findMany({
        where: { organizationId: owner.organizationId },
        select: { approvalStepId: true },
      });

      const step = await database.unscoped.approvalStep.findFirst({
        where: { organizationId: owner.organizationId, approvalInstanceId: instanceId },
        select: { id: true, status: true },
      });

      expect(actions.filter((action) => action.approvalStepId === step?.id)).toHaveLength(1);
      expect(step?.status).toBe('APPROVED');

      const settled = expectStatus(
        await request(server).get(`/v1/spend-requests/${raised.id}`).set('Cookie', owner.cookie),
        200,
      );

      expect((settled.body as { data: { status: string } }).data.status).toBe('APPROVED');
    });

    it('records one approval when the same person presses twice', async () => {
      await publishOnly('Either finance admin approves', [
        {
          type: 'REQUIRE_APPROVER',
          approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
          stepType: 'PARALLEL_ANY',
          sequence: 1,
          timeoutHours: 48,
        },
      ]);

      const raised = await submit(owner.cookie, 'One person, two clicks');
      const instanceId = raised.instanceId ?? '';

      const [first, second] = await Promise.all([
        request(server)
          .post(`/v1/approvals/${instanceId}/act`)
          .set('Cookie', graceCookie)
          .send({ action: 'APPROVE' }),
        request(server)
          .post(`/v1/approvals/${instanceId}/act`)
          .set('Cookie', graceCookie)
          .send({ action: 'APPROVE' }),
      ]);

      // The double-click case, which is far more common than two people and
      // has the same requirement.
      const statuses = [first.status, second.status].sort((a, b) => a - b);

      expect(statuses[0]).toBe(200);
      expect(statuses[1]).toBeGreaterThanOrEqual(400);
    });
  });
});
