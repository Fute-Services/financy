import { Money } from '@financy/core';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';
import {
  JobRegistry,
  QUEUE_PORT,
  type JobPayload,
  type QueuePort,
} from '../../platform/queue/index.js';
import { BudgetLedgerService, type SpendCoordinates } from './budget-ledger.service.js';

/**
 * Moving budgets off the request path (docs/14, FR-SPD-007, FR-TXN-008).
 *
 * ## Why this is a job and not a call inside the transaction
 *
 * A commitment written inside the approval's own transaction is a reservation
 * against a decision that has not committed yet. If that transaction rolls
 * back — a write conflict, a failed audit insert — the budget reads as spent
 * for a request nobody approved, and nothing in the system will ever tell
 * anyone. Enqueueing after the commit inverts the failure: the worst case is a
 * commitment that has not happened *yet*, which the retry fixes and the ledger
 * makes safe to attempt any number of times.
 *
 * ## The payload names a record; the handler reads it
 *
 * Which department, which project, which amount — all of it is read here,
 * because by the time this runs the record may have been edited, and a payload
 * carrying a copy would commit budget against numbers that are no longer
 * anybody's.
 *
 * ## A record that has gone is permanent
 *
 * A spend request that does not exist will not exist in eight seconds either.
 */
@Injectable()
export class BudgetJobs implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: BudgetLedgerService,
    private readonly registry: JobRegistry,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
  ) {}

  onModuleInit(): void {
    this.registry.register('budget.apply', (payload) => this.apply(payload));
  }

  private async apply(payload: JobPayload<'budget.apply'>): Promise<void> {
    const coordinates = await this.resolve(payload);

    // `null` means "nothing to do here", which covers both a record that has
    // gone and one whose money is accounted for elsewhere. Neither is a
    // failure worth retrying.
    if (coordinates === null) return;

    const source = { type: payload.sourceType, id: payload.sourceId } as const;

    const crossings =
      payload.operation === 'COMMIT'
        ? await this.ledger.commit(payload.organizationId, coordinates, source)
        : payload.operation === 'ACTUALIZE'
          ? await this.ledger.actualize(payload.organizationId, coordinates, source)
          : await this.ledger.release(payload.organizationId, coordinates, source);

    // Announced as its own job, because a mail server being down must not undo
    // a movement that has already been recorded.
    for (const crossing of crossings) {
      await this.queue.enqueue(
        'notification.budget_threshold',
        {
          organizationId: payload.organizationId,
          budgetId: crossing.budgetId,
          budgetLineId: crossing.budgetLineId,
          threshold: crossing.threshold,
          utilization: crossing.utilization,
        },
        {
          idempotencyKey: `budget-threshold:${crossing.budgetLineId}:${String(crossing.threshold)}`,
        },
      );
    }
  }

  /**
   * Where the money is, according to the record that moved it.
   *
   * Three shapes, one answer. The `switch` is exhaustive on the source types a
   * budget can be moved by, so the day bills arrive the compiler names this
   * function rather than a budget silently failing to move.
   */
  private async resolve(
    payload: JobPayload<'budget.apply'>,
  ): Promise<SpendCoordinates | null> {
    const { organizationId, sourceId } = payload;

    switch (payload.sourceType) {
      case 'SPEND_REQUEST': {
        const row = await this.database.unscoped.spendRequest.findFirst({
          where: { id: sourceId, organizationId },
          select: {
            entityId: true,
            departmentId: true,
            projectId: true,
            categoryId: true,
            amountInBaseCurrency: true,
            createdAt: true,
            organization: { select: { baseCurrency: true } },
          },
        });

        return row === null
          ? null
          : {
              entityId: row.entityId,
              departmentId: row.departmentId,
              projectId: row.projectId,
              categoryId: row.categoryId,
              // The budget period a request belongs to is when it was raised,
              // not when the last approver got round to it. Otherwise a
              // request that sat over a month end would draw on the wrong one.
              occurredAt: row.createdAt,
              amount: Money.of(row.amountInBaseCurrency, row.organization.baseCurrency),
            };
      }

      case 'EXPENSE': {
        const row = await this.database.unscoped.expense.findFirst({
          where: { id: sourceId, organizationId },
          select: {
            entityId: true,
            departmentId: true,
            projectId: true,
            categoryId: true,
            amount: true,
            currency: true,
            expenseDate: true,
            paymentMethod: true,
          },
        });

        // A card claim explains a charge that already moved the budget when it
        // posted. Recording the claim as well would count the same money
        // twice, and the two entries would be indistinguishable in the ledger.
        if (row?.paymentMethod === 'COMPANY_CARD') return null;

        return row === null
          ? null
          : {
              entityId: row.entityId,
              departmentId: row.departmentId,
              projectId: row.projectId,
              categoryId: row.categoryId,
              // When the money was spent, which is what a budget period means.
              occurredAt: row.expenseDate,
              amount: Money.of(row.amount, row.currency),
            };
      }

      case 'TRANSACTION': {
        const row = await this.database.unscoped.transaction.findFirst({
          where: { id: sourceId, organizationId },
          select: {
            entityId: true,
            departmentId: true,
            projectId: true,
            categoryId: true,
            amount: true,
            currency: true,
            postedAt: true,
            occurredAt: true,
          },
        });

        return row === null
          ? null
          : {
              entityId: row.entityId,
              departmentId: row.departmentId,
              projectId: row.projectId,
              categoryId: row.categoryId,
              occurredAt: row.postedAt ?? row.occurredAt,
              amount: Money.of(row.amount, row.currency),
            };
      }

      case 'BILL': {
        const row = await this.database.unscoped.bill.findFirst({
          where: { id: sourceId, organizationId },
          select: {
            entityId: true,
            totalAmount: true,
            currency: true,
            issueDate: true,
            lines: {
              orderBy: { sequence: 'asc' },
              take: 1,
              select: { departmentId: true, projectId: true, categoryId: true },
            },
          },
        });

        if (row === null) return null;

        const first = row.lines[0];

        return {
          entityId: row.entityId,
          // A bill's dimensions are its lines', and a bill routinely spans
          // several. The first line stands in for the whole, which is the
          // answer a person would give if asked what the invoice was for. A
          // bill split across two departments needs line-level budgeting,
          // which is a larger change than pretending this is exact.
          departmentId: first?.departmentId ?? null,
          projectId: first?.projectId ?? null,
          categoryId: first?.categoryId ?? null,
          // The invoice's own date, not the day it was entered: an invoice
          // keyed in three weeks late belongs to the period it was issued in.
          occurredAt: row.issueDate,
          amount: Money.of(row.totalAmount, row.currency),
        };
      }

      case 'PURCHASE_ORDER': {
        const row = await this.database.unscoped.purchaseOrder.findFirst({
          where: { id: sourceId, organizationId },
          select: {
            entityId: true,
            departmentId: true,
            projectId: true,
            categoryId: true,
            totalAmount: true,
            currency: true,
            createdAt: true,
          },
        });

        return row === null
          ? null
          : {
              entityId: row.entityId,
              departmentId: row.departmentId,
              projectId: row.projectId,
              categoryId: row.categoryId,
              occurredAt: row.createdAt,
              amount: Money.of(row.totalAmount, row.currency),
            };
      }

      default:
        return null;
    }
  }
}
