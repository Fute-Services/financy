import {
  createCategorySchema,
  updateCategorySchema,
  type CategoryRecord,
  type CreateCategory,
  type Resource,
  type UpdateCategory,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { CategoriesService } from './categories.service.js';

/**
 * `/v1/categories` (docs/10 §5.4).
 *
 * Gated on `policy:read` / `policy:manage`, not on the organisation
 * permissions the rest of settings uses. A category is what a policy branches
 * on: re-coding the taxonomy silently changes what every policy decides, so
 * it belongs to whoever owns the policies rather than to whoever can rename
 * the company.
 *
 * There is no way to change a category's key or its parent through this
 * controller, by design — see `CategoriesService`.
 */
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('policy:read')
  async list(): Promise<Resource<CategoryRecord[]>> {
    return {
      data: await this.categories.list(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('policy:read')
  async get(@Param('id') id: string): Promise<Resource<CategoryRecord>> {
    return {
      data: await this.categories.get(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post()
  @RequirePermission('policy:manage')
  async create(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategory,
  ): Promise<Resource<CategoryRecord>> {
    return {
      data: await this.categories.create(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Patch(':id')
  @RequirePermission('policy:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategory,
    @IfMatch() version: number,
  ): Promise<Resource<CategoryRecord>> {
    return {
      data: await this.categories.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('policy:manage')
  async archive(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<CategoryRecord>> {
    return {
      data: await this.categories.setArchived(id, true, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('policy:manage')
  async restore(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<CategoryRecord>> {
    return {
      data: await this.categories.setArchived(id, false, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
