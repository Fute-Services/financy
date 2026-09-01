import { Module } from '@nestjs/common';

import { PolicyContextService } from './policy-context.service.js';
import { PolicyRepositoryService } from './policy-repository.service.js';

/**
 * The impure half of the policy path.
 *
 * The evaluator itself is a pure function in `@financy/core` and needs no
 * module at all. What lives here is everything that has to touch the database:
 * assembling the context, and finding the active versions.
 */
@Module({
  providers: [PolicyContextService, PolicyRepositoryService],
  exports: [PolicyContextService, PolicyRepositoryService],
})
export class PoliciesModule {}
