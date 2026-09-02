import type { Server } from 'node:http';

import { Money } from '@financy/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { BudgetLedgerService } from '../src/modules/budgets/index.js';
import { DatabaseService } from '../src/platform/database/index.js';
import { runWithContext } from '../src/platform/request-context/index.js';

/**
 * Budgets, end to end (Epic 4.1).
 *
 * The properties here are the ones that only exist when a real database is
 * doing the arbitration, and every one of them is a way a budget silently goes
 * wrong in production rather than a way it fails loudly in review:
 *
 * - **The ledger and the balances agree, always** (FR-BDG-003). The invariant
 *   test re-sums every movement and compares. This is the assertion that makes
 *   it safe to read the materialised numbers on the hot path.
 * - **Fifty simultaneous commitments produce fifty movements and one correct
 *   balance** (FR-BDG-004). MongoDB has no `SELECT ... FOR UPDATE`, so this is
 *   the test that says the version-guard-plus-retry substitute actually works.
 * - **A replayed commitment does nothing** — the unique index is the
 *   idempotency, and a retried job is the ordinary case, not the exception.
 * - **Posting releases the commitment it replaces, atomically** (FR-TXN-008),
 *   because the failure mode is a budget that reads as twice as spent.
 * - **A threshold announces itself once** (FR-BDG-006), including across a
 *   release and a re-crossing. An alert that repeats is an alert people filter.
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

function errorCode(response: request.Response): string {
  return (response.body as { error: { code: string } }).error.code;
}

interface BudgetBody {
  id: string;
  status: string;
  version: number;
  currency: string;
  totals: {
    allocated: { amount: string };
    committed: { amount: string };
    actual: { amount: string };
    remaining: { amount: string };
    utilization: number | null;
  };
  lines: {
    id: string;
    version: number;
    allocated: { amount: string };
    committed: { amount: string };
    actual: { amount: string };
    remaining: { amount: string };
    utilization: number | null;
  }[];
}

describeWithDatabase('budgets', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let ledger: BudgetLedgerService;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let stranger: { cookie: string; organizationId: string };
  /** Budgets are FINANCE_ADMIN's to manage — ORG_ADMIN can read them and no more. */
  let financeCookie: string;
  let employeeCookie: string;
  let entityId: string;
  let departmentId: string;

  /** The day every movement in this suite happens on, and the period it lands in. */
  const YEAR = new Date().getUTCFullYear();
  const PERIOD_START = `${String(YEAR)}-01-01`;
  const PERIOD_END = `${String(YEAR)}-12-31`;
  const OCCURRED = new Date(Date.UTC(YEAR, 5, 15));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    ledger = app.get(BudgetLedgerService);

    owner = await register('owner');
    stranger = await register('stranger');

    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', owner.cookie),
      200,
    );
    const first = (entities.body as { data: { id: string }[] }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;

    const department = expectStatus(
      await request(server)
        .post('/v1/departments')
        .set('Cookie', owner.cookie)
        .send({ name: `Design ${RUN}` }),
      201,
    );
    departmentId = (department.body as { data: { id: string } }).data.id;

    financeCookie = await addMember('FINANCE_ADMIN', 'Grace Finance');
    employeeCookie = await addMember('EMPLOYEE', 'Sam Employee');
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
          organizationName: `Budgets ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `budgets-${name}-${RUN}@budgets.test`,
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
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@budgets.test`;

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

  let created = 0;

  /** The department the current budget is drawn around — see `makeBudget`. */
  let scopeDepartmentId: string;

  /** An active, annual budget over a department of its own, with a known allocation. */
  async function makeBudget(
    allocated: string,
    options: {
      overspendBehavior?: 'WARN' | 'REQUIRE_APPROVAL' | 'BLOCK';
      alertThresholds?: number[];
      granularity?: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
    } = {},
  ): Promise<BudgetBody> {
    created += 1;

    const department = expectStatus(
      await request(server)
        .post('/v1/departments')
        .set('Cookie', owner.cookie)
        .send({ name: `Scope ${RUN}-${String(created)}` }),
      201,
    );

    scopeDepartmentId = (department.body as { data: { id: string } }).data.id;

    const response = expectStatus(
      await request(server)
        .post('/v1/budgets')
        .set('Cookie', financeCookie)
        .send({
          name: `Design ${RUN}-${String(created)}`,
          scopeType: 'DEPARTMENT',
          scopeId: scopeDepartmentId,
          entityId,
          currency: 'USD',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          periodGranularity: options.granularity ?? 'ANNUAL',
          overspendBehavior: options.overspendBehavior ?? 'WARN',
          ...(options.alertThresholds === undefined
            ? {}
            : { alertThresholds: options.alertThresholds }),
          totalAllocated: { amount: allocated, currency: 'USD' },
        }),
      201,
    );

    const budget = (response.body as { data: BudgetBody }).data;

    return activate(budget);
  }

  async function activate(budget: BudgetBody): Promise<BudgetBody> {
    const response = expectStatus(
      await request(server)
        .patch(`/v1/budgets/${budget.id}`)
        .set('Cookie', financeCookie)
        .set('If-Match', String(budget.version))
        .send({ status: 'ACTIVE' }),
      200,
    );

    return (response.body as { data: BudgetBody }).data;
  }

  async function read(id: string): Promise<BudgetBody> {
    const response = expectStatus(
      await request(server).get(`/v1/budgets/${id}`).set('Cookie', owner.cookie),
      200,
    );

    return (response.body as { data: BudgetBody }).data;
  }

  /** Run a ledger call as the owner, the way a request would. */
  async function asOwner<T>(operation: () => Promise<T>): Promise<T> {
    return runWithContext(
      {
        correlationId: `budget-test-${RUN}`,
        organizationId: owner.organizationId,
        membershipId: owner.membershipId,
        startedAt: Date.now(),
      },
      operation,
    );
  }

  function coordinates(amount: string): {
    entityId: string;
    departmentId: string;
    occurredAt: Date;
    amount: Money;
  } {
    return {
      entityId,
      departmentId: scopeDepartmentId,
      occurredAt: OCCURRED,
      amount: Money.of(amount, 'USD'),
    };
  }

  /**
   * The invariant, re-derived from the ledger (FR-BDG-003).
   *
   * Runs after the movements each test makes rather than once at the end, so a
   * failure names the operation that broke it.
   */
  async function assertLedgerMatches(budgetId: string): Promise<void> {
    const lines = await database.unscoped.budgetLine.findMany({ where: { budgetId } });

    for (const line of lines) {
      const movements = await database.unscoped.budgetMovement.findMany({
        where: { budgetLineId: line.id },
      });

      const sumOf = (types: string[]): Money =>
        movements
          .filter((movement) => types.includes(movement.movementType))
          .reduce((total, movement) => {
            const amount = Money.of(movement.amount, movement.currency);
            return movement.direction === 'INCREASE' ? total.add(amount) : total.subtract(amount);
          }, Money.zero(line.currency));

      expect(sumOf(['COMMITMENT', 'RELEASE']).toJSON().amount).toBe(line.committedAmount);
      expect(sumOf(['ACTUAL']).toJSON().amount).toBe(line.actualAmount);
    }
  }

  // ── creation and shape ───────────────────────────────────────────────────

  describe('creating one', () => {
    /**
     * The regression this exists for.
     *
     * The first version of the list filtered on `archivedAt: null`. On MongoDB
     * an optional field that was never written is **absent**, and Prisma's
     * `null` filter does not match absent (ADR-0017) — so the predicate matched
     * nothing, every budget screen was empty, and the rows were perfectly fine
     * the whole time. It was found by looking at a seeded demo, not by a test,
     * which is why there is now a test.
     */
    it('lists a budget that has just been created', async () => {
      const budget = await makeBudget('1000.00');

      const listed = expectStatus(
        await request(server).get('/v1/budgets').set('Cookie', owner.cookie),
        200,
      ).body as { data: { id: string }[] };

      expect(listed.data.some((row) => row.id === budget.id)).toBe(true);
    });

    it('cuts the range into periods and spreads the allocation across them', async () => {
      const response = expectStatus(
        await request(server)
          .post('/v1/budgets')
          .set('Cookie', financeCookie)
          .send({
            name: `Monthly ${RUN}`,
            scopeType: 'DEPARTMENT',
            scopeId: departmentId,
            entityId,
            currency: 'USD',
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
            periodGranularity: 'MONTHLY',
            totalAllocated: { amount: '12000.00', currency: 'USD' },
          }),
        201,
      );

      const budget = (response.body as { data: BudgetBody }).data;

      expect(budget.lines).toHaveLength(12);
      expect(budget.totals.allocated.amount).toBe('12000.0000');
      // Evenly, and exactly: nothing is lost between the periods.
      expect(budget.lines.every((line) => line.allocated.amount === '1000.0000')).toBe(true);
    });

    it('refuses a budget drawn around something that does not exist', async () => {
      const response = await request(server)
        .post('/v1/budgets')
        .set('Cookie', financeCookie)
        .send({
          name: `Ghost ${RUN}`,
          scopeType: 'DEPARTMENT',
          scopeId: '01a00000-0000-7000-8000-000000000000',
          entityId,
          currency: 'USD',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
        });

      expectStatus(response, 422);
      expect(errorCode(response)).toBe('VALIDATION_FAILED');
    });

    it('refuses a scoped budget with no scope, and a whole-organisation one with a scope', async () => {
      const missing = await request(server)
        .post('/v1/budgets')
        .set('Cookie', financeCookie)
        .send({
          name: `Unscoped ${RUN}`,
          scopeType: 'DEPARTMENT',
          entityId,
          currency: 'USD',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
        });

      expectStatus(missing, 422);

      const extra = await request(server)
        .post('/v1/budgets')
        .set('Cookie', financeCookie)
        .send({
          name: `Overscoped ${RUN}`,
          scopeType: 'ORGANIZATION',
          scopeId: departmentId,
          entityId,
          currency: 'USD',
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
        });

      expectStatus(extra, 422);
    });

    it('refuses to read another organisation’s budget, as a 404', async () => {
      const budget = await makeBudget('1000.00');

      const response = await request(server)
        .get(`/v1/budgets/${budget.id}`)
        .set('Cookie', stranger.cookie);

      expectStatus(response, 404);
    });

    it('hides budgets from someone without the permission', async () => {
      const response = await request(server).get('/v1/budgets').set('Cookie', employeeCookie);

      expectStatus(response, 403);
    });
  });

  // ── the ledger ───────────────────────────────────────────────────────────

  describe('the ledger', () => {
    it('remaining is allocated minus committed minus actual', async () => {
      const budget = await makeBudget('1000.00');

      await asOwner(() =>
        ledger.commit(owner.organizationId, coordinates('300.00'), {
          type: 'SPEND_REQUEST',
          id: `sr-${RUN}-1`,
        }),
      );
      await asOwner(() =>
        ledger.actualize(owner.organizationId, coordinates('200.00'), {
          type: 'TRANSACTION',
          id: `txn-${RUN}-1`,
        }),
      );

      const after = await read(budget.id);

      expect(after.totals.committed.amount).toBe('300.0000');
      expect(after.totals.actual.amount).toBe('200.0000');
      expect(after.totals.remaining.amount).toBe('500.0000');
      expect(after.totals.utilization).toBe(50);

      await assertLedgerMatches(budget.id);
    });

    it('does nothing the second time the same commitment arrives', async () => {
      const budget = await makeBudget('1000.00');
      const source = { type: 'SPEND_REQUEST' as const, id: `sr-${RUN}-replay` };

      await asOwner(() => ledger.commit(owner.organizationId, coordinates('250.00'), source));
      await asOwner(() => ledger.commit(owner.organizationId, coordinates('250.00'), source));
      await asOwner(() => ledger.commit(owner.organizationId, coordinates('250.00'), source));

      const after = await read(budget.id);

      expect(after.totals.committed.amount).toBe('250.0000');
      await assertLedgerMatches(budget.id);
    });

    it('posting records the actual and releases what it had reserved, together', async () => {
      const budget = await makeBudget('1000.00');
      const source = { type: 'EXPENSE' as const, id: `exp-${RUN}-post` };

      await asOwner(() => ledger.commit(owner.organizationId, coordinates('400.00'), source));
      expect((await read(budget.id)).totals.committed.amount).toBe('400.0000');

      await asOwner(() => ledger.actualize(owner.organizationId, coordinates('400.00'), source));

      const after = await read(budget.id);

      // The money moved from reserved to spent. It was not counted twice.
      expect(after.totals.committed.amount).toBe('0.0000');
      expect(after.totals.actual.amount).toBe('400.0000');
      expect(after.totals.remaining.amount).toBe('600.0000');

      await assertLedgerMatches(budget.id);
    });

    it('releases a commitment as a movement rather than by deleting one', async () => {
      const budget = await makeBudget('1000.00');
      const source = { type: 'SPEND_REQUEST' as const, id: `sr-${RUN}-cancel` };

      await asOwner(() => ledger.commit(owner.organizationId, coordinates('600.00'), source));
      await asOwner(() => ledger.release(owner.organizationId, coordinates('600.00'), source));

      const after = await read(budget.id);
      expect(after.totals.committed.amount).toBe('0.0000');

      const movements = await database.unscoped.budgetMovement.findMany({
        where: { organizationId: owner.organizationId, sourceId: source.id },
      });

      // Both are still there. The history explains the balance.
      expect(movements.map((movement) => movement.movementType).sort()).toEqual([
        'COMMITMENT',
        'RELEASE',
      ]);

      await assertLedgerMatches(budget.id);
    });

    it('does not touch a budget in another currency', async () => {
      const budget = await makeBudget('1000.00');

      await asOwner(() =>
        ledger.commit(
          owner.organizationId,
          { ...coordinates('100.00'), amount: Money.of('100.00', 'EUR') },
          { type: 'SPEND_REQUEST', id: `sr-${RUN}-eur` },
        ),
      );

      // Converting here would put an FX rate inside a control. It matches
      // nothing instead.
      expect((await read(budget.id)).totals.committed.amount).toBe('0.0000');
    });

    it('does not touch a budget drawn around a different department', async () => {
      const budget = await makeBudget('1000.00');

      const other = expectStatus(
        await request(server)
          .post('/v1/departments')
          .set('Cookie', owner.cookie)
          .send({ name: `Sales ${RUN}` }),
        201,
      );

      await asOwner(() =>
        ledger.commit(
          owner.organizationId,
          {
            ...coordinates('100.00'),
            departmentId: (other.body as { data: { id: string } }).data.id,
          },
          { type: 'SPEND_REQUEST', id: `sr-${RUN}-other-dept` },
        ),
      );

      expect((await read(budget.id)).totals.committed.amount).toBe('0.0000');
    });
  });

  // ── concurrency (FR-BDG-004) ─────────────────────────────────────────────

  describe('under concurrency', () => {
    it('fifty simultaneous commitments produce fifty movements and one correct balance', async () => {
      const budget = await makeBudget('10000.00');
      const line = budget.lines[0];
      if (line === undefined) throw new Error('a budget has at least one line');

      await Promise.all(
        Array.from({ length: 50 }, (_unused, index) =>
          asOwner(() =>
            ledger.commit(owner.organizationId, coordinates('10.00'), {
              type: 'SPEND_REQUEST',
              id: `sr-${RUN}-concurrent-${String(index)}`,
            }),
          ),
        ),
      );

      const after = await read(budget.id);

      // Fifty × 10.00. Not 490, not 500.0001, not a number that depends on
      // which writer happened to read last.
      expect(after.totals.committed.amount).toBe('500.0000');

      const movements = await database.unscoped.budgetMovement.count({
        where: { budgetLineId: line.id, movementType: 'COMMITMENT' },
      });

      expect(movements).toBe(50);
      await assertLedgerMatches(budget.id);
    }, 120_000);
  });

  // ── allocation ───────────────────────────────────────────────────────────

  describe('allocating', () => {
    it('sets an absolute amount and records the change as an adjustment', async () => {
      const budget = await makeBudget('1000.00');
      const line = budget.lines[0];
      if (line === undefined) throw new Error('a budget has at least one line');

      const response = expectStatus(
        await request(server)
          .put(`/v1/budgets/${budget.id}/lines/${line.id}/allocation`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(line.version))
          .send({ amount: { amount: '1500.00', currency: 'USD' }, memo: 'Topped up for Q3.' }),
        200,
      );

      const after = (response.body as { data: BudgetBody }).data;
      expect(after.totals.allocated.amount).toBe('1500.0000');

      const adjustment = await database.unscoped.budgetMovement.findFirst({
        where: { budgetLineId: line.id, movementType: 'ADJUSTMENT' },
      });

      expect(adjustment?.amount).toBe('500.0000');
      expect(adjustment?.direction).toBe('INCREASE');
    });

    it('refuses a stale allocation rather than adding to it', async () => {
      const budget = await makeBudget('1000.00');
      const line = budget.lines[0];
      if (line === undefined) throw new Error('a budget has at least one line');

      expectStatus(
        await request(server)
          .put(`/v1/budgets/${budget.id}/lines/${line.id}/allocation`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(line.version))
          .send({ amount: { amount: '1500.00', currency: 'USD' } }),
        200,
      );

      const stale = await request(server)
        .put(`/v1/budgets/${budget.id}/lines/${line.id}/allocation`)
        .set('Cookie', financeCookie)
        .set('If-Match', String(line.version))
        .send({ amount: { amount: '2000.00', currency: 'USD' } });

      expectStatus(stale, 409);
      expect(errorCode(stale)).toBe('STALE_VERSION');

      // And the number is what the first write made it, not the sum of both.
      expect((await read(budget.id)).totals.allocated.amount).toBe('1500.0000');
    });

    it('refuses an allocation in the wrong currency', async () => {
      const budget = await makeBudget('1000.00');
      const line = budget.lines[0];
      if (line === undefined) throw new Error('a budget has at least one line');

      const response = await request(server)
        .put(`/v1/budgets/${budget.id}/lines/${line.id}/allocation`)
        .set('Cookie', financeCookie)
        .set('If-Match', String(line.version))
        .send({ amount: { amount: '100.00', currency: 'EUR' } });

      expectStatus(response, 422);
    });

    it('is refused to someone who can read budgets but not manage them', async () => {
      const budget = await makeBudget('1000.00');
      const line = budget.lines[0];
      if (line === undefined) throw new Error('a budget has at least one line');

      const response = await request(server)
        .put(`/v1/budgets/${budget.id}/lines/${line.id}/allocation`)
        .set('Cookie', employeeCookie)
        .set('If-Match', String(line.version))
        .send({ amount: { amount: '5.00', currency: 'USD' } });

      expectStatus(response, 403);
    });
  });

  // ── alerts (FR-BDG-006) ──────────────────────────────────────────────────

  describe('threshold alerts', () => {
    it('announces a crossing once, and not again when it is re-crossed', async () => {
      const budget = await makeBudget('1000.00', { alertThresholds: [75, 90, 100] });

      const first = await asOwner(() =>
        ledger.commit(owner.organizationId, coordinates('800.00'), {
          type: 'SPEND_REQUEST',
          id: `sr-${RUN}-alert-1`,
        }),
      );

      expect(first.map((crossing) => crossing.threshold)).toEqual([75]);

      // Back under, then over again. The same threshold has nothing new to say.
      await asOwner(() =>
        ledger.release(owner.organizationId, coordinates('800.00'), {
          type: 'SPEND_REQUEST',
          id: `sr-${RUN}-alert-1`,
        }),
      );

      const second = await asOwner(() =>
        ledger.commit(owner.organizationId, coordinates('800.00'), {
          type: 'SPEND_REQUEST',
          id: `sr-${RUN}-alert-2`,
        }),
      );

      expect(second).toEqual([]);
      await assertLedgerMatches(budget.id);
    });

    it('reports every threshold a single movement jumps past', async () => {
      const budget = await makeBudget('1000.00', { alertThresholds: [75, 90, 100] });

      const crossings = await asOwner(() =>
        ledger.commit(owner.organizationId, coordinates('1100.00'), {
          type: 'SPEND_REQUEST',
          id: `sr-${RUN}-alert-jump`,
        }),
      );

      expect(crossings.map((crossing) => crossing.threshold)).toEqual([75, 90, 100]);
      expect(crossings.every((crossing) => crossing.utilization === 110)).toBe(true);

      await assertLedgerMatches(budget.id);
    });
  });

  // ── positions, which is what policy and the spend path read ──────────────

  describe('positions', () => {
    it('says what is left and whether an amount would exceed it', async () => {
      const budget = await makeBudget('1000.00', { overspendBehavior: 'BLOCK' });

      await asOwner(() =>
        ledger.commit(owner.organizationId, coordinates('900.00'), {
          type: 'SPEND_REQUEST',
          id: `sr-${RUN}-position`,
        }),
      );

      const fits = await asOwner(() =>
        ledger.positions(owner.organizationId, coordinates('50.00')),
      );
      const doesNot = await asOwner(() =>
        ledger.positions(owner.organizationId, coordinates('200.00')),
      );

      const forBudget = (positions: { budgetId: string }[]): unknown =>
        positions.find((position) => position.budgetId === budget.id);

      expect(forBudget(fits)).toMatchObject({
        remaining: '100.0000',
        wouldExceed: false,
        overspendBehavior: 'BLOCK',
      });
      expect(forBudget(doesNot)).toMatchObject({ wouldExceed: true });
    });

    it('finds nothing for a budget that is still a draft', async () => {
      const response = expectStatus(
        await request(server)
          .post('/v1/budgets')
          .set('Cookie', financeCookie)
          .send({
            name: `Draft ${RUN}`,
            scopeType: 'DEPARTMENT',
            scopeId: scopeDepartmentId,
            entityId,
            currency: 'USD',
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
            totalAllocated: { amount: '500.00', currency: 'USD' },
          }),
        201,
      );

      const draft = (response.body as { data: BudgetBody }).data;

      const positions = await asOwner(() =>
        ledger.positions(owner.organizationId, coordinates('10.00')),
      );

      // A draft budget is a plan, not a control.
      expect(positions.some((position) => position.budgetId === draft.id)).toBe(false);
    });
  });

  // ── the movement log ─────────────────────────────────────────────────────

  it('shows the ledger behind the numbers', async () => {
    const budget = await makeBudget('1000.00');

    await asOwner(() =>
      ledger.commit(owner.organizationId, coordinates('100.00'), {
        type: 'SPEND_REQUEST',
        id: `sr-${RUN}-log`,
      }),
    );

    const response = expectStatus(
      await request(server)
        .get(`/v1/budgets/${budget.id}/movements`)
        .set('Cookie', owner.cookie),
      200,
    );

    const movements = (response.body as { data: { movementType: string }[] }).data;

    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ movementType: 'COMMITMENT' });
  });
});
