import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * Cards and transactions, end to end (Epic 2.4).
 *
 * The properties worth a real database are the ones that only exist when the
 * schema, the permission matrix, and concurrency are all in play at once:
 *
 * - **No response carries a card number.** Asserted against the serialised
 *   body rather than field by field, because the failure this guards against
 *   is a field somebody adds later without thinking about it.
 * - **Issuing a card and raising its limit are different powers.** The
 *   organisation admin who can issue one cannot raise it; that separation is
 *   in `docs/03 §3` and would be invisible if nothing exercised it.
 * - **Termination is permanent.** Every transition out of it is refused, which
 *   is what makes the word mean what it says.
 * - **Import is idempotent on the provider's identifier**, reports per row,
 *   and one bad row does not take the good ones with it.
 * - **Posted money is immutable.** The amount cannot be edited by any route;
 *   a correction is a new adjustment row and the original figure survives it.
 * - **Scope is decided by the server.** Somebody without
 *   `transaction:read_all` sees their own charges whatever they ask for.
 */
const HAS_DATABASE =
  (process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL']) !== undefined;

const describeWithDatabase = HAS_DATABASE ? describe : describe.skip;

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const JOINER_PASSWORD = 'another-correct-horse-staple';

interface Session {
  cookie: string;
  organizationId: string;
  membershipId: string;
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

function errorCode(response: request.Response): string {
  return (response.body as { error: { code: string } }).error.code;
}

describeWithDatabase('cards and transactions', () => {
  let app: INestApplication;
  let server: Server;

  /** The registering account, which is an `ORG_ADMIN`. */
  let owner: Session;
  let financeCookie: string;
  let employee: { cookie: string; membershipId: string };
  let stranger: Session;

  let entityId: string;
  let categoryId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer() as Server;

    owner = await register('holder');
    stranger = await register('stranger');

    entityId = await firstEntity(owner.cookie);

    financeCookie = await addMember('FINANCE_ADMIN', 'Grace Finance');
    employee = await addMemberWithId('EMPLOYEE', 'Sam Employee');

    const categories = expectStatus(
      await request(server).get('/v1/categories').set('Cookie', owner.cookie),
      200,
    );

    const firstCategory = (categories.body as { data: Array<{ id: string }> }).data[0];
    if (firstCategory === undefined) throw new Error('registration should seed categories');
    categoryId = firstCategory.id;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
  });

  // ── harness ──────────────────────────────────────────────────────────────

  async function register(name: string): Promise<Session> {
    const response = expectStatus(
      await request(server)
        .post('/v1/auth/register')
        .send({
          organizationName: `Cards ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `cards-${name}-${RUN}@cards.test`,
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

  async function firstEntity(cookie: string): Promise<string> {
    const entities = expectStatus(
      await request(server).get('/v1/entities').set('Cookie', cookie),
      200,
    );

    const first = (entities.body as { data: Array<{ id: string }> }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');

    return first.id;
  }

  async function addMemberWithId(
    roleKey: string,
    fullName: string,
  ): Promise<{ cookie: string; membershipId: string }> {
    const email = `${fullName.toLowerCase().replace(/\s+/g, '-')}-${RUN}@cards.test`;

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

  async function addMember(roleKey: string, fullName: string): Promise<string> {
    return (await addMemberWithId(roleKey, fullName)).cookie;
  }

  interface CardBody {
    id: string;
    status: string;
    version: number;
    lastFour: string | null;
    limit: { amount: string; currency: string };
    limitPeriod: string;
    limitHistory: Array<{ amount: string; reason: string | null; setBy: string | null }>;
    spentInPeriod: { amount: string; currency: string };
    transactionCount: number;
  }

  async function issueCard(
    name: string,
    holderMembershipId: string = owner.membershipId,
    limit = '2000.00',
  ): Promise<CardBody> {
    const response = expectStatus(
      await request(server)
        .post('/v1/cards')
        .set('Cookie', owner.cookie)
        .send({
          name,
          cardType: 'VIRTUAL',
          holderMembershipId,
          entityId,
          limit: { amount: limit, currency: 'USD' },
          limitPeriod: 'MONTHLY',
        }),
      201,
    );

    return (response.body as { data: CardBody }).data;
  }

  interface TransactionBody {
    id: string;
    version: number;
    status: string;
    reviewStatus: string;
    accountingStatus: string;
    matchStatus: string;
    amount: { amount: string; currency: string };
    spendRequestId: string | null;
    adjustments: Array<{ adjustmentType: string; amount: { amount: string } }>;
  }

  interface ImportBody {
    imported: number;
    skipped: number;
    failed: number;
    matched: number;
    rows: Array<{
      index: number;
      outcome: string;
      transactionId: string | null;
      matchedSpendRequestId: string | null;
      message: string | null;
    }>;
  }

  function importRow(reference: string, overrides: Record<string, unknown> = {}) {
    return {
      providerTransactionId: reference,
      entityId,
      merchantName: 'Blue Bottle Coffee',
      amount: { amount: '42.50', currency: 'USD' },
      occurredAt: new Date().toISOString(),
      status: 'POSTED',
      ...overrides,
    };
  }

  async function importRows(
    rows: Array<Record<string, unknown>>,
    options: { autoMatch?: boolean; provider?: string } = {},
  ): Promise<ImportBody> {
    const response = expectStatus(
      await request(server)
        .post('/v1/transactions/import')
        .set('Cookie', owner.cookie)
        .send({ provider: options.provider ?? 'acme-bank', rows, autoMatch: options.autoMatch }),
      200,
    );

    return (response.body as { data: ImportBody }).data;
  }

  async function readTransaction(id: string, cookie = owner.cookie): Promise<TransactionBody> {
    const response = expectStatus(
      await request(server).get(`/v1/transactions/${id}`).set('Cookie', cookie),
      200,
    );

    return (response.body as { data: TransactionBody }).data;
  }

  /** An approved request, which with no policy published is what submission produces. */
  async function approvedRequest(amount: string): Promise<string> {
    const created = expectStatus(
      await request(server)
        .post('/v1/spend-requests')
        .set('Cookie', owner.cookie)
        .send({
          amount: { amount, currency: 'USD' },
          entityId,
          purpose: 'A thing that was authorised in advance',
        }),
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

    const status = (submitted.body as { data: { status: string } }).data.status;
    if (status !== 'APPROVED') throw new Error(`expected an approved request, got ${status}`);

    return id;
  }

  // ── cards ────────────────────────────────────────────────────────────────

  describe('issuing a card', () => {
    it('returns enough to recognise the card and nothing anybody could spend with', async () => {
      const card = await issueCard('Marketing subscriptions');

      expect(card.status).toBe('ACTIVE');
      expect(card.lastFour).toMatch(/^\d{4}$/);

      // Asserted against the whole serialised body, not field by field. The
      // failure worth guarding against is a field somebody adds in six months
      // without thinking about what it carries.
      const wire = JSON.stringify(card);
      expect(wire).not.toMatch(/"pan"|"cvv"|"cardNumber"|"providerCardId"/i);
      // The mock provider's own number, which must never leave it.
      expect(wire).not.toMatch(/4[0-9]{15}/);
    });

    it('records the limit it was issued with as the first history row', async () => {
      const card = await issueCard('Opening limit');

      expect(card.limitHistory).toHaveLength(1);
      expect(card.limitHistory[0]?.amount).toBe('2000.0000');
      expect(card.limitHistory[0]?.reason).toBe('Issued with this limit.');
    });

    it('starts with nothing spent, computed rather than assumed', async () => {
      const card = await issueCard('Nothing spent yet');

      expect(card.spentInPeriod).toEqual({ amount: '0.0000', currency: 'USD' });
      expect(card.transactionCount).toBe(0);
    });

    it('refuses an entity belonging to another organisation, as a 404', async () => {
      const theirEntity = await firstEntity(stranger.cookie);

      // Not a 403: a distinguishable refusal would make the field a way to
      // test whether an id exists in somebody else's organisation.
      const response = expectStatus(
        await request(server)
          .post('/v1/cards')
          .set('Cookie', owner.cookie)
          .send({
            name: 'Somebody else’s entity',
            holderMembershipId: owner.membershipId,
            entityId: theirEntity,
            limit: { amount: '100.00', currency: 'USD' },
            limitPeriod: 'MONTHLY',
          }),
        404,
      );

      expect(errorCode(response)).toBe('RESOURCE_NOT_FOUND');
    });

    it('refuses a card with no limit period, because an amount alone cannot be enforced', async () => {
      expectStatus(
        await request(server)
          .post('/v1/cards')
          .set('Cookie', owner.cookie)
          .send({
            name: 'Unenforceable',
            holderMembershipId: owner.membershipId,
            entityId,
            limit: { amount: '100.00', currency: 'USD' },
          }),
        422,
      );
    });
  });

  describe('the limit', () => {
    it('is not raisable by the administrator who issued the card', async () => {
      const card = await issueCard('Separation of duties');

      // `ORG_ADMIN` holds `card:create` and not `card:update_limit`
      // (docs/03 §3). Administering people and structure is not authority over
      // spend, and this is the assertion that keeps the two apart.
      const refused = expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/limit`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(card.version))
          .send({
            limit: { amount: '50000.00', currency: 'USD' },
            limitPeriod: 'MONTHLY',
            reason: 'Because I can.',
          }),
        403,
      );

      expect(errorCode(refused)).toBe('FORBIDDEN');
    });

    it('is raisable by finance, and the reason is kept forever', async () => {
      const card = await issueCard('Raised by finance');

      const raised = expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/limit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(card.version))
          .send({
            limit: { amount: '5000.00', currency: 'USD' },
            limitPeriod: 'MONTHLY',
            reason: 'Q4 campaign approved by the board.',
          }),
        200,
      );

      const after = (raised.body as { data: CardBody }).data;

      expect(after.limit.amount).toBe('5000.0000');
      // Newest first, and the opening row survives — "what was it issued with?"
      // stays answerable after every change.
      expect(after.limitHistory).toHaveLength(2);
      expect(after.limitHistory[0]?.reason).toBe('Q4 campaign approved by the board.');
      expect(after.limitHistory[0]?.setBy).toBe('Grace Finance');
      expect(after.limitHistory[1]?.reason).toBe('Issued with this limit.');
    });

    it('refuses a change without a reason', async () => {
      const card = await issueCard('No reason given');

      expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/limit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(card.version))
          .send({ limit: { amount: '5000.00', currency: 'USD' }, limitPeriod: 'MONTHLY' }),
        422,
      );
    });

    it('refuses a version that is not the one the caller read', async () => {
      const card = await issueCard('Stale write');

      expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/limit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(card.version))
          .send({
            limit: { amount: '3000.00', currency: 'USD' },
            limitPeriod: 'MONTHLY',
            reason: 'First writer wins.',
          }),
        200,
      );

      // The second writer read the same version the first one did. Without the
      // precondition this would silently discard the change above.
      const stale = expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/limit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(card.version))
          .send({
            limit: { amount: '9000.00', currency: 'USD' },
            limitPeriod: 'MONTHLY',
            reason: 'Second writer, same read.',
          }),
        409,
      );

      expect(errorCode(stale)).toBe('STALE_VERSION');
    });

    it('refuses a write with no precondition at all', async () => {
      const card = await issueCard('No If-Match');

      expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/limit`)
          .set('Cookie', financeCookie)
          .send({
            limit: { amount: '3000.00', currency: 'USD' },
            limitPeriod: 'MONTHLY',
            reason: 'Sent without a version.',
          }),
        422,
      );
    });
  });

  describe('freezing and terminating', () => {
    it('freezes and unfreezes, and refuses the transition that changes nothing', async () => {
      const card = await issueCard('Mislaid');

      const frozen = expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/freeze`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(card.version))
          .send({ reason: 'Left in a taxi.' }),
        200,
      );

      const frozenCard = (frozen.body as { data: CardBody }).data;
      expect(frozenCard.status).toBe('FROZEN');

      const again = expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/freeze`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(frozenCard.version))
          .send({ reason: 'Freezing it twice.' }),
        409,
      );

      expect(errorCode(again)).toBe('INVALID_STATE_TRANSITION');

      const unfrozen = expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/unfreeze`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(frozenCard.version))
          .send({ reason: 'Found in the taxi.' }),
        200,
      );

      expect((unfrozen.body as { data: CardBody }).data.status).toBe('ACTIVE');
    });

    it('makes termination permanent — every way back is refused', async () => {
      const card = await issueCard('Gone for good');

      const terminated = expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/terminate`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(card.version))
          .send({ reason: 'The holder has left the company.' }),
        200,
      );

      const dead = (terminated.body as { data: CardBody }).data;
      expect(dead.status).toBe('TERMINATED');

      // The issuer has destroyed the credential. A card that looked alive and
      // declined every charge would be worse for the holder than one that says
      // it is gone.
      expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/unfreeze`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(dead.version))
          .send({ reason: 'Actually they came back.' }),
        409,
      );

      expectStatus(
        await request(server)
          .post(`/v1/cards/${card.id}/limit`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(dead.version))
          .send({
            limit: { amount: '10.00', currency: 'USD' },
            limitPeriod: 'MONTHLY',
            reason: 'Trimming a dead card.',
          }),
        409,
      );

      expectStatus(
        await request(server)
          .patch(`/v1/cards/${card.id}`)
          .set('Cookie', owner.cookie)
          .set('If-Match', String(dead.version))
          .send({ name: 'Renaming a dead card' }),
        409,
      );
    });
  });

  describe('who can see which card', () => {
    it('shows an employee their own card and not everybody’s', async () => {
      await issueCard('The admin’s own card');
      const theirs = await issueCard('Sam’s card', employee.membershipId);

      const listed = expectStatus(
        await request(server).get('/v1/cards').set('Cookie', employee.cookie),
        200,
      );

      const data = (listed.body as { data: Array<{ id: string }> }).data;

      // `EMPLOYEE` holds `card:read` and no organisation-wide read, so the
      // scope is narrowed here regardless of what was asked for.
      expect(data.map((card) => card.id)).toEqual([theirs.id]);
    });

    it('answers 404 for a card in another organisation', async () => {
      const ours = await issueCard('Not yours');

      const response = expectStatus(
        await request(server).get(`/v1/cards/${ours.id}`).set('Cookie', stranger.cookie),
        404,
      );

      expect(errorCode(response)).toBe('RESOURCE_NOT_FOUND');
    });
  });

  // ── transactions ─────────────────────────────────────────────────────────

  describe('import', () => {
    it('imports every row and reports each one', async () => {
      const result = await importRows([
        importRow(`imp-${RUN}-a`),
        importRow(`imp-${RUN}-b`, { merchantName: 'Figma' }),
      ]);

      expect(result).toMatchObject({ imported: 2, skipped: 0, failed: 0 });
      expect(result.rows.map((row) => row.outcome)).toEqual(['IMPORTED', 'IMPORTED']);
      expect(result.rows[0]?.transactionId).not.toBeNull();
    });

    it('writes nothing new when the same file is imported twice', async () => {
      const rows = [importRow(`idem-${RUN}-a`), importRow(`idem-${RUN}-b`)];

      const first = await importRows(rows);
      const second = await importRows(rows);

      expect(second).toMatchObject({ imported: 0, skipped: 2, failed: 0 });
      // The same rows, not new ones that happen to look alike.
      expect(second.rows.map((row) => row.transactionId)).toEqual(
        first.rows.map((row) => row.transactionId),
      );
      expect(second.rows[0]?.outcome).toBe('SKIPPED_DUPLICATE');
    });

    it('keeps the same reference apart per provider', async () => {
      const reference = `shared-${RUN}`;

      await importRows([importRow(reference)], { provider: 'acme-bank' });
      const other = await importRows([importRow(reference)], { provider: 'other-bank' });

      // Two banks numbering their own statements from 1 is normal. Uniqueness
      // is per provider, or the second bank's file would import as duplicates.
      expect(other.imported).toBe(1);
    });

    it('fails one row and imports the rest', async () => {
      const theirEntity = await firstEntity(stranger.cookie);

      const result = await importRows([
        importRow(`mixed-${RUN}-good`),
        importRow(`mixed-${RUN}-bad`, { entityId: theirEntity }),
      ]);

      expect(result).toMatchObject({ imported: 1, failed: 1 });
      expect(result.rows[1]).toMatchObject({ index: 1, outcome: 'FAILED', transactionId: null });
      // Named, so the person fixing line 2 knows what to fix.
      expect(result.rows[1]?.message).toBeTruthy();
    });

    it('inherits the holder and coding from the card that was charged', async () => {
      const card = await issueCard('Coded card', employee.membershipId);

      const result = await importRows([importRow(`card-${RUN}`, { cardId: card.id })]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      expect(charge.status).toBe('POSTED');
      // The file knows which card was charged; asking it to also carry the
      // holder is asking it to repeat what this system already knows.
      expect((charge as unknown as { member: { membershipId: string } }).member.membershipId).toBe(
        employee.membershipId,
      );
    });

    it('counts an imported charge against the card it was made on', async () => {
      const card = await issueCard('Spent against', owner.membershipId);

      await importRows([
        importRow(`spend-${RUN}-1`, {
          cardId: card.id,
          amount: { amount: '100.00', currency: 'USD' },
        }),
        importRow(`spend-${RUN}-2`, {
          cardId: card.id,
          amount: { amount: '25.50', currency: 'USD' },
        }),
      ]);

      const read = expectStatus(
        await request(server).get(`/v1/cards/${card.id}`).set('Cookie', owner.cookie),
        200,
      );

      const after = (read.body as { data: CardBody }).data;

      // Summed on the server from every posted charge, not from the page of
      // transactions the browser happens to be showing.
      expect(after.spentInPeriod.amount).toBe('125.5000');
      expect(after.transactionCount).toBe(2);
    });
  });

  describe('matching a charge to its authorisation', () => {
    it('links an approved request automatically, and labels it a guess', async () => {
      await approvedRequest('777.00');

      const result = await importRows(
        [importRow(`auto-${RUN}`, { amount: { amount: '777.00', currency: 'USD' } })],
        { autoMatch: true },
      );

      expect(result.matched).toBe(1);

      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      // `AUTO_MATCHED`, never `MANUALLY_MATCHED`: the record distinguishes a
      // guess from a decision, and the guess stays reversible.
      expect(charge.matchStatus).toBe('AUTO_MATCHED');
      expect(charge.spendRequestId).not.toBeNull();
    });

    it('matches nothing when it was not asked to', async () => {
      await approvedRequest('888.00');

      const result = await importRows([
        importRow(`noauto-${RUN}`, { amount: { amount: '888.00', currency: 'USD' } }),
      ]);

      expect(result.matched).toBe(0);

      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      expect((await readTransaction(id)).matchStatus).toBe('UNMATCHED');
    });

    it('refuses a request that was never approved', async () => {
      const draft = expectStatus(
        await request(server)
          .post('/v1/spend-requests')
          .set('Cookie', owner.cookie)
          .send({
            amount: { amount: '10.00', currency: 'USD' },
            entityId,
            purpose: 'Still a draft',
          }),
        201,
      );

      const result = await importRows([importRow(`unapproved-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      const refused = expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/match`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(charge.version))
          .send({ spendRequestId: (draft.body as { data: { id: string } }).data.id }),
        409,
      );

      expect(errorCode(refused)).toBe('INVALID_STATE_TRANSITION');
    });

    it('records an unplanned purchase as a conclusion rather than leaving it open', async () => {
      const result = await importRows([importRow(`unplanned-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      const marked = expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/match`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(charge.version))
          .send({ spendRequestId: null, notApplicable: true }),
        200,
      );

      // A queue that cannot express "there was no request, and that is fine"
      // never empties.
      expect((marked.body as { data: TransactionBody }).data.matchStatus).toBe('NOT_APPLICABLE');
    });
  });

  describe('coding and review', () => {
    it('marks a coded charge as mapped', async () => {
      const result = await importRows([importRow(`code-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);
      expect(charge.accountingStatus).toBe('UNMAPPED');

      const coded = expectStatus(
        await request(server)
          .patch(`/v1/transactions/${id}`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(charge.version))
          .send({ categoryId, memo: 'Team offsite coffee' }),
        200,
      );

      // Left `UNMAPPED` after a category was set, it would sit in the unmapped
      // queue forever, which is how that queue stops being trusted.
      expect((coded.body as { data: TransactionBody }).data.accountingStatus).toBe('MAPPED');
    });

    it('refuses to let any route edit the money', async () => {
      const result = await importRows([importRow(`money-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      // Not "ignored" — rejected. A body whose amount was silently dropped
      // would leave the caller believing the figure had changed.
      expectStatus(
        await request(server)
          .patch(`/v1/transactions/${id}`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(charge.version))
          .send({ amount: { amount: '1.00', currency: 'USD' } }),
        422,
      );

      expect((await readTransaction(id)).amount.amount).toBe('42.5000');
    });

    it('refuses a dispute with no explanation', async () => {
      const result = await importRows([importRow(`dispute-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/review`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(charge.version))
          .send({ reviewStatus: 'DISPUTED' }),
        422,
      );

      const disputed = expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/review`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(charge.version))
          .send({ reviewStatus: 'DISPUTED', note: 'Charged twice for one seat.' }),
        200,
      );

      expect((disputed.body as { data: TransactionBody }).data.reviewStatus).toBe('DISPUTED');
    });

    it('refuses to review an authorisation that has not settled', async () => {
      const result = await importRows([importRow(`pending-${RUN}`, { status: 'PENDING' })]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      const refused = expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/review`)
          .set('Cookie', financeCookie)
          .set('If-Match', String(charge.version))
          .send({ reviewStatus: 'REVIEWED' }),
        409,
      );

      expect(errorCode(refused)).toBe('INVALID_STATE_TRANSITION');
    });

    it('is not something an employee can complete', async () => {
      const result = await importRows([importRow(`emp-review-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const charge = await readTransaction(id);

      // `EMPLOYEE` can code their own charges and cannot review them —
      // coding and reviewing are two jobs done by two people.
      expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/review`)
          .set('Cookie', employee.cookie)
          .set('If-Match', String(charge.version))
          .send({ reviewStatus: 'REVIEWED' }),
        403,
      );
    });
  });

  describe('corrections', () => {
    it('appends an adjustment and leaves the original figure alone', async () => {
      const result = await importRows([importRow(`adjust-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      const adjusted = expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/adjustments`)
          .set('Cookie', financeCookie)
          .send({
            adjustmentType: 'REFUND',
            amount: { amount: '-42.50', currency: 'USD' },
            reason: 'Refunded after the subscription was cancelled.',
          }),
        201,
      );

      const after = (adjusted.body as { data: TransactionBody }).data;

      expect(after.adjustments).toHaveLength(1);
      expect(after.adjustments[0]?.adjustmentType).toBe('REFUND');
      // The original has been reconciled against. Rewriting it would silently
      // change a number somebody has already reported.
      expect(after.amount.amount).toBe('42.5000');
    });

    it('refuses an adjustment in another currency', async () => {
      const result = await importRows([importRow(`fx-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      // Converting would need a rate, and a rate nobody recorded is a
      // correction nobody can check.
      expectStatus(
        await request(server)
          .post(`/v1/transactions/${id}/adjustments`)
          .set('Cookie', financeCookie)
          .send({
            adjustmentType: 'REFUND',
            amount: { amount: '-40.00', currency: 'EUR' },
            reason: 'Refunded in euros.',
          }),
        422,
      );
    });

    it('offers no way to delete a transaction', async () => {
      const result = await importRows([importRow(`delete-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      // A record of money that moved is not removed when it becomes
      // inconvenient. There is no route, so this is a 404 from the router.
      expectStatus(
        await request(server).delete(`/v1/transactions/${id}`).set('Cookie', owner.cookie),
        404,
      );
    });
  });

  describe('who can see which transaction', () => {
    it('shows an employee their own charges and not the organisation’s', async () => {
      const theirs = await issueCard('Sam’s second card', employee.membershipId);

      const result = await importRows([
        importRow(`scope-${RUN}-mine`, { cardId: theirs.id }),
        importRow(`scope-${RUN}-theirs`),
      ]);

      const mine = result.rows[0]?.transactionId;
      const notMine = result.rows[1]?.transactionId;
      if (mine == null || notMine == null) throw new Error('both rows should have imported');

      const listed = expectStatus(
        await request(server).get('/v1/transactions?pageSize=100').set('Cookie', employee.cookie),
        200,
      );

      const ids = (listed.body as { data: Array<{ id: string }> }).data.map((row) => row.id);

      // The scope is decided by the server from the permissions, not by the
      // query: `EMPLOYEE` holds `transaction:read` and not `read_all`.
      expect(ids).toContain(mine);
      expect(ids).not.toContain(notMine);

      // And not reachable one at a time either, which is the hole a
      // list-only filter would leave open.
      expectStatus(
        await request(server).get(`/v1/transactions/${notMine}`).set('Cookie', employee.cookie),
        404,
      );
    });

    it('shows nothing of another organisation’s transactions', async () => {
      const result = await importRows([importRow(`tenant-${RUN}`)]);
      const id = result.rows[0]?.transactionId;
      if (id == null) throw new Error('the row should have imported');

      expectStatus(
        await request(server).get(`/v1/transactions/${id}`).set('Cookie', stranger.cookie),
        404,
      );
    });
  });
});
