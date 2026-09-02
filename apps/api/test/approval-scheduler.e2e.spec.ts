import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PolicyRepositoryService } from '../src/modules/policies/index.js';
import { DatabaseService } from '../src/platform/database/index.js';
import { QUEUE_PORT, type InlineQueueAdapter } from '../src/platform/queue/index.js';

/**
 * Reminders, escalation, and expiry (tasks 2.2.7 and 2.3.8).
 *
 * **The clock is a parameter, so none of this waits.** The sweep takes `asOf`
 * and every threshold is computed from it, which is what makes "what happens
 * at 80% of a two-day window?" a test rather than a two-day wait. A job whose
 * behaviour could only be tested by sleeping is one nobody tests.
 *
 * The properties worth the whole stack:
 *
 * - **A reminder is sent once per threshold, not once per sweep.** The sweep
 *   runs every fifteen minutes; a key that included the time would chase an
 *   approver ninety-six times a day.
 * - **Escalation adds an approver and never removes one.** The step stays
 *   actionable — one that stopped accepting approvals the moment it went
 *   overdue would be a chain nobody can finish.
 * - **The escalation target is frozen when the chain opens**, like the
 *   eligible set, so a reorganisation cannot redirect it.
 * - **Expiry is a status change on the request, never a deletion**, and it is
 *   attributed to the job rather than to a person.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const JOINER_PASSWORD = 'another-correct-horse-staple';

const HOUR = 3_600_000;

function expectStatus(response: request.Response, status: number): request.Response {
  if (response.status !== status) {
    throw new Error(
      `Expected ${String(status)} from ${response.request.method} ${response.request.url}, got ${String(response.status)}.
Body: ${JSON.stringify(response.body, null, 2)}`,
    );
  }

  return response;
}

describeWithDatabase('the approval scheduler', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let policies: PolicyRepositoryService;
  let queue: InlineQueueAdapter;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let financeMembershipId: string;
  let financeCookie: string;
  let managerMembershipId: string;
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
    queue = app.get<InlineQueueAdapter>(QUEUE_PORT);

    owner = await register();

    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', owner.cookie),
      200,
    );

    const first = (entities.body as { data: Array<{ id: string }> }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;

    const manager = await addMember('MANAGER', 'Mia Manager');
    managerMembershipId = manager.membershipId;

    const finance = await addMember('FINANCE_ADMIN', 'Grace Finance');
    financeMembershipId = finance.membershipId;
    financeCookie = finance.cookie;

    // A step that goes to the manager, times out after 48 hours, and escalates
    // to finance. Both roles hold `approval:act`, which is what makes the
    // escalation resolvable at all.
    await publishPolicy();
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
          organizationName: `Sweep ${RUN}`,
          fullName: 'Owner Sweep',
          email: `sweep-owner-${RUN}@sweep.test`,
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
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@sweep.test`;

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

  async function publishPolicy(): Promise<void> {
    const policyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    await database.unscoped.policy.create({
      data: {
        id: policyId,
        organizationId: owner.organizationId,
        name: 'Manager first, escalating to finance',
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
              name: 'Over 500 goes to a manager, then escalates',
              sequence: 1,
              terminal: false,
              condition: {
                type: 'COMPARISON',
                field: 'amountInBaseCurrency',
                operator: 'GT',
                value: { kind: 'money', amount: '500.00', currency: 'USD' },
              },
              outcomes: [
                {
                  type: 'REQUIRE_APPROVER',
                  approver: { kind: 'ROLE', roleKey: 'MANAGER', scope: 'ORGANIZATION' },
                  stepType: 'SINGLE',
                  sequence: 1,
                  timeoutHours: 48,
                  escalation: {
                    afterHours: 48,
                    to: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
                  },
                },
                { type: 'SET_VALIDITY', days: 30 },
              ],
            },
          ],
        } as never,
      },
    });

    policies.invalidate(owner.organizationId);
  }

  interface Step {
    id: string;
    status: string;
    dueAt: Date | null;
    activatedAt: Date | null;
    eligibleMembershipIds: string[];
    escalation: unknown;
  }

  async function submitAndFindStep(purpose: string): Promise<{ requestId: string; step: Step }> {
    const created = expectStatus(
      await request(server)
        .post('/v1/spend-requests')
        .set('Cookie', owner.cookie)
        .send({ amount: { amount: '900.00', currency: 'USD' }, entityId, purpose }),
      201,
    );

    const requestId = (created.body as { data: { id: string } }).data.id;

    const submitted = expectStatus(
      await request(server)
        .post(`/v1/spend-requests/${requestId}/submit`)
        .set('Cookie', owner.cookie)
        .set('If-Match', '1'),
      200,
    );

    const status = (submitted.body as { data: { status: string } }).data.status;
    if (status !== 'PENDING_APPROVAL') {
      throw new Error(`expected the policy to require approval, got ${status}`);
    }

    await queue.drain();

    const step = await database.unscoped.approvalStep.findFirst({
      where: { organizationId: owner.organizationId, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        status: true,
        dueAt: true,
        activatedAt: true,
        eligibleMembershipIds: true,
        escalation: true,
      },
    });

    if (step === null) throw new Error('the chain should have an active step');

    return { requestId, step };
  }

  /** Run the sweep at a chosen moment. */
  async function sweep(asOf: Date): Promise<void> {
    await queue.enqueue(
      'approvals.sweep',
      { asOf: asOf.toISOString() },
      { idempotencyKey: `sweep-${RUN}-${asOf.toISOString()}` },
    );

    await queue.drain();
  }

  async function notificationsFor(
    membershipId: string,
    eventType: string,
  ): Promise<Array<{ dedupeKey: string; title: string }>> {
    return database.unscoped.notification.findMany({
      where: {
        organizationId: owner.organizationId,
        recipientMembershipId: membershipId,
        eventType,
      },
      select: { dedupeKey: true, title: true },
    });
  }

  // ── what the chain looks like when it opens ──────────────────────────────

  describe('when the chain opens', () => {
    it('freezes the escalation target beside the eligible set', async () => {
      const { step } = await submitAndFindStep('Frozen escalation target');

      expect(step.eligibleMembershipIds).toEqual([managerMembershipId]);
      expect(step.dueAt).not.toBeNull();

      // Resolved now, not when the deadline arrives — a reorganisation in
      // between would otherwise send it to somebody the policy never named.
      expect(step.escalation).toEqual({
        afterHours: 48,
        membershipIds: [financeMembershipId],
      });
    });
  });

  // ── reminders ────────────────────────────────────────────────────────────

  describe('reminders', () => {
    it('says nothing before half the window has passed', async () => {
      const { step } = await submitAndFindStep('Too early to chase');

      const started = (step.activatedAt ?? new Date()).getTime();
      await sweep(new Date(started + 4 * HOUR));

      expect(await notificationsFor(managerMembershipId, 'approval.reminder')).toHaveLength(0);
    });

    it('chases at half, again at four fifths, and never twice for the same threshold', async () => {
      const { step } = await submitAndFindStep('Chased twice');
      const started = (step.activatedAt ?? new Date()).getTime();

      await sweep(new Date(started + 25 * HOUR));

      const afterHalf = (await notificationsFor(managerMembershipId, 'approval.reminder')).filter(
        (row) => row.dedupeKey.startsWith(`step:${step.id}:`),
      );

      expect(afterHalf.map((row) => row.dedupeKey)).toEqual([`step:${step.id}:reminder:1`]);

      // The sweep runs every fifteen minutes. Without a key naming the
      // threshold rather than the moment, this would chase them again.
      await sweep(new Date(started + 26 * HOUR));

      expect(
        (await notificationsFor(managerMembershipId, 'approval.reminder')).filter((row) =>
          row.dedupeKey.startsWith(`step:${step.id}:`),
        ),
      ).toHaveLength(1);

      await sweep(new Date(started + 40 * HOUR));

      const afterFourFifths = (
        await notificationsFor(managerMembershipId, 'approval.reminder')
      ).filter((row) => row.dedupeKey.startsWith(`step:${step.id}:`));

      // The second is a different job about the same step, which is exactly
      // why `nth` is in the key.
      expect(afterFourFifths.map((row) => row.dedupeKey).sort()).toEqual([
        `step:${step.id}:reminder:1`,
        `step:${step.id}:reminder:2`,
      ]);
    },
    /**
     * Two sweeps, and a sweep is **cross-tenant by design** — it asks "which
     * steps anywhere are overdue?" in one query rather than once per
     * organisation (docs/14). That is the right shape, and it means this test
     * gets slower as the test database accumulates organisations from every
     * run that has ever happened against it.
     *
     * The default 30 seconds was fitting on an empty database and stopped
     * fitting somewhere around a thousand organisations. Raised rather than
     * worked around, because the sweep's cost growing with the estate is a
     * real property worth leaving visible.
     */
    120_000);

    it('chases the people who can act, not the person waiting', async () => {
      const { step } = await submitAndFindStep('Chasing the right person');
      const started = (step.activatedAt ?? new Date()).getTime();

      await sweep(new Date(started + 25 * HOUR));

      expect(
        (await notificationsFor(owner.membershipId, 'approval.reminder')).filter((row) =>
          row.dedupeKey.startsWith(`step:${step.id}:`),
        ),
      ).toHaveLength(0);
    });
  });

  // ── escalation ───────────────────────────────────────────────────────────

  describe('escalation', () => {
    it('adds the escalation target without removing anybody, and says so', async () => {
      const { step } = await submitAndFindStep('Escalated to finance');
      const due = (step.dueAt ?? new Date()).getTime();

      await sweep(new Date(due + HOUR));

      const after = await database.unscoped.approvalStep.findFirst({
        where: { id: step.id },
        select: { status: true, escalatedAt: true, eligibleMembershipIds: true },
      });

      expect(after?.status).toBe('ESCALATED');
      expect(after?.escalatedAt).not.toBeNull();
      // Added, not replaced: the manager can still approve it, which is what
      // keeps an escalated chain finishable.
      expect(after?.eligibleMembershipIds.sort()).toEqual(
        [managerMembershipId, financeMembershipId].sort(),
      );

      const told = await notificationsFor(financeMembershipId, 'approval.escalated');
      const mine = told.find((row) => row.dedupeKey === `step:${step.id}:escalated`);

      expect(mine).toBeDefined();
      expect(mine?.title).toContain('Escalated to you');
    });

    it('leaves an escalated step actionable, and by the original approver too', async () => {
      const { requestId, step } = await submitAndFindStep('Escalated then approved');
      const due = (step.dueAt ?? new Date()).getTime();

      await sweep(new Date(due + HOUR));

      const instance = await database.unscoped.approvalInstance.findFirst({
        where: { organizationId: owner.organizationId, subjectId: requestId },
        select: { id: true },
      });

      if (instance === null) throw new Error('the request should have a chain');

      // Finance was brought in by the escalation and acts on it. A step that
      // stopped accepting approvals when it went overdue would be a chain
      // nobody could finish.
      expectStatus(
        await request(server)
          .post(`/v1/approvals/${instance.id}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'APPROVE' }),
        200,
      );

      const read = expectStatus(
        await request(server).get(`/v1/spend-requests/${requestId}`).set('Cookie', owner.cookie),
        200,
      );

      expect((read.body as { data: { status: string } }).data.status).toBe('APPROVED');
    });

    it('escalates once, however many times the sweep runs', async () => {
      const { step } = await submitAndFindStep('Escalated exactly once');
      const due = (step.dueAt ?? new Date()).getTime();

      await sweep(new Date(due + HOUR));
      await sweep(new Date(due + 2 * HOUR));

      const after = await database.unscoped.approvalStep.findFirst({
        where: { id: step.id },
        select: { eligibleMembershipIds: true },
      });

      // Two of the same person on the step would be the tell.
      expect(after?.eligibleMembershipIds).toHaveLength(2);

      expect(
        (await notificationsFor(financeMembershipId, 'approval.escalated')).filter(
          (row) => row.dedupeKey === `step:${step.id}:escalated`,
        ),
      ).toHaveLength(1);
    });

    it('does nothing to a step that was acted on before the deadline', async () => {
      const { requestId, step } = await submitAndFindStep('Approved before it was due');

      const instance = await database.unscoped.approvalInstance.findFirst({
        where: { organizationId: owner.organizationId, subjectId: requestId },
        select: { id: true },
      });

      if (instance === null) throw new Error('the request should have a chain');

      const managerSession = await request(server)
        .post('/v1/auth/login')
        .send({ email: `mia-manager-${RUN}@sweep.test`, password: JOINER_PASSWORD });

      const managerCookie = (managerSession.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; ');

      expectStatus(
        await request(server)
          .post(`/v1/approvals/${instance.id}/act`)
          .set('Cookie', managerCookie)
          .send({ action: 'APPROVE' }),
        200,
      );

      await queue.drain();
      await sweep(new Date((step.dueAt ?? new Date()).getTime() + HOUR));

      const after = await database.unscoped.approvalStep.findFirst({
        where: { id: step.id },
        select: { status: true, escalatedAt: true },
      });

      // Settled steps are not escalated afterwards, and the sweep treats that
      // as an ordinary outcome rather than an error.
      expect(after?.status).toBe('APPROVED');
      expect(after?.escalatedAt).toBeNull();
    });
  });

  // ── expiry ───────────────────────────────────────────────────────────────

  describe('expiry', () => {
    it('expires an approved request whose validity has run out, and audits it as the system', async () => {
      const { requestId, step } = await submitAndFindStep('Approved and left to lapse');

      const instance = await database.unscoped.approvalInstance.findFirst({
        where: { organizationId: owner.organizationId, subjectId: requestId },
        select: { id: true },
      });

      if (instance === null) throw new Error('the request should have a chain');
      void step;

      expectStatus(
        await request(server)
          .post(`/v1/approvals/${instance.id}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'OVERRIDE', comment: 'Settling it so it can lapse.' }),
        200,
      );

      await queue.drain();

      // The policy set 30 days of validity. Rather than wait, move the
      // deadline into the past — which is what the sweep reads.
      await database.unscoped.spendRequest.update({
        where: { id: requestId },
        data: { validUntil: new Date(Date.now() - HOUR) },
      });

      await sweep(new Date());

      const after = await database.unscoped.spendRequest.findFirst({
        where: { id: requestId },
        select: { status: true },
      });

      // A status change, never a deletion: the approval happened, and what has
      // run out is the licence to spend against it.
      expect(after?.status).toBe('EXPIRED');

      const audit = await database.unscoped.auditEvent.findFirst({
        where: {
          organizationId: owner.organizationId,
          resourceId: requestId,
          action: 'spend_request.expired',
        },
        select: { actorType: true, actorLabel: true, actorMembershipId: true },
      });

      // Attributed to the job. Borrowing whoever last touched the request
      // would be a lie about who did it.
      expect(audit?.actorType).toBe('SYSTEM');
      expect(audit?.actorLabel).toBe('spend_request.expire');
      expect(audit?.actorMembershipId).toBeNull();
    });

    it('leaves a request alone if it is no longer approved', async () => {
      const { requestId } = await submitAndFindStep('Cancelled before it could lapse');

      const read = expectStatus(
        await request(server).get(`/v1/spend-requests/${requestId}`).set('Cookie', owner.cookie),
        200,
      );

      const version = (read.body as { data: { version: number } }).data.version;

      expectStatus(
        await request(server)
          .post(`/v1/spend-requests/${requestId}/cancel`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(version)),
        200,
      );

      await database.unscoped.spendRequest.update({
        where: { id: requestId },
        data: { validUntil: new Date(Date.now() - HOUR) },
      });

      await sweep(new Date());

      const after = await database.unscoped.spendRequest.findFirst({
        where: { id: requestId },
        select: { status: true },
      });

      expect(after?.status).toBe('CANCELLED');
    });
  });

  // ── the schedule itself ──────────────────────────────────────────────────

  describe('the schedule', () => {
    it('is registered and deliberately not running', () => {
      const registered = queue.recurring;

      expect(registered.map((entry) => entry.name)).toContain('approvals.sweep');
      // The inline adapter records schedules and fires none of them: a timer
      // in every test process would make behaviour depend on how long the
      // process had been up.
      expect(registered.find((entry) => entry.name === 'approvals.sweep')?.cron).toBe(
        '*/15 * * * *',
      );
    });
  });
});
