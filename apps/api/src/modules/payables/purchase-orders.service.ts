import type {
  CreatePurchaseOrder,
  ListPurchaseOrdersQuery,
  PurchaseOrderDetail,
  PurchaseOrderRecord,
  ReceivePurchaseOrder,
  UpdatePurchaseOrder,
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
  quantity,
  subtractQuantities,
  sumQuantities,
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
 * Purchase orders (FR-PRC-001…003, epic 5.3).
 *
 * ## An approved order commits budget
 *
 * That is the whole reason for having one. The money is spoken for from the
 * moment somebody agrees to the purchase, not from the moment the invoice
 * arrives six weeks later — otherwise a department can approve four orders it
 * cannot collectively afford and nobody finds out until the bills land in the
 * same week.
 *
 * ## The fourth subject type, and the same engine again
 *
 * `spendType = PURCHASE_ORDER` into the identical evaluator and chain. The
 * approvals module still knows nothing about any of the four.
 *
 * ## Receiving is append-only
 *
 * A delivery that arrives in two vans is two receipts, and a correction is a
 * negative one. Overwriting a received quantity is how a warehouse loses half a
 * shipment on paper and how a three-way match starts agreeing with the wrong
 * number.
 */
@Injectable()
export class PurchaseOrdersService implements OnModuleInit {
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
    this.subjects.register('purchase_order', {
      onApprovalSettled: (tx, organizationId, subjectId, outcome) =>
        this.onApprovalSettled(tx, organizationId, subjectId, outcome),
    });
  }

  async list(
    query: ListPurchaseOrdersQuery,
  ): Promise<{ items: PurchaseOrderRecord[]; total: number }> {
    const membershipId = getContext()?.membershipId;

    const where: Prisma.PurchaseOrderWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.vendorId === undefined ? {} : { vendorId: query.vendorId }),
      ...(query.mine === true && membershipId !== undefined
        ? { requesterMembershipId: membershipId }
        : {}),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { poNumber: { contains: query.q, mode: 'insensitive' } },
              { memo: { contains: query.q, mode: 'insensitive' } },
            ],
          }),
    };

    const [total, rows] = await Promise.all([
      this.database.client.purchaseOrder.count({ where }),
      this.database.client.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true } },
          requester: { select: { id: true, user: { select: { fullName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map((row) => toRecord(row)) };
  }

  async get(id: string): Promise<PurchaseOrderDetail> {
    const row = await this.database.client.purchaseOrder.findFirst({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        requester: { select: { id: true, user: { select: { fullName: true } } } },
        lines: { orderBy: { sequence: 'asc' } },
      },
    });

    if (row === null) throw new NotFoundError('Purchase order');

    return {
      ...toRecord(row),
      lines: row.lines.map((line) => {
        return {
          id: line.id,
          sequence: line.sequence,
          description: line.description,
          quantity: line.quantity,
          unitAmount: { amount: line.unitAmount, currency: line.currency },
          lineAmount: { amount: line.lineAmount, currency: line.currency },
          receivedQuantity: line.receivedQuantity,
          // Computed on the server like every other figure. A browser
          // subtracting two decimal strings is the arithmetic this codebase
          // exists to keep out of browsers.
          outstandingQuantity: subtractQuantities(line.quantity, line.receivedQuantity),
          categoryId: line.categoryId,
        };
      }),
    };
  }

  async create(input: CreatePurchaseOrder): Promise<PurchaseOrderDetail> {
    const organizationId = requireOrganization();
    const requester = getContext()?.membershipId;

    if (requester === undefined) {
      throw new Error('A purchase order must name the membership that raised it.');
    }

    const currency = input.currency.toUpperCase();

    const [vendor, entity] = await Promise.all([
      this.database.unscoped.vendor.findFirst({
        where: { id: input.vendorId, organizationId },
        select: { id: true, status: true },
      }),
      this.database.unscoped.entity.findFirst({
        where: { id: input.entityId, organizationId },
        select: { id: true },
      }),
    ]);

    if (vendor === null) throw new ValidationError({ vendorId: ['That supplier does not exist.'] });
    if (vendor.status === 'MERGED') {
      throw new ValidationError({
        vendorId: ['That supplier was merged into another. Order from the one it points at.'],
      });
    }
    if (entity === null) throw new ValidationError({ entityId: ['That entity does not exist.'] });

    const lines = input.lines.map((line, index) => {
      const unit = Money.of(line.unitAmount, currency);

      return {
        id: newId(),
        organizationId,
        sequence: index + 1,
        description: line.description,
        quantity: quantity(line.quantity),
        unitAmount: unit.toJSON().amount,
        lineAmount: unit.multiply(line.quantity).toJSON().amount,
        currency,
        receivedQuantity: '0.0000',
        categoryId: line.categoryId ?? null,
      };
    });

    const total = Money.sum(
      lines.map((line) => Money.of(line.lineAmount, currency)),
      currency,
    );

    const id = newId();

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.purchaseOrder.create({
        data: {
          id,
          organizationId,
          poNumber: await nextPoNumber(tx, organizationId),
          vendorId: input.vendorId,
          entityId: input.entityId,
          requesterMembershipId: requester,
          totalAmount: total.toJSON().amount,
          currency,
          status: 'DRAFT',
          expectedDate:
            input.expectedDate === undefined
              ? null
              : new Date(`${input.expectedDate}T00:00:00.000Z`),
          departmentId: input.departmentId ?? null,
          projectId: input.projectId ?? null,
          categoryId: input.categoryId ?? null,
          memo: input.memo ?? null,
        },
      });

      await tx.purchaseOrderLine.createMany({
        data: lines.map((line) => ({ ...line, purchaseOrderId: id })),
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'purchase_order.created',
        resourceType: 'purchase_order',
        resourceId: id,
        after: { vendorId: input.vendorId, total: total.toJSON().amount, currency },
      });
    });

    return this.get(id);
  }

  async update(
    id: string,
    input: UpdatePurchaseOrder,
    expectedVersion: number,
  ): Promise<PurchaseOrderDetail> {
    const organizationId = requireOrganization();

    const existing = await this.database.client.purchaseOrder.findFirst({ where: { id } });
    if (existing === null) throw new NotFoundError('Purchase order');

    guardVersion('Purchase order', expectedVersion, existing.version);

    if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      throw new InvalidStateTransitionError('Purchase order', existing.status, 'edited');
    }

    const currency = (input.currency ?? existing.currency).toUpperCase();

    await this.database.unscoped.$transaction(async (tx) => {
      if (input.lines !== undefined) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id, organizationId } });

        const lines = input.lines.map((line, index) => {
          const unit = Money.of(line.unitAmount, currency);

          return {
            id: newId(),
            organizationId,
            purchaseOrderId: id,
            sequence: index + 1,
            description: line.description,
            quantity: line.quantity,
            unitAmount: unit.toJSON().amount,
            lineAmount: unit.multiply(line.quantity).toJSON().amount,
            currency,
            receivedQuantity: '0.0000',
            categoryId: line.categoryId ?? null,
          };
        });

        await tx.purchaseOrderLine.createMany({ data: lines });

        await tx.purchaseOrder.updateMany({
          where: { id, organizationId },
          data: {
            totalAmount: Money.sum(
              lines.map((line) => Money.of(line.lineAmount, currency)),
              currency,
            ).toJSON().amount,
          },
        });
      }

      const updated = await tx.purchaseOrder.updateMany({
        where: { id, organizationId, version: existing.version },
        data: {
          ...(input.vendorId === undefined ? {} : { vendorId: input.vendorId }),
          ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
          ...(input.currency === undefined ? {} : { currency }),
          ...(input.expectedDate === undefined
            ? {}
            : { expectedDate: new Date(`${input.expectedDate}T00:00:00.000Z`) }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.memo === undefined ? {} : { memo: input.memo }),
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictError('The purchase order changed. Read it again.');
      }

      await this.audit.record(tx, {
        organizationId,
        action: 'purchase_order.updated',
        resourceType: 'purchase_order',
        resourceId: id,
        before: { total: existing.totalAmount, status: existing.status },
        after: { ...input, lines: input.lines === undefined ? undefined : input.lines.length },
      });
    });

    return this.get(id);
  }

  async submit(id: string, expectedVersion: number): Promise<PurchaseOrderDetail> {
    const organizationId = requireOrganization();
    const requester = getContext()?.membershipId;

    if (requester === undefined) {
      throw new Error('A purchase order must be submitted by a membership.');
    }

    const activatedStepId = await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.purchaseOrder.findFirst({ where: { id, organizationId } });

      if (before === null) throw new NotFoundError('Purchase order');

      guardVersion('Purchase order', expectedVersion, before.version);

      if (before.status !== 'DRAFT' && before.status !== 'REJECTED') {
        throw new InvalidStateTransitionError('Purchase order', before.status, 'PENDING_APPROVAL');
      }

      const now = new Date();
      const started = Date.now();

      const context = await this.policyContext.build(tx, organizationId, {
        spendType: 'PURCHASE_ORDER',
        amount: before.totalAmount,
        currency: before.currency,
        requesterMembershipId: before.requesterMembershipId,
        entityId: before.entityId,
        categoryId: before.categoryId,
        projectId: before.projectId,
        vendorId: before.vendorId,
        merchantName: null,
        hasReceipt: false,
        memo: before.memo,
        neededBy: before.expectedDate,
        now,
      });

      const versions = await this.policies.activeVersions(
        tx,
        organizationId,
        'PURCHASE_ORDER',
        now,
      );
      const decision = evaluate(context, versions, { durationMs: Date.now() - started });
      const decisionJson = decision as unknown as Prisma.InputJsonValue;

      if (decision.verdict === 'BLOCKED') {
        await tx.purchaseOrder.update({
          where: { id, version: expectedVersion },
          data: { policyDecision: decisionJson, version: { increment: 1 } },
        });

        await this.audit.record(tx, {
          organizationId,
          action: 'purchase_order.blocked',
          resourceType: 'purchase_order',
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

      const opened =
        decision.requirements.approvalSteps.length === 0
          ? null
          : await this.approvals.open(tx, organizationId, {
              subjectType: 'purchase_order',
              subjectId: id,
              context,
              decision,
              now,
            });

      await tx.purchaseOrder.update({
        where: { id, version: expectedVersion },
        data: {
          status: opened === null ? 'APPROVED' : 'PENDING_APPROVAL',
          policyDecision: decisionJson,
          approvalInstanceId: opened?.instanceId ?? null,
          submittedAt: now,
          ...(opened === null ? { approvedAt: now } : {}),
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'purchase_order.submitted',
        resourceType: 'purchase_order',
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
    } else {
      // Approved with no chain: the commitment is due now.
      await this.commitBudget(organizationId, id);
    }

    return this.get(id);
  }

  /**
   * Record what arrived (FR-PRC-002).
   *
   * Each receipt is appended and the line's `receivedQuantity` is re-summed
   * from them — the same reasoning as the budget ledger. A materialised number
   * that is incremented drifts silently; one that is derived is repaired by the
   * next delivery.
   */
  async receive(
    id: string,
    input: ReceivePurchaseOrder,
    expectedVersion: number,
  ): Promise<PurchaseOrderDetail> {
    const organizationId = requireOrganization();
    const receiver = getContext()?.membershipId;

    if (receiver === undefined) {
      throw new Error('A receipt must name the membership that recorded it.');
    }

    await this.database.unscoped.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id, organizationId },
        include: { lines: true },
      });

      if (order === null) throw new NotFoundError('Purchase order');

      guardVersion('Purchase order', expectedVersion, order.version);

      if (!RECEIVABLE.has(order.status)) {
        throw new InvalidStateTransitionError('Purchase order', order.status, 'received');
      }

      for (const line of input.lines) {
        const target = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);

        if (target === undefined) {
          throw new ValidationError({
            lines: ['One of those lines does not belong to this purchase order.'],
          });
        }

        await tx.purchaseOrderReceipt.create({
          data: {
            id: newId(),
            organizationId,
            purchaseOrderLineId: target.id,
            quantity: quantity(line.quantity),
            note: line.note ?? null,
            receivedByMembershipId: receiver,
          },
        });

        const receipts = await tx.purchaseOrderReceipt.findMany({
          where: { purchaseOrderLineId: target.id },
          select: { quantity: true },
        });

        await tx.purchaseOrderLine.update({
          where: { id: target.id },
          data: {
            receivedQuantity: sumQuantities(receipts.map((receipt) => receipt.quantity)),
          },
        });
      }

      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });

      // Fully received when every line has, partly when any has. The state is
      // derived from the lines rather than set by whoever happened to record
      // the last delivery.
      const complete = lines.every(
        (line) => Number(line.receivedQuantity) >= Number(line.quantity),
      );
      const started = lines.some((line) => Number(line.receivedQuantity) > 0);

      await tx.purchaseOrder.update({
        where: { id, version: expectedVersion },
        data: {
          status: complete ? 'RECEIVED' : started ? 'PARTIALLY_RECEIVED' : order.status,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'purchase_order.received',
        resourceType: 'purchase_order',
        resourceId: id,
        after: {
          lines: input.lines.length,
          status: complete ? 'RECEIVED' : started ? 'PARTIALLY_RECEIVED' : order.status,
        },
      });
    });

    return this.get(id);
  }

  async cancel(id: string, expectedVersion: number): Promise<PurchaseOrderDetail> {
    const organizationId = requireOrganization();

    const before = await this.database.client.purchaseOrder.findFirst({ where: { id } });
    if (before === null) throw new NotFoundError('Purchase order');

    guardVersion('Purchase order', expectedVersion, before.version);

    if (before.status === 'RECEIVED' || before.status === 'CLOSED') {
      throw new ConflictError('An order that has arrived cannot be cancelled.');
    }

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id, version: expectedVersion },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'purchase_order.cancelled',
        resourceType: 'purchase_order',
        resourceId: id,
        before: { status: before.status },
        after: { status: 'CANCELLED' },
      });
    });

    // Give the reservation back. A cancelled order that kept its commitment
    // holds budget nobody can spend and nobody can see a reason for.
    if (before.status === 'APPROVED' || before.status === 'PARTIALLY_RECEIVED') {
      await this.queue.enqueue(
        'budget.apply',
        {
          organizationId,
          operation: 'RELEASE',
          sourceType: 'PURCHASE_ORDER',
          sourceId: id,
        },
        { idempotencyKey: `budget:PURCHASE_ORDER:${id}:RELEASE` },
      );
    }

    return this.get(id);
  }

  /** An approved order reserves its money (FR-PRC-001). */
  private async commitBudget(organizationId: string, id: string): Promise<void> {
    await this.queue.enqueue(
      'budget.apply',
      { organizationId, operation: 'COMMIT', sourceType: 'PURCHASE_ORDER', sourceId: id },
      { idempotencyKey: `budget:PURCHASE_ORDER:${id}:COMMIT` },
    );
  }

  async onApprovalSettled(
    tx: Prisma.TransactionClient,
    organizationId: string,
    subjectId: string,
    outcome: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'OVERRIDDEN',
  ): Promise<void> {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: subjectId, organizationId },
      select: { id: true, status: true },
    });

    if (order === null || order.status !== 'PENDING_APPROVAL') return;

    const status =
      outcome === 'REJECTED' ? 'REJECTED' : outcome === 'RETURNED' ? 'DRAFT' : 'APPROVED';

    await tx.purchaseOrder.update({
      where: { id: subjectId },
      data: {
        status,
        ...(status === 'APPROVED' ? { approvedAt: new Date() } : {}),
        ...(outcome === 'RETURNED' ? { approvalInstanceId: null } : {}),
        version: { increment: 1 },
      },
    });

    await this.audit.record(tx, {
      organizationId,
      action: `purchase_order.${status.toLowerCase()}`,
      resourceType: 'purchase_order',
      resourceId: subjectId,
      before: { status: 'PENDING_APPROVAL' },
      after: { status },
    });
  }
}

/** Statuses in which a delivery can still be recorded. */
const RECEIVABLE = new Set(['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED']);

interface OrderRow {
  id: string;
  poNumber: string;
  status: string;
  vendor: { id: string; name: string };
  entityId: string;
  requester: { id: string; user: { fullName: string } };
  totalAmount: string;
  currency: string;
  expectedDate: Date | null;
  departmentId: string | null;
  projectId: string | null;
  categoryId: string | null;
  approvalInstanceId: string | null;
  policyDecision: unknown;
  memo: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
  version: number;
}

function toRecord(row: OrderRow): PurchaseOrderRecord {
  return {
    id: row.id,
    poNumber: row.poNumber,
    status: row.status as PurchaseOrderRecord['status'],
    vendor: row.vendor,
    entityId: row.entityId,
    requester: { membershipId: row.requester.id, fullName: row.requester.user.fullName },
    total: { amount: row.totalAmount, currency: row.currency },
    currency: row.currency,
    expectedDate: row.expectedDate?.toISOString() ?? null,
    departmentId: row.departmentId,
    projectId: row.projectId,
    categoryId: row.categoryId,
    approvalInstanceId: row.approvalInstanceId,
    policyDecision: row.policyDecision ?? null,
    memo: row.memo,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/**
 * The next PO number.
 *
 * Sequential and readable, because it is quoted to a supplier on a purchase
 * order document and read back over a phone. The random suffix breaks a tie
 * between two orders counted at the same instant; the unique index is what
 * actually decides.
 */
async function nextPoNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const count = await tx.purchaseOrder.count({ where: { organizationId } });

  return `PO-${String(count + 1).padStart(4, '0')}-${newId().slice(-4).toUpperCase()}`;
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}
