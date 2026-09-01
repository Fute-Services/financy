import { Module } from '@nestjs/common';

import { ApprovalResolverService } from './approval-resolver.service.js';
import { ApprovalService } from './approval.service.js';
import { DelegationService } from './delegation.service.js';
import { DelegationsController } from './delegations.controller.js';

/**
 * The approval machinery, and the delegation that redirects it.
 *
 * Delegation has a controller here while acting on an approval does not, and
 * the asymmetry is deliberate: a delegation touches nothing but itself, whereas
 * settling a chain has to tell the subject — a spend request today, an expense
 * or a bill from Phase 3 — so that route lives in the spend module until a
 * second subject type forces a dispatcher.
 */
@Module({
  controllers: [DelegationsController],
  providers: [ApprovalService, ApprovalResolverService, DelegationService],
  exports: [ApprovalService, ApprovalResolverService, DelegationService],
})
export class ApprovalsModule {}
