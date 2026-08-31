import type { LivenessResponse, ReadinessResponse } from '@financy/contracts';
import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';

import { HealthService } from './health.service.js';

/** Injected rather than imported from `package.json`, which is not in `dist`. */
const VERSION = process.env['npm_package_version'] ?? '0.0.0';

/**
 * `/v1/health/live` and `/v1/health/ready` (docs/10 §5.14, docs/17 §6).
 *
 * Both are public and unauthenticated: a probe has no session, and requiring
 * one would mean the orchestrator could not tell "the database is down" from
 * "authentication is down".
 *
 * Neither is wrapped in the standard `data`/`meta` envelope. They are read by
 * Kubernetes, a load balancer, and an uptime checker — none of which will
 * unwrap anything — and the shape is fixed by `@financy/contracts` so it is
 * still a contract, just a different one.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Is the process alive?
   *
   * Touches nothing. A liveness probe that checks the database restarts every
   * instance the moment the database blips, converting a recoverable
   * dependency incident into a full outage — and a restarting process cannot
   * reconnect any faster than a running one.
   */
  @Get('live')
  @HttpCode(200)
  live(): LivenessResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Can this instance serve traffic?
   *
   * `503` when a required dependency is down, so the load balancer stops
   * routing here instead of the caller collecting the errors. `200` while
   * degraded: an optional dependency being unavailable is worth an alert, not
   * worth removing capacity for.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness(VERSION);

    response.status(result.status === 'down' ? 503 : 200);

    // Readiness changes between two consecutive requests by design. A cached
    // one is a stale answer to the only question the probe is asking.
    response.setHeader('Cache-Control', 'no-store');

    return result;
  }
}
