import type { DashboardSummary, Resource } from '@financy/contracts';
import { Controller, Get } from '@nestjs/common';

import { getCorrelationId } from '../../platform/request-context/index.js';
import { DashboardService } from './dashboard.service.js';

/**
 * `/v1/dashboard` (docs/10 §5.13, epic 4.3).
 *
 * **No permission decorator, and that is not an oversight.** Every widget is
 * already scoped by what the caller can see — an employee's dashboard is their
 * own spend, and the counts they cannot act on are absent rather than zero.
 * Requiring a permission to see one's own figures would leave the first screen
 * after sign-in empty for exactly the people who use the product most.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  async summary(): Promise<Resource<DashboardSummary>> {
    return { data: await this.dashboard.summary(), meta: { correlationId: getCorrelationId() } };
  }
}
