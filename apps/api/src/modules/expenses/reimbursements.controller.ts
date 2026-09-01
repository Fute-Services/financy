import {
  createReimbursementSchema,
  listReimbursementsQuerySchema,
  markReimbursementPaidSchema,
  type CreateReimbursement,
  type ListReimbursementsQuery,
  type MarkReimbursementPaid,
  type OffsetCollection,
  type ReimbursementDetail,
  type ReimbursementRecord,
  type Resource,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { ReimbursementsService } from './reimbursements.service.js';

/**
 * `/v1/reimbursements` (docs/10 §5.11, epic 3.3).
 *
 * **Approving and marking paid are separate routes with separate permissions**
 * (docs/03 §2.1). Finance approves a batch; somebody with payment authority
 * records that the money actually left. One route doing both would let one
 * person pay themselves, which is the separation the whole permission model
 * exists to express.
 *
 * **There is no route that adds or removes a line.** A batch is built from
 * what qualifies — one person, one entity, one currency, one period — and a
 * line added by hand is how a batch stops matching the claims it says it
 * covers.
 */
@Controller('reimbursements')
export class ReimbursementsController {
  constructor(private readonly reimbursements: ReimbursementsService) {}

  @Get()
  @RequirePermission('reimbursement:read')
  async list(
    @Query(new ZodValidationPipe(listReimbursementsQuerySchema)) query: ListReimbursementsQuery,
  ): Promise<OffsetCollection<ReimbursementRecord>> {
    const { items, total } = await this.reimbursements.list(query);

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
  @RequirePermission('reimbursement:read')
  async get(@Param('id') id: string): Promise<Resource<ReimbursementDetail>> {
    return {
      data: await this.reimbursements.get(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post()
  @RequirePermission('reimbursement:create')
  async create(
    @Body(new ZodValidationPipe(createReimbursementSchema)) body: CreateReimbursement,
  ): Promise<Resource<ReimbursementDetail>> {
    return {
      data: await this.reimbursements.create(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('reimbursement:approve')
  async approve(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ReimbursementDetail>> {
    return {
      data: await this.reimbursements.approve(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission('reimbursement:mark_paid')
  async markPaid(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markReimbursementPaidSchema)) body: MarkReimbursementPaid,
    @IfMatch() version: number,
  ): Promise<Resource<ReimbursementDetail>> {
    return {
      data: await this.reimbursements.markPaid(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('reimbursement:create')
  async cancel(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ReimbursementDetail>> {
    return {
      data: await this.reimbursements.cancel(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
