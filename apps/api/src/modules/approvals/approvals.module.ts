import { Module } from '@nestjs/common';

import { ApprovalResolverService } from './approval-resolver.service.js';
import { ApprovalJobs } from './approval-jobs.js';
import { ApprovalSubjectRegistry } from './approval-subjects.js';
import { ApprovalService } from './approval.service.js';
import { DelegationService } from './delegation.service.js';
import { ApprovalController } from './approvals.controller.js';
import { DelegationsController } from './delegations.controller.js';

/**
 * The approval machinery, and the delegation that redirects it.
 *
 * Both controllers live here now. Acting on an approval used to live in the
 * spend module because settling a chain has to tell its subject, and with one
 * subject type that meant one import in one direction. Expenses made that a
 * second, so settlement goes through the subject registry and the route came
 * back to the machinery it belongs to.
 */
@Module({
  controllers: [ApprovalController, DelegationsController],
  providers: [
    ApprovalService,
    ApprovalResolverService,
    DelegationService,
    ApprovalJobs,
    ApprovalSubjectRegistry,
  ],
  exports: [ApprovalService, ApprovalResolverService, DelegationService, ApprovalSubjectRegistry],
})
export class ApprovalsModule {}
