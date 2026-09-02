import { randomBytes } from 'node:crypto';

import type {
  BillDetail,
  BillRecord,
  CreateBill,
  CreateCreditNote,
  ListBillsQuery,
  MarkBillPaid,
  UpdateBill,
} from '@financy/contracts';
import { MATCH_TOLERANCE_PERCENT } from '@financy/contracts';
import {
  ConflictError,
  InvalidStateTransitionError,
  Money,
  NotFoundError,
  PolicyBlockedError,
  ValidationError,
  evaluate,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { QUEUE_PORT, type QueuePort } from '../../platform/queue/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { ApprovalService, ApprovalSubjectRegistry } from '../approvals/index.js';
import { PolicyContextService } from '../policies/policy-context.service.js';
import { PolicyRepositoryService } from '../policies/policy-repository.service.js';

/**
 * Bills (FR-BIL-001…004, epic 5.2).
 *
 * ## The same engine, a third subject type
 *
 * A bill submits into the **identical** policy evaluation and approval chain a
 * spend request and an expense use, carrying `spendType = BILL`. Nothing in the
 * approvals module knows what a bill is, and a test asserts the shared path —
 * because two implementations of "who has to agree to this" drift within a
 * quarter and nobody can then say which is authoritative.
 *
 * ## The invoice number is the control against paying twice
 *
 * `(organisation, vendor, billNumber)` is unique, and that index — not a
 * pre-flight check — is what stops the same invoice being entered on Tuesday by
 * accounts and on Thursday by whoever chased it. Two people entering it at the
 * same moment both pass a check; only one passes an index.
 *
 * ## A paid bill is immutable, and a correction is a credit note
 *
 * FR-BIL-004. Editing a paid bill changes a figure that has already been paid,
 * reported, and possibly exported to a ledger, and nothing downstream would
 * know. A credit note is a second record that offsets the first, which is what
 * the accounts expect to see anyway.
 */
@Injectable()
export class BillsService implements OnModuleInit {
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
    this.subjects.register('bill', {
      onApprovalSettled: (tx, organizationId, subjectId, outcome) =>
        this.onApprovalSettled(tx, organizationId, subjectId, outcome),
    });
  }

  async list(query: ListBillsQuery): Promise<{ items: BillRecord[]; total: number }> {
    const where: Prisma.BillWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.vendorId === undefined ? {} : { vendorId: query.vendorId }),
      ...(query.overdue === true
        ? { dueDate: { lt: new Date() }, status: { in: ['APPROVED', 'PENDING_APPROVAL'] } }
        : {}),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { billNumber: { contains: query.q, mode: 'insensitive' } },
              { reference: { contains: query.q, mode: 'insensitive' } },
              { memo: { contains: query.q, mode: 'insensitive' } },
            ],
          }),
    };

    const [total, rows] = await Promise.all([
      this.database.client.bill.count({ where }),
      this.database.client.bill.findMany({
        where,
        include: { vendor: { select: { id: true, name: true } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map((row) => toRecord(row)) };
  }

  async get(id: string): Promise<BillDetail> {
    const row = await this.database.client.bill.findFirst({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        lines: { orderBy: { sequence: 'asc' } },
      },
    });

    if (row === null) throw new NotFoundError('Bill');

    return {
      ...toRecord(row),
      lines: row.lines.map((line) => ({
        id: line.id,
        sequence: line.sequence,
        description: line.description,
        quantity: line.quantity,
        unitAmount: { amount: line.unitAmount, currency: line.currency },
        lineAmount: { amount: line.lineAmount, currency: line.currency },
        categoryId: line.categoryId,
        departmentId: line.departmentId,
        projectId: line.projectId,
        purchaseOrderLineId: line.purchaseOrderLineId,
      })),
      match: await this.matchOf(row.id),
    };
  }

  async create(input: CreateBill): Promise<BillDetail> {
    const organizationId = requireOrganization();
    const submitter = getContext()?.membershipId ?? null;
    const currency = input.currency.toUpperCase();

    const vendor = await this.database.unscoped.vendor.findFirst({
      where: { id: input.vendorId, organizationId },
      select: { id: true, status: true, paymentTermsDays: true },
    });

    if (vendor === null) throw new ValidationError({ vendorId: ['That supplier does not exist.'] });

    if (vendor.status === 'MERGED') {
      throw new ValidationError({
        vendorId: ['That supplier was merged into another. Bill the one it points at.'],
      });
    }

    const entity = await this.database.unscoped.entity.findFirst({
      where: { id: input.entityId, organizationId },
      select: { id: true },
    });

    if (entity === null) throw new ValidationError({ entityId: ['That entity does not exist.'] });

    const lines = input.lines.map((line, index) => {
      const quantity = line.quantity.trim() === '' ? '1' : line.quantity;
      const unit = Money.of(line.unitAmount, currency);

      return {
        id: newId(),
        sequence: index + 1,
        description: line.description,
        quantity,
        unitAmount: unit.toJSON().amount,
        // Computed here, never accepted: a line whose total disagrees with its
        // own quantity and price is a number somebody pays and then argues
        // about for a week.
        lineAmount: unit.multiply(quantity).toJSON().amount,
        currency,
        categoryId: line.categoryId ?? null,
        departmentId: line.departmentId ?? null,
        projectId: line.projectId ?? null,
        purchaseOrderLineId: line.purchaseOrderLineId ?? null,
      };
    });

    const total = Money.sum(
      lines.map((line) => Money.of(line.lineAmount, currency)),
      currency,
    );

    const issueDate = new Date(`${input.issueDate}T00:00:00.000Z`);
    const dueDate =
      input.dueDate === undefined
        ? new Date(issueDate.getTime() + vendor.paymentTermsDays * 86_400_000)
        : new Date(`${input.dueDate}T00:00:00.000Z`);

    const id = newId();

    try {
      await this.database.unscoped.$transaction(async (tx) => {
        await tx.bill.create({
          data: {
            id,
            organizationId,
            vendorId: input.vendorId,
            entityId: input.entityId,
            billNumber: input.billNumber,
            reference: await nextReference(tx, organizationId),
            issueDate,
            dueDate,
            totalAmount: total.toJSON().amount,
            currency,
            status: 'DRAFT',
            memo: input.memo ?? null,
            submittedByMembershipId: submitter,
          },
        });

        await tx.billLine.createMany({
          data: lines.map((line) => ({ ...line, organizationId, billId: id })),
        });

        await this.audit.record(tx, {
          organizationId,
          action: 'bill.created',
          resourceType: 'bill',
          resourceId: id,
          after: {
            billNumber: input.billNumber,
            vendorId: input.vendorId,
            total: total.toJSON().amount,
            currency,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'That invoice number is already recorded against this supplier. Paying the same invoice twice is what this refuses.',
        );
      }
      throw error;
    }

    return this.get(id);
  }

  async update(id: string, input: UpdateBill, expectedVersion: number): Promise<BillDetail> {
    const organizationId = requireOrganization();

    const existing = await this.database.client.bill.findFirst({ where: { id } });
    if (existing === null) throw new NotFoundError('Bill');

    guardVersion('Bill', expectedVersion, existing.version);

    if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      throw new InvalidStateTransitionError(
        'Bill',
        existing.status,
        'edited',
        // A paid bill is corrected with a credit note; one in approval is
        // corrected by returning it.
      );
    }

    const currency = (input.currency ?? existing.currency).toUpperCase();

    await this.database.unscoped.$transaction(async (tx) => {
      if (input.lines !== undefined) {
        await tx.billLine.deleteMany({ where: { billId: id, organizationId } });

        const lines = input.lines.map((line, index) => {
          const unit = Money.of(line.unitAmount, currency);
          const quantity = line.quantity.trim() === '' ? '1' : line.quantity;

          return {
            id: newId(),
            organizationId,
            billId: id,
            sequence: index + 1,
            description: line.description,
            quantity,
            unitAmount: unit.toJSON().amount,
            lineAmount: unit.multiply(quantity).toJSON().amount,
            currency,
            categoryId: line.categoryId ?? null,
            departmentId: line.departmentId ?? null,
            projectId: line.projectId ?? null,
            purchaseOrderLineId: line.purchaseOrderLineId ?? null,
          };
        });

        await tx.billLine.createMany({ data: lines });

        await tx.bill.updateMany({
          where: { id, organizationId },
          data: {
            totalAmount: Money.sum(
              lines.map((line) => Money.of(line.lineAmount, currency)),
              currency,
            ).toJSON().amount,
          },
        });
      }

      const updated = await tx.bill.updateMany({
        where: { id, organizationId, version: existing.version },
        data: {
          ...(input.billNumber === undefined ? {} : { billNumber: input.billNumber }),
          ...(input.vendorId === undefined ? {} : { vendorId: input.vendorId }),
          ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
          ...(input.issueDate === undefined
            ? {}
            : { issueDate: new Date(`${input.issueDate}T00:00:00.000Z`) }),
          ...(input.dueDate === undefined
            ? {}
            : { dueDate: new Date(`${input.dueDate}T00:00:00.000Z`) }),
          ...(input.currency === undefined ? {} : { currency }),
          ...(input.memo === undefined ? {} : { memo: input.memo }),
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) throw new ConflictError('The bill changed. Read it again.');

      await this.audit.record(tx, {
        organizationId,
        action: 'bill.updated',
        resourceType: 'bill',
        resourceId: id,
        before: { total: existing.totalAmount, status: existing.status },
        after: { ...input, lines: input.lines === undefined ? undefined : input.lines.length },
      });
    });

    return this.get(id);
  }

  /**
   * Submit for approval — the same evaluation and the same chain as everything
   * else (FR-BIL-003).
   */
  async submit(id: string, expectedVersion: number): Promise<BillDetail> {
    const organizationId = requireOrganization();
    const submitter = getContext()?.membershipId;

    if (submitter === undefined) throw new Error('A bill must be submitted by a membership.');

    const activatedStepId = await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.bill.findFirst({
        where: { id, organizationId },
        include: { lines: true },
      });

      if (before === null) throw new NotFoundError('Bill');

      guardVersion('Bill', expectedVersion, before.version);

      if (before.status !== 'DRAFT' && before.status !== 'REJECTED') {
        throw new InvalidStateTransitionError('Bill', before.status, 'PENDING_APPROVAL');
      }

      const now = new Date();
      const started = Date.now();

      const context = await this.policyContext.build(tx, organizationId, {
        spendType: 'BILL',
        amount: before.totalAmount,
        currency: before.currency,
        requesterMembershipId: submitter,
        entityId: before.entityId,
        // A bill's classification is its lines', and a bill routinely spans
        // several. The first line's dimensions stand in for the whole, which
        // is what a person would answer if asked "what is this bill for?".
        categoryId: before.lines[0]?.categoryId ?? null,
        projectId: before.lines[0]?.projectId ?? null,
        vendorId: before.vendorId,
        merchantName: null,
        hasReceipt: false,
        memo: before.memo,
        now,
      });

      const versions = await this.policies.activeVersions(tx, organizationId, 'BILL', now);
      const decision = evaluate(context, versions, { durationMs: Date.now() - started });
      const decisionJson = decision as unknown as Prisma.InputJsonValue;

      if (decision.verdict === 'BLOCKED') {
        await tx.bill.update({
          where: { id, version: expectedVersion },
          data: { policyDecision: decisionJson, version: { increment: 1 } },
        });

        await this.audit.record(tx, {
          organizationId,
          action: 'bill.blocked',
          resourceType: 'bill',
          resourceId: id,
          metadata: { reasons: decision.blocks.map((block) => block.reasonCode) },
        });

        throw new PolicyBlockedError(
          decision.blocks.map((block) => ({
            reasonCode: block.reasonCode,
            message: block.message,
          })),
        );
      }

      // No steps means nothing to approve, and opening an empty chain would
      // leave an instance nobody can act on beside a bill that is already
      // approved.
      const opened =
        decision.requirements.approvalSteps.length === 0
          ? null
          : await this.approvals.open(tx, organizationId, {
              subjectType: 'bill',
              subjectId: id,
              context,
              decision,
              now,
            });

      await tx.bill.update({
        where: { id, version: expectedVersion },
        data: {
          status: opened === null ? 'APPROVED' : 'PENDING_APPROVAL',
          policyDecision: decisionJson,
          approvalInstanceId: opened?.instanceId ?? null,
          submittedAt: now,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'bill.submitted',
        resourceType: 'bill',
        resourceId: id,
        before: { status: before.status },
        after: { status: opened === null ? 'APPROVED' : 'PENDING_APPROVAL' },
      });

      return opened?.activatedStepId ?? null;
    });

    if (activatedStepId !== null) {
      await this.queue.enqueue(
        'notification.approval_requested',
        { organizationId, approvalStepId: activatedStepId },
        { idempotencyKey: `step:${activatedStepId}:requested` },
      );
    }

    return this.get(id);
  }

  /** Record that a bill has been paid, with the reference that proves it. */
  async markPaid(id: string, input: MarkBillPaid, expectedVersion: number): Promise<BillDetail> {
    const organizationId = requireOrganization();
    const payer = getContext()?.membershipId ?? null;

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.bill.findFirst({ where: { id, organizationId } });

      if (before === null) throw new NotFoundError('Bill');

      guardVersion('Bill', expectedVersion, before.version);

      if (before.status !== 'APPROVED') {
        throw new InvalidStateTransitionError('Bill', before.status, 'PAID');
      }

      await tx.bill.update({
        where: { id, version: expectedVersion },
        data: {
          status: 'PAID',
          paymentReference: input.paymentReference,
          paidAt: input.paidAt === undefined ? new Date() : new Date(input.paidAt),
          paidByMembershipId: payer,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'bill.paid',
        resourceType: 'bill',
        resourceId: id,
        before: { status: before.status },
        after: { status: 'PAID', paymentReference: input.paymentReference },
      });
    });

    // The money has left. `actualize` records the spend and releases the
    // commitment approval made, in one movement pair — a bill that recorded its
    // actual and kept its reservation reads as twice as spent for the rest of
    // the period.
    await this.queue.enqueue(
      'budget.apply',
      { organizationId, operation: 'ACTUALIZE', sourceType: 'BILL', sourceId: id },
      { idempotencyKey: `budget:BILL:${id}:ACTUALIZE` },
    );

    return this.get(id);
  }

  /**
   * Offset a paid bill with a credit note (FR-BIL-004).
   *
   * A second record rather than an edit, because the original has been paid and
   * reported and possibly exported. The note carries the same lines negated, so
   * a report that sums both sees the corrected figure without anything special
   * happening.
   */
  async creditNote(
    id: string,
    input: CreateCreditNote,
    expectedVersion: number,
  ): Promise<BillDetail> {
    const organizationId = requireOrganization();

    const original = await this.database.unscoped.bill.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });

    if (original === null) throw new NotFoundError('Bill');

    guardVersion('Bill', expectedVersion, original.version);

    if (original.status !== 'PAID' && original.status !== 'APPROVED') {
      throw new InvalidStateTransitionError('Bill', original.status, 'CREDIT_NOTE');
    }

    const currency = original.currency;
    const requested = input.amount;
    const full = requested === undefined;
    const amount = full
      ? Money.of(original.totalAmount, currency)
      : Money.of(requested.amount, currency);

    if (amount.greaterThan(Money.of(original.totalAmount, currency))) {
      throw new ValidationError({
        amount: ['A credit note cannot be larger than the bill it offsets.'],
      });
    }

    const noteId = newId();

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.bill.create({
        data: {
          id: noteId,
          organizationId,
          vendorId: original.vendorId,
          entityId: original.entityId,
          // Distinct from the original's, because the unique index is per
          // supplier per number and a credit note is a different document.
          billNumber: `CN-${original.billNumber}`,
          reference: await nextReference(tx, organizationId, 'CN'),
          issueDate: new Date(),
          dueDate: new Date(),
          totalAmount: amount.negate().toJSON().amount,
          currency,
          status: 'CREDIT_NOTE',
          creditsBillId: id,
          memo: input.reason,
          submittedByMembershipId: getContext()?.membershipId ?? null,
        },
      });

      await tx.billLine.createMany({
        data: full
          ? original.lines.map((line) => ({
              id: newId(),
              organizationId,
              billId: noteId,
              sequence: line.sequence,
              description: `Credit: ${line.description}`,
              quantity: line.quantity,
              unitAmount: Money.of(line.unitAmount, currency).negate().toJSON().amount,
              lineAmount: Money.of(line.lineAmount, currency).negate().toJSON().amount,
              currency,
              categoryId: line.categoryId,
              departmentId: line.departmentId,
              projectId: line.projectId,
              purchaseOrderLineId: line.purchaseOrderLineId,
            }))
          : [
              {
                id: newId(),
                organizationId,
                billId: noteId,
                sequence: 1,
                description: input.reason,
                quantity: '1',
                unitAmount: amount.negate().toJSON().amount,
                lineAmount: amount.negate().toJSON().amount,
                currency,
                categoryId: original.lines[0]?.categoryId ?? null,
                departmentId: original.lines[0]?.departmentId ?? null,
                projectId: original.lines[0]?.projectId ?? null,
                purchaseOrderLineId: null,
              },
            ],
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'bill.credited',
        resourceType: 'bill',
        resourceId: id,
        after: { creditNoteId: noteId, amount: amount.toJSON().amount, reason: input.reason },
      });
    });

    return this.get(noteId);
  }

  async cancel(id: string, expectedVersion: number): Promise<BillDetail> {
    const organizationId = requireOrganization();
    let released = false;

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.bill.findFirst({ where: { id, organizationId } });

      if (before === null) throw new NotFoundError('Bill');

      guardVersion('Bill', expectedVersion, before.version);

      if (before.status === 'PAID') {
        throw new ConflictError('A paid bill is cancelled with a credit note, not by deleting it.');
      }

      await tx.bill.update({
        where: { id, version: expectedVersion },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'bill.cancelled',
        resourceType: 'bill',
        resourceId: id,
        before: { status: before.status },
        after: { status: 'CANCELLED' },
      });

      if (before.status === 'APPROVED') {
        released = true;
      }
    });

    // A cancelled bill that kept its reservation holds budget nobody can spend
    // and nobody can find a reason for.
    if (released) {
      await this.queue.enqueue(
        'budget.apply',
        { organizationId, operation: 'RELEASE', sourceType: 'BILL', sourceId: id },
        { idempotencyKey: `budget:BILL:${id}:RELEASE` },
      );
    }

    return this.get(id);
  }

  /**
   * The three-way match, when the bill names PO lines (FR-PRC-003).
   *
   * **A percentage tolerance, not a fixed amount.** Rounding, freight, and
   * exchange move an invoice by a fraction of a percent routinely; a fixed
   * tolerance is either meaningless on a large order or paralysing on a small
   * one. Anything outside it is a variance a person looks at, named down to the
   * line that caused it — "this bill does not match" with no line reference is
   * a message that sends somebody to a spreadsheet.
   */
  async matchOf(billId: string): Promise<BillDetail['match']> {
    const lines = await this.database.unscoped.billLine.findMany({
      where: { billId, purchaseOrderLineId: { not: null } },
      include: { purchaseOrderLine: true },
    });

    if (lines.length === 0) return null;

    const verdicts = lines.map((line) => {
      const orderLine = line.purchaseOrderLine;
      const currency = line.currency;

      if (orderLine === null) {
        return {
          billLineId: line.id,
          orderedQuantity: '0',
          receivedQuantity: '0',
          billedQuantity: line.quantity,
          orderedAmount: { amount: '0.0000', currency },
          billedAmount: { amount: line.lineAmount, currency },
          variancePercent: 100,
          verdict: 'VARIANCE' as const,
        };
      }

      const ordered = Money.of(orderLine.lineAmount, currency);
      const billed = Money.of(line.lineAmount, currency);
      const received = Number(orderLine.receivedQuantity);
      const billedQuantity = Number(line.quantity);

      const orderedNumber = Number(ordered.toJSON().amount);
      const variance =
        orderedNumber === 0
          ? 100
          : Math.abs(
              ((Number(billed.toJSON().amount) - orderedNumber) / orderedNumber) * 100,
            );

      const verdict =
        received <= 0
          ? ('NOT_RECEIVED' as const)
          : billedQuantity > received
            ? ('VARIANCE' as const)
            : variance === 0
              ? ('MATCHED' as const)
              : variance <= MATCH_TOLERANCE_PERCENT
                ? ('WITHIN_TOLERANCE' as const)
                : ('VARIANCE' as const);

      return {
        billLineId: line.id,
        orderedQuantity: orderLine.quantity,
        receivedQuantity: orderLine.receivedQuantity,
        billedQuantity: line.quantity,
        orderedAmount: { amount: ordered.toJSON().amount, currency },
        billedAmount: { amount: billed.toJSON().amount, currency },
        variancePercent: Math.round(variance * 100) / 100,
        verdict,
      };
    });

    // The worst line decides the bill. A bill that reported "matched" because
    // most of its lines did is a bill somebody pays without looking.
    const status = verdicts.some((line) => line.verdict === 'VARIANCE')
      ? ('VARIANCE' as const)
      : verdicts.some((line) => line.verdict === 'NOT_RECEIVED')
        ? ('NOT_RECEIVED' as const)
        : verdicts.some((line) => line.verdict === 'WITHIN_TOLERANCE')
          ? ('WITHIN_TOLERANCE' as const)
          : ('MATCHED' as const);

    return { status, lines: verdicts };
  }

  /** Called by the approval machinery when a bill's chain finishes. */
  async onApprovalSettled(
    tx: Prisma.TransactionClient,
    organizationId: string,
    subjectId: string,
    outcome: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'OVERRIDDEN',
  ): Promise<void> {
    const bill = await tx.bill.findFirst({
      where: { id: subjectId, organizationId },
      select: { id: true, status: true },
    });

    if (bill === null || bill.status !== 'PENDING_APPROVAL') return;

    const status =
      outcome === 'REJECTED' ? 'REJECTED' : outcome === 'RETURNED' ? 'DRAFT' : 'APPROVED';

    await tx.bill.update({
      where: { id: subjectId },
      data: {
        status,
        // A returned bill goes back to a draft and builds a new chain when it
        // is resubmitted, rather than reattaching to a settled one.
        ...(outcome === 'RETURNED' ? { approvalInstanceId: null } : {}),
        version: { increment: 1 },
      },
    });

    await this.audit.record(tx, {
      organizationId,
      action: `bill.${status.toLowerCase()}`,
      resourceType: 'bill',
      resourceId: subjectId,
      before: { status: 'PENDING_APPROVAL' },
      after: { status },
    });
  }
}

interface BillRow {
  id: string;
  reference: string;
  billNumber: string;
  status: string;
  vendor: { id: string; name: string };
  entityId: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: string;
  currency: string;
  approvalInstanceId: string | null;
  policyDecision: unknown;
  paymentReference: string | null;
  paidAt: Date | null;
  creditsBillId: string | null;
  memo: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  version: number;
}

function toRecord(row: BillRow): BillRecord {
  return {
    id: row.id,
    reference: row.reference,
    billNumber: row.billNumber,
    status: row.status as BillRecord['status'],
    vendor: row.vendor,
    entityId: row.entityId,
    issueDate: row.issueDate.toISOString(),
    dueDate: row.dueDate.toISOString(),
    total: { amount: row.totalAmount, currency: row.currency },
    currency: row.currency,
    approvalInstanceId: row.approvalInstanceId,
    policyDecision: row.policyDecision ?? null,
    paymentReference: row.paymentReference,
    paidAt: row.paidAt?.toISOString() ?? null,
    creditsBillId: row.creditsBillId,
    memo: row.memo,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    // Negative when overdue, so a list sorts by urgency without arithmetic in
    // the browser.
    daysUntilDue: Math.round((row.dueDate.getTime() - Date.now()) / 86_400_000),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/**
 * Our own reference for a bill, distinct from the supplier's number.
 *
 * Counted rather than random, because a person reads it aloud on a phone call
 * with a supplier. The count is scoped to the organisation and the collision
 * case is handled by the unique index above it, which retries with a suffix
 * rather than failing the whole entry.
 */
async function nextReference(
  tx: Prisma.TransactionClient,
  organizationId: string,
  prefix = 'BILL',
): Promise<string> {
  const count = await tx.bill.count({ where: { organizationId } });

  // The suffix breaks a tie when two entries are counted at the same instant.
  // Random rather than sequential because a second counter is a second thing
  // to keep consistent, and the unique index is what actually decides.
  return `${prefix}-${String(count + 1).padStart(4, '0')}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
