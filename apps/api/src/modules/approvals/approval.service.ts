import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SelfApprovalForbiddenError,
  StepNotActionableError,
  newId,
  type PolicyContext,
  type PolicyDecision,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import type { ApprovalInstance as ApprovalInstanceView } from '@financy/contracts';

import { AuditService } from '../../platform/audit/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { ApprovalResolverService } from './approval-resolver.service.js';

export interface OpenChainInput {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly context: PolicyContext;
  readonly decision: PolicyDecision;
  readonly now: Date;
}

/**
 * How a chain ended.
 *
 * `RETURNED` sits beside the two terminal outcomes because it settles the
 * *chain* while leaving the subject alive — the requester edits and resubmits,
 * and resubmission re-evaluates policy from scratch rather than reusing the
 * chain. Reusing it would be a way to launder a larger amount through a
 * smaller approval (docs/11 §7.1).
 */
export interface ChainSettled {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly outcome: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'OVERRIDDEN';
}

/**
 * The approval state machine (tasks 2.2.4 to 2.2.6, docs/11 §7).
 *
 * **Steps run in sequence; approvers within a step run in parallel.** Only one
 * step is `ACTIVE` at a time, and it is the lowest-numbered one still
 * outstanding. That is what makes "the manager, then finance" mean what it
 * says rather than asking both at once.
 *
 * **A rejection ends the chain immediately.** Not "the remaining steps are
 * skipped" — the instance is rejected and nothing else is asked. Continuing to
 * collect approvals on a rejected request would produce an audit trail in
 * which somebody approved something that had already been refused.
 *
 * **Every transition re-reads the step inside the transaction and checks its
 * status again** (task 2.2.6). Two approvers pressing the button at the same
 * instant is the ordinary case in a `PARALLEL_ANY` step, and without the
 * re-check both would complete the step, both would advance the instance, and
 * the chain would skip a step. The version column makes the second write fail
 * rather than duplicate.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly resolver: ApprovalResolverService,
  ) {}

  /** Build and open a chain. Returns the instance the subject should record. */
  async open(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: OpenChainInput,
  ): Promise<{ instanceId: string }> {
    const steps = await this.resolver.resolve(
      tx,
      organizationId,
      input.context,
      input.decision.requirements.approvalSteps,
      input.now,
    );

    const instanceId = newId();

    await tx.approvalInstance.create({
      data: {
        id: instanceId,
        organizationId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: 'PENDING',
        currentStepSequence: steps[0]?.sequence ?? 1,
        // The decision is copied onto the instance as well as onto the
        // subject. The instance outlives the policy version that produced it,
        // and "why was this the chain?" has to stay answerable afterwards.
        policyDecisionSnapshot: input.decision as unknown as Prisma.InputJsonValue,
      },
    });

    for (const [index, step] of steps.entries()) {
      const isFirst = index === 0;

      await tx.approvalStep.create({
        data: {
          id: newId(),
          organizationId,
          approvalInstanceId: instanceId,
          sequence: step.sequence,
          stepType: step.stepType,
          quorum: step.quorum,
          // Only the first step opens. The rest wait, which is what makes the
          // sequence a sequence.
          status: isFirst ? 'ACTIVE' : 'WAITING',
          eligibleMembershipIds: [...step.eligibleMembershipIds],
          activatedAt: isFirst ? input.now : null,
          dueAt: step.dueAt,
        },
      });
    }

    await this.audit.record(tx, {
      action: 'approval.opened',
      resourceType: 'approval_instance',
      resourceId: instanceId,
      metadata: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        steps: steps.length,
      },
    });

    return { instanceId };
  }

  /**
   * Act on the active step.
   *
   * Returns how the chain ended, or `null` if it is still running — the caller
   * owns the subject and is the only thing that knows what an approval means
   * for it.
   */
  async act(
    tx: Prisma.TransactionClient,
    organizationId: string,
    instanceId: string,
    action: 'APPROVE' | 'REJECT' | 'RETURN' | 'OVERRIDE',
    comment: string | null,
  ): Promise<ChainSettled | null> {
    const actorMembershipId = getContext()?.membershipId;

    if (actorMembershipId === undefined) {
      throw new ForbiddenError('Only a member of this organisation can act on an approval.');
    }

    const instance = await tx.approvalInstance.findFirst({
      where: { id: instanceId, organizationId },
      select: {
        id: true,
        status: true,
        subjectType: true,
        subjectId: true,
        currentStepSequence: true,
        version: true,
      },
    });

    if (instance === null) throw new NotFoundError('Approval');

    if (instance.status !== 'PENDING') {
      throw new ConflictError('This approval has already been decided.');
    }

    // Re-read inside the transaction, and check the status again. Two
    // approvers pressing the button at the same instant is ordinary; without
    // this the second would complete an already-completed step and advance
    // the chain twice.
    const step = await tx.approvalStep.findFirst({
      where: {
        organizationId,
        approvalInstanceId: instanceId,
        sequence: instance.currentStepSequence,
      },
      select: {
        id: true,
        sequence: true,
        stepType: true,
        quorum: true,
        status: true,
        eligibleMembershipIds: true,
        version: true,
      },
    });

    if (step === null) throw new NotFoundError('Approval step');

    // An escalated step is still actionable. A step that stopped accepting
    // approvals the moment it went past its due date would be a chain nobody
    // can finish — the escalation adds an approver, it does not remove one.
    if (step.status !== 'ACTIVE' && step.status !== 'ESCALATED') {
      throw new StepNotActionableError();
    }

    /**
     * An override is not an approval, and it is not gated on being an approver.
     *
     * That is the entire point of it (FR-APR-010): finance settles a chain that
     * is stuck — an approver who has left, a step nobody is eligible for after a
     * reorganisation — and the person doing it is by definition not one of the
     * people the chain named. The route gates it on `approval:override`
     * separately, the reason is mandatory, and it is recorded as an override
     * rather than as an approval so that "this was approved" never covers a case
     * where nobody with the authority to approve it ever did.
     */
    if (action !== 'OVERRIDE' && !step.eligibleMembershipIds.includes(actorMembershipId)) {
      // A 403 rather than a 404: the caller can see the request, they simply
      // are not one of its approvers, and telling them so is the difference
      // between a usable product and a confusing one.
      throw new ForbiddenError('You are not an approver for this step.');
    }

    const existing = await tx.approvalAction.findMany({
      where: { organizationId, approvalStepId: step.id },
      select: { actedByMembershipId: true, action: true },
    });

    if (
      action !== 'OVERRIDE' &&
      existing.some((entry) => entry.actedByMembershipId === actorMembershipId)
    ) {
      throw new ConflictError('You have already acted on this step.');
    }

    await tx.approvalAction.create({
      data: {
        id: newId(),
        organizationId,
        approvalStepId: step.id,
        actedByMembershipId: actorMembershipId,
        action,
        comment,
      },
    });

    await this.audit.record(tx, {
      action: AUDIT_ACTIONS[action],
      resourceType: 'approval_step',
      resourceId: step.id,
      metadata: { instanceId, sequence: step.sequence, ...(comment === null ? {} : { comment }) },
    });

    if (action === 'REJECT' || action === 'RETURN' || action === 'OVERRIDE') {
      // Any of the three ends the chain here and now. Not "the rest are
      // skipped": continuing to collect approvals on a request that has been
      // refused, returned, or forced through would produce a trail in which
      // somebody approved what had already been settled.
      const stepStatus =
        action === 'REJECT' ? 'REJECTED' : action === 'RETURN' ? 'RETURNED' : 'SKIPPED';
      const instanceStatus =
        action === 'REJECT' ? 'REJECTED' : action === 'RETURN' ? 'RETURNED' : 'OVERRIDDEN';

      await this.closeStep(tx, step.id, step.version, stepStatus);
      await this.skipOutstandingSteps(tx, organizationId, instanceId);
      await this.closeInstance(tx, instance.id, instance.version, instanceStatus);

      return {
        subjectType: instance.subjectType,
        subjectId: instance.subjectId,
        outcome: action === 'REJECT' ? 'REJECTED' : action === 'RETURN' ? 'RETURNED' : 'OVERRIDDEN',
      };
    }

    const approvals = existing.filter((entry) => entry.action === 'APPROVE').length + 1;

    if (
      !this.stepIsSatisfied(
        step.stepType,
        step.quorum,
        step.eligibleMembershipIds.length,
        approvals,
      )
    ) {
      // Still waiting on other approvers in this step. Nothing else moves.
      return null;
    }

    await this.closeStep(tx, step.id, step.version, 'APPROVED');

    const next = await tx.approvalStep.findFirst({
      where: {
        organizationId,
        approvalInstanceId: instanceId,
        sequence: { gt: step.sequence },
        status: 'WAITING',
      },
      orderBy: [{ sequence: 'asc' }],
      select: { id: true, sequence: true, version: true },
    });

    if (next === null) {
      await this.closeInstance(tx, instance.id, instance.version, 'APPROVED');

      return {
        subjectType: instance.subjectType,
        subjectId: instance.subjectId,
        outcome: 'APPROVED',
      };
    }

    await tx.approvalStep.update({
      where: { id: next.id, version: next.version },
      data: { status: 'ACTIVE', activatedAt: new Date(), version: { increment: 1 } },
    });

    await tx.approvalInstance.update({
      where: { id: instance.id, version: instance.version },
      data: { currentStepSequence: next.sequence, version: { increment: 1 } },
    });

    return null;
  }

  async cancel(
    tx: Prisma.TransactionClient,
    organizationId: string,
    instanceId: string,
  ): Promise<void> {
    const instance = await tx.approvalInstance.findFirst({
      where: { id: instanceId, organizationId },
      select: { id: true, status: true, version: true },
    });

    if (instance === null || instance.status !== 'PENDING') return;

    await this.closeInstance(tx, instance.id, instance.version, 'CANCELLED');

    // Outstanding steps are marked skipped rather than left active, so the
    // approval queue does not keep showing work nobody can complete.
    await tx.approvalStep.updateMany({
      where: {
        organizationId,
        approvalInstanceId: instanceId,
        status: { in: ['ACTIVE', 'WAITING'] },
      },
      data: { status: 'SKIPPED', completedAt: new Date() },
    });

    await this.audit.record(tx, {
      action: 'approval.cancelled',
      resourceType: 'approval_instance',
      resourceId: instanceId,
    });
  }

  /**
   * Whether a step has collected enough approvals.
   *
   * `PARALLEL_ALL` needs everybody eligible — which is why the eligible list
   * is frozen when the chain opens: a step that recomputed eligibility would
   * change its own completion condition every time somebody joined a team.
   */
  private stepIsSatisfied(
    stepType: string,
    quorum: number,
    eligible: number,
    approvals: number,
  ): boolean {
    switch (stepType) {
      case 'PARALLEL_ALL':
        return approvals >= eligible;
      case 'QUORUM':
        return approvals >= Math.min(quorum, eligible);
      default:
        // `SINGLE` and `PARALLEL_ANY`: one approval is the whole requirement.
        return approvals >= 1;
    }
  }

  /**
   * Mark every step that will now never run.
   *
   * Left alone, an `ACTIVE` step on a settled chain keeps appearing in its
   * approvers' queues as work nobody can complete — and a `WAITING` one leaves
   * the timeline showing a future that is not coming.
   */
  private async skipOutstandingSteps(
    tx: Prisma.TransactionClient,
    organizationId: string,
    instanceId: string,
  ): Promise<void> {
    await tx.approvalStep.updateMany({
      where: {
        organizationId,
        approvalInstanceId: instanceId,
        status: { in: ['ACTIVE', 'WAITING', 'ESCALATED'] },
      },
      data: { status: 'SKIPPED', completedAt: new Date() },
    });
  }

  private async closeStep(
    tx: Prisma.TransactionClient,
    stepId: string,
    version: number,
    status: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'SKIPPED',
  ): Promise<void> {
    await tx.approvalStep.update({
      // `version` in the `where`: if another approver's transaction moved this
      // step between the read and here, this write fails rather than
      // overwriting their decision.
      where: { id: stepId, version },
      data: { status, completedAt: new Date(), version: { increment: 1 } },
    });
  }

  private async closeInstance(
    tx: Prisma.TransactionClient,
    instanceId: string,
    version: number,
    status: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED' | 'OVERRIDDEN',
  ): Promise<void> {
    await tx.approvalInstance.update({
      where: { id: instanceId, version },
      data: { status, completedAt: new Date(), version: { increment: 1 } },
    });
  }

  /**
   * One chain, with its steps, its approvers, and everything anybody did to it.
   *
   * **Approvers are shown by name.** "Waiting on two people" is not something a
   * requester can act on; "waiting on Priya and the finance team" is — they can
   * go and ask. The names come from the ids frozen when the chain opened, so
   * the timeline shows who it was actually assigned to rather than who would be
   * assigned if it were raised today.
   *
   * `canAct` is computed here rather than inferred by the caller from the
   * approver list: the rules for who may act on a step are the service's, and a
   * second copy of them in the frontend is a second copy that drifts.
   */
  async instance(instanceId: string): Promise<ApprovalInstanceView | null> {
    const organizationId = getOrganizationId();
    const membershipId = getContext()?.membershipId;

    if (organizationId === undefined) return null;

    const instance = await this.database.unscoped.approvalInstance.findFirst({
      where: { id: instanceId, organizationId },
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        status: true,
        currentStepSequence: true,
        completedAt: true,
        createdAt: true,
        steps: {
          orderBy: [{ sequence: 'asc' }],
          select: {
            id: true,
            sequence: true,
            stepType: true,
            quorum: true,
            status: true,
            eligibleMembershipIds: true,
            activatedAt: true,
            dueAt: true,
            completedAt: true,
            actions: {
              orderBy: [{ createdAt: 'asc' }],
              select: {
                id: true,
                action: true,
                comment: true,
                createdAt: true,
                actedByMembershipId: true,
                actedBy: { select: { user: { select: { fullName: true } } } },
                onBehalfOfMembershipId: true,
                onBehalfOf: { select: { user: { select: { fullName: true } } } },
              },
            },
          },
        },
      },
    });

    if (instance === null) return null;

    // One query for every name the timeline needs, rather than one per step.
    const referenced = [...new Set(instance.steps.flatMap((step) => step.eligibleMembershipIds))];

    const people =
      referenced.length === 0
        ? []
        : await this.database.unscoped.membership.findMany({
            where: { organizationId, id: { in: referenced } },
            select: { id: true, user: { select: { fullName: true } } },
          });

    const nameOf = new Map(people.map((person) => [person.id, person.user.fullName]));

    const openStep = instance.steps.find(
      (step) => step.status === 'ACTIVE' || step.status === 'ESCALATED',
    );

    return {
      id: instance.id,
      subjectType: instance.subjectType,
      subjectId: instance.subjectId,
      status: instance.status,
      currentStepSequence: instance.currentStepSequence,
      canAct:
        instance.status === 'PENDING' &&
        membershipId !== undefined &&
        openStep !== undefined &&
        openStep.eligibleMembershipIds.includes(membershipId) &&
        !openStep.actions.some((action) => action.actedByMembershipId === membershipId),
      steps: instance.steps.map((step) => ({
        id: step.id,
        sequence: step.sequence,
        stepType: step.stepType,
        quorum: step.quorum,
        status: step.status,
        approvers: step.eligibleMembershipIds.map((id) => ({
          membershipId: id,
          fullName: nameOf.get(id) ?? 'Unknown',
        })),
        actions: step.actions.map((action) => ({
          id: action.id,
          action: action.action,
          comment: action.comment,
          actedBy: {
            membershipId: action.actedByMembershipId,
            fullName: action.actedBy.user.fullName,
          },
          onBehalfOf:
            action.onBehalfOfMembershipId === null || action.onBehalfOf === null
              ? null
              : {
                  membershipId: action.onBehalfOfMembershipId,
                  fullName: action.onBehalfOf.user.fullName,
                },
          createdAt: action.createdAt.toISOString(),
        })),
        activatedAt: step.activatedAt?.toISOString() ?? null,
        dueAt: step.dueAt?.toISOString() ?? null,
        completedAt: step.completedAt?.toISOString() ?? null,
      })),
      completedAt: instance.completedAt?.toISOString() ?? null,
      createdAt: instance.createdAt.toISOString(),
    };
  }

  /**
   * What is waiting for this person (task 2.2.9).
   *
   * Only steps that are `ACTIVE` and name them. A queue that showed waiting
   * steps would show work nobody can do yet, and a queue that showed steps
   * they had already acted on would never empty.
   */
  async queue(): Promise<
    Array<{
      instanceId: string;
      stepId: string;
      sequence: number;
      subjectType: string;
      subjectId: string;
      dueAt: string | null;
      activatedAt: string | null;
    }>
  > {
    const organizationId = getOrganizationId();
    const membershipId = getContext()?.membershipId;

    if (organizationId === undefined || membershipId === undefined) return [];

    const steps = await this.database.unscoped.approvalStep.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        eligibleMembershipIds: { has: membershipId },
      },
      select: {
        id: true,
        sequence: true,
        dueAt: true,
        activatedAt: true,
        approvalInstanceId: true,
        instance: { select: { subjectType: true, subjectId: true, status: true } },
        actions: { select: { actedByMembershipId: true } },
      },
      orderBy: [{ activatedAt: 'asc' }],
    });

    return steps
      .filter(
        (step) =>
          step.instance.status === 'PENDING' &&
          // Somebody who has already approved a `PARALLEL_ALL` step is still
          // eligible for it; the step is just not theirs to act on any more.
          !step.actions.some((action) => action.actedByMembershipId === membershipId),
      )
      .map((step) => ({
        instanceId: step.approvalInstanceId,
        stepId: step.id,
        sequence: step.sequence,
        subjectType: step.instance.subjectType,
        subjectId: step.instance.subjectId,
        dueAt: step.dueAt?.toISOString() ?? null,
        activatedAt: step.activatedAt?.toISOString() ?? null,
      }));
  }
}

/**
 * One audit action per approval action.
 *
 * A map rather than a ternary, because the point of the audit trail is that
 * `approval.overridden` and `approval.approved` are different events. Folding
 * an override into "approved" would make the one action that bypassed the
 * chain the hardest one to find.
 */
const AUDIT_ACTIONS: Readonly<Record<'APPROVE' | 'REJECT' | 'RETURN' | 'OVERRIDE', string>> = {
  APPROVE: 'approval.approved',
  REJECT: 'approval.rejected',
  RETURN: 'approval.returned',
  OVERRIDE: 'approval.overridden',
};

/** Re-exported so the spend module can name the refusal it maps to a 403. */
export { SelfApprovalForbiddenError };
