import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  cursorCollectionEnvelope,
  offsetCollectionEnvelope,
  resourceEnvelope,
} from './envelope.js';
import { idempotencyKeySchema, ifMatchSchema } from './headers.js';
import { livenessResponseSchema, readinessResponseSchema } from './health.js';

const correlationId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const item = z.object({ id: z.string() });

describe('envelopes', () => {
  it('wraps a single resource with its meta', () => {
    const schema = resourceEnvelope(item);
    expect(schema.safeParse({ data: { id: 'a' }, meta: { correlationId } }).success).toBe(true);
  });

  it('rejects a bare resource — there would be nowhere to put the correlation id', () => {
    expect(resourceEnvelope(item).safeParse({ id: 'a' }).success).toBe(false);
  });

  it('requires pagination on a collection, so no endpoint can return an unbounded list', () => {
    const schema = cursorCollectionEnvelope(item);
    expect(schema.safeParse({ data: [{ id: 'a' }], meta: { correlationId } }).success).toBe(false);
    expect(
      schema.safeParse({
        data: [{ id: 'a' }],
        pagination: { nextCursor: null, hasMore: false, limit: 50 },
        meta: { correlationId },
      }).success,
    ).toBe(true);
  });

  it('accepts an offset collection', () => {
    expect(
      offsetCollectionEnvelope(item).safeParse({
        data: [],
        pagination: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 },
        meta: { correlationId },
      }).success,
    ).toBe(true);
  });
});

describe('headers', () => {
  it('requires the idempotency key to be a UUID, so it cannot collide with itself', () => {
    expect(idempotencyKeySchema.safeParse(correlationId).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('submit').success).toBe(false);
  });

  it('parses If-Match as a record version', () => {
    expect(ifMatchSchema.parse('7')).toBe(7);
    expect(ifMatchSchema.safeParse('W/"7"').success).toBe(false);
  });
});

describe('health responses', () => {
  it('accepts a liveness response that touched no dependency', () => {
    expect(
      livenessResponseSchema.safeParse({
        status: 'ok',
        uptimeSeconds: 12.5,
        checkedAt: '2026-08-29T14:32:11.482Z',
      }).success,
    ).toBe(true);
  });

  it('accepts a readiness response reporting a degraded optional dependency', () => {
    expect(
      readinessResponseSchema.safeParse({
        status: 'degraded',
        version: '0.1.0',
        appEnv: 'local',
        checkedAt: '2026-08-29T14:32:11.482Z',
        dependencies: [
          { name: 'database', status: 'ok', latencyMs: 3, required: true },
          { name: 'queue', status: 'degraded', adapter: 'inline', required: false },
        ],
      }).success,
    ).toBe(true);
  });

  it('requires every dependency to declare whether it gates readiness', () => {
    expect(
      readinessResponseSchema.safeParse({
        status: 'ok',
        version: '0.1.0',
        appEnv: 'local',
        checkedAt: '2026-08-29T14:32:11.482Z',
        dependencies: [{ name: 'database', status: 'ok' }],
      }).success,
    ).toBe(false);
  });
});
