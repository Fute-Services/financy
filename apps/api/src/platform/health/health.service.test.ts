import { readinessResponseSchema, type DependencyHealth } from '@financy/contracts';
import { describe, expect, it, vi } from 'vitest';

import { HealthService, aggregate } from './health.service.js';

function dependency(overrides: Partial<DependencyHealth>): DependencyHealth {
  return { name: 'database', status: 'ok', required: true, ...overrides };
}

describe('aggregate', () => {
  it('is ok when everything is ok', () => {
    expect(aggregate([dependency({})])).toBe('ok');
  });

  /**
   * A required dependency being down must take the instance out of rotation.
   * Reporting `degraded` would keep it in the load balancer serving errors.
   */
  it('is down when a required dependency is down', () => {
    expect(aggregate([dependency({ status: 'down', required: true })])).toBe('down');
  });

  /**
   * And an optional one must not. Losing the queue is worth an alert; it is
   * not worth removing capacity, because reads still work.
   */
  it('is degraded when only an optional dependency is down', () => {
    expect(
      aggregate([dependency({}), dependency({ name: 'queue', status: 'down', required: false })]),
    ).toBe('degraded');
  });

  it('is degraded when a required dependency is merely degraded', () => {
    expect(aggregate([dependency({ status: 'degraded' })])).toBe('degraded');
  });

  it('is ok with nothing to check', () => {
    expect(aggregate([])).toBe('ok');
  });
});

describe('HealthService.readiness', () => {
  const config = { get: () => 'local' } as never;

  it('reports the database as ok and matches the published schema', async () => {
    const service = new HealthService(config, {
      ping: vi.fn().mockResolvedValue(undefined),
    } as never);
    const result = await service.readiness('1.2.3');

    expect(result.status).toBe('ok');
    expect(result.version).toBe('1.2.3');
    expect(result.dependencies).toEqual([
      expect.objectContaining({ name: 'database', status: 'ok', required: true }),
    ]);
    expect(readinessResponseSchema.safeParse(result).success).toBe(true);
  });

  it('reports down rather than throwing when the database is unreachable', async () => {
    const service = new HealthService(config, {
      ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432')),
    } as never);

    const result = await service.readiness('1.2.3');

    expect(result.status).toBe('down');
    expect(result.dependencies[0]?.status).toBe('down');
  });

  /**
   * This endpoint is unauthenticated, and a driver's error message is a
   * plausible place for a connection string — credentials included — to
   * appear. The detail belongs in the log.
   */
  it('does not put the driver message in an unauthenticated response', async () => {
    const service = new HealthService(config, {
      ping: vi.fn().mockRejectedValue(new Error('password authentication failed for user "app"')),
    } as never);

    const result = await service.readiness('1.2.3');

    expect(JSON.stringify(result)).not.toContain('password');
  });

  /**
   * A probe that hangs never fails, so the orchestrator waits on it forever
   * instead of replacing the instance.
   */
  it('times out a hanging probe instead of hanging with it', async () => {
    vi.useFakeTimers();

    const service = new HealthService(config, {
      ping: vi.fn().mockReturnValue(new Promise(() => {})),
    } as never);

    const pending = service.readiness('1.2.3');
    await vi.advanceTimersByTimeAsync(2_500);
    const result = await pending;

    vi.useRealTimers();

    expect(result.status).toBe('down');
  });
});
