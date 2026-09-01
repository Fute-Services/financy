import {
  createSpendRequestSchema,
  listSpendRequestsQuerySchema,
  updateSpendRequestSchema,
  type CreateSpendRequest,
  type ListSpendRequestsQuery,
  type OffsetCollection,
  type Resource,
  type SpendRequestRecord,
  type UpdateSpendRequest,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { SpendRequestService } from './spend-request.service.js';

/**
 * `/v1/spend-requests` (docs/10 §5.6).
 *
 * **Create and submit are separate routes**, and that is a control rather than
 * a REST preference. Creating produces a draft; submitting evaluates policy,
 * records the decision, and builds the approval chain. A create that could
 * arrive already approved would be a way around every control the product has
 * — so `status` appears in no write schema and no route sets one directly.
 *
 * Submitting takes `If-Match`. It is the most consequential transition here:
 * two people submitting the same draft would otherwise evaluate policy twice
 * and open two approval chains for one request.
 */
@Controller('spend-requests')
export class SpendRequestController {
  constructor(private readonly requests: SpendRequestService) {}

  @Get()
  @RequirePermission('spend_request:read')
  async list(
    @Query(new ZodValidationPipe(listSpendRequestsQuerySchema)) query: ListSpendRequestsQuery,
  ): Promise<OffsetCollection<SpendRequestRecord>> {
    const { items, total } = await this.requests.list(query);

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
  @RequirePermission('spend_request:read')
  async get(@Param('id') id: string): Promise<Resource<SpendRequestRecord>> {
    return { data: await this.requests.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post()
  @RequirePermission('spend_request:create')
  async create(
    @Body(new ZodValidationPipe(createSpendRequestSchema)) body: CreateSpendRequest,
  ): Promise<Resource<SpendRequestRecord>> {
    return { data: await this.requests.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('spend_request:update')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSpendRequestSchema)) body: UpdateSpendRequest,
    @IfMatch() version: number,
  ): Promise<Resource<SpendRequestRecord>> {
    return {
      data: await this.requests.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /** Evaluates policy, records the decision, and opens the chain. */
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('spend_request:create')
  async submit(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<SpendRequestRecord>> {
    return {
      data: await this.requests.submit(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('spend_request:cancel')
  async cancel(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<SpendRequestRecord>> {
    return {
      data: await this.requests.cancel(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
