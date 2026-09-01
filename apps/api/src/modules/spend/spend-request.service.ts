import type {
  CreateSpendRequest,
  ListSpendRequestsQuery,
  SpendRequestRecord,
  UpdateSpendRequest,
} from '@financy/contracts';
import {
  ConflictError,
  InvalidStateTransitionError,
  Money,
  NotFoundError,
  PolicyBlockedError,
  ValidationError,
  evaluate,
  newId,
  type PolicyContext,
  type PolicyDecision,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { QUEUE_PORT, type QueuePort } from '../../platform/queue/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PolicyContextService } from '../policies/policy-context.service.js';
import { PolicyRepositoryService } from '../policies/policy-repository.service.js';

const SELECT = {
  id: true,
  reference: true,
  spendType: true,
  amount: true,
  currency: true,
  amountInBaseCurrency: true,
  purpose: true,
  memo: true,
  neededBy: true,
  status: true,
  requesterMembershipId: true,
  entityId: true,
  departmentId: true,
  projectId: true,
  categoryId: true,
  policyDecision: true,
  approvalInstanceId: true,
  validUntil: true,
  submittedAt: true,
  decidedAt: true,
  createdAt: true,
  version: true,
  requester: { select: { user: { select: { fullName: true } } } },
} as const;

/**
 * Spend requests (task 2.3).
 *
 * **Creation and submission are separate, and that separation is the control.**
 * A request is created as a draft; submitting it is what evaluates policy,
 * records the decision, and builds the approval chain. A create that could
 * arrive already approved would be a way around every control the product has,
 * so `status` appears in no write schema and the only route from `DRAFT` to
 * anything else runs through `submit`.
 *
 * **The decision is stored verbatim and never recomputed.** The screen that
 * answers "why did this need three approvals?" reads the snapshot taken at
 * submission, under the engine version recorded in it. Recomputing would
 * answer with today's policy — which is a different question, and a wrong
 * answer to the one being asked.
 *
 * **Everything happens in one transaction.** The decision, the chain, the
 * status change, and the audit event commit together or not at all: a request
 * marked pending with no chain is stuck forever, and a chain with no request
 * is an approval queue full of ghosts.
 */
@Injectable()
export class SpendRequestService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly policyContext: PolicyContextService,
    private readonly policies: PolicyRepositoryService,
    private readonly approvals: ApprovalService,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
  ) {}

  async list(
    query: ListSpendRequestsQuery,
  ): Promise<{ items: SpendRequestRecord[]; total: number }> {
    const membershipId = getContext()?.membershipId;

    const where: Record<string, unknown> = {};
    if (query.status !== undefined) where['status'] = query.status;
    if (query.mine === true && membershipId !== undefined) {
      where['requesterMembershipId'] = membershipId;
    }

    const [total, rows] = await Promise.all([
      this.database.client.spendRequest.count({ where }),
      this.database.client.spendRequest.findMany({
        where,
        select: SELECT,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map(toRecord) };
  }

  async get(id: string): Promise<SpendRequestRecord> {
    const row = await this.database.client.spendRequest.findFirst({
      where: { id },
      select: SELECT,
    });

    if (row === null) throw new NotFoundError('Spend request');

    return toRecord(row);
  }

  async create(input: CreateSpendRequest): Promise<SpendRequestRecord> {
    const organizationId = requireOrganization();
    const requesterMembershipId = getContext()?.membershipId;

    if (requesterMembershipId === undefined) {
      throw new Error('A spend request must name the membership that raised it.');
    }

    return this.database.unscoped.$transaction(async (tx) => {
      await this.assertReferencesAreOurs(tx, organizationId, input);

      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { baseCurrency: true },
      });

      if (organization === null) throw new NotFoundError('Organization');

      const amount = Money.of(input.amount.amount, input.amount.currency);

      const created = await tx.spendRequest.create({
        data: {
          id: newId(),
          organizationId,
          reference: await nextReference(tx, organizationId),
          requesterMembershipId,
          spendType: input.spendType,
          amount: amount.toJSON().amount,
          currency: amount.currency,
          // No conversion yet: a converted amount whose rate nobody can
          // reproduce is a number that cannot be checked, and the FX provider
          // with its recorded rates is Phase 5. Until then a policy authored
          // against the base currency sees the submitted amount unchanged.
          amountInBaseCurrency: amount.toJSON().amount,
          entityId: input.entityId,
          departmentId: input.departmentId ?? null,
          projectId: input.projectId ?? null,
          categoryId: input.categoryId ?? null,
          purpose: input.purpose,
          memo: input.memo ?? null,
          neededBy:
            input.neededBy === undefined || input.neededBy === null
              ? null
              : new Date(`${input.neededBy}T00:00:00.000Z`),
          status: 'DRAFT',
        },
        select: SELECT,
      });

      await this.audit.record(tx, {
        action: 'spend_request.created',
        resourceType: 'spend_request',
        resourceId: created.id,
        after: { reference: created.reference, amount: created.amount, currency: created.currency },
      });

      return toRecord(created);
    });
  }

  async update(
    id: string,
    input: UpdateSpendRequest,
    expectedVersion: number,
  ): Promise<SpendRequestRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.spendRequest.findFirst({
        where: { id, organizationId },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Spend request');

      guardVersion('Spend request', expectedVersion, before.version);

      // A draft, or a request an approver has handed back. Nothing else: once
      // submitted, the request is the thing approvers are looking at, and
      // editing it underneath them would mean the approval was given for
      // something other than what was approved.
      if (before.status !== 'DRAFT' && before.status !== 'CHANGES_REQUESTED') {
        throw new InvalidStateTransitionError('Spend request', before.status, 'DRAFT');
      }

      await this.assertReferencesAreOurs(tx, organizationId, input);

      const amount =
        input.amount === undefined ? null : Money.of(input.amount.amount, input.amount.currency);

      const after = await tx.spendRequest.update({
        where: { id, version: expectedVersion },
        data: {
          ...(amount === null
            ? {}
            : {
                amount: amount.toJSON().amount,
                currency: amount.currency,
                amountInBaseCurrency: amount.toJSON().amount,
              }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
          ...(input.memo === undefined ? {} : { memo: input.memo }),
          ...(input.neededBy === undefined
            ? {}
            : {
                neededBy:
                  input.neededBy === null ? null : new Date(`${input.neededBy}T00:00:00.000Z`),
              }),
          version: { increment: 1 },
        },
        select: SELECT,
      });

      await this.audit.record(tx, {
        action: 'spend_request.updated',
        resourceType: 'spend_request',
        resourceId: id,
        before: { amount: before.amount, purpose: before.purpose },
        after: { amount: after.amount, purpose: after.purpose },
      });

      return toRecord(after);
    });
  }

  /**
   * Submit: evaluate policy, record the decision, build the chain.
   *
   * The order matters. The decision is taken first and stored whatever it
   * says — including when it blocks, because "this was refused, and here is
   * why" is a record somebody needs. Only then is the chain built, and only
   * if the decision asked for one.
   */
  async submit(id: string, expectedVersion: number): Promise<SpendRequestRecord> {
    const organizationId = requireOrganization();
    const now = new Date();

    const { record, activatedStepId } = await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.spendRequest.findFirst({
        where: { id, organizationId },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Spend request');

      guardVersion('Spend request', expectedVersion, before.version);

      /**
       * A draft, or one that was returned for changes.
       *
       * Resubmission after a return re-runs evaluation completely rather than
       * reopening the old chain. The amount or the category may have changed,
       * and reusing a chain built for the previous figures would be a way to
       * launder a larger amount through a smaller approval (docs/11 §7.1).
       * That happens for free here, because submission always evaluates from
       * scratch — the point is that nothing in this method is allowed to
       * shortcut it.
       */
      if (before.status !== 'DRAFT' && before.status !== 'CHANGES_REQUESTED') {
        throw new InvalidStateTransitionError('Spend request', before.status, 'SUBMITTED');
      }

      const context: PolicyContext = await this.policyContext.build(tx, organizationId, {
        spendType: before.spendType,
        amount: before.amount,
        currency: before.currency,
        requesterMembershipId: before.requesterMembershipId,
        entityId: before.entityId,
        categoryId: before.categoryId,
        projectId: before.projectId,
        memo: before.memo,
        neededBy: before.neededBy,
        now,
      });

      const started = Date.now();
      const policies = await this.policies.activeVersions(
        tx,
        organizationId,
        before.spendType,
        now,
      );
      const decision = evaluate(context, policies, { durationMs: Date.now() - started });

      // Stored before anything branches on it, so a blocked request still
      // carries the reasons that blocked it.
      const decisionJson = decision as unknown as Prisma.InputJsonValue;

      if (decision.verdict === 'BLOCKED') {
        await tx.spendRequest.update({
          where: { id, version: expectedVersion },
          data: { policyDecision: decisionJson, version: { increment: 1 } },
        });

        await this.audit.record(tx, {
          action: 'spend_request.blocked',
          resourceType: 'spend_request',
          resourceId: id,
          metadata: { reasons: decision.blocks.map((block) => block.reasonCode) },
        });

        // The request stays a draft. A blocked submission is not a rejected
        // request — nobody decided anything — and leaving it editable is what
        // lets the person fix what the policy objected to.
        throw new PolicyBlockedError(
          decision.blocks.map((block) => ({
            reasonCode: block.reasonCode,
            message: block.message,
          })),
        );
      }

      // Evidence requirements are checked here rather than by the evaluator,
      // which only says what is required. A memo shorter than a rule demands
      // is the requester's to fix, so it is a validation failure naming the
      // field rather than a policy block naming a rule.
      this.assertEvidence(decision, before.memo);

      const chain =
        decision.requirements.approvalSteps.length === 0
          ? null
          : await this.approvals.open(tx, organizationId, {
              subjectType: 'spend_request',
              subjectId: id,
              context,
              decision,
              now,
            });

      const status = chain === null ? 'APPROVED' : 'PENDING_APPROVAL';

      const after = await tx.spendRequest.update({
        where: { id, version: expectedVersion },
        data: {
          status,
          policyDecision: decisionJson,
          approvalInstanceId: chain?.instanceId ?? null,
          submittedAt: now,
          decidedAt: chain === null ? now : null,
          validUntil:
            decision.requirements.validityDays === null
              ? null
              : new Date(now.getTime() + decision.requirements.validityDays * 86_400_000),
          version: { increment: 1 },
        },
        select: SELECT,
      });

      await this.audit.record(tx, {
        action: 'spend_request.submitted',
        resourceType: 'spend_request',
        resourceId: id,
        after: { status, verdict: decision.verdict },
        metadata: {
          matchedRuleIds: decision.evaluation.matchedRuleIds,
          policyVersionIds: decision.evaluation.policyVersionIds,
          engineVersion: decision.evaluation.engineVersion,
          approvalSteps: decision.requirements.approvalSteps.length,
        },
      });

      return { record: toRecord(after), activatedStepId: chain?.activatedStepId ?? null };
    });

    if (activatedStepId !== null) {
      // After the commit, never inside it (docs/14 §1). A job enqueued inside
      // a transaction that then rolled back would ask five people to approve
      // a request that does not exist, and an email cannot be rolled back.
      //
      // The key names the step, so a redelivery is one notification rather
      // than two — which is the queue guarantee this has to absorb rather
      // than assume away.
      await this.queue.enqueue(
        'notification.approval_requested',
        { organizationId, approvalStepId: activatedStepId },
        { idempotencyKey: `step:${activatedStepId}:requested` },
      );
    }

    return record;
  }

  async cancel(id: string, expectedVersion: number): Promise<SpendRequestRecord> {
    const organizationId = requireOrganization();
    const membershipId = getContext()?.membershipId;

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.spendRequest.findFirst({
        where: { id, organizationId },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Spend request');

      guardVersion('Spend request', expectedVersion, before.version);

      // Only the person who raised it may withdraw it. An administrator who
      // wants it stopped rejects it through the approval chain, which records
      // who decided and why — cancelling on somebody's behalf would erase
      // that distinction.
      if (membershipId !== undefined && before.requesterMembershipId !== membershipId) {
        throw new ConflictError('Only the person who raised this request can cancel it.');
      }

      // FR-SPD-010: anything not yet decided. A request handed back for changes
      // is one the requester is most likely to want to abandon — it is sitting
      // in their list asking them to do work they have decided against.
      if (
        before.status !== 'DRAFT' &&
        before.status !== 'SUBMITTED' &&
        before.status !== 'PENDING_APPROVAL' &&
        before.status !== 'CHANGES_REQUESTED'
      ) {
        throw new InvalidStateTransitionError('Spend request', before.status, 'CANCELLED');
      }

      if (before.approvalInstanceId !== null) {
        await this.approvals.cancel(tx, organizationId, before.approvalInstanceId);
      }

      const after = await tx.spendRequest.update({
        where: { id, version: expectedVersion },
        data: { status: 'CANCELLED', decidedAt: new Date(), version: { increment: 1 } },
        select: SELECT,
      });

      await this.audit.record(tx, {
        action: 'spend_request.cancelled',
        resourceType: 'spend_request',
        resourceId: id,
        before: { status: before.status },
        after: { status: 'CANCELLED' },
      });

      return toRecord(after);
    });
  }

  /**
   * Called by the approval machinery when a chain finishes.
   *
   * On the service rather than in it, because the approval module must not
   * know the shape of a spend request — the same chain machinery serves
   * expenses and bills from Phase 3.
   */
  async onApprovalSettled(
    tx: Prisma.TransactionClient,
    organizationId: string,
    subjectId: string,
    outcome: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'OVERRIDDEN',
  ): Promise<void> {
    const request = await tx.spendRequest.findFirst({
      where: { id: subjectId, organizationId },
      select: { id: true, version: true, status: true },
    });

    if (request === null || request.status !== 'PENDING_APPROVAL') return;

    const status = SETTLED_STATUS[outcome];

    await tx.spendRequest.update({
      where: { id: subjectId },
      data: {
        status,
        /**
         * A return is not a decision, so it does not stamp `decidedAt`.
         *
         * The request goes back to its requester and will be decided later, by
         * whatever chain the resubmission builds. Stamping it here would make
         * a request that is still open look settled in every report that reads
         * that column.
         */
        ...(outcome === 'RETURNED' ? {} : { decidedAt: new Date() }),
        // The chain is over either way. Clearing the link on a return is what
        // makes resubmission build a new one rather than reattaching to a
        // settled instance.
        ...(outcome === 'RETURNED' ? { approvalInstanceId: null } : {}),
        version: { increment: 1 },
      },
    });

    await this.audit.record(tx, {
      action: SETTLED_AUDIT_ACTIONS[outcome],
      resourceType: 'spend_request',
      resourceId: subjectId,
      before: { status: 'PENDING_APPROVAL' },
      after: { status },
    });
  }

  private assertEvidence(decision: PolicyDecision, memo: string | null): void {
    const { requireMemo } = decision.requirements;

    if (!requireMemo.required) return;

    const length = memo?.trim().length ?? 0;

    if (length >= requireMemo.minLength) return;

    throw new ValidationError({
      memo:
        requireMemo.minLength > 0
          ? [`Policy requires a memo of at least ${String(requireMemo.minLength)} characters.`]
          : ['Policy requires a memo on this request.'],
    });
  }

  /**
   * Every id the request points at must belong to this organisation.
   *
   * A `404` rather than a `403`, as everywhere else: a caller must never learn
   * that an id exists in somebody else's organisation. PostgreSQL made these
   * impossible with composite foreign keys; on MongoDB this is the only thing
   * standing between a request and another customer's department.
   */
  private async assertReferencesAreOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: {
      entityId?: string | undefined;
      departmentId?: string | null | undefined;
      projectId?: string | null | undefined;
      categoryId?: string | null | undefined;
    },
  ): Promise<void> {
    if (input.entityId !== undefined) {
      const entity = await tx.entity.findFirst({
        where: { id: input.entityId, organizationId },
        select: { status: true },
      });

      if (entity === null) throw new NotFoundError('Entity');
      if (entity.status !== 'ACTIVE') {
        throw new ConflictError('That entity is archived. Choose an active one.');
      }
    }

    for (const [value, model, label] of [
      [input.departmentId, tx.department, 'Department'],
      [input.projectId, tx.project, 'Project'],
      [input.categoryId, tx.category, 'Category'],
    ] as const) {
      if (value === undefined || value === null) continue;

      const found = await (model as { findFirst: (args: unknown) => Promise<unknown> }).findFirst({
        where: { id: value, organizationId },
        select: { id: true },
      });

      if (found === null) throw new NotFoundError(label);
    }
  }
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Spend requests cannot be written without a tenant context.');
  }

  return organizationId;
}

/**
 * The next human-facing reference, numbered within the organisation.
 *
 * Per organisation rather than globally, so one customer's volume is not
 * visible to another — a global counter tells every customer roughly how much
 * business the product is doing.
 *
 * Counted inside the caller's transaction. Two concurrent submissions could
 * still collide on the count, and the unique index on
 * `(organizationId, reference)` is what makes that a retryable error rather
 * than two requests sharing a number.
 */
async function nextReference(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const count = await tx.spendRequest.count({ where: { organizationId } });

  return `SR-${String(count + 1).padStart(5, '0')}`;
}

interface Row {
  id: string;
  reference: string;
  spendType: string;
  amount: string;
  currency: string;
  amountInBaseCurrency: string;
  purpose: string;
  memo: string | null;
  neededBy: Date | null;
  status: string;
  requesterMembershipId: string;
  entityId: string;
  departmentId: string | null;
  projectId: string | null;
  categoryId: string | null;
  policyDecision: unknown;
  approvalInstanceId: string | null;
  validUntil: Date | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  version: number;
  requester: { user: { fullName: string } };
}

function toRecord(row: Row): SpendRequestRecord {
  return {
    id: row.id,
    reference: row.reference,
    spendType: row.spendType as SpendRequestRecord['spendType'],
    amount: { amount: row.amount, currency: row.currency },
    amountInBaseCurrency: { amount: row.amountInBaseCurrency, currency: row.currency },
    purpose: row.purpose,
    memo: row.memo,
    neededBy: row.neededBy === null ? null : (row.neededBy.toISOString().split('T')[0] ?? null),
    status: row.status as SpendRequestRecord['status'],
    requester: { membershipId: row.requesterMembershipId, fullName: row.requester.user.fullName },
    entityId: row.entityId,
    departmentId: row.departmentId,
    projectId: row.projectId,
    categoryId: row.categoryId,
    policyDecision: (row.policyDecision ?? null) as SpendRequestRecord['policyDecision'],
    approvalInstanceId: row.approvalInstanceId,
    validUntil: row.validUntil?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/**
 * What each chain outcome means for the request.
 *
 * An **override** lands on `APPROVED`, and the collapse is deliberate: for
 * everything downstream — budgets, cards, reports — a request finance forced
 * through is approved and spendable, and giving it a status of its own would
 * mean every consumer had to learn a fourth case to treat identically to the
 * third. The distinction is not lost: the approval instance is `OVERRIDDEN`,
 * the action row says `OVERRIDE`, and the audit event is
 * `spend_request.overridden` with the mandatory reason attached.
 */
const SETTLED_STATUS: Readonly<
  Record<'APPROVED' | 'REJECTED' | 'RETURNED' | 'OVERRIDDEN', SpendRequestRecord['status']>
> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RETURNED: 'CHANGES_REQUESTED',
  OVERRIDDEN: 'APPROVED',
};

const SETTLED_AUDIT_ACTIONS: Readonly<
  Record<'APPROVED' | 'REJECTED' | 'RETURNED' | 'OVERRIDDEN', string>
> = {
  APPROVED: 'spend_request.approved',
  REJECTED: 'spend_request.rejected',
  RETURNED: 'spend_request.returned',
  OVERRIDDEN: 'spend_request.overridden',
};
