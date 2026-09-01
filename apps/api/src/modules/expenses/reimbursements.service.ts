import type {
  CreateReimbursement,
  ListReimbursementsQuery,
  MarkReimbursementPaid,
  ReimbursementDetail,
  ReimbursementRecord,
} from '@financy/contracts';
import {
  ConflictError,
  ExpenseAlreadyReimbursedError,
  InvalidStateTransitionError,
  Money,
  NotFoundError,
  ValidationError,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { isWriteConflict } from '../../platform/concurrency/index.js';
import { callerHas, getContext, getOrganizationId } from '../../platform/request-context/index.js';

/**
 * Reimbursements (epic 3.3, FR-EXP-008…010).
 *
 * ## A batch is a payment, so its grouping is forced
 *
 * One person, one entity, one currency, one period. Every one of those is a
 * constraint on what a payment *can* be rather than a preference: money leaves
 * one legal entity, arrives in one person's account, in one currency. A batch
 * mixing any of them is a payment nobody can actually make, and discovering
 * that at the bank is discovering it far too late.
 *
 * ## The caller names the group; the server finds the expenses
 *
 * A request listing expense ids would let somebody assemble a batch that
 * crosses currencies or people. Naming the group and letting the server select
 * makes the invalid batch unexpressible.
 *
 * ## Paying twice is prevented by an index, not by a check
 *
 * `UNIQUE(expense_id)` across every line in every batch (FR-EXP-009). Two
 * people batching the same afternoon, or one retrying after a timeout, both
 * find the expense unbatched when they look — a pre-flight check passes twice
 * and pays twice. The index is what makes the second one a `409` instead.
 */
@Injectable()
export class ReimbursementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListReimbursementsQuery,
  ): Promise<{ items: ReimbursementRecord[]; total: number }> {
    const where: Prisma.ReimbursementBatchWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...this.visibleToCaller(query.mine === true),
    };

    const [total, rows] = await Promise.all([
      this.database.client.reimbursementBatch.count({ where }),
      this.database.client.reimbursementBatch.findMany({
        where,
        select: SELECT,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map(toRecord) };
  }

  async get(id: string): Promise<ReimbursementDetail> {
    const organizationId = requireOrganization();

    const batch = await this.database.client.reimbursementBatch.findFirst({
      where: { id, ...this.visibleToCaller() },
      select: SELECT,
    });

    if (batch === null) throw new NotFoundError('Reimbursement');

    const lines = await this.database.unscoped.reimbursementLine.findMany({
      where: { organizationId, batchId: id },
      select: {
        id: true,
        expenseId: true,
        amount: true,
        currency: true,
        expense: { select: { reference: true, merchantName: true, expenseDate: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    return {
      ...toRecord(batch),
      lines: lines.map((line) => ({
        id: line.id,
        expenseId: line.expenseId,
        reference: line.expense.reference,
        merchantName: line.expense.merchantName,
        expenseDate: line.expense.expenseDate.toISOString(),
        amount: { amount: line.amount, currency: line.currency },
      })),
    };
  }

  /**
   * Build a batch from everything that qualifies.
   *
   * Approved, out of pocket, this person, this entity, this currency, inside
   * the period, and **not already on a line** — the last one checked here for
   * a useful answer and enforced by the index below for correctness.
   */
  async create(input: CreateReimbursement): Promise<ReimbursementDetail> {
    const organizationId = requireOrganization();

    const periodStart = new Date(`${input.periodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${input.periodEnd}T23:59:59.999Z`);

    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new ValidationError({
        periodEnd: ['The period ends before it starts. Check the dates.'],
      });
    }

    const batchId = await this.database.unscoped.$transaction(async (tx) => {
      const payee = await tx.membership.findFirst({
        where: { id: input.payeeMembershipId, organizationId },
        select: { id: true },
      });

      if (payee === null) throw new NotFoundError('Membership');

      const entity = await tx.entity.findFirst({
        where: { id: input.entityId, organizationId },
        select: { id: true },
      });

      if (entity === null) throw new NotFoundError('Entity');

      const expenses = await tx.expense.findMany({
        where: {
          organizationId,
          submitterMembershipId: input.payeeMembershipId,
          entityId: input.entityId,
          currency: input.currency,
          status: 'APPROVED',
          // Company-card spend is not reimbursed: the company already paid.
          // Including it would pay for the same thing twice, from two
          // directions, and the second payment would look perfectly ordinary.
          paymentMethod: 'OUT_OF_POCKET',
          expenseDate: { gte: periodStart, lte: periodEnd },
          reimbursementLine: null,
        },
        select: { id: true, amount: true, currency: true },
      });

      if (expenses.length === 0) {
        throw new ValidationError({
          periodStart: [
            'No approved out-of-pocket expenses match that person, entity, currency, and period.',
          ],
        });
      }

      const total = Money.sum(
        expenses.map((expense) => Money.of(expense.amount, expense.currency)),
        input.currency,
      );

      const id = newId();

      await tx.reimbursementBatch.create({
        data: {
          id,
          organizationId,
          reference: await nextReference(tx, organizationId, id),
          payeeMembershipId: input.payeeMembershipId,
          entityId: input.entityId,
          currency: input.currency,
          periodStart,
          periodEnd,
          status: 'DRAFT',
          totalAmount: total.toString(),
          paymentReference: null,
          paidAt: null,
          approvedAt: null,
        },
      });

      for (const expense of expenses) {
        try {
          await tx.reimbursementLine.create({
            data: {
              id: newId(),
              organizationId,
              batchId: id,
              expenseId: expense.id,
              amount: expense.amount,
              currency: expense.currency,
            },
          });
        } catch (error) {
          /**
           * The index refused it: this expense is already on another batch.
           *
           * Reported by name rather than swallowed. Silently dropping the line
           * would produce a batch whose total is less than the expenses it
           * claims to cover, and the person being paid would be short with no
           * explanation.
           */
          if (isDuplicateLine(error)) throw new ExpenseAlreadyReimbursedError();

          throw error;
        }
      }

      await this.audit.record(tx, {
        action: 'reimbursement.created',
        resourceType: 'reimbursement',
        resourceId: id,
        after: {
          payeeMembershipId: input.payeeMembershipId,
          total: total.toString(),
          currency: input.currency,
          lines: expenses.length,
        },
      });

      return id;
    });

    return this.get(batchId);
  }

  /** Approve the batch for payment. Separate from paying it, deliberately. */
  async approve(id: string, expectedVersion: number): Promise<ReimbursementDetail> {
    const organizationId = requireOrganization();
    const membershipId = getContext()?.membershipId ?? null;

    await this.database.unscoped.$transaction(async (tx) => {
      const batch = await tx.reimbursementBatch.findFirst({
        where: { id, organizationId },
        select: { id: true, status: true, version: true },
      });

      if (batch === null) throw new NotFoundError('Reimbursement');

      guardVersion('Reimbursement', expectedVersion, batch.version);

      if (batch.status !== 'DRAFT') {
        throw new InvalidStateTransitionError('Reimbursement', batch.status, 'APPROVED');
      }

      await tx.reimbursementBatch.update({
        where: { id, version: expectedVersion },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedByMembershipId: membershipId,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'reimbursement.approved',
        resourceType: 'reimbursement',
        resourceId: id,
      });
    });

    return this.get(id);
  }

  /**
   * Mark it paid, with the reference that proves it.
   *
   * **Approving and paying are two actions by two people** (docs/03 §2.1):
   * finance approves the batch, and somebody with payment authority records
   * that the money left. Collapsing them would mean one person could pay
   * themselves.
   *
   * The expenses move to `REIMBURSED` in the same transaction. A batch marked
   * paid whose expenses still read `APPROVED` is a claim that can be batched
   * again, which is the failure this whole epic exists to prevent.
   */
  async markPaid(
    id: string,
    input: MarkReimbursementPaid,
    expectedVersion: number,
  ): Promise<ReimbursementDetail> {
    const organizationId = requireOrganization();
    const membershipId = getContext()?.membershipId ?? null;

    await this.database.unscoped.$transaction(async (tx) => {
      const batch = await tx.reimbursementBatch.findFirst({
        where: { id, organizationId },
        select: { id: true, status: true, version: true, totalAmount: true, currency: true },
      });

      if (batch === null) throw new NotFoundError('Reimbursement');

      guardVersion('Reimbursement', expectedVersion, batch.version);

      if (batch.status !== 'APPROVED') {
        throw new InvalidStateTransitionError('Reimbursement', batch.status, 'PAID');
      }

      const lines = await tx.reimbursementLine.findMany({
        where: { organizationId, batchId: id },
        select: { expenseId: true },
      });

      await tx.reimbursementBatch.update({
        where: { id, version: expectedVersion },
        data: {
          status: 'PAID',
          paymentReference: input.paymentReference,
          paidAt: input.paidAt === undefined ? new Date() : new Date(input.paidAt),
          paidByMembershipId: membershipId,
          version: { increment: 1 },
        },
      });

      await tx.expense.updateMany({
        where: {
          organizationId,
          id: { in: lines.map((line) => line.expenseId) },
          status: 'APPROVED',
        },
        data: { status: 'REIMBURSED' },
      });

      await this.audit.record(tx, {
        action: 'reimbursement.paid',
        resourceType: 'reimbursement',
        resourceId: id,
        after: {
          paymentReference: input.paymentReference,
          total: batch.totalAmount,
          currency: batch.currency,
          expenses: lines.length,
        },
      });
    });

    return this.get(id);
  }

  /**
   * Cancel a batch that has not been paid.
   *
   * The lines are deleted so their expenses can be batched again — which is
   * the entire point of cancelling, and safe precisely because a *paid* batch
   * can never reach here.
   */
  async cancel(id: string, expectedVersion: number): Promise<ReimbursementDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const batch = await tx.reimbursementBatch.findFirst({
        where: { id, organizationId },
        select: { id: true, status: true, version: true },
      });

      if (batch === null) throw new NotFoundError('Reimbursement');

      guardVersion('Reimbursement', expectedVersion, batch.version);

      if (batch.status === 'PAID') {
        throw new ConflictError(
          'This batch has been paid. Money has left the company; record a correction rather than cancelling it.',
        );
      }

      if (batch.status === 'CANCELLED') {
        throw new InvalidStateTransitionError('Reimbursement', batch.status, 'CANCELLED');
      }

      await tx.reimbursementLine.deleteMany({ where: { organizationId, batchId: id } });

      await tx.reimbursementBatch.update({
        where: { id, version: expectedVersion },
        data: { status: 'CANCELLED', totalAmount: '0.0000', version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        action: 'reimbursement.cancelled',
        resourceType: 'reimbursement',
        resourceId: id,
        before: { status: batch.status },
      });
    });

    return this.get(id);
  }

  /**
   * Somebody without `reimbursement:read_all` sees batches paying *them*.
   *
   * A reimbursement names a person and an amount they are owed; it is their
   * own business and finance's, and nobody else's.
   */
  private visibleToCaller(mine = false): Prisma.ReimbursementBatchWhereInput {
    const membershipId = getContext()?.membershipId;

    if (membershipId === undefined) return {};
    if (callerHas('reimbursement:read_all') && !mine) return {};

    return { payeeMembershipId: membershipId };
  }
}

/**
 * Was this the unique index refusing a second line for one expense?
 *
 * `P2002` is Prisma's unique-constraint violation. Matched structurally rather
 * than by importing Prisma's error class, for the same reason the write
 * conflict check is: the module boundary (docs/08 §4.3).
 */
function isDuplicateLine(error: unknown): boolean {
  if (isWriteConflict(error)) return false;
  if (typeof error !== 'object' || error === null) return false;

  return (error as { code?: unknown }).code === 'P2002';
}

const SELECT = {
  id: true,
  reference: true,
  status: true,
  payeeMembershipId: true,
  entityId: true,
  currency: true,
  periodStart: true,
  periodEnd: true,
  totalAmount: true,
  paymentReference: true,
  paidAt: true,
  approvedAt: true,
  createdAt: true,
  version: true,
  payee: { select: { user: { select: { fullName: true } } } },
  _count: { select: { lines: true } },
} as const;

interface Row {
  id: string;
  reference: string;
  status: string;
  payeeMembershipId: string;
  entityId: string;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  totalAmount: string;
  paymentReference: string | null;
  paidAt: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
  version: number;
  payee: { user: { fullName: string } };
  _count: { lines: number };
}

function toRecord(row: Row): ReimbursementRecord {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status as ReimbursementRecord['status'],
    payee: { membershipId: row.payeeMembershipId, fullName: row.payee.user.fullName },
    entityId: row.entityId,
    currency: row.currency,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    total: { amount: row.totalAmount, currency: row.currency },
    lineCount: row._count.lines,
    paymentReference: row.paymentReference,
    paidAt: row.paidAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/**
 * `RMB-00042`, and it has to survive two people batching at once.
 *
 * Counting rows is honest about what a reference is — a display label, not an
 * identifier — but two simultaneous creates both count the same number, and
 * the unique index then refuses the second with an error about a *reference*
 * when the interesting refusal is about the *expense*. Two batches built at
 * the same instant is exactly the case this module exists to get right, so the
 * label must not be what fails.
 *
 * The suffix is four characters of the batch's own id: unique by construction,
 * ugly only in the rare case, and never wrong.
 */
async function nextReference(
  tx: Prisma.TransactionClient,
  organizationId: string,
  batchId: string,
): Promise<string> {
  const count = await tx.reimbursementBatch.count({ where: { organizationId } });
  const sequential = `RMB-${String(count + 1).padStart(5, '0')}`;

  const taken = await tx.reimbursementBatch.findFirst({
    where: { organizationId, reference: sequential },
    select: { id: true },
  });

  if (taken === null) return sequential;

  return `${sequential}-${batchId.slice(-4)}`;
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Reimbursements cannot be read or written without a tenant context.');
  }

  return organizationId;
}
