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
 * Expenses and reimbursements, end to end (Epics 3.2 and 3.3).
 *
 * The properties that need the whole stack:
 *
 * - **The same approval machinery, a second subject type.** An expense opens a
 *   chain, is approved on `/v1/approvals`, and settles into an expense — with
 *   nothing in the approvals module knowing what an expense is.
 * - **Card spend and out-of-pocket spend are governed separately**, because
 *   they carry different spend types into the same engine. This is also the
 *   first time two spend types exist at once, which the policy suite could not
 *   assert before.
 * - **A blocked expense stays editable** (FR-EXP-003). The money is already
 *   gone; blocking asks for a receipt rather than refusing a purchase.
 * - **The total comes from the items**, and a stated total that disagrees is
 *   refused rather than reconciled.
 * - **An expense cannot be paid twice** (FR-EXP-009), asserted with two
 *   simultaneous batches — the case a pre-flight check passes and the unique
 *   index does not.
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

function errorCode(response: request.Response): string {
  return (response.body as { error: { code: string } }).error.code;
}

const TODAY = new Date().toISOString().slice(0, 10);

describeWithDatabase('expenses and reimbursements', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let policies: PolicyRepositoryService;
  let queue: QueuePort;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let stranger: { cookie: string };
  let financeCookie: string;
  let employee: { cookie: string; membershipId: string };
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

    financeCookie = (await addMember('FINANCE_ADMIN', 'Grace Finance')).cookie;
    employee = await addMember('EMPLOYEE', 'Sam Employee');
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
          organizationName: `Expenses ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `expenses-${name}-${RUN}@expenses.test`,
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
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@expenses.test`;

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

  let published = 0;

  /** Publish one policy for one spend type, archiving whatever was live. */
  async function publishOnly(
    spendType: 'REIMBURSEMENT' | 'CARD',
    name: string,
    outcomes: readonly Record<string, unknown>[],
    over = '100.00',
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
        spendTypes: [spendType],
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
                value: { kind: 'money', amount: over, currency: 'USD' },
              },
              outcomes,
            },
          ],
        } as never,
      },
    });

    policies.invalidate(owner.organizationId);
  }

  const financeApproves = {
    type: 'REQUIRE_APPROVER',
    approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
    stepType: 'SINGLE',
    sequence: 1,
    timeoutHours: 48,
  };

  interface ExpenseBody {
    id: string;
    reference: string;
    status: string;
    version: number;
    amount: { amount: string; currency: string };
    items: Array<{ description: string }>;
    approvalInstanceId: string | null;
  }

  async function createExpense(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<ExpenseBody> {
    const response = expectStatus(
      await request(server)
        .post('/v1/expenses')
        .set('Cookie', cookie)
        .send({ entityId, expenseDate: TODAY, ...body }),
      201,
    );

    return (response.body as { data: ExpenseBody }).data;
  }

  async function submit(cookie: string, expense: ExpenseBody): Promise<request.Response> {
    return request(server)
      .post(`/v1/expenses/${expense.id}/submit`)
      .set('Cookie', cookie)
      .set('If-Match', String(expense.version))
      .send({});
  }

  async function read(cookie: string, id: string): Promise<ExpenseBody> {
    const response = expectStatus(
      await request(server).get(`/v1/expenses/${id}`).set('Cookie', cookie),
      200,
    );

    return (response.body as { data: ExpenseBody }).data;
  }

  // ── the claim ────────────────────────────────────────────────────────────

  describe('a claim', () => {
    it('totals itself from its items', async () => {
      const expense = await createExpense(owner.cookie, {
        merchantName: 'A hotel in Lisbon',
        items: [
          { description: 'Room, two nights', amount: { amount: '240.00', currency: 'USD' } },
          { description: 'Breakfast', amount: { amount: '31.50', currency: 'USD' } },
        ],
      });

      // Computed on the server, never taken from the client (FR-SPD-006's
      // reasoning applies here for the same reason).
      expect(expense.amount).toEqual({ amount: '271.5000', currency: 'USD' });
      expect(expense.items).toHaveLength(2);
    });

    it('refuses a stated total that disagrees with its own items', async () => {
      const refused = expectStatus(
        await request(server)
          .post('/v1/expenses')
          .set('Cookie', owner.cookie)
          .send({
            entityId,
            expenseDate: TODAY,
            merchantName: 'A hotel in Lisbon',
            amount: { amount: '500.00', currency: 'USD' },
            items: [{ description: 'Room', amount: { amount: '240.00', currency: 'USD' } }],
          }),
        422,
      );

      // Refused rather than resolved: picking one means picking a number
      // nobody chose, and the two obvious rules are wrong in opposite
      // directions.
      expect(JSON.stringify(refused.body)).toContain('does not match the items');
    });

    it('refuses items in mixed currencies', async () => {
      expectStatus(
        await request(server)
          .post('/v1/expenses')
          .set('Cookie', owner.cookie)
          .send({
            entityId,
            expenseDate: TODAY,
            merchantName: 'A trip with two legs',
            items: [
              { description: 'Taxi in Lisbon', amount: { amount: '20.00', currency: 'EUR' } },
              { description: 'Taxi in Boston', amount: { amount: '30.00', currency: 'USD' } },
            ],
          }),
        422,
      );
    });

    it('needs an amount when there are no items', async () => {
      expectStatus(
        await request(server)
          .post('/v1/expenses')
          .set('Cookie', owner.cookie)
          .send({ entityId, expenseDate: TODAY, merchantName: 'Something' }),
        422,
      );
    });
  });

  // ── policy ───────────────────────────────────────────────────────────────

  describe('submitting', () => {
    it('goes straight through when no policy applies', async () => {
      await publishOnly('REIMBURSEMENT', 'Over 100 needs finance', [financeApproves]);

      const expense = await createExpense(owner.cookie, {
        merchantName: 'A cheap lunch',
        amount: { amount: '9.00', currency: 'USD' },
      });

      const submitted = expectStatus(await submit(owner.cookie, expense), 200);

      expect((submitted.body as { data: ExpenseBody }).data.status).toBe('APPROVED');
    });

    it('opens a chain, and the approval settles the expense', async () => {
      await publishOnly('REIMBURSEMENT', 'Over 100 needs finance', [financeApproves]);

      const expense = await createExpense(owner.cookie, {
        merchantName: 'Team dinner',
        amount: { amount: '410.00', currency: 'USD' },
      });

      const submitted = expectStatus(await submit(owner.cookie, expense), 200);
      const pending = (submitted.body as { data: ExpenseBody }).data;

      expect(pending.status).toBe('PENDING_APPROVAL');
      expect(pending.approvalInstanceId).not.toBeNull();

      await queue.drain();

      // Approved through the shared machinery — the approvals module does not
      // know what an expense is, and the subject registry is what keeps it
      // that way.
      expectStatus(
        await request(server)
          .post(`/v1/approvals/${pending.approvalInstanceId ?? ''}/act`)
          .set('Cookie', financeCookie)
          .send({ action: 'APPROVE' }),
        200,
      );

      expect((await read(owner.cookie, expense.id)).status).toBe('APPROVED');
    });

    it('governs card spend by a different rule from out-of-pocket spend', async () => {
      // The card policy covers `CARD` only. An out-of-pocket claim for the
      // same amount is untouched by it — which is the entire reason payment
      // method is a field rather than a note.
      await publishOnly('CARD', 'Card spend over 100 is reviewed', [financeApproves]);

      const card = await createExpense(owner.cookie, {
        merchantName: 'Software renewal',
        amount: { amount: '410.00', currency: 'USD' },
        paymentMethod: 'COMPANY_CARD',
      });

      const cardSubmitted = expectStatus(await submit(owner.cookie, card), 200);
      expect((cardSubmitted.body as { data: ExpenseBody }).data.status).toBe('PENDING_APPROVAL');

      const pocket = await createExpense(owner.cookie, {
        merchantName: 'The same amount, my own money',
        amount: { amount: '410.00', currency: 'USD' },
        paymentMethod: 'OUT_OF_POCKET',
      });

      const pocketSubmitted = expectStatus(await submit(owner.cookie, pocket), 200);
      expect((pocketSubmitted.body as { data: ExpenseBody }).data.status).toBe('APPROVED');
    });

    it('blocks without a receipt, and leaves the claim editable', async () => {
      await publishOnly('REIMBURSEMENT', 'Over 100 needs a receipt', [
        { type: 'BLOCK', reasonCode: 'RECEIPT_REQUIRED', message: 'Attach the receipt first.' },
      ]);

      const expense = await createExpense(owner.cookie, {
        merchantName: 'An unevidenced dinner',
        amount: { amount: '410.00', currency: 'USD' },
      });

      // A 409, not a 422: the request is well-formed and the *state of the
      // world* refuses it, which is what the taxonomy reserves 409 for.
      const blocked = expectStatus(await submit(owner.cookie, expense), 409);

      expect(errorCode(blocked)).toBe('POLICY_BLOCKED');

      // Still a draft, and still editable (FR-EXP-003). The money is already
      // spent; blocking asks for something, it does not refuse a purchase.
      const after = await read(owner.cookie, expense.id);
      expect(after.status).toBe('DRAFT');

      expectStatus(
        await request(server)
          .patch(`/v1/expenses/${expense.id}`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(after.version))
          .send({ memo: 'The receipt is coming.' }),
        200,
      );
    });

    it('asks for the receipt by name when policy requires one', async () => {
      await publishOnly('REIMBURSEMENT', 'Over 100 needs a receipt', [{ type: 'REQUIRE_RECEIPT' }]);

      const expense = await createExpense(owner.cookie, {
        merchantName: 'Dinner with no receipt',
        amount: { amount: '410.00', currency: 'USD' },
      });

      const refused = expectStatus(await submit(owner.cookie, expense), 422);

      // A validation failure naming the field the person can fix, not a policy
      // block naming a rule they cannot read.
      expect(errorCode(refused)).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(refused.body)).toContain('receipt');
    });

    it('refuses to submit twice', async () => {
      await publishOnly('REIMBURSEMENT', 'Over 100 needs finance', [financeApproves]);

      const expense = await createExpense(owner.cookie, {
        merchantName: 'Submitted once',
        amount: { amount: '410.00', currency: 'USD' },
      });

      expectStatus(await submit(owner.cookie, expense), 200);
      await queue.drain();

      const after = await read(owner.cookie, expense.id);

      expectStatus(await submit(owner.cookie, { ...expense, version: after.version }), 409);
    });
  });

  // ── who sees what ────────────────────────────────────────────────────────

  describe('visibility', () => {
    it('shows an employee their own claims and not the organisation’s', async () => {
      const mine = await createExpense(employee.cookie, {
        merchantName: 'Sam’s taxi',
        amount: { amount: '18.00', currency: 'USD' },
      });

      const theirs = await createExpense(owner.cookie, {
        merchantName: 'The owner’s taxi',
        amount: { amount: '22.00', currency: 'USD' },
      });

      const listed = expectStatus(
        await request(server).get('/v1/expenses?pageSize=100').set('Cookie', employee.cookie),
        200,
      );

      const ids = (listed.body as { data: Array<{ id: string }> }).data.map((row) => row.id);

      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);

      // And not reachable one at a time either: an expense is somebody's own
      // claim, often for something personal.
      expectStatus(
        await request(server).get(`/v1/expenses/${theirs.id}`).set('Cookie', employee.cookie),
        404,
      );
    });

    it('shows nothing of another organisation’s expenses', async () => {
      const expense = await createExpense(owner.cookie, {
        merchantName: 'Private',
        amount: { amount: '30.00', currency: 'USD' },
      });

      expectStatus(
        await request(server).get(`/v1/expenses/${expense.id}`).set('Cookie', stranger.cookie),
        404,
      );
    });
  });

  // ── reimbursement ────────────────────────────────────────────────────────

  describe('reimbursement', () => {
    /** An approved out-of-pocket claim, ready to be batched. */
    async function approvedExpense(merchantName: string, amount: string): Promise<ExpenseBody> {
      await publishOnly('REIMBURSEMENT', 'Nothing needs approval', [], '999999.00');

      const expense = await createExpense(employee.cookie, {
        merchantName,
        amount: { amount, currency: 'USD' },
      });

      const submitted = expectStatus(await submit(employee.cookie, expense), 200);
      const after = (submitted.body as { data: ExpenseBody }).data;

      if (after.status !== 'APPROVED') {
        throw new Error(`expected an approved expense, got ${after.status}`);
      }

      return after;
    }

    interface BatchBody {
      id: string;
      status: string;
      version: number;
      total: { amount: string; currency: string };
      lineCount: number;
      lines: Array<{ expenseId: string }>;
      paymentReference: string | null;
    }

    async function batch(): Promise<BatchBody> {
      const response = expectStatus(
        await request(server).post('/v1/reimbursements').set('Cookie', financeCookie).send({
          payeeMembershipId: employee.membershipId,
          entityId,
          currency: 'USD',
          periodStart: '2000-01-01',
          periodEnd: '2999-12-31',
        }),
        201,
      );

      return (response.body as { data: BatchBody }).data;
    }

    it('groups approved claims and totals them on the server', async () => {
      const first = await approvedExpense('A taxi', '18.00');
      const second = await approvedExpense('A coffee', '4.50');

      const created = await batch();

      expect(created.status).toBe('DRAFT');
      expect(created.lineCount).toBeGreaterThanOrEqual(2);
      expect(created.lines.map((line) => line.expenseId)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      );

      // Summed from the lines inside the transaction that wrote them.
      const total = Number(created.total.amount);
      expect(total).toBeGreaterThanOrEqual(22.5);
    });

    /**
     * FR-EXP-009, and the reason the phase exists.
     *
     * Two batches built at the same instant, both finding the expense
     * unbatched when they look. A pre-flight check passes twice and pays twice;
     * the unique index is what makes the second one a refusal.
     */
    it('cannot pay the same claim twice, even from two simultaneous batches', async () => {
      await approvedExpense('A dinner that must be paid once', '64.00');

      const [first, second] = await Promise.all([
        request(server).post('/v1/reimbursements').set('Cookie', financeCookie).send({
          payeeMembershipId: employee.membershipId,
          entityId,
          currency: 'USD',
          periodStart: '2000-01-01',
          periodEnd: '2999-12-31',
        }),
        request(server).post('/v1/reimbursements').set('Cookie', financeCookie).send({
          payeeMembershipId: employee.membershipId,
          entityId,
          currency: 'USD',
          periodStart: '2000-01-01',
          periodEnd: '2999-12-31',
        }),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);

      expect(statuses[0]).toBe(201);
      expect(statuses[1]).toBeGreaterThanOrEqual(400);

      const loser = first.status === 201 ? second : first;

      // Named rather than generic: "already reimbursed" is what finance needs
      // to hear, and a 500 would send them looking for an outage.
      expect(['EXPENSE_ALREADY_REIMBURSED', 'REQUEST_IN_PROGRESS']).toContain(errorCode(loser));
    });

    it('needs a payment reference before it can be marked paid', async () => {
      await approvedExpense('Something to pay for', '12.00');
      const created = await batch();

      const approved = expectStatus(
        await request(server)
          .post(`/v1/reimbursements/${created.id}/approve`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(created.version))
          .send({}),
        200,
      );

      const ready = (approved.body as { data: BatchBody }).data;

      // A payment nobody can find in a bank statement is a payment nobody can
      // prove was made (FR-EXP-010).
      expectStatus(
        await request(server)
          .post(`/v1/reimbursements/${created.id}/pay`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(ready.version))
          .send({}),
        422,
      );

      const paid = expectStatus(
        await request(server)
          .post(`/v1/reimbursements/${created.id}/pay`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(ready.version))
          .send({ paymentReference: 'BACS-2026-09-01-0042' }),
        200,
      );

      const settled = (paid.body as { data: BatchBody }).data;

      expect(settled.status).toBe('PAID');
      expect(settled.paymentReference).toBe('BACS-2026-09-01-0042');
    });

    it('moves the expenses to reimbursed in the same transaction', async () => {
      const expense = await approvedExpense('Paid and marked', '77.00');
      const created = await batch();

      const approved = expectStatus(
        await request(server)
          .post(`/v1/reimbursements/${created.id}/approve`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(created.version))
          .send({}),
        200,
      );

      expectStatus(
        await request(server)
          .post(`/v1/reimbursements/${created.id}/pay`)
          .set('Cookie', financeCookie)
          .set('If-Match', String((approved.body as { data: BatchBody }).data.version))
          .send({ paymentReference: 'BACS-2026-09-01-0043' }),
        200,
      );

      // A batch marked paid whose expenses still read `APPROVED` is a claim
      // that can be batched again — which is the failure this whole epic
      // exists to prevent.
      expect((await read(financeCookie, expense.id)).status).toBe('REIMBURSED');
    });

    it('refuses to pay a batch that has not been approved', async () => {
      await approvedExpense('Not approved yet', '9.00');
      const created = await batch();

      expectStatus(
        await request(server)
          .post(`/v1/reimbursements/${created.id}/pay`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(created.version))
          .send({ paymentReference: 'BACS-TOO-EARLY' }),
        409,
      );
    });

    it('never batches company-card spend', async () => {
      await publishOnly('REIMBURSEMENT', 'Nothing needs approval', [], '999999.00');

      const card = await createExpense(employee.cookie, {
        merchantName: 'Paid by the company already',
        amount: { amount: '55.00', currency: 'USD' },
        paymentMethod: 'COMPANY_CARD',
      });

      expectStatus(await submit(employee.cookie, card), 200);

      const created = await batch().catch(() => null);

      // Either there was nothing else to batch, or the batch exists and does
      // not contain it. Including it would pay for the same thing twice, from
      // two directions, and the second payment would look entirely ordinary.
      if (created !== null) {
        expect(created.lines.map((line) => line.expenseId)).not.toContain(card.id);
      }
    });
  });
});
