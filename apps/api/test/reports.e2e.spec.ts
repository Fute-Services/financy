import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/platform/database/index.js';

/**
 * Reports, the dashboard, and export (Epics 4.2 to 4.4).
 *
 * What only the whole stack can prove:
 *
 * - **The totals are right**, against fixture data whose answer was worked out
 *   by hand. Every other property of a report is decoration around this one.
 * - **Currencies are never mixed, and the exclusion is stated.** A total that
 *   quietly dropped a third of the spend looks exactly like one that did not.
 * - **Scope is intersected, never replaced** (docs/15 §4). An employee running
 *   a company report sees their own spend, and a manager asking for a
 *   department that is not theirs gets nothing rather than an error that
 *   confirms it exists.
 * - **The export escapes formulas** and records the exact filters it ran with,
 *   because "what did that export contain?" is asked months later against data
 *   that has since changed.
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

interface ResultBody {
  key: string;
  rows: Record<string, unknown>[];
  totals: Record<string, unknown>;
  columns: { key: string; label: string; kind: string }[];
  excludedForCurrency: number;
  totalRows: number;
  currency: string | null;
  period: { from: string; to: string; label: string };
}

describeWithDatabase('reports', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let financeCookie: string;
  let employee: { cookie: string; membershipId: string };
  /** Heads Design, which is what makes their reports department-wide. */
  let manager: { cookie: string; membershipId: string };
  let entityId: string;
  let designId: string;
  let salesId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);

    owner = await register();

    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', owner.cookie),
      200,
    );
    const first = (entities.body as { data: { id: string }[] }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;

    designId = await addDepartment('Design');
    salesId = await addDepartment('Sales');

    financeCookie = (await addMember('FINANCE_ADMIN', 'Grace Finance')).cookie;
    employee = await addMember('EMPLOYEE', 'Sam Employee');
    manager = await addMember('MANAGER', 'Dana Manager');

    // Headship, not the role name, is what widens a report to a department.
    await database.unscoped.department.update({
      where: { id: designId },
      data: { headMembershipId: manager.membershipId },
    });

    await seedSpend();
  }, 300_000);

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
          organizationName: `Reports ${RUN}`,
          fullName: 'Owner Reports',
          email: `reports-${RUN}@reports.test`,
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

  async function addDepartment(name: string): Promise<string> {
    const response = expectStatus(
      await request(server)
        .post('/v1/departments')
        .set('Cookie', owner.cookie)
        .send({ name: `${name} ${RUN}` }),
      201,
    );

    return (response.body as { data: { id: string } }).data.id;
  }

  async function addMember(
    roleKey: string,
    fullName: string,
  ): Promise<{ cookie: string; membershipId: string }> {
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@reports.test`;

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

    return {
      cookie: (accepted.headers['set-cookie'] as unknown as string[])
        .map((value) => value.split(';')[0])
        .join('; '),
      membershipId: (accepted.body as { membership: { id: string } }).membership.id,
    };
  }

  /**
   * Known spend, with the answer worked out here rather than by the code
   * under test.
   *
   * Written directly to the database rather than through the import endpoint,
   * because this suite is about what reports say and not about how charges
   * arrive. Everything lands inside the current month so `MTD` covers it.
   */
  const today = new Date();
  const midMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), Math.min(today.getUTCDate(), 15)),
  );

  async function seedSpend(): Promise<void> {
    let sequence = 0;

    const charge = async (options: {
      amount: string;
      currency?: string;
      departmentId?: string | null;
      membershipId?: string | null;
      merchantName?: string;
      status?: 'PENDING' | 'POSTED';
      receiptStatus?: 'MISSING' | 'ATTACHED';
      categoryId?: string | null;
    }): Promise<void> => {
      sequence += 1;

      await database.unscoped.transaction.create({
        data: {
          id: crypto.randomUUID(),
          organizationId: owner.organizationId,
          entityId,
          departmentId: options.departmentId ?? null,
          categoryId: options.categoryId ?? null,
          memberMembershipId: options.membershipId ?? null,
          merchantName: options.merchantName ?? `Merchant ${String(sequence)}`,
          amount: options.amount,
          currency: options.currency ?? 'USD',
          source: 'IMPORT',
          status: options.status ?? 'POSTED',
          receiptStatus: options.receiptStatus ?? 'ATTACHED',
          reviewStatus: 'PENDING',
          accountingStatus: 'UNMAPPED',
          matchStatus: 'UNMATCHED',
          occurredAt: midMonth,
          provider: 'test',
          providerTransactionId: `reports-${RUN}-${String(sequence)}`,
        },
      });
    };

    // Design: 100 + 250 = 350. Sales: 400. Unassigned: 50. Total USD = 800.
    await charge({ amount: '100.0000', departmentId: designId, membershipId: owner.membershipId });
    await charge({
      amount: '250.0000',
      departmentId: designId,
      membershipId: employee.membershipId,
      receiptStatus: 'MISSING',
    });
    await charge({ amount: '400.0000', departmentId: salesId, membershipId: owner.membershipId });
    await charge({ amount: '50.0000', departmentId: null, membershipId: owner.membershipId });

    // Not counted: a pending authorisation may still be reversed.
    await charge({ amount: '999.0000', departmentId: designId, status: 'PENDING' });

    // Not counted in a USD report, and reported as excluded.
    await charge({ amount: '77.0000', currency: 'EUR', departmentId: designId });

    // A merchant name that is a live formula in a spreadsheet.
    await charge({
      amount: '25.0000',
      departmentId: salesId,
      membershipId: owner.membershipId,
      merchantName: '=HYPERLINK("http://evil","Click")',
    });
  }

  async function run(
    key: string,
    cookie: string,
    query: Record<string, string> = {},
  ): Promise<ResultBody> {
    const response = expectStatus(
      await request(server).get(`/v1/reports/${key}`).set('Cookie', cookie).query(query),
      200,
    );

    return (response.body as { data: ResultBody }).data;
  }

  // ── the catalogue ────────────────────────────────────────────────────────

  it('lists every report and marks the ones this caller cannot run', async () => {
    const response = expectStatus(
      await request(server).get('/v1/reports').set('Cookie', owner.cookie),
      200,
    );

    const reports = (response.body as { data: { key: string; available: boolean }[] }).data;

    expect(reports.length).toBeGreaterThanOrEqual(11);
    // The owner can see budgets but not manage them, so budget-vs-actual is
    // available; `available` reflects the grant, not the role's name.
    expect(reports.find((report) => report.key === 'budget-vs-actual')?.available).toBe(true);
  });

  it('refuses a report whose own permission the caller lacks', async () => {
    // `report:read` opens the door; the report's own permission decides.
    const response = await request(server)
      .get('/v1/reports/spend-total')
      .set('Cookie', employee.cookie);

    expectStatus(response, 403);
  });

  it('answers 404 for a report key that does not exist', async () => {
    expectStatus(
      await request(server).get('/v1/reports/not-a-report').set('Cookie', owner.cookie),
      404,
    );
  });

  // ── correctness ──────────────────────────────────────────────────────────

  describe('totals', () => {
    it('adds up posted spend in the report currency and says what it excluded', async () => {
      const result = await run('spend-total', owner.cookie);

      // 100 + 250 + 400 + 50 + 25. Not the 999 pending, not the 77 in euros.
      expect(result.totals['amount']).toEqual({ amount: '825.0000', currency: 'USD' });
      expect(result.totals['transactions']).toBe(5);
      expect(result.excludedForCurrency).toBe(1);
      expect(result.currency).toBe('USD');
    });

    it('groups by department, largest first, with unassigned as its own row', async () => {
      const result = await run('spend-by-department', owner.cookie);

      const amounts = result.rows.map((row) => [row['name'], row['amount']]);

      expect(amounts[0]).toEqual([`Sales ${RUN}`, { amount: '425.0000', currency: 'USD' }]);
      expect(amounts[1]).toEqual([`Design ${RUN}`, { amount: '350.0000', currency: 'USD' }]);
      // Not dropped: a report that omitted it would total less than the bank.
      expect(amounts[2]).toEqual(['Unassigned', { amount: '50.0000', currency: 'USD' }]);
      expect(result.totals['amount']).toEqual({ amount: '825.0000', currency: 'USD' });
    });

    it('carries its own totals so a client never adds anything up', async () => {
      const result = await run('spend-by-department', owner.cookie, { pageSize: '1' });

      // One row returned, and the total still covers all three.
      expect(result.rows).toHaveLength(1);
      expect(result.totals['amount']).toEqual({ amount: '825.0000', currency: 'USD' });
      expect(result.totalRows).toBe(3);
    });

    it('finds the charges that are blocking a close', async () => {
      const [uncategorised, receipts] = await Promise.all([
        run('uncategorised-transactions', owner.cookie),
        run('missing-receipts', owner.cookie),
      ]);

      // Every seeded charge is uncategorised; exactly one has no receipt.
      expect(Number(uncategorised.totals['records'])).toBeGreaterThanOrEqual(5);
      expect(receipts.totals['records']).toBe(1);
      expect(receipts.rows[0]?.['whose']).toBe('Sam Employee');
    });
  });

  // ── scope ────────────────────────────────────────────────────────────────

  describe('scope', () => {
    it('shows a department head their department and nothing beyond it', async () => {
      const wide = await run('spend-total', financeCookie);
      const narrow = await run('spend-total', manager.cookie);

      expect(wide.totals['amount']).toEqual({ amount: '825.0000', currency: 'USD' });
      // Design's 100 + 250. Not Sales' 425, and not the unassigned 50.
      expect(narrow.totals['amount']).toEqual({ amount: '350.0000', currency: 'USD' });
    });

    it('intersects a requested department with the allowed one, in that direction', async () => {
      const result = await run('spend-by-department', manager.cookie, {
        departmentIds: salesId,
      });

      // Empty, not an error. An error would confirm that Sales exists and that
      // this person is outside it, which is an organisation chart anybody
      // patient can assemble from a series of them.
      expect(result.rows).toHaveLength(0);
      expect(result.totals['amount']).toEqual({ amount: '0.0000', currency: 'USD' });
    });

    it('refuses a report to somebody with no report permission at all', async () => {
      expectStatus(
        await request(server).get('/v1/reports/spend-total').set('Cookie', employee.cookie),
        403,
      );
    });
  });

  // ── export ───────────────────────────────────────────────────────────────

  describe('export', () => {
    it('escapes a merchant name that is a spreadsheet formula', async () => {
      const response = expectStatus(
        await request(server)
          .get('/v1/reports/spend-by-vendor/export')
          .set('Cookie', financeCookie),
        200,
      );

      const body = response.text;

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('spend-by-vendor-');
      // Present, and inert: the leading apostrophe is what makes Excel read it
      // as text rather than running it.
      expect(body).toContain('HYPERLINK');
      expect(body).not.toContain(',=HYPERLINK');
      expect(body).toContain("'=HYPERLINK");
    });

    it('records the exact filter set it ran with', async () => {
      await request(server)
        .get('/v1/reports/spend-by-department/export')
        .set('Cookie', financeCookie)
        .query({ datePreset: 'YTD', currency: 'USD' })
        .expect(200);

      const event = await database.unscoped.auditEvent.findFirst({
        where: {
          organizationId: owner.organizationId,
          action: 'report.exported',
          resourceId: 'spend-by-department',
        },
        orderBy: { createdAt: 'desc' },
      });

      const metadata = event?.metadata as
        | { filters?: { datePreset?: string; currency?: string }; rowCount?: number }
        | undefined;

      // Not merely "an export happened": what it contained, months later,
      // against data that has since changed.
      expect(metadata?.filters?.datePreset).toBe('YTD');
      expect(metadata?.filters?.currency).toBe('USD');
      expect(metadata?.rowCount).toBe(3);
    });

    it('is refused to somebody who can read a report but not export it', async () => {
      // The owner holds `report:export`; the employee holds neither.
      expectStatus(
        await request(server)
          .get('/v1/reports/spend-total/export')
          .set('Cookie', employee.cookie),
        403,
      );
    });
  });

  // ── the dashboard ────────────────────────────────────────────────────────

  describe('the dashboard', () => {
    it('gives finance the organisation and an employee their own', async () => {
      const wide = expectStatus(
        await request(server).get('/v1/dashboard').set('Cookie', financeCookie),
        200,
      ).body as { data: { scope: string; spendMonthToDate: { amount: string } } };

      const narrow = expectStatus(
        await request(server).get('/v1/dashboard').set('Cookie', employee.cookie),
        200,
      ).body as {
        data: { scope: string; spendMonthToDate: { amount: string }; missingReceipts: number };
      };

      expect(wide.data.scope).toBe('ORGANIZATION');
      expect(wide.data.spendMonthToDate.amount).toBe('825.0000');

      // Not the organisation's figure with most of it hidden — the employee's
      // endpoint returns the employee's data.
      expect(narrow.data.scope).toBe('OWN');
      expect(narrow.data.spendMonthToDate.amount).toBe('250.0000');
      expect(narrow.data.missingReceipts).toBe(1);
    });

    it('returns a point per month, including the quiet ones', async () => {
      const response = expectStatus(
        await request(server).get('/v1/dashboard').set('Cookie', financeCookie),
        200,
      ).body as { data: { trend: { label: string; amount: { amount: string } }[] } };

      // Six months, and a month with no spend is a zero rather than a gap —
      // otherwise the line draws a quiet August straight through to September.
      expect(response.data.trend).toHaveLength(6);
      expect(response.data.trend.at(-1)?.amount.amount).toBe('825.0000');
    });
  });
});
