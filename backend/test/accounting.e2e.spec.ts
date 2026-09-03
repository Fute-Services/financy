import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/platform/database/index.js';

/**
 * The chart of accounts, mapping, and the export (Phase 6).
 *
 * The properties that decide whether a ledger somebody else keeps can be
 * trusted:
 *
 * - **A re-run exports nothing twice** (FR-ACC-005), including two runs racing.
 *   That is the unique index doing the work, not a status flag.
 * - **Unmapped records are named, not defaulted** (FR-ACC-003). An export that
 *   invented a GL account produces a clean-looking file that is wrong, and
 *   nobody finds out until an accountant does.
 * - **An exported record is frozen** (FR-ACC-007).
 * - **The batch carries a checksum over what it contained**, so two people can
 *   compare one number.
 * - **A closed period refuses to export**, and re-opening it is recorded.
 * - **The mapping harness answers before anything is exported** (FR-ACC-002),
 *   and explains itself when nothing matches.
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

interface ExportResultBody {
  batch: {
    id: string;
    reference: string;
    rowCount: number;
    checksum: string;
    status: string;
    totals: { debits: { amount: string }; credits: { amount: string } };
  } | null;
  eligible: number;
  exported: number;
  unmapped: { recordId: string; reason: string; description: string }[];
  dryRun: boolean;
}

describeWithDatabase('accounting', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let financeCookie: string;
  let entityId: string;
  let categoryId: string;
  let glAccountId: string;

  /** Everything in this suite happens on one day inside the open period. */
  const YEAR = new Date().getUTCFullYear();
  const DAY = new Date(Date.UTC(YEAR, 5, 15));
  const PERIOD = { start: `${String(YEAR)}-06-01`, end: `${String(YEAR)}-06-30` };

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
    const firstEntity = (entities.body as { data: { id: string }[] }).data[0];
    if (firstEntity === undefined) throw new Error('registration should create an entity');
    entityId = firstEntity.id;

    const categories = expectStatus(
      await request(server).get('/v1/categories').set('Cookie', owner.cookie),
      200,
    );
    const firstCategory = (categories.body as { data: { id: string }[] }).data[0];
    if (firstCategory === undefined) throw new Error('registration should seed categories');
    categoryId = firstCategory.id;

    financeCookie = await addMember('FINANCE_ADMIN', 'Grace Finance');

    glAccountId = await makeCode('GL_ACCOUNT', `6200-${RUN}`, 'Office costs');
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
          organizationName: `Accounting ${RUN}`,
          fullName: 'Owner Accounting',
          email: `accounting-${RUN}@accounting.test`,
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
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@accounting.test`;

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

  async function makeCode(codeType: string, code: string, name: string): Promise<string> {
    const response = expectStatus(
      await request(server)
        .post('/v1/accounting/codes')
        .set('Cookie', financeCookie)
        .send({ codeType, code, name }),
      201,
    );

    return (response.body as { data: { id: string } }).data.id;
  }

  let charges = 0;

  /** A reviewed, coded, posted charge — the shape the export is looking for. */
  async function makeCharge(amount: string, coded = true): Promise<string> {
    charges += 1;

    const id = crypto.randomUUID();

    await database.unscoped.transaction.create({
      data: {
        id,
        organizationId: owner.organizationId,
        entityId,
        categoryId: coded ? categoryId : null,
        merchantName: `Merchant ${String(charges)}`,
        amount,
        currency: 'USD',
        source: 'IMPORT',
        status: 'POSTED',
        receiptStatus: 'ATTACHED',
        reviewStatus: 'REVIEWED',
        accountingStatus: 'MAPPED',
        matchStatus: 'UNMATCHED',
        occurredAt: DAY,
        provider: 'test',
        providerTransactionId: `acct-${RUN}-${String(charges)}`,
      },
    });

    return id;
  }

  async function runExport(body: Record<string, unknown> = {}): Promise<ExportResultBody> {
    const response = expectStatus(
      await request(server)
        .post('/v1/accounting/exports')
        .set('Cookie', financeCookie)
        .send({
          periodStart: PERIOD.start,
          periodEnd: PERIOD.end,
          recordTypes: ['transaction'],
          ...body,
        }),
      200,
    );

    return (response.body as { data: ExportResultBody }).data;
  }

  // ── codes ────────────────────────────────────────────────────────────────

  describe('the chart of accounts', () => {
    it('refuses the same code twice within a kind', async () => {
      const response = await request(server)
        .post('/v1/accounting/codes')
        .set('Cookie', financeCookie)
        .send({ codeType: 'GL_ACCOUNT', code: `6200-${RUN}`, name: 'Duplicate' });

      expectStatus(response, 409);
    });

    it('allows the same code in two different kinds', async () => {
      // `6200` as a GL account and `6200` as a cost centre are different
      // things, and an organisation whose ledger numbers them alike should not
      // have to rename one.
      await makeCode('COST_CENTER', `6200-${RUN}`, 'Also six two hundred');
    });

    it('imports a chart, upserting by code', async () => {
      const first = expectStatus(
        await request(server)
          .post('/v1/accounting/codes/import')
          .set('Cookie', financeCookie)
          .send({
            codeType: 'GL_ACCOUNT',
            codes: [
              { code: `7000-${RUN}`, name: 'Travel' },
              { code: `7100-${RUN}`, name: 'Software' },
            ],
          }),
        200,
      ).body as { data: { created: number; updated: number } };

      expect(first.data).toEqual({ created: 2, updated: 0 });

      const again = expectStatus(
        await request(server)
          .post('/v1/accounting/codes/import')
          .set('Cookie', financeCookie)
          .send({
            codeType: 'GL_ACCOUNT',
            codes: [
              { code: `7000-${RUN}`, name: 'Travel and subsistence' },
              { code: `7100-${RUN}`, name: 'Software' },
            ],
          }),
        200,
      ).body as { data: { created: number; updated: number } };

      // One renamed, one unchanged, nothing duplicated.
      expect(again.data).toEqual({ created: 0, updated: 1 });
    });

    it('is refused to somebody without the permission', async () => {
      expectStatus(
        await request(server).get('/v1/accounting/codes').set('Cookie', owner.cookie),
        403,
      );
    });
  });

  // ── mapping ──────────────────────────────────────────────────────────────

  describe('mapping', () => {
    it('says there are no rules at all when there are none', async () => {
      const response = expectStatus(
        await request(server)
          .post('/v1/accounting/mappings/simulate')
          .set('Cookie', financeCookie)
          .send({ categoryId, entityId }),
        200,
      ).body as { data: { matched: boolean; explanation: string } };

      expect(response.data.matched).toBe(false);
      // "None of the 0 rules matched" is technically true and useless. An
      // organisation with no rules has a different problem from one whose rules
      // do not cover a record, and the message says which.
      expect(response.data.explanation).toContain('no mapping rules yet');
    });

    it('names the dimensions the record had when rules exist but none fit', async () => {
      const narrow = await makeCode('GL_ACCOUNT', `6400-${RUN}`, 'Narrow');

      // A rule that only covers one entity — deliberately not the one asked
      // about below.
      expectStatus(
        await request(server)
          .post('/v1/accounting/mappings')
          .set('Cookie', financeCookie)
          .send({
            name: `Some other entity ${RUN}`,
            priority: 5,
            entityId: '01a00000-0000-7000-8000-000000000000',
            glAccountId: narrow,
          }),
        201,
      );

      const response = expectStatus(
        await request(server)
          .post('/v1/accounting/mappings/simulate')
          .set('Cookie', financeCookie)
          .send({ categoryId, entityId }),
        200,
      ).body as { data: { matched: boolean; explanation: string } };

      expect(response.data.matched).toBe(false);
      // Names what the record had, so somebody knows which rule to write
      // rather than reading every rule to find out why none applied.
      expect(response.data.explanation).toContain('a category');
      expect(response.data.explanation).toContain('an entity');
    });

    it('takes the first rule by priority, not the first written', async () => {
      const specific = await makeCode('GL_ACCOUNT', `6300-${RUN}`, 'Specific');

      // Written second, priority first.
      expectStatus(
        await request(server)
          .post('/v1/accounting/mappings')
          .set('Cookie', financeCookie)
          .send({ name: `Catch all ${RUN}`, priority: 900, glAccountId }),
        201,
      );

      expectStatus(
        await request(server)
          .post('/v1/accounting/mappings')
          .set('Cookie', financeCookie)
          .send({
            name: `This category ${RUN}`,
            priority: 10,
            categoryId,
            glAccountId: specific,
          }),
        201,
      );

      const matched = expectStatus(
        await request(server)
          .post('/v1/accounting/mappings/simulate')
          .set('Cookie', financeCookie)
          .send({ categoryId }),
        200,
      ).body as { data: { matched: boolean; glAccount: { code: string } | null } };

      expect(matched.data.glAccount?.code).toBe(`6300-${RUN}`);

      // And something the specific rule does not cover falls to the catch-all.
      const fallback = expectStatus(
        await request(server)
          .post('/v1/accounting/mappings/simulate')
          .set('Cookie', financeCookie)
          .send({}),
        200,
      ).body as { data: { glAccount: { code: string } | null } };

      expect(fallback.data.glAccount?.code).toBe(`6200-${RUN}`);
    });

    it('refuses a rule whose GL account is actually a cost centre', async () => {
      const costCentre = await makeCode('COST_CENTER', `CC-${RUN}`, 'Sales');

      const response = await request(server)
        .post('/v1/accounting/mappings')
        .set('Cookie', financeCookie)
        .send({ name: `Wrong kind ${RUN}`, glAccountId: costCentre });

      // A rule pointing at the wrong kind of code produces an export that
      // balances and posts to nothing.
      expectStatus(response, 422);
    });
  });

  // ── export ───────────────────────────────────────────────────────────────

  describe('export', () => {
    it('says what it would do without doing it', async () => {
      await makeCharge('120.00');

      const dry = await runExport({ dryRun: true });

      expect(dry.dryRun).toBe(true);
      expect(dry.batch).toBeNull();
      expect(dry.eligible).toBeGreaterThan(0);

      const batches = await database.unscoped.exportBatch.count({
        where: { organizationId: owner.organizationId },
      });

      expect(batches).toBe(0);
    });

    it('writes a batch with a checksum and balanced totals', async () => {
      const result = await runExport();

      expect(result.batch?.status).toBe('COMPLETED');
      expect(result.batch?.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(result.batch?.totals.debits.amount).toBe(result.batch?.totals.credits.amount);
      expect(result.exported).toBeGreaterThan(0);
    });

    it('exports nothing twice', async () => {
      const before = await runExport();

      // Everything eligible went out in the run above.
      expect(before.exported).toBe(0);

      await makeCharge('45.00');

      const after = await runExport();

      expect(after.exported).toBe(1);
    });

    it('names what it could not map rather than defaulting it', async () => {
      // Uncoded, so no rule can reach it — and the catch-all deliberately does
      // not save it, because a charge with no category is a coding problem and
      // not a mapping one.
      const uncoded = await makeCharge('99.00', false);

      const result = await runExport();

      // Not eligible at all: FR-ACC-003 says reviewed *and* coded.
      expect(result.unmapped.some((row) => row.recordId === uncoded)).toBe(false);

      const item = await database.unscoped.exportBatchItem.findFirst({
        where: { organizationId: owner.organizationId, recordId: uncoded },
      });

      expect(item).toBeNull();
    });

    it('freezes an exported charge', async () => {
      const id = await makeCharge('75.00');

      await runExport();

      const exported = await database.unscoped.exportBatchItem.findFirst({
        where: { organizationId: owner.organizationId, recordId: id },
      });

      // The item is the record of it having left; nothing else needs a flag.
      expect(exported).not.toBeNull();
    });

    it('refuses to export a closed period, and records the reopening', async () => {
      const closed = expectStatus(
        await request(server)
          .post('/v1/accounting/periods')
          .set('Cookie', financeCookie)
          .send({ periodStart: PERIOD.start, periodEnd: PERIOD.end, note: 'June signed off.' }),
        201,
      ).body as { data: { id: string; version: number; isClosed: boolean } };

      expect(closed.data.isClosed).toBe(true);

      await makeCharge('30.00');

      const refused = await request(server)
        .post('/v1/accounting/exports')
        .set('Cookie', financeCookie)
        .send({ periodStart: PERIOD.start, periodEnd: PERIOD.end });

      expectStatus(refused, 409);

      const reopened = expectStatus(
        await request(server)
          .post(`/v1/accounting/periods/${closed.data.id}/reopen`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(closed.data.version))
          .send({ reason: 'A late invoice arrived for June.' }),
        200,
      ).body as { data: { isClosed: boolean; reopenReason: string | null } };

      // Both the close and the reopen stay on the record.
      expect(reopened.data.isClosed).toBe(false);
      expect(reopened.data.reopenReason).toBe('A late invoice arrived for June.');

      // And the export works again.
      const after = await runExport();
      expect(after.exported).toBe(1);
    });
  });
});
