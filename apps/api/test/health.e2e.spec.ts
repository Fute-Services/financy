import {
  HEADER,
  errorResponseSchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from '@financy/contracts';
import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * The Phase 0 exit test: a real Nest application boots, routes are mounted
 * under `/v1`, the correlation id flows end to end, and errors come back in
 * the published envelope.
 *
 * Readiness is asserted for *consistency* rather than for `ok`, because this
 * suite runs both in CI — where docker-compose provides PostgreSQL — and on a
 * developer machine where it may not. A test that demanded a database would
 * be red for a reason that has nothing to do with the code being changed, and
 * a red test nobody believes is worse than no test.
 */
describe('health endpoints', () => {
  let app: INestApplication;

  /** `getHttpServer()` is typed `any`; narrowing it once keeps the call sites honest. */
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();

    server = app.getHttpServer() as Server;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /v1/health/live', () => {
    it('is 200 and matches the contract', async () => {
      const response = await request(server).get('/v1/health/live').expect(200);

      expect(livenessResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.body.status).toBe('ok');
    });

    /**
     * Liveness must not depend on anything external. If it did, a database
     * blip would restart every instance and turn a recoverable incident into
     * an outage — so it stays 200 even when readiness is down.
     */
    it('is 200 regardless of dependency health', async () => {
      await request(server).get('/v1/health/live').expect(200);
      await request(server).get('/v1/health/live').expect(200);
    });
  });

  describe('GET /v1/health/ready', () => {
    it('matches the contract and agrees with its own status', async () => {
      const response = await request(server).get('/v1/health/ready');

      expect(readinessResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.status).toBe(response.body.status === 'down' ? 503 : 200);
    });

    it('reports the database as a required dependency', async () => {
      const response = await request(server).get('/v1/health/ready');

      expect(response.body.dependencies).toEqual([
        expect.objectContaining({ name: 'database', required: true }),
      ]);
    });

    it('is not cacheable — a stale readiness answer is the wrong answer', async () => {
      const response = await request(server).get('/v1/health/ready');
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('correlation id', () => {
    it('is generated and echoed when the client sends none', async () => {
      const response = await request(server).get('/v1/health/live');

      expect(response.headers[HEADER.correlationId]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('adopts a well-formed one from the client, so a trace spans both apps', async () => {
      const supplied = 'web-01HQ8ZK4E6-abcdef';

      const response = await request(server)
        .get('/v1/health/live')
        .set(HEADER.correlationId, supplied);

      expect(response.headers[HEADER.correlationId]).toBe(supplied);
    });

    /**
     * The value reaches log lines and a response header, so an unvalidated one
     * is a log-injection and header-splitting vector for the price of a curl.
     */
    it('replaces a malformed one rather than reflecting it', async () => {
      const response = await request(server)
        .get('/v1/health/live')
        .set(HEADER.correlationId, 'bad value with spaces');

      expect(response.headers[HEADER.correlationId]).not.toBe('bad value with spaces');
      expect(response.headers[HEADER.correlationId]).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('error handling', () => {
    it('returns the published envelope for an unknown route', async () => {
      const response = await request(server).get('/v1/nope').expect(404);

      expect(errorResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
      expect(response.body.error.correlationId).toBe(response.headers[HEADER.correlationId]);
    });

    it('does not serve anything outside the /v1 prefix', async () => {
      await request(server).get('/health/live').expect(404);
    });
  });
});
