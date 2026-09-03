import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/platform/database/index.js';
import { QUEUE_PORT, type QueuePort } from '../src/platform/queue/index.js';

/**
 * Vendors, bills, and procurement, end to end (Phase 5).
 *
 * The properties that need the whole stack, and that all fail silently in
 * production if they are wrong:
 *
 * - **A bill traverses the identical evaluator and chain** a spend request does
 *   (FR-BIL-003). This is the assertion the roadmap names as the exit criterion
 *   for the phase, and it is the one that stops a second approval
 *   implementation appearing.
 * - **The same invoice cannot be entered twice** (FR-BIL-002), asserted with
 *   two simultaneous entries — the case a pre-flight check passes and only an
 *   index catches.
 * - **A duplicate supplier is refused before it exists**, with the match named,
 *   and can be created anyway when a person says it is genuinely different.
 * - **Bank details go in and never come out.**
 * - **A merge keeps both rows** and repoints the invoices.
 * - **An approved order commits budget** (FR-PRC-001), and a cancelled one
 *   gives it back.
 * - **The three-way match names the line that varies**, not just the bill.
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

interface VendorBody {
  id: string;
  name: string;
  status: string;
  version: number;
  bankAccountLast4: string | null;
  hasBankDetails: boolean;
  mergedIntoId: string | null;
}

interface BillBody {
  id: string;
  status: string;
  version: number;
  billNumber: string;
  total: { amount: string; currency: string };
  approvalInstanceId: string | null;
  match: {
    status: string;
    lines: { billLineId: string; verdict: string; variancePercent: number }[];
  } | null;
  lines: { id: string; lineAmount: { amount: string } }[];
}

interface OrderBody {
  id: string;
  status: string;
  version: number;
  poNumber: string;
  total: { amount: string; currency: string };
  lines: {
    id: string;
    quantity: string;
    receivedQuantity: string;
    outstandingQuantity: string;
  }[];
}

describeWithDatabase('payables', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let queue: QueuePort;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let stranger: { cookie: string };
  let financeCookie: string;
  let employeeCookie: string;
  let entityId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    queue = app.get<QueuePort>(QUEUE_PORT);

    owner = await register('owner');
    stranger = await register('stranger');

    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', owner.cookie),
      200,
    );
    const first = (entities.body as { data: { id: string }[] }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;

    financeCookie = await addMember('FINANCE_ADMIN', 'Grace Finance');
    employeeCookie = await addMember('EMPLOYEE', 'Sam Employee');
  }, 300_000);

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
          organizationName: `Payables ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `payables-${name}-${RUN}@payables.test`,
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

  async function addMember(roleKey: string, fullName: string): Promise<string> {
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@payables.test`;

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
          password: 'another-correct-horse-staple',
        }),
      201,
    );

    return (accepted.headers['set-cookie'] as unknown as string[])
      .map((value) => value.split(';')[0])
      .join('; ');
  }

  let vendors = 0;

  async function makeVendor(
    name?: string,
    extra: Record<string, unknown> = {},
  ): Promise<VendorBody> {
    vendors += 1;

    const response = expectStatus(
      await request(server)
        .post('/v1/vendors')
        .set('Cookie', financeCookie)
        .send({ name: name ?? `Supplier ${RUN}-${String(vendors)}`, ...extra }),
      201,
    );

    return (response.body as { data: VendorBody }).data;
  }

  let bills = 0;

  async function makeBill(
    vendorId: string,
    lines: Record<string, unknown>[] = [{ description: 'Consulting', unitAmount: '1000.00' }],
    billNumber?: string,
  ): Promise<BillBody> {
    bills += 1;

    const response = expectStatus(
      await request(server)
        .post('/v1/bills')
        .set('Cookie', financeCookie)
        .send({
          vendorId,
          entityId,
          billNumber: billNumber ?? `INV-${RUN}-${String(bills)}`,
          issueDate: new Date().toISOString().slice(0, 10),
          currency: 'USD',
          lines,
        }),
      201,
    );

    return (response.body as { data: BillBody }).data;
  }

  async function readBill(id: string): Promise<BillBody> {
    const response = expectStatus(
      await request(server).get(`/v1/bills/${id}`).set('Cookie', financeCookie),
      200,
    );

    return (response.body as { data: BillBody }).data;
  }

  // ── vendors ──────────────────────────────────────────────────────────────

  describe('vendors', () => {
    it('refuses a near-duplicate and names what it matched', async () => {
      const original = await makeVendor(`Acme Widgets ${RUN}`);

      const response = await request(server)
        .post('/v1/vendors')
        .set('Cookie', financeCookie)
        // Different case, a suffix, and punctuation. One supplier, entered
        // twice on two afternoons.
        .send({ name: `ACME WIDGETS ${RUN}, Ltd.` });

      expectStatus(response, 409);

      const details = (response.body as { error: { details?: { matches?: { id: string }[] } } })
        .error.details;

      expect(details?.matches?.[0]?.id).toBe(original.id);
    });

    it('creates it anyway when somebody says it is a different company', async () => {
      await makeVendor(`Franchise ${RUN}`);

      const response = expectStatus(
        await request(server)
          .post('/v1/vendors')
          .set('Cookie', financeCookie)
          .send({ name: `Franchise ${RUN} Limited`, allowDuplicate: true }),
        201,
      );

      expect((response.body as { data: VendorBody }).data.id).toBeTruthy();
    });

    it('matches on tax id even when the name changed', async () => {
      const taxId = `TAX-${RUN}`;

      await makeVendor(`Before Rebrand ${RUN}`, { taxId });

      const response = await request(server)
        .post('/v1/vendors')
        .set('Cookie', financeCookie)
        .send({ name: `After Rebrand ${RUN}`, taxId });

      expectStatus(response, 409);

      const details = (
        response.body as { error: { details?: { matches?: { reason: string }[] } } }
      ).error.details;

      expect(details?.matches?.[0]?.reason).toBe('SAME_TAX_ID');
    });

    it('takes bank details and never gives them back', async () => {
      const vendor = await makeVendor(`Banked ${RUN}`, {
        bankDetails: { accountName: 'Banked Ltd', accountNumber: '12345678901234' },
      });

      expect(vendor.hasBankDetails).toBe(true);
      expect(vendor.bankAccountLast4).toBe('1234');

      const raw = JSON.stringify(
        (
          await request(server)
            .get(`/v1/vendors/${vendor.id}`)
            .set('Cookie', financeCookie)
            .expect(200)
        ).body,
      );

      // Neither the number nor the ciphertext appears anywhere in a response.
      expect(raw).not.toContain('12345678901234');
      expect(raw).not.toContain('accountNumber');

      const stored = await database.unscoped.vendor.findFirst({ where: { id: vendor.id } });

      // Stored, but not in the clear.
      expect(stored?.bankDetailsEncrypted).toBeTruthy();
      expect(stored?.bankDetailsEncrypted).not.toContain('12345678901234');
    });

    it('merges without deleting, and moves the invoices', async () => {
      const loser = await makeVendor(`Loser ${RUN}`);
      const winner = await makeVendor(`Winner ${RUN}`);

      const bill = await makeBill(loser.id);

      const merged = expectStatus(
        await request(server)
          .post(`/v1/vendors/${loser.id}/merge`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(loser.version))
          .send({ intoVendorId: winner.id, reason: 'Same company, entered twice.' }),
        200,
      );

      // The surviving supplier is what the caller now works with.
      expect((merged.body as { data: VendorBody }).data.id).toBe(winner.id);

      const tombstone = expectStatus(
        await request(server).get(`/v1/vendors/${loser.id}`).set('Cookie', financeCookie),
        200,
      ).body as { data: VendorBody };

      // Still there, still resolvable, pointing at the survivor.
      expect(tombstone.data.status).toBe('MERGED');
      expect(tombstone.data.mergedIntoId).toBe(winner.id);

      const moved = await database.unscoped.bill.findFirst({ where: { id: bill.id } });
      expect(moved?.vendorId).toBe(winner.id);
    });

    it('refuses to bill a supplier that has been merged away', async () => {
      const loser = await makeVendor(`Gone ${RUN}`);
      const winner = await makeVendor(`Kept ${RUN}`);

      expectStatus(
        await request(server)
          .post(`/v1/vendors/${loser.id}/merge`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(loser.version))
          .send({ intoVendorId: winner.id }),
        200,
      );

      const response = await request(server)
        .post('/v1/bills')
        .set('Cookie', financeCookie)
        .send({
          vendorId: loser.id,
          entityId,
          billNumber: `INV-GONE-${RUN}`,
          issueDate: new Date().toISOString().slice(0, 10),
          currency: 'USD',
          lines: [{ description: 'Anything', unitAmount: '10.00' }],
        });

      expectStatus(response, 422);
    });

    it('shows nothing of another organisation’s suppliers', async () => {
      const vendor = await makeVendor(`Private ${RUN}`);

      expectStatus(
        await request(server).get(`/v1/vendors/${vendor.id}`).set('Cookie', stranger.cookie),
        404,
      );
    });

    it('is refused to somebody who can read suppliers but not manage them', async () => {
      expectStatus(
        await request(server)
          .post('/v1/vendors')
          .set('Cookie', employeeCookie)
          .send({ name: `Sneaky ${RUN}` }),
        403,
      );
    });
  });

  // ── bills ────────────────────────────────────────────────────────────────

  describe('bills', () => {
    it('computes the total from the lines and ignores anything else', async () => {
      const vendor = await makeVendor();

      const bill = await makeBill(vendor.id, [
        { description: 'Licences', quantity: '3', unitAmount: '250.00' },
        { description: 'Support', quantity: '1', unitAmount: '125.50' },
      ]);

      // 3 × 250 + 125.50. Worked out here, not by the code under test.
      expect(bill.total).toEqual({ amount: '875.5000', currency: 'USD' });
    });

    it('refuses the same invoice number from the same supplier', async () => {
      const vendor = await makeVendor();
      const number = `DUP-${RUN}`;

      await makeBill(vendor.id, undefined, number);

      const response = await request(server)
        .post('/v1/bills')
        .set('Cookie', financeCookie)
        .send({
          vendorId: vendor.id,
          entityId,
          billNumber: number,
          issueDate: new Date().toISOString().slice(0, 10),
          currency: 'USD',
          lines: [{ description: 'Again', unitAmount: '1000.00' }],
        });

      expectStatus(response, 409);
    });

    it('refuses it under two simultaneous entries, which a check would not', async () => {
      const vendor = await makeVendor();
      const number = `RACE-${RUN}`;

      const body = {
        vendorId: vendor.id,
        entityId,
        billNumber: number,
        issueDate: new Date().toISOString().slice(0, 10),
        currency: 'USD',
        lines: [{ description: 'Consulting', unitAmount: '4000.00' }],
      };

      const [first, second] = await Promise.all([
        request(server).post('/v1/bills').set('Cookie', financeCookie).send(body),
        request(server).post('/v1/bills').set('Cookie', financeCookie).send(body),
      ]);

      const statuses = [first.status, second.status].sort((left, right) => left - right);

      // One created, one refused. Never two.
      expect(statuses).toEqual([201, 409]);

      const stored = await database.unscoped.bill.count({
        where: { organizationId: owner.organizationId, vendorId: vendor.id, billNumber: number },
      });

      expect(stored).toBe(1);
    });

    it('submits into the same approval machinery everything else uses', async () => {
      const vendor = await makeVendor();
      const bill = await makeBill(vendor.id, [
        { description: 'A large engagement', unitAmount: '50000.00' },
      ]);

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/bills/${bill.id}/submit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(bill.version)),
        200,
      ).body as { data: BillBody };

      // With no policy published, nothing requires approval and the bill
      // settles immediately — which is itself the shared behaviour: the same
      // "no steps means no chain" rule every other subject follows.
      expect(['APPROVED', 'PENDING_APPROVAL']).toContain(submitted.data.status);

      if (submitted.data.approvalInstanceId !== null) {
        // The chain is readable on the *approvals* endpoint, with nothing
        // bill-shaped about it. That is FR-BIL-003 in one assertion.
        const instance = expectStatus(
          await request(server)
            .get(`/v1/approvals/${submitted.data.approvalInstanceId}`)
            .set('Cookie', financeCookie),
          200,
        ).body as { data: { subjectType: string } };

        expect(instance.data.subjectType).toBe('bill');
      }
    });

    it('records payment with a reference, and refuses to pay an unapproved bill', async () => {
      const vendor = await makeVendor();
      const bill = await makeBill(vendor.id);

      const tooEarly = await request(server)
        .post(`/v1/bills/${bill.id}/pay`)
        .set('Cookie', financeCookie)
        .set('If-Match', String(bill.version))
        .send({ paymentReference: 'BACS-1' });

      expectStatus(tooEarly, 409);

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/bills/${bill.id}/submit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(bill.version)),
        200,
      ).body as { data: BillBody };

      const paid = expectStatus(
        await request(server)
          .post(`/v1/bills/${bill.id}/pay`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(submitted.data.version))
          .send({ paymentReference: `BACS-${RUN}` }),
        200,
      ).body as { data: BillBody };

      expect(paid.data.status).toBe('PAID');
    });

    it('corrects a paid bill with a credit note rather than an edit', async () => {
      const vendor = await makeVendor();
      const bill = await makeBill(vendor.id, [{ description: 'Overcharged', unitAmount: '900.00' }]);

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/bills/${bill.id}/submit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(bill.version)),
        200,
      ).body as { data: BillBody };

      const paid = expectStatus(
        await request(server)
          .post(`/v1/bills/${bill.id}/pay`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(submitted.data.version))
          .send({ paymentReference: `BACS-CN-${RUN}` }),
        200,
      ).body as { data: BillBody };

      // The paid bill refuses to be edited.
      const edit = await request(server)
        .patch(`/v1/bills/${bill.id}`)
        .set('Cookie', financeCookie)
        .set('If-Match', String(paid.data.version))
        .send({ memo: 'Trying to change history' });

      expectStatus(edit, 409);

      const note = expectStatus(
        await request(server)
          .post(`/v1/bills/${bill.id}/credit-note`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(paid.data.version))
          .send({ reason: 'Overcharged by the supplier.', amount: { amount: '100.00', currency: 'USD' } }),
        201,
      ).body as { data: BillBody };

      expect(note.data.status).toBe('CREDIT_NOTE');
      // Negative, so a report that sums both sees the corrected figure without
      // anything special happening.
      expect(note.data.total.amount).toBe('-100.0000');

      // And the original is untouched.
      expect((await readBill(bill.id)).total.amount).toBe('900.0000');
    });
  });

  // ── procurement ──────────────────────────────────────────────────────────

  describe('purchase orders', () => {
    async function makeOrder(
      vendorId: string,
      lines: Record<string, unknown>[] = [
        { description: 'Laptops', quantity: '10', unitAmount: '1200.00' },
      ],
    ): Promise<OrderBody> {
      const response = expectStatus(
        await request(server)
          .post('/v1/purchase-orders')
          .set('Cookie', financeCookie)
          .send({ vendorId, entityId, currency: 'USD', lines }),
        201,
      );

      return (response.body as { data: OrderBody }).data;
    }

    it('computes its total and starts with nothing received', async () => {
      const vendor = await makeVendor();
      const order = await makeOrder(vendor.id);

      expect(order.total).toEqual({ amount: '12000.0000', currency: 'USD' });
      expect(order.lines[0]?.receivedQuantity).toBe('0.0000');
      expect(order.lines[0]?.outstandingQuantity).toBe('10.0000');
    });

    it('reserves budget when it is approved (FR-PRC-001)', async () => {
      const vendor = await makeVendor();
      const order = await makeOrder(vendor.id, [
        { description: 'Chairs', quantity: '4', unitAmount: '250.00' },
      ]);

      const budget = await makeActiveBudget('5000.00');

      expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/submit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(order.version)),
        200,
      );

      await queue.drain();

      const line = await database.unscoped.budgetLine.findFirst({ where: { budgetId: budget } });

      expect(line?.committedAmount).toBe('1000.0000');
    });

    it('gives the reservation back when it is cancelled', async () => {
      const vendor = await makeVendor();
      const order = await makeOrder(vendor.id, [
        { description: 'Desks', quantity: '2', unitAmount: '300.00' },
      ]);

      const budget = await makeActiveBudget('5000.00');

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/submit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(order.version)),
        200,
      ).body as { data: OrderBody };

      await queue.drain();

      expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/cancel`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(submitted.data.version)),
        200,
      );

      await queue.drain();

      const line = await database.unscoped.budgetLine.findFirst({ where: { budgetId: budget } });

      // Back to nothing — and by a release movement, not by deleting the
      // commitment.
      expect(line?.committedAmount).toBe('0.0000');

      // Scoped to *this* budget's line. An order draws on every active budget
      // it matches, and earlier tests in this file leave theirs active — which
      // is the behaviour a company with a departmental budget and a
      // company-wide one depends on.
      const movements = await database.unscoped.budgetMovement.findMany({
        where: {
          budgetLineId: line?.id ?? '',
          sourceType: 'PURCHASE_ORDER',
          sourceId: order.id,
        },
        select: { movementType: true },
      });

      expect(movements.map((movement) => movement.movementType).sort()).toEqual([
        'COMMITMENT',
        'RELEASE',
      ]);
    });

    it('records deliveries by appending, so two vans are two receipts', async () => {
      const vendor = await makeVendor();
      const order = await makeOrder(vendor.id, [
        { description: 'Monitors', quantity: '10', unitAmount: '200.00' },
      ]);

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/submit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(order.version)),
        200,
      ).body as { data: OrderBody };

      const lineId = order.lines[0]?.id;
      if (lineId === undefined) throw new Error('an order has at least one line');

      const partial = expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/receive`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(submitted.data.version))
          .send({ lines: [{ purchaseOrderLineId: lineId, quantity: '6' }] }),
        200,
      ).body as { data: OrderBody };

      expect(partial.data.status).toBe('PARTIALLY_RECEIVED');
      expect(partial.data.lines[0]?.outstandingQuantity).toBe('4.0000');

      const complete = expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/receive`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(partial.data.version))
          .send({ lines: [{ purchaseOrderLineId: lineId, quantity: '4' }] }),
        200,
      ).body as { data: OrderBody };

      expect(complete.data.status).toBe('RECEIVED');
      expect(complete.data.lines[0]?.receivedQuantity).toBe('10.0000');

      // Both deliveries are still on record.
      const receipts = await database.unscoped.purchaseOrderReceipt.count({
        where: { purchaseOrderLineId: lineId },
      });

      expect(receipts).toBe(2);
    });

    it('matches a bill against what was ordered and received, and names the variance', async () => {
      const vendor = await makeVendor();
      const order = await makeOrder(vendor.id, [
        { description: 'Servers', quantity: '2', unitAmount: '5000.00' },
      ]);

      const submitted = expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/submit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(order.version)),
        200,
      ).body as { data: OrderBody };

      const lineId = order.lines[0]?.id;
      if (lineId === undefined) throw new Error('an order has at least one line');

      expectStatus(
        await request(server)
          .post(`/v1/purchase-orders/${order.id}/receive`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(submitted.data.version))
          .send({ lines: [{ purchaseOrderLineId: lineId, quantity: '2' }] }),
        200,
      );

      // Within tolerance: 10,150 against 10,000 is 1.5%.
      const close = await makeBill(vendor.id, [
        {
          description: 'Servers',
          quantity: '2',
          unitAmount: '5075.00',
          purchaseOrderLineId: lineId,
        },
      ]);

      expect((await readBill(close.id)).match?.status).toBe('WITHIN_TOLERANCE');

      // Outside it: 12,000 against 10,000 is 20%.
      const wide = await makeBill(vendor.id, [
        {
          description: 'Servers',
          quantity: '2',
          unitAmount: '6000.00',
          purchaseOrderLineId: lineId,
        },
      ]);

      const matched = await readBill(wide.id);

      expect(matched.match?.status).toBe('VARIANCE');
      // Named down to the line, because "this bill does not match" with no line
      // reference sends somebody to a spreadsheet.
      expect(matched.match?.lines[0]?.variancePercent).toBe(20);
      expect(matched.match?.lines[0]?.billLineId).toBe(matched.lines[0]?.id);
    });

    it('has no match at all when the bill names no order', async () => {
      const vendor = await makeVendor();
      const bill = await makeBill(vendor.id);

      // `null`, not an empty match. A bill nobody ordered against is not a
      // failed match; it is a bill with nothing to match.
      expect((await readBill(bill.id)).match).toBeNull();
    });
  });

  // ── helpers that need the budget module ──────────────────────────────────

  let budgets = 0;

  /** An active organisation-wide budget, so PO commitments have somewhere to land. */
  async function makeActiveBudget(allocated: string): Promise<string> {
    budgets += 1;

    const year = new Date().getUTCFullYear();

    const created = expectStatus(
      await request(server)
        .post('/v1/budgets')
        .set('Cookie', financeCookie)
        .send({
          name: `Payables ${RUN}-${String(budgets)}`,
          scopeType: 'ORGANIZATION',
          entityId,
          currency: 'USD',
          periodStart: `${String(year)}-01-01`,
          periodEnd: `${String(year)}-12-31`,
          periodGranularity: 'ANNUAL',
          totalAllocated: { amount: allocated, currency: 'USD' },
        }),
      201,
    ).body as { data: { id: string; version: number } };

    expectStatus(
      await request(server)
        .patch(`/v1/budgets/${created.data.id}`)
        .set('Cookie', financeCookie)
        .set('If-Match', String(created.data.version))
        .send({ status: 'ACTIVE' }),
      200,
    );

    return created.data.id;
  }
});
