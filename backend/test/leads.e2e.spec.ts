import { HEADER, errorResponseSchema } from '@financy/contracts';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/**
 * `POST /v1/leads` — the public demo request.
 *
 * Deliberately exercised with **invalid** bodies. Guards run before pipes, so
 * every request here is counted by the rate limiter and then refused by
 * validation, which lets the whole access path — public route, rate limit,
 * envelope, error taxonomy — be asserted without a database. A suite that
 * needed one would be red on a developer machine for a reason unrelated to the
 * code being changed, and the accepted-submission path is covered by the unit
 * tests over the schema and the counter.
 *
 * The limit is 3 per hour per address and the counter lives in the process, so
 * the order of the tests below matters: the first three requests are the
 * allowance and the fourth is the refusal.
 */
describe('POST /v1/leads', () => {
  let app: INestApplication;
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

  it('is reachable without a session', async () => {
    const response = await request(server).post('/v1/leads').send({});

    // The point of the assertion is what it is *not*: a 401. An authenticated
    // route would answer that before ever looking at the body.
    expect(response.status).toBe(422);
  });

  it('names the fields it refused, so the form can point at its inputs', async () => {
    const response = await request(server)
      .post('/v1/leads')
      .send({ name: '', email: 'not-an-address', company: 'Acme Ltd' })
      .expect(422);

    const body = errorResponseSchema.parse(response.body);

    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(body.error.details?.fields ?? {})).toEqual(
      expect.arrayContaining(['name', 'email']),
    );
  });

  it('reports the remaining allowance on every response', async () => {
    const response = await request(server).post('/v1/leads').send({}).expect(422);

    expect(response.headers[HEADER.rateLimitLimit]).toBe('3');
    // Third of three.
    expect(response.headers[HEADER.rateLimitRemaining]).toBe('0');
    expect(Number(response.headers[HEADER.rateLimitReset])).toBeGreaterThan(0);
  });

  it('refuses the fourth request in the window with a retry time', async () => {
    const response = await request(server).post('/v1/leads').send({}).expect(429);

    const body = errorResponseSchema.parse(response.body);

    expect(body.error.code).toBe('RATE_LIMITED');

    // A `Retry-After` a client can act on. Zero would invite an immediate
    // retry that is certain to fail.
    const retryAfter = Number(response.headers[HEADER.retryAfter]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
  });

  it('has no read route — sales reads the collection, not the API', async () => {
    await request(server).get('/v1/leads').expect(404);
  });
});
