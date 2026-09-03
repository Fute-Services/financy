import type { DependencyHealth, HealthStatus, ReadinessResponse } from '@financy/contracts';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '../config/index.js';
import { DatabaseService } from '../database/index.js';

/** Beyond this, the dependency is treated as down rather than slow. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Assemble the readiness picture.
 *
 * Only dependencies that are genuinely checked appear in the response. It
 * would be easy to list the queue and the document store and report the
 * configured adapter name, and it would be worse than saying nothing: a
 * readiness endpoint that reports `ok` for something it never probed is a
 * green light nobody should have trusted. Those checks arrive with their
 * ports in Phase 1 (roadmap 1.2.5 and 1.2.6).
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  async readiness(version: string): Promise<ReadinessResponse> {
    const dependencies = await Promise.all([this.checkDatabase()]);

    return {
      status: aggregate(dependencies),
      version,
      appEnv: this.config.get('APP_ENV'),
      checkedAt: new Date().toISOString(),
      dependencies,
    };
  }

  private async checkDatabase(): Promise<DependencyHealth> {
    const startedAt = Date.now();

    try {
      await withTimeout(this.database.ping(), PROBE_TIMEOUT_MS);

      return {
        name: 'database',
        status: 'ok',
        latencyMs: Date.now() - startedAt,
        required: true,
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'down',
        latencyMs: Date.now() - startedAt,
        required: true,
        // A connection string with credentials in it is a plausible thing for
        // a driver to include in its message, and this response is
        // unauthenticated. The detail belongs in the log, not here.
        message: error instanceof Error ? error.name : 'probe failed',
      };
    }
  }
}

/**
 * A probe that hangs is a probe that never fails, which is the worst outcome:
 * the orchestrator waits on it instead of replacing the instance.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Probe exceeded ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A required dependency being down makes the instance not ready — it should
 * leave the load balancer. An optional one being down is `degraded`: worth
 * alerting on, not worth taking the instance out of service for.
 */
export function aggregate(dependencies: readonly DependencyHealth[]): HealthStatus {
  if (dependencies.some((dep) => dep.required && dep.status === 'down')) return 'down';
  if (dependencies.some((dep) => dep.status !== 'ok')) return 'degraded';
  return 'ok';
}
