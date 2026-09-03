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
 * Notifications and the queue behind them (Epics 2.5, and docs/14 §3).
 *
 * The properties that need the whole stack running:
 *
 * - **Submitting tells the approvers and nobody else.** The requester is not
 *   an approver of their own request (INV-02), so they must not be told to
 *   approve it.
 * - **Delivery is idempotent.** Enqueuing the same job twice — which is what a
 *   queue's at-least-once guarantee produces — writes one notification, not
 *   two. Asserted by enqueuing it twice on purpose.
 * - **A preference turns off delivery, not the record.** With email off, the
 *   row still exists and `channelsDelivered` says what actually happened.
 * - **The inbox is the caller's own.** Not "filtered to" — unreachable by id,
 *   because an id in a URL is not a permission.
 * - **A job about a record that moved on is a success.** A step approved
 *   before the notification ran needs no notification, and treating that as a
 *   failure would fill the dead-letter queue with jobs that did the right
 *   thing.
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

interface NotificationBody {
  id: string;
  eventType: string;
  title: string;
  body: string;
  resourceId: string | null;
  channelsDelivered: string[];
  readAt: string | null;
}

describeWithDatabase('notifications', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let policies: PolicyRepositoryService;
  let queue: QueuePort;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let stranger: { cookie: string; organizationId: string; membershipId: string };
  let financeCookie: string;
  let financeMembershipId: string;
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
    queue = app.get<QueuePort>(QUEUE_PORT);

    owner = await register('owner');
    stranger = await register('stranger');

    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', owner.cookie),
      200,
    );

    const first = (entities.body as { data: Array<{ id: string }> }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;

    const finance = await addMember('FINANCE_ADMIN', 'Grace Finance');
    financeCookie = finance.cookie;
    financeMembershipId = finance.membershipId;

    // Anything over 500 goes to finance. Without a policy every submission is
    // approved on the spot, and there would be no approver to notify.
    await publishPolicy();
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  // ── harness ──────────────────────────────────────────────────────────────

  async function register(
    name: string,
  ): Promise<{ cookie: string; organizationId: string; membershipId: string }> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Notify ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `notify-${name}-${RUN}@notify.test`,
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
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@notify.test`;

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
   * Written directly, as the approvals suite does.
   *
   * The authoring endpoint exists, but reaching for it here would make every
   * assertion below depend on the policy screen's contract as well as on the
   * notification path — and when it failed, the failure would not say which.
   */
  async function publishPolicy(): Promise<void> {
    const policyId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    await database.unscoped.policy.create({
      data: {
        id: policyId,
        organizationId: owner.organizationId,
        name: 'Over 500 goes to finance',
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
              name: 'Over 500 needs finance',
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
                  approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
                  stepType: 'SINGLE',
                  sequence: 1,
                  timeoutHours: 48,
                },
              ],
            },
          ],
        } as never,
      },
    });

    policies.invalidate(owner.organizationId);
  }

  /** A submitted request that needs finance to approve it. */
  async function submitOverLimit(purpose: string): Promise<{ id: string; instanceId: string }> {
    const created = expectStatus(
      await request(server)
        .post('/v1/spend-requests')
        .set('Cookie', owner.cookie)
        .send({ amount: { amount: '900.00', currency: 'USD' }, entityId, purpose }),
      201,
    );

    const id = (created.body as { data: { id: string } }).data.id;

    const submitted = expectStatus(
      await request(server)
        .post(`/v1/spend-requests/${id}/submit`)
        .set('Cookie', owner.cookie)
        .set('If-Match', '1'),
      200,
    );

    const record = (submitted.body as { data: { status: string; approvalInstanceId: string } })
      .data;

    if (record.status !== 'PENDING_APPROVAL') {
      throw new Error(`expected the policy to require approval, got ${record.status}`);
    }

    // Notifications are enqueued after the commit and run on their own. Every
    // assertion below is about what the queue *did*, so waiting for it is part
    // of the arrangement rather than a workaround for timing.
    await queue.drain();

    return { id, instanceId: record.approvalInstanceId };
  }

  async function inbox(
    cookie: string,
    query = '',
  ): Promise<{ items: NotificationBody[]; unread: number }> {
    const response = expectStatus(
      await request(server).get(`/v1/notifications${query}`).set('Cookie', cookie),
      200,
    );

    const body = response.body as {
      data: NotificationBody[];
      summary: { unread: number };
    };

    return { items: body.data, unread: body.summary.unread };
  }

  // ── what arrives ─────────────────────────────────────────────────────────

  describe('when a request needs approving', () => {
    it('tells the approver, in a sentence they can act on', async () => {
      const submitted = await submitOverLimit('New laptops for the design team');

      const forFinance = await inbox(financeCookie);
      const mine = forFinance.items.find((row) => row.resourceId === submitted.id);

      expect(mine).toBeDefined();
      expect(mine?.eventType).toBe('approval.requested');
      // Not "Approval required" — a category is not a notification. The
      // person, the amount, and what it is for are what decide whether this
      // needs opening.
      expect(mine?.title).toContain('needs your approval');
      expect(mine?.title).toContain('$900.00');
      expect(mine?.body).toContain('New laptops for the design team');
      expect(mine?.channelsDelivered).toEqual(expect.arrayContaining(['IN_APP', 'EMAIL']));
      expect(mine?.readAt).toBeNull();
    });

    it('does not ask the requester to approve their own request', async () => {
      const submitted = await submitOverLimit('Something I asked for myself');

      const forOwner = await inbox(owner.cookie);

      // INV-02 is enforced in the resolver; this asserts the notification
      // path inherits it rather than re-deriving a recipient list.
      expect(
        forOwner.items.some(
          (row) => row.resourceId === submitted.id && row.eventType === 'approval.requested',
        ),
      ).toBe(false);
    });

    it('writes one notification however many times the job is delivered', async () => {
      const submitted = await submitOverLimit('Delivered twice on purpose');

      const step = await database.unscoped.approvalStep.findFirst({
        where: { organizationId: owner.organizationId, status: 'ACTIVE' },
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true },
      });

      if (step === null) throw new Error('the chain should have an active step');

      // Exactly what an at-least-once queue does on a redelivery.
      const again = await queue.enqueue(
        'notification.approval_requested',
        { organizationId: owner.organizationId, approvalStepId: step.id },
        { idempotencyKey: `step:${step.id}:requested` },
      );

      await queue.drain();

      expect(again.deduplicated).toBe(true);

      const rows = await database.unscoped.notification.findMany({
        where: {
          organizationId: owner.organizationId,
          recipientMembershipId: financeMembershipId,
          resourceId: submitted.id,
          eventType: 'approval.requested',
        },
        select: { id: true },
      });

      expect(rows).toHaveLength(1);
    });
  });

  describe('when a request is decided', () => {
    it('tells the requester, and says who decided it', async () => {
      const submitted = await submitOverLimit('A thing that will be approved');

      expectStatus(
        await request(server)
          .post(`/v1/approvals/${submitted.instanceId}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'APPROVE', comment: 'Fine by me.' }),
        200,
      );

      await queue.drain();

      const forOwner = await inbox(owner.cookie);
      const decided = forOwner.items.find(
        (row) => row.resourceId === submitted.id && row.eventType === 'approval.decided',
      );

      expect(decided).toBeDefined();
      expect(decided?.title).toContain('approved');
      expect(decided?.body).toContain('Grace Finance');
      expect(decided?.body).toContain('Fine by me.');
    });

    it('uses a different event for a request sent back, because the next action differs', async () => {
      const submitted = await submitOverLimit('A thing that will come back');

      expectStatus(
        await request(server)
          .post(`/v1/approvals/${submitted.instanceId}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'RETURN', comment: 'Add a quote from a second supplier.' }),
        200,
      );

      await queue.drain();

      const forOwner = await inbox(owner.cookie);
      const returned = forOwner.items.find(
        (row) => row.resourceId === submitted.id && row.eventType === 'spend_request.returned',
      );

      expect(returned).toBeDefined();
      // A returned request is not a rejected one, and the wording has to make
      // the difference obvious: one is finished, the other needs an edit.
      expect(returned?.title).toContain('sent back');
      expect(returned?.body).toContain('submit it again');
    });
  });

  describe('a job whose record has moved on', () => {
    it('succeeds without notifying anybody, rather than dead-lettering', async () => {
      const submitted = await submitOverLimit('Approved before the reminder ran');

      const step = await database.unscoped.approvalStep.findFirst({
        where: { organizationId: owner.organizationId, status: 'ACTIVE' },
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true },
      });

      if (step === null) throw new Error('the chain should have an active step');

      expectStatus(
        await request(server)
          .post(`/v1/approvals/${submitted.instanceId}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'APPROVE' }),
        200,
      );

      await queue.drain();

      const handle = await queue.enqueue(
        'approval.reminder',
        { organizationId: owner.organizationId, approvalStepId: step.id, nth: 1 },
        { idempotencyKey: `step:${step.id}:reminder:1` },
      );

      await queue.drain();

      const execution = await database.unscoped.jobExecution.findFirst({
        where: { id: handle.id },
        select: { status: true, attempts: true },
      });

      // The job did its work, which was to make sure nobody is chased about
      // something already settled.
      expect(execution?.status).toBe('SUCCEEDED');
      expect(execution?.attempts).toBe(1);

      const reminders = await database.unscoped.notification.findMany({
        where: { eventType: 'approval.reminder', dedupeKey: `step:${step.id}:reminder:1` },
        select: { id: true },
      });

      expect(reminders).toHaveLength(0);
    });

    it('dead-letters on the first attempt when the record does not exist', async () => {
      const handle = await queue.enqueue(
        'approval.reminder',
        {
          organizationId: owner.organizationId,
          approvalStepId: '01a05000-0000-7000-8000-000000000000',
          nth: 1,
        },
        { idempotencyKey: `missing-step-${RUN}` },
      );

      await queue.drain();

      const execution = await database.unscoped.jobExecution.findFirst({
        where: { id: handle.id },
        select: { status: true, attempts: true, errorKind: true },
      });

      expect(execution?.status).toBe('DEAD_LETTERED');
      // One attempt, not five. A step that does not exist will not exist in
      // eight seconds either, and the retries would only delay the alert.
      expect(execution?.attempts).toBe(1);
      expect(execution?.errorKind).toBe('PERMANENT');
    });
  });

  // ── preferences ──────────────────────────────────────────────────────────

  describe('preferences', () => {
    it('lists every event type, defaulted, before anybody chooses anything', async () => {
      const response = expectStatus(
        await request(server).get('/v1/notifications/preferences').set('Cookie', stranger.cookie),
        200,
      );

      const rows = (
        response.body as { data: Array<{ eventType: string; isDefault: boolean; email: boolean }> }
      ).data;

      // The full list, not the rows that happen to exist. A screen built from
      // stored rows shows nothing to somebody on their first visit.
      expect(rows.length).toBeGreaterThanOrEqual(9);
      expect(rows.every((row) => row.isDefault)).toBe(true);
      // Things needing an action default on; summaries default off.
      expect(rows.find((row) => row.eventType === 'approval.requested')?.email).toBe(true);
      expect(rows.find((row) => row.eventType === 'receipt.missing')?.email).toBe(false);
    });

    it('turns off delivery without turning off the record', async () => {
      expectStatus(
        await request(server)
          .patch('/v1/notifications/preferences')
          .set('Cookie', financeCookie)
          .send({
            preferences: [{ eventType: 'approval.requested', inApp: true, email: false }],
          }),
        200,
      );

      const submitted = await submitOverLimit('Email is off for this one');

      const forFinance = await inbox(financeCookie);
      const row = forFinance.items.find((entry) => entry.resourceId === submitted.id);

      expect(row).toBeDefined();
      // The row exists — "I was never told" has to stay answerable — and it
      // records what actually happened rather than what was intended.
      expect(row?.channelsDelivered).toEqual(['IN_APP']);

      // Put it back, so the tests after this one are not reading a preference
      // this one left behind.
      expectStatus(
        await request(server)
          .patch('/v1/notifications/preferences')
          .set('Cookie', financeCookie)
          .send({ preferences: [{ eventType: 'approval.requested', inApp: true, email: true }] }),
        200,
      );
    });

    it('refuses the same event type twice in one save', async () => {
      expectStatus(
        await request(server)
          .patch('/v1/notifications/preferences')
          .set('Cookie', financeCookie)
          .send({
            preferences: [
              { eventType: 'approval.decided', inApp: true, email: true },
              { eventType: 'approval.decided', inApp: false, email: false },
            ],
          }),
        422,
      );
    });
  });

  // ── the inbox ────────────────────────────────────────────────────────────

  describe('the inbox', () => {
    it('marks one as read, and the unread count follows', async () => {
      await submitOverLimit('Something to read');

      const before = await inbox(financeCookie, '?unreadOnly=true');
      const first = before.items[0];

      if (first === undefined) throw new Error('finance should have an unread notification');

      expectStatus(
        await request(server)
          .post(`/v1/notifications/${first.id}/read`)
          .set('Cookie', financeCookie),
        200,
      );

      const after = await inbox(financeCookie, '?unreadOnly=true');

      expect(after.items.some((row) => row.id === first.id)).toBe(false);
      expect(after.unread).toBe(before.unread - 1);
    });

    it('marks everything read in one call', async () => {
      await submitOverLimit('Something else to read');

      const marked = expectStatus(
        await request(server).post('/v1/notifications/read-all').set('Cookie', financeCookie),
        200,
      );

      expect((marked.body as { data: { marked: number } }).data.marked).toBeGreaterThan(0);
      expect((await inbox(financeCookie)).unread).toBe(0);
    });

    it('dismisses one from the list and keeps the record', async () => {
      await submitOverLimit('Something to dismiss');

      const before = await inbox(financeCookie);
      const first = before.items[0];

      if (first === undefined) throw new Error('finance should have a notification');

      expectStatus(
        await request(server).delete(`/v1/notifications/${first.id}`).set('Cookie', financeCookie),
        204,
      );

      const after = await inbox(financeCookie);
      expect(after.items.some((row) => row.id === first.id)).toBe(false);

      // Soft: "I was never told" must stay answerable, and a hard delete would
      // let the answer be removed by the person asking.
      const row = await database.unscoped.notification.findFirst({
        where: { id: first.id },
        select: { deletedAt: true },
      });

      expect(row?.deletedAt).not.toBeNull();
    });

    it('is nobody else’s to read, even with the id', async () => {
      await submitOverLimit('Not for the owner');

      const forFinance = await inbox(financeCookie);
      const theirs = forFinance.items[0];

      if (theirs === undefined) throw new Error('finance should have a notification');

      // The owner is an administrator of this organisation and still cannot
      // mark somebody else's notification as read: an id in a URL is not a
      // permission, and this answers 404 rather than 403 so it cannot be used
      // to learn what a colleague was told.
      expectStatus(
        await request(server)
          .post(`/v1/notifications/${theirs.id}/read`)
          .set('Cookie', owner.cookie),
        404,
      );

      expectStatus(
        await request(server)
          .post(`/v1/notifications/${theirs.id}/read`)
          .set('Cookie', stranger.cookie),
        404,
      );
    });

    it('offers no way to send somebody a notification', async () => {
      // They are written from events, by jobs (FR-NOT-003). A route would be a
      // way to send a message that looks like it came from the system.
      expectStatus(
        await request(server)
          .post('/v1/notifications')
          .set('Cookie', owner.cookie)
          .send({ title: 'Please approve my expenses', body: 'Thanks' }),
        404,
      );
    });
  });
});
