import {
  createEntitySchema,
  updateEntitySchema,
  type CreateEntity,
  type EntityRecord,
  type Resource,
  type UpdateEntity,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { EntitiesService } from './entities.service.js';

/**
 * `/v1/entities` (docs/10 §5.4).
 *
 * Reads need `entity:read`, which every role holds; writes need
 * `entity:manage`, which only `ORG_ADMIN` does. The split is per-route rather
 * than per-controller because an auditor must be able to see the entity list
 * and must never be able to change it — one permission for the controller
 * would force a choice between those two.
 *
 * There is no `DELETE`. Archiving is the whole of the destructive surface;
 * see `EntitiesService`.
 */
@Controller('entities')
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @RequirePermission('entity:read')
  async list(): Promise<Resource<EntityRecord[]>> {
    return {
      data: await this.entities.list(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('entity:read')
  async get(@Param('id') id: string): Promise<Resource<EntityRecord>> {
    return {
      data: await this.entities.get(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post()
  @RequirePermission('entity:manage')
  async create(
    @Body(new ZodValidationPipe(createEntitySchema)) body: CreateEntity,
  ): Promise<Resource<EntityRecord>> {
    return {
      data: await this.entities.create(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Patch(':id')
  @RequirePermission('entity:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEntitySchema)) body: UpdateEntity,
    @IfMatch() version: number,
  ): Promise<Resource<EntityRecord>> {
    return {
      data: await this.entities.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * `POST`, not `DELETE`. The row survives; only its status changes, and a
   * `DELETE` that leaves the resource readable at the same URL is a lie about
   * what happened.
   */
  @Post(':id/archive')
  // Nest answers `POST` with 201 by default, which would say a resource was
  // created. Archiving creates nothing; it changes one that already exists,
  // and the response body is that record.
  @HttpCode(200)
  @RequirePermission('entity:manage')
  async archive(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<EntityRecord>> {
    return {
      data: await this.entities.setArchived(id, true, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('entity:manage')
  async restore(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<EntityRecord>> {
    return {
      data: await this.entities.setArchived(id, false, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
