import { Module } from '@nestjs/common';

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
