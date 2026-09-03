import { Module } from '@nestjs/common';

import { BudgetsModule } from '../budgets/index.js';
import { PoliciesController } from './policies.controller.js';
import { PoliciesService } from './policies.service.js';
import { PolicyContextService } from './policy-context.service.js';
import { PolicyRepositoryService } from './policy-repository.service.js';
import { PolicySimulationService } from './policy-simulation.service.js';

/**
 * The impure half of the policy path, and the authoring of it.
 *
 * The evaluator itself is a pure function in `@financy/core` and needs no
 * module at all. What lives here is everything that has to touch the database:
 * assembling the context, finding the active versions, editing and publishing
 * them, and answering "what would this do" without doing it.
 */
@Module({
  // The context needs the budget ledger to answer `budget.*` rules
  // (FR-BDG-007). Budgets know nothing about policies, so the dependency runs
  // one way and there is no cycle to break.
  imports: [BudgetsModule],
  controllers: [PoliciesController],
  providers: [
    PoliciesService,
    PolicyContextService,
    PolicyRepositoryService,
    PolicySimulationService,
  ],
  exports: [PolicyContextService, PolicyRepositoryService, PoliciesService],
})
export class PoliciesModule {}
