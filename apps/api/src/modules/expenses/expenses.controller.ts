import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
  type CreateExpense,
  type ExpenseRecord,
  type ListExpensesQuery,
  type OffsetCollection,
  type Resource,
  type UpdateExpense,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { ExpensesService } from './expenses.service.js';

/**
 * `/v1/expenses` (docs/10 §5.10, epic 3.2).
 *
 * **`status` appears in no write schema.** The only route from a draft to
 * anything else is `submit`, which is what evaluates policy — a create or a
 * patch that could set a status would be a way past every control the product
 * has, and it is the same reasoning that shapes spend requests.
 *
 * **Approving happens on `/v1/approvals`, not here.** An expense is one of two
 * subject types the approval machinery now serves, and the day a third arrives
 * nothing about this controller should change.
 */
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermission('expense:read')
  async list(
    @Query(new ZodValidationPipe(listExpensesQuerySchema)) query: ListExpensesQuery,
  ): Promise<OffsetCollection<ExpenseRecord>> {
    const { items, total } = await this.expenses.list(query);

    return {
      data: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('expense:read')
  async get(@Param('id') id: string): Promise<Resource<ExpenseRecord>> {
    return { data: await this.expenses.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post()
  @RequirePermission('expense:create')
  async create(
    @Body(new ZodValidationPipe(createExpenseSchema)) body: CreateExpense,
  ): Promise<Resource<ExpenseRecord>> {
    return { data: await this.expenses.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('expense:create')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema)) body: UpdateExpense,
    @IfMatch() version: number,
  ): Promise<Resource<ExpenseRecord>> {
    return {
      data: await this.expenses.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Submit, which is the transition that evaluates policy.
   *
   * A blocked submission answers `422` with the reasons and leaves the claim
   * editable (FR-EXP-003) — the money is already spent, so blocking here is
   * not a control but a request for something the person can supply.
   */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('expense:create')
  async submit(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ExpenseRecord>> {
    return {
      data: await this.expenses.submit(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('expense:create')
  async cancel(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ExpenseRecord>> {
    return {
      data: await this.expenses.cancel(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
