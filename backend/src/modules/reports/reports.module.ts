import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * Reports, exports, and the dashboard.
 *
 * One module, because the dashboard is a report with a fixed filter set and a
 * different presentation. Splitting them would give the two paths separate
 * definitions of "spend this month", and the first thing anybody notices about
 * a spend tool is when two screens disagree.
 */
@Module({
  controllers: [ReportsController, DashboardController],
  providers: [ReportsService, DashboardService],
  exports: [ReportsService, DashboardService],
})
export class ReportsModule {}
