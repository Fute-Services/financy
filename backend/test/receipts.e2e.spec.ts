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
 * Receipts, end to end (Epic 3.1, FR-EXP-004…007).
 *
 * The properties that need the whole stack — an HTTP server, a signed URL, and
 * a file actually written to disk:
 *
 * - **An executable renamed `.pdf` is refused** (FR-EXP-004). The requirement
 *   names this test; it is the reason the magic-byte check exists.
 * - **A refused file is deleted, not kept.** An unidentified binary sitting in
 *   storage under a plausible name is worse than either accepting or refusing.
 * - **A photograph's location is gone before anybody can read it**
 *   (FR-EXP-006).
 * - **A link expires and a tampered one is refused**, which is the only reason
 *   the local adapter emulates signatures at all (ADR-0008).
 * - **A receipt is attached to one thing at a time, and the history survives**
 *   (FR-EXP-007).
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

/** A PDF, as far as anything that reads its first bytes is concerned. */
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'utf8');

/** A Windows executable. The file the requirement asks about. */
const EXECUTABLE = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff,
]);

/** A JPEG whose EXIF segment carries a location and a device serial. */
function photographWithLocation(): Buffer {
  const exif = Buffer.from('Exif\0\0GPS 51.5074 -0.1278 device-serial-XYZ789', 'utf8');
  const length = exif.length + 2;

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]),
    exif,
    Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x11, 0x22]),
    Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describeWithDatabase('receipts', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let queue: QueuePort;

  let owner: { cookie: string; organizationId: string; membershipId: string };
  let stranger: { cookie: string; organizationId: string };
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

    const first = (entities.body as { data: Array<{ id: string }> }).data[0];
    if (first === undefined) throw new Error('registration should create an entity');
    entityId = first.id;
  }, 240_000);

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
          organizationName: `Receipts ${name} ${RUN}`,
          fullName: `Owner ${name}`,
          email: `receipts-${name}-${RUN}@receipts.test`,
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

  interface Intent {
    receiptId: string;
    uploadUrl: string;
    maxBytes: number;
    isSandbox: boolean;
  }

  async function intent(fileName: string, contentType: string, byteSize: number): Promise<Intent> {
    const response = expectStatus(
      await request(server)
        .post('/v1/receipts/upload-intent')
        .set('Cookie', owner.cookie)
        .send({ fileName, contentType, byteSize }),
      201,
    );

    return (response.body as { data: Intent }).data;
  }

  /** Follow a signed URL back into this same server, as a browser would. */
  function follow(url: string): { path: string } {
    const parsed = new URL(url);
    return { path: `${parsed.pathname}${parsed.search}` };
  }

  async function upload(uploadUrl: string, body: Buffer): Promise<request.Response> {
    return request(server)
      .put(follow(uploadUrl).path)
      .set('Content-Type', 'application/octet-stream')
      .send(body);
  }

  async function complete(receiptId: string): Promise<request.Response> {
    return request(server)
      .post(`/v1/receipts/${receiptId}/complete`)
      .set('Cookie', owner.cookie)
      .send({});
  }

  // ── the happy path ───────────────────────────────────────────────────────

  describe('uploading', () => {
    it('hands back a signed link and stores the file behind it', async () => {
      const created = await intent('january-taxi.pdf', 'application/pdf', PDF.length);

      expect(created.uploadUrl).toContain('token=');
      expect(created.maxBytes).toBeLessThanOrEqual(20 * 1024 * 1024);
      // The local adapter is a sandbox, and that travels rather than being
      // assumed (docs/13 §3).
      expect(created.isSandbox).toBe(true);

      expectStatus(await upload(created.uploadUrl, PDF), 200);

      const completed = expectStatus(await complete(created.receiptId), 200);
      const receipt = (completed.body as { data: { status: string; byteSize: number } }).data;

      expect(receipt.status).toBe('STORED');
      expect(receipt.byteSize).toBe(PDF.length);
    });

    it('issues a download link that is fresh, short-lived, and only issued after a check', async () => {
      const created = await intent('february-hotel.pdf', 'application/pdf', PDF.length);
      await upload(created.uploadUrl, PDF);
      await complete(created.receiptId);

      const read = expectStatus(
        await request(server).get(`/v1/receipts/${created.receiptId}`).set('Cookie', owner.cookie),
        200,
      );

      const detail = (read.body as { data: { downloadUrl: string; downloadExpiresAt: string } })
        .data;

      expect(detail.downloadUrl).toContain('token=');
      // Fifteen minutes at most: long enough to open the file, short enough
      // that a pasted link is useless by the time anybody else reads it.
      expect(new Date(detail.downloadExpiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
        900_000 + 5_000,
      );

      const downloaded = expectStatus(
        await request(server).get(follow(detail.downloadUrl).path),
        200,
      );

      // Never rendered inline: a stored file served as a page would run in
      // this application's origin.
      expect(downloaded.headers['content-disposition']).toContain('attachment');
      expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
      expect(
        Buffer.from(downloaded.body as Buffer)
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
    });

    it('refuses a link whose signature does not verify', async () => {
      const created = await intent('tampered.pdf', 'application/pdf', PDF.length);
      const tampered = created.uploadUrl.replace(/token=[0-9a-f]+/, 'token=' + 'a'.repeat(64));

      expectStatus(await upload(tampered, PDF), 403);
    });

    it('refuses a link that has expired, signature and all', async () => {
      const created = await intent('stale.pdf', 'application/pdf', PDF.length);

      // The signature covers the expiry, so moving it invalidates the token —
      // which is the point: a valid signature on a stale link is the case a
      // naive check gets wrong.
      const expired = created.uploadUrl.replace(
        /expires=\d+/,
        `expires=${String(Date.now() - 1000)}`,
      );

      expectStatus(await upload(expired, PDF), 403);
    });
  });

  // ── the requirement's own test ───────────────────────────────────────────

  describe('what a file actually is', () => {
    it('refuses an executable renamed as a PDF, and keeps nothing', async () => {
      const created = await intent('invoice.pdf', 'application/pdf', EXECUTABLE.length);

      // Storage accepts the bytes — it is a bucket, not a validator.
      expectStatus(await upload(created.uploadUrl, EXECUTABLE), 200);

      // Completion is where the file is read and disbelieved.
      const refused = expectStatus(await complete(created.receiptId), 422);

      expect((refused.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

      const row = await database.unscoped.receipt.findFirst({
        where: { id: created.receiptId },
        select: { status: true, storageKey: true },
      });

      expect(row?.status).toBe('QUARANTINED');

      // And the object is gone. An unidentified binary kept "for inspection"
      // under a plausible name is the worst of the three outcomes.
      const detail = expectStatus(
        await request(server).get(`/v1/receipts/${created.receiptId}`).set('Cookie', owner.cookie),
        200,
      );

      expect((detail.body as { data: { downloadUrl: string | null } }).data.downloadUrl).toBeNull();
    });

    it('refuses a PNG uploaded as a PDF, even though both are allowed', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      const created = await intent('receipt.pdf', 'application/pdf', png.length);

      await upload(created.uploadUrl, png);

      // The mismatch is the signal, not the type. A file that is not what its
      // uploader said it was is worth stopping either way.
      expectStatus(await complete(created.receiptId), 422);
    });

    it('refuses to complete a receipt whose file never arrived', async () => {
      const created = await intent('never-uploaded.pdf', 'application/pdf', 100);

      expectStatus(await complete(created.receiptId), 422);

      // Still `PENDING`, which is exactly what it is: somebody closed a tab.
      const row = await database.unscoped.receipt.findFirst({
        where: { id: created.receiptId },
        select: { status: true },
      });

      expect(row?.status).toBe('PENDING');
    });
  });

  // ── privacy ──────────────────────────────────────────────────────────────

  describe('a photograph', () => {
    it('loses its location and its device before anybody can download it', async () => {
      const photograph = photographWithLocation();
      const created = await intent('lunch.jpg', 'image/jpeg', photograph.length);

      await upload(created.uploadUrl, photograph);
      expectStatus(await complete(created.receiptId), 200);

      const read = expectStatus(
        await request(server).get(`/v1/receipts/${created.receiptId}`).set('Cookie', owner.cookie),
        200,
      );

      const url = (read.body as { data: { downloadUrl: string } }).data.downloadUrl;
      const downloaded = expectStatus(await request(server).get(follow(url).path), 200);
      const text = Buffer.from(downloaded.body as Buffer).toString('latin1');

      // Nobody agreed to give their employer the coordinates of their lunch.
      expect(text).not.toContain('GPS');
      expect(text).not.toContain('51.5074');
      expect(text).not.toContain('device-serial-XYZ789');

      // And it is still a JPEG, byte for byte where it matters.
      expect(text.startsWith('\xff\xd8')).toBe(true);
    });
  });

  // ── attachment ───────────────────────────────────────────────────────────

  describe('attaching', () => {
    async function storedReceipt(name: string): Promise<string> {
      const created = await intent(name, 'application/pdf', PDF.length);
      await upload(created.uploadUrl, PDF);
      expectStatus(await complete(created.receiptId), 200);

      return created.receiptId;
    }

    async function importedTransaction(reference: string): Promise<string> {
      const response = expectStatus(
        await request(server)
          .post('/v1/transactions/import')
          .set('Cookie', owner.cookie)
          .send({
            provider: 'acme-bank',
            rows: [
              {
                providerTransactionId: reference,
                entityId,
                merchantName: 'A taxi company',
                amount: { amount: '31.40', currency: 'USD' },
                occurredAt: new Date().toISOString(),
                status: 'POSTED',
              },
            ],
          }),
        200,
      );

      const id = (response.body as { data: { rows: Array<{ transactionId: string | null }> } }).data
        .rows[0]?.transactionId;

      if (id == null) throw new Error('the row should have imported');

      return id;
    }

    it('marks the charge as having its receipt', async () => {
      const receiptId = await storedReceipt('attached.pdf');
      const transactionId = await importedTransaction(`rcpt-${RUN}-a`);

      expectStatus(
        await request(server)
          .post(`/v1/receipts/${receiptId}/attach`)
          .set('Cookie', owner.cookie)
          .send({ targetType: 'transaction', targetId: transactionId }),
        200,
      );

      const charge = expectStatus(
        await request(server).get(`/v1/transactions/${transactionId}`).set('Cookie', owner.cookie),
        200,
      );

      // The transaction's receipt axis moves with it — otherwise the finance
      // queue's "still needs a receipt" filter means nothing.
      expect((charge.body as { data: { receiptStatus: string } }).data.receiptStatus).toBe(
        'ATTACHED',
      );
    });

    it('moves rather than duplicates, and keeps where it used to be', async () => {
      const receiptId = await storedReceipt('moved.pdf');
      const first = await importedTransaction(`rcpt-${RUN}-b`);
      const second = await importedTransaction(`rcpt-${RUN}-c`);

      await request(server)
        .post(`/v1/receipts/${receiptId}/attach`)
        .set('Cookie', owner.cookie)
        .send({ targetType: 'transaction', targetId: first });

      const moved = expectStatus(
        await request(server)
          .post(`/v1/receipts/${receiptId}/attach`)
          .set('Cookie', owner.cookie)
          .send({ targetType: 'transaction', targetId: second }),
        200,
      );

      const detail = (
        moved.body as {
          data: {
            attachedTo: { targetId: string };
            history: Array<{ targetId: string; detachedAt: string | null }>;
          };
        }
      ).data;

      // One open attachment: the same image on two charges is how one taxi
      // gets claimed twice.
      expect(detail.attachedTo.targetId).toBe(second);

      const open = detail.history.filter((row) => row.detachedAt === null);
      expect(open).toHaveLength(1);

      // And the closed row stays — "it used to be on that one" is a question
      // an auditor asks (FR-EXP-007).
      const closed = detail.history.find((row) => row.targetId === first);
      expect(closed?.detachedAt).not.toBeNull();
    });

    it('refuses a charge belonging to another organisation, as a 404', async () => {
      const receiptId = await storedReceipt('cross-tenant.pdf');

      expectStatus(
        await request(server)
          .post(`/v1/receipts/${receiptId}/attach`)
          .set('Cookie', owner.cookie)
          .send({ targetType: 'transaction', targetId: '01a05000-0000-7000-8000-000000000000' }),
        404,
      );
    });

    it('detaching leaves the receipt and returns the charge to needing one', async () => {
      const receiptId = await storedReceipt('detached.pdf');
      const transactionId = await importedTransaction(`rcpt-${RUN}-d`);

      await request(server)
        .post(`/v1/receipts/${receiptId}/attach`)
        .set('Cookie', owner.cookie)
        .send({ targetType: 'transaction', targetId: transactionId });

      const detached = expectStatus(
        await request(server)
          .delete(`/v1/receipts/${receiptId}/attach`)
          .set('Cookie', owner.cookie),
        200,
      );

      expect((detached.body as { data: { attachedTo: unknown } }).data.attachedTo).toBeNull();

      const charge = expectStatus(
        await request(server).get(`/v1/transactions/${transactionId}`).set('Cookie', owner.cookie),
        200,
      );

      expect((charge.body as { data: { receiptStatus: string } }).data.receiptStatus).toBe(
        'MISSING',
      );
    });
  });

  // ── the jobs, and what they honestly say ─────────────────────────────────

  describe('after a receipt lands', () => {
    it('says the scan was skipped rather than claiming the file is clean', async () => {
      const created = await intent('scanned.pdf', 'application/pdf', PDF.length);
      await upload(created.uploadUrl, PDF);
      await complete(created.receiptId);
      await queue.drain();

      const row = await database.unscoped.receipt.findFirst({
        where: { id: created.receiptId },
        select: { scanStatus: true, ocrStatus: true },
      });

      // No scanner is configured. A status saying "clean" would be the single
      // most dangerous lie this system could tell, because somebody would rely
      // on it.
      expect(row?.scanStatus).toBe('SKIPPED');
      // And OCR is a no-op adapter, which says so rather than returning empty
      // fields that look like a failed reading.
      expect(row?.ocrStatus).toBe('SKIPPED');
    });
  });

  // ── who may see a receipt ────────────────────────────────────────────────

  describe('visibility', () => {
    it('shows nothing of another organisation’s receipts', async () => {
      const created = await intent('private.pdf', 'application/pdf', PDF.length);
      await upload(created.uploadUrl, PDF);
      await complete(created.receiptId);

      expectStatus(
        await request(server)
          .get(`/v1/receipts/${created.receiptId}`)
          .set('Cookie', stranger.cookie),
        404,
      );
    });

    it('offers no route that accepts a file body', async () => {
      // The bytes go to storage under a signed URL and never through this API
      // — an endpoint that accepted uploads would hold 20 MB per concurrent
      // request and would be the obvious thing to point a fuzzer at.
      expectStatus(
        await request(server)
          .post('/v1/receipts')
          .set('Cookie', owner.cookie)
          .send({ file: 'anything' }),
        404,
      );
    });
  });
});
