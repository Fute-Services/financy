import {
  allocateBudgetLineSchema,
  createBudgetSchema,
  listBudgetMovementsQuerySchema,
  listBudgetsQuerySchema,
  updateBudgetSchema,
  type AllocateBudgetLine,
  type BudgetDetail,
  type BudgetMovementRecord,
  type BudgetRecord,
  type CreateBudget,
  type ListBudgetMovementsQuery,
  type ListBudgetsQuery,
  type OffsetCollection,
  type Resource,
  type UpdateBudget,
} from '@financy/contracts';
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { BudgetsService } from './budgets.service.js';

/**
 * `/v1/budgets` (docs/10 §5.11, epic 4.1).
 *
 * **There is no route that writes a balance.** Allocation is the only number a
 * person sets; committed and actual move only through the ledger, driven by
 * approvals and postings. An endpoint that let a client set `actual` would make
 * every reconciliation argument unwinnable.
 *
 * **There is no delete.** A budget is closed or archived; its ledger is what
 * explains a year of spending after the year is over.
 */
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @RequirePermission('budget:read')
  async list(
    @Query(new ZodValidationPipe(listBudgetsQuerySchema)) query: ListBudgetsQuery,
  ): Promise<OffsetCollection<BudgetRecord>> {
    const { items, total } = await this.budgets.list(query);

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
  @RequirePermission('budget:read')
  async get(@Param('id') id: string): Promise<Resource<BudgetDetail>> {
    return { data: await this.budgets.get(id), meta: { correlationId: getCorrelationId() } };
  }

  /** The ledger behind the numbers, which is the answer to "where did it go". */
  @Get(':id/movements')
  @RequirePermission('budget:read')
  async movements(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listBudgetMovementsQuerySchema)) query: ListBudgetMovementsQuery,
  ): Promise<OffsetCollection<BudgetMovementRecord>> {
    const { items, total } = await this.budgets.movements(id, query);

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

  @Post()
  @RequirePermission('budget:manage')
  async create(
    @Body(new ZodValidationPipe(createBudgetSchema)) body: CreateBudget,
  ): Promise<Resource<BudgetDetail>> {
    return { data: await this.budgets.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('budget:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBudgetSchema)) body: UpdateBudget,
    @IfMatch() version: number,
  ): Promise<Resource<BudgetDetail>> {
    return {
      data: await this.budgets.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Set one period's allocation. `PUT`, because it is absolute: the body is
   * what the number becomes, not what to add to it.
   */
  @Put(':id/lines/:lineId/allocation')
  @RequirePermission('budget:manage')
  async allocate(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(allocateBudgetLineSchema)) body: AllocateBudgetLine,
    @IfMatch() version: number,
  ): Promise<Resource<BudgetDetail>> {
    return {
      data: await this.budgets.allocate(id, lineId, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
