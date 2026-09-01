import type {
  CreateExpense,
  ExpenseRecord,
  ListExpensesQuery,
  UpdateExpense,
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
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { QUEUE_PORT, type QueuePort } from '../../platform/queue/index.js';
import { callerHas, getContext, getOrganizationId } from '../../platform/request-context/index.js';
import {
  ApprovalService,
  ApprovalSubjectRegistry,
  type SettlementOutcome,
} from '../approvals/index.js';
import { PolicyContextService } from '../policies/policy-context.service.js';
import { PolicyRepositoryService } from '../policies/policy-repository.service.js';

/**
 * Expenses (epic 3.2).
 *
 * ## The same engine, a different question
 *
 * An expense goes through the identical policy evaluation and approval chain a
 * spend request does — deliberately, because "who has to agree to this?" has
 * one answer in an organisation and two implementations of it would drift
 * within a quarter. What differs is the **spend type** carried into the
 * context: `REIMBURSEMENT` when somebody paid out of pocket, `CARD` when the
 * company already paid. Most organisations govern those differently, and the
 * policy screen can express that without any code here knowing about it.
 *
 * ## The money is already gone
 *
 * A spend request that is blocked stops spending. A blocked expense stops
 * *nothing* — it refuses the reimbursement, or flags a charge that has already
 * settled. The state machine reflects that: an expense in `CHANGES_REQUESTED`
 * is a conversation, not a control, and cancelling one is withdrawing a claim
 * rather than stopping a purchase.
 *
 * ## The total is never the client's
 *
 * With items, the total is their sum. Without, it is the amount supplied. An
 * expense carrying both a total and items that sum to something else is a
 * disagreement the server refuses rather than resolves — resolving it means
 * picking a number nobody chose.
 */
@Injectable()
export class ExpensesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly policyContext: PolicyContextService,
    private readonly policies: PolicyRepositoryService,
    private readonly approvals: ApprovalService,
    private readonly subjects: ApprovalSubjectRegistry,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
  ) {}

  onModuleInit(): void {
    // The approvals module knows a subject type and an id, and nothing else.
    // This is where "what an approval *means* for an expense" lives.
    this.subjects.register('expense', {
      onApprovalSettled: (tx, organizationId, subjectId, outcome) =>
        this.onApprovalSettled(tx, organizationId, subjectId, outcome),
    });
  }

  async list(query: ListExpensesQuery): Promise<{ items: ExpenseRecord[]; total: number }> {
    const where: Prisma.ExpenseWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.paymentMethod === undefined ? {} : { paymentMethod: query.paymentMethod }),
      ...(query.q === undefined
        ? {}
        : { merchantName: { contains: query.q, mode: 'insensitive' } }),
      ...this.visibleToCaller(query.mine === true),
    };

    const [total, rows] = await Promise.all([
      this.database.client.expense.count({ where }),
      this.database.client.expense.findMany({
        where,
        select: SELECT,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: await Promise.all(rows.map((row) => this.toRecord(row))) };
  }

  async get(id: string): Promise<ExpenseRecord> {
    const row = await this.database.client.expense.findFirst({
      where: { id, ...this.visibleToCaller() },
      select: SELECT,
    });

    if (row === null) throw new NotFoundError('Expense');

    return this.toRecord(row);
  }

  async create(input: CreateExpense): Promise<ExpenseRecord> {
    const organizationId = requireOrganization();
    const submitterMembershipId = requireMembership();

    const total = totalOf(input);

    return this.database.unscoped.$transaction(async (tx) => {
      await this.assertReferencesAreOurs(tx, organizationId, input);

      const id = newId();

      await tx.expense.create({
        data: {
          id,
          organizationId,
          reference: await nextReference(tx, organizationId),
          submitterMembershipId,
          paymentMethod: input.paymentMethod,
          entityId: input.entityId,
          departmentId: input.departmentId ?? null,
          projectId: input.projectId ?? null,
          categoryId: input.categoryId ?? null,
          transactionId: input.transactionId ?? null,
          merchantName: input.merchantName,
          amount: total.toString(),
          currency: total.currency,
          // No conversion yet: the FX provider with its recorded rates is
          // Phase 5, and a converted amount whose rate nobody can reproduce is
          // a number that cannot be checked.
          amountInBaseCurrency: total.toString(),
          expenseDate: new Date(`${input.expenseDate}T00:00:00.000Z`),
          memo: input.memo ?? null,
          status: 'DRAFT',
          approvalInstanceId: null,
          submittedAt: null,
          decidedAt: null,
        },
      });

      await this.writeItems(tx, organizationId, id, input.items ?? []);

      await this.audit.record(tx, {
        action: 'expense.created',
        resourceType: 'expense',
        resourceId: id,
        after: {
          merchantName: input.merchantName,
          amount: total.toString(),
          currency: total.currency,
          paymentMethod: input.paymentMethod,
        },
      });

      const created = await tx.expense.findFirstOrThrow({ where: { id }, select: SELECT });

      return this.toRecord(created);
    });
  }

  async update(id: string, input: UpdateExpense, expectedVersion: number): Promise<ExpenseRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.expense.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Expense');

      guardVersion('Expense', expectedVersion, before.version);

      // A draft, or one an approver handed back. Editing after submission
      // would mean the approval was given for something else.
      if (before.status !== 'DRAFT' && before.status !== 'CHANGES_REQUESTED') {
        throw new InvalidStateTransitionError('Expense', before.status, 'DRAFT');
      }

      await this.assertReferencesAreOurs(tx, organizationId, input);

      const items = input.items;
      const total =
        items === undefined && input.amount === undefined
          ? null
          : totalOf({
              amount: input.amount,
              items: items ?? undefined,
              currency: before.currency,
            });

      if (items !== undefined) {
        await tx.expenseItem.deleteMany({ where: { organizationId, expenseId: id } });
        await this.writeItems(tx, organizationId, id, items);
      }

      await tx.expense.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.merchantName === undefined ? {} : { merchantName: input.merchantName }),
          ...(input.paymentMethod === undefined ? {} : { paymentMethod: input.paymentMethod }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.transactionId === undefined ? {} : { transactionId: input.transactionId }),
          ...(input.memo === undefined ? {} : { memo: input.memo }),
          ...(input.expenseDate === undefined
            ? {}
            : { expenseDate: new Date(`${input.expenseDate}T00:00:00.000Z`) }),
          ...(total === null
            ? {}
            : {
                amount: total.toString(),
                currency: total.currency,
                amountInBaseCurrency: total.toString(),
              }),
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'expense.updated',
        resourceType: 'expense',
        resourceId: id,
        before: { amount: before.amount, merchantName: before.merchantName },
      });

      const after = await tx.expense.findFirstOrThrow({ where: { id }, select: SELECT });

      return this.toRecord(after);
    });
  }

  /**
   * Submit, which is where policy runs.
   *
   * Identical in shape to a spend request's submission and identical for the
   * same reason: creating never decides anything, and submitting is the only
   * transition that evaluates. A create that could arrive approved would be a
   * way around every control the product has.
   */
  async submit(id: string, expectedVersion: number): Promise<ExpenseRecord> {
    const organizationId = requireOrganization();
    const now = new Date();

    const { record, activatedStepId } = await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.expense.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Expense');

      guardVersion('Expense', expectedVersion, before.version);

      if (before.status !== 'DRAFT' && before.status !== 'CHANGES_REQUESTED') {
        throw new InvalidStateTransitionError('Expense', before.status, 'PENDING_APPROVAL');
      }

      const receipts = await tx.receipt.count({
        where: {
          organizationId,
          attachedTargetType: 'expense',
          attachedTargetId: id,
          status: 'STORED',
        },
      });

      const context = await this.buildContext(tx, organizationId, before, receipts, now);

      const started = Date.now();
      const versions = await this.policies.activeVersions(
        tx,
        organizationId,
        context.spendType,
        now,
      );
      const decision = evaluate(context, versions, { durationMs: Date.now() - started });
      const decisionJson = decision as unknown as Prisma.InputJsonValue;

      if (decision.verdict === 'BLOCKED') {
        await tx.expense.update({
          where: { id, version: expectedVersion },
          data: { policyDecision: decisionJson, version: { increment: 1 } },
        });

        await this.audit.record(tx, {
          action: 'expense.blocked',
          resourceType: 'expense',
          resourceId: id,
          metadata: { reasons: decision.blocks.map((block) => block.reasonCode) },
        });

        /**
         * Blocked, not rejected (FR-EXP-003).
         *
         * The claim stays a draft and stays editable. A policy that requires a
         * receipt and does not have one is a thing the person can fix in
         * thirty seconds; recording it as a rejection would put a refusal in
         * their history for a missing attachment.
         */
        throw new PolicyBlockedError(
          decision.blocks.map((block) => ({
            reasonCode: block.reasonCode,
            message: block.message,
          })),
        );
      }

      this.assertEvidence(decision, before.memo, receipts);

      const chain =
        decision.requirements.approvalSteps.length === 0
          ? null
          : await this.approvals.open(tx, organizationId, {
              subjectType: 'expense',
              subjectId: id,
              context,
              decision,
              now,
            });

      const status = chain === null ? 'APPROVED' : 'PENDING_APPROVAL';

      await tx.expense.update({
        where: { id, version: expectedVersion },
        data: {
          status,
          policyDecision: decisionJson,
          approvalInstanceId: chain?.instanceId ?? null,
          submittedAt: now,
          decidedAt: chain === null ? now : null,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'expense.submitted',
        resourceType: 'expense',
        resourceId: id,
        after: { status, verdict: decision.verdict },
        metadata: {
          spendType: context.spendType,
          matchedRuleIds: decision.evaluation.matchedRuleIds,
          engineVersion: decision.evaluation.engineVersion,
        },
      });

      const after = await tx.expense.findFirstOrThrow({ where: { id }, select: SELECT });

      return {
        record: await this.toRecord(after),
        activatedStepId: chain?.activatedStepId ?? null,
      };
    });

    if (activatedStepId !== null) {
      await this.queue.enqueue(
        'notification.approval_requested',
        { organizationId, approvalStepId: activatedStepId },
        { idempotencyKey: `step:${activatedStepId}:requested` },
      );
    }

    return record;
  }

  /**
   * Withdraw a claim.
   *
   * Cancelling an expense withdraws a request to be paid back; it does not
   * unspend anything. Allowed from a draft or while awaiting approval, and
   * never after — an approved expense may already be in a batch.
   */
  async cancel(id: string, expectedVersion: number): Promise<ExpenseRecord> {
    const organizationId = requireOrganization();

    return this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.expense.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Expense');

      guardVersion('Expense', expectedVersion, before.version);

      if (before.status !== 'DRAFT' && before.status !== 'PENDING_APPROVAL') {
        throw new InvalidStateTransitionError('Expense', before.status, 'CANCELLED');
      }

      if (before.approvalInstanceId !== null) {
        await this.approvals.cancel(tx, organizationId, before.approvalInstanceId);
      }

      await tx.expense.update({
        where: { id, version: expectedVersion },
        data: { status: 'CANCELLED', decidedAt: new Date(), version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        action: 'expense.cancelled',
        resourceType: 'expense',
        resourceId: id,
        before: { status: before.status },
      });

      const after = await tx.expense.findFirstOrThrow({ where: { id }, select: SELECT });

      return this.toRecord(after);
    });
  }

  /**
   * What an approval means for an expense.
   *
   * Registered with the subject registry rather than called from the approval
   * controller: the chain knows a subject type and an id, and each owner
   * decides what settling does to its own record.
   */
  async onApprovalSettled(
    tx: Prisma.TransactionClient,
    organizationId: string,
    subjectId: string,
    outcome: SettlementOutcome,
  ): Promise<void> {
    const expense = await tx.expense.findFirst({
      where: { id: subjectId, organizationId },
      select: { id: true, status: true, version: true },
    });

    if (expense === null || expense.status !== 'PENDING_APPROVAL') return;

    const status = SETTLED_STATUS[outcome];

    await tx.expense.update({
      where: { id: subjectId },
      data: {
        status,
        // A return is not a decision: the claim goes back to its submitter and
        // will be decided by whatever chain the resubmission builds.
        ...(outcome === 'RETURNED' ? {} : { decidedAt: new Date() }),
        // Cleared either way, so resubmitting opens a new chain rather than
        // reattaching to a settled one — reusing it would be a way to pass a
        // larger claim through a smaller approval.
        approvalInstanceId: null,
        version: { increment: 1 },
      },
    });

    await this.audit.record(tx, {
      action: `expense.${status.toLowerCase()}`,
      resourceType: 'expense',
      resourceId: subjectId,
      after: { status },
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The evaluation context, with the expense's own spend type.
   *
   * `REIMBURSEMENT` or `CARD` — the whole reason two payment methods exist as
   * a field rather than as a note. An organisation that reviews card spend
   * lightly and scrutinises out-of-pocket claims closely can say so in policy,
   * and nothing here has to know that is what they did.
   */
  private async buildContext(
    tx: Prisma.TransactionClient,
    organizationId: string,
    expense: {
      id: string;
      submitterMembershipId: string;
      entityId: string;
      departmentId: string | null;
      projectId: string | null;
      categoryId: string | null;
      merchantName: string;
      amount: string;
      currency: string;
      memo: string | null;
      paymentMethod: string;
    },
    receiptCount: number,
    now: Date,
  ): Promise<PolicyContext> {
    const base = await this.policyContext.build(tx, organizationId, {
      spendType: expense.paymentMethod === 'COMPANY_CARD' ? 'CARD' : 'REIMBURSEMENT',
      requesterMembershipId: expense.submitterMembershipId,
      amount: expense.amount,
      currency: expense.currency,
      entityId: expense.entityId,
      projectId: expense.projectId,
      categoryId: expense.categoryId,
      merchantName: expense.merchantName,
      hasReceipt: receiptCount > 0,
      memo: expense.memo,
      now,
    });

    return {
      ...base,
      evidence: {
        ...base.evidence,
        hasReceipt: receiptCount > 0,
        receiptCount,
      },
    };
  }

  /**
   * The requirements a person can fix themselves.
   *
   * A missing memo or a missing receipt is the submitter's to supply, so it is
   * a validation failure naming the field rather than a policy block naming a
   * rule they cannot read.
   */
  private assertEvidence(
    decision: {
      requirements: {
        requireReceipt: boolean;
        requireMemo: { required: boolean; minLength: number };
      };
    },
    memo: string | null,
    receiptCount: number,
  ): void {
    const fields: Record<string, string[]> = {};

    if (decision.requirements.requireReceipt && receiptCount === 0) {
      fields['receipts'] = ['This kind of expense needs a receipt attached before you submit it.'];
    }

    const required = decision.requirements.requireMemo;

    if (required.required && (memo ?? '').trim().length < required.minLength) {
      fields['memo'] = [
        `Policy asks for at least ${String(required.minLength)} characters explaining this.`,
      ];
    }

    if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  }

  private async writeItems(
    tx: Prisma.TransactionClient,
    organizationId: string,
    expenseId: string,
    items: readonly {
      description: string;
      amount: { amount: string; currency: string };
      categoryId?: string | null | undefined;
    }[],
  ): Promise<void> {
    for (const item of items) {
      const money = Money.of(item.amount.amount, item.amount.currency);

      await tx.expenseItem.create({
        data: {
          id: newId(),
          organizationId,
          expenseId,
          description: item.description,
          amount: money.toString(),
          currency: money.currency,
          categoryId: item.categoryId ?? null,
        },
      });
    }
  }

  private async assertReferencesAreOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: Partial<CreateExpense> | UpdateExpense,
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

    for (const [field, model] of [
      ['departmentId', 'department'],
      ['projectId', 'project'],
      ['categoryId', 'category'],
      ['transactionId', 'transaction'],
    ] as const) {
      const value = input[field];

      if (value === undefined || value === null) continue;

      const found = await (
        tx[model] as { findFirst: (args: unknown) => Promise<{ id: string } | null> }
      ).findFirst({ where: { id: value, organizationId }, select: { id: true } });

      // A 404 rather than a 403 for another organisation's id: the field must
      // not become a way to test whether a record exists elsewhere.
      if (found === null) throw new NotFoundError(model);
    }
  }

  /**
   * What this caller may see.
   *
   * An expense is a person's own claim, often for something personal. Without
   * `expense:read_all` a caller sees their own, and that is the default rather
   * than the exception.
   */
  private visibleToCaller(mine = false): Prisma.ExpenseWhereInput {
    const membershipId = getContext()?.membershipId;

    if (membershipId === undefined) return {};
    if (callerHas('expense:read_all') && !mine) return {};

    return { submitterMembershipId: membershipId };
  }

  private async toRecord(row: Row): Promise<ExpenseRecord> {
    const receipts = await this.database.unscoped.receipt.findMany({
      where: {
        organizationId: row.organizationId,
        attachedTargetType: 'expense',
        attachedTargetId: row.id,
      },
      select: { id: true },
    });

    return {
      id: row.id,
      reference: row.reference,
      status: row.status as ExpenseRecord['status'],
      paymentMethod: row.paymentMethod as ExpenseRecord['paymentMethod'],
      submitter: {
        membershipId: row.submitterMembershipId,
        fullName: row.submitter.user.fullName,
      },
      entityId: row.entityId,
      departmentId: row.departmentId,
      projectId: row.projectId,
      categoryId: row.categoryId,
      transactionId: row.transactionId,
      merchantName: row.merchantName,
      amount: { amount: row.amount, currency: row.currency },
      expenseDate: row.expenseDate.toISOString(),
      memo: row.memo,
      items: row.items.map((item) => ({
        id: item.id,
        description: item.description,
        amount: { amount: item.amount, currency: item.currency },
        categoryId: item.categoryId,
      })),
      receiptIds: receipts.map((receipt) => receipt.id),
      policyDecision: row.policyDecision ?? null,
      approvalInstanceId: row.approvalInstanceId,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    };
  }
}

const SETTLED_STATUS: Readonly<
  Record<SettlementOutcome, 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'>
> = {
  APPROVED: 'APPROVED',
  OVERRIDDEN: 'APPROVED',
  REJECTED: 'REJECTED',
  RETURNED: 'CHANGES_REQUESTED',
};

const SELECT = {
  id: true,
  organizationId: true,
  reference: true,
  status: true,
  paymentMethod: true,
  submitterMembershipId: true,
  entityId: true,
  departmentId: true,
  projectId: true,
  categoryId: true,
  transactionId: true,
  merchantName: true,
  amount: true,
  currency: true,
  expenseDate: true,
  memo: true,
  policyDecision: true,
  approvalInstanceId: true,
  submittedAt: true,
  decidedAt: true,
  createdAt: true,
  version: true,
  submitter: { select: { user: { select: { fullName: true } } } },
  items: {
    select: { id: true, description: true, amount: true, currency: true, categoryId: true },
  },
} as const;

interface Row {
  id: string;
  organizationId: string;
  reference: string;
  status: string;
  paymentMethod: string;
  submitterMembershipId: string;
  entityId: string;
  departmentId: string | null;
  projectId: string | null;
  categoryId: string | null;
  transactionId: string | null;
  merchantName: string;
  amount: string;
  currency: string;
  expenseDate: Date;
  memo: string | null;
  policyDecision: unknown;
  approvalInstanceId: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  version: number;
  submitter: { user: { fullName: string } };
  items: Array<{
    id: string;
    description: string;
    amount: string;
    currency: string;
    categoryId: string | null;
  }>;
}

/**
 * The total, from the items when there are any.
 *
 * Both supplied and disagreeing is refused rather than resolved: picking one
 * means picking a number nobody chose, and the two most obvious rules — trust
 * the total, trust the items — are wrong in opposite directions.
 */
function totalOf(input: {
  amount?: { amount: string; currency: string } | undefined;
  items?: readonly { amount: { amount: string; currency: string } }[] | undefined;
  currency?: string;
}): Money {
  const items = input.items ?? [];

  if (items.length === 0) {
    if (input.amount === undefined) {
      throw new ValidationError({
        amount: ['Give an amount, or add the items it is made up of.'],
      });
    }

    return Money.of(input.amount.amount, input.amount.currency);
  }

  const first = items[0];

  /* c8 ignore next -- `items.length > 0` is checked above. */
  if (first === undefined) throw new ValidationError({ items: ['Add at least one item.'] });

  const currency = first.amount.currency;

  if (items.some((item) => item.amount.currency !== currency)) {
    // Summing across currencies needs a rate, and a rate nobody recorded is a
    // total nobody can check.
    throw new ValidationError({
      items: ['Every item has to be in the same currency. Raise a separate expense for the rest.'],
    });
  }

  const summed = Money.sum(
    items.map((item) => Money.of(item.amount.amount, item.amount.currency)),
    currency,
  );

  if (input.amount !== undefined) {
    const stated = Money.of(input.amount.amount, input.amount.currency);

    if (!stated.equals(summed)) {
      throw new ValidationError({
        amount: [
          `The total (${stated.toString()}) does not match the items (${summed.toString()}). Change one of them.`,
        ],
      });
    }
  }

  return summed;
}

/**
 * `EXP-00042`, sequential per organisation.
 *
 * Counted rather than held in a sequence table, which is honest about what it
 * is: a display reference, not an identifier. Two expenses created in the same
 * millisecond can collide, and the unique index turns that into a retry rather
 * than two records claiming one number.
 */
async function nextReference(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const count = await tx.expense.count({ where: { organizationId } });

  return `EXP-${String(count + 1).padStart(5, '0')}`;
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Expenses cannot be read or written without a tenant context.');
  }

  return organizationId;
}

function requireMembership(): string {
  const membershipId = getContext()?.membershipId;

  if (membershipId === undefined) {
    throw new Error('An expense must name the membership that submitted it.');
  }

  return membershipId;
}
