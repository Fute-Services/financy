import {
  createDepartmentSchema,
  updateDepartmentSchema,
  type CreateDepartment,
  type DepartmentRecord,
  type Resource,
  type UpdateDepartment,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { DepartmentsService } from './departments.service.js';

/**
 * `/v1/departments` (docs/10 §5.4).
 *
 * The list comes back in `path` order, which is depth-first: a parent always
 * precedes its children, so a client renders the tree by indenting rows in
 * the order given. There is no separate `/tree` endpoint returning a nested
 * shape — the flat list already carries the structure in `path` and `depth`,
 * and two representations of one tree are two things that can disagree.
 */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermission('department:read')
  async list(): Promise<Resource<DepartmentRecord[]>> {
    return {
      data: await this.departments.list(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('department:read')
  async get(@Param('id') id: string): Promise<Resource<DepartmentRecord>> {
    return {
      data: await this.departments.get(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post()
  @RequirePermission('department:manage')
  async create(
    @Body(new ZodValidationPipe(createDepartmentSchema)) body: CreateDepartment,
  ): Promise<Resource<DepartmentRecord>> {
    return {
      data: await this.departments.create(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Renaming and re-parenting are the same request.
   *
   * Moving a node is an edit, not a delete and a re-create: the latter breaks
   * every membership pointing at the old row and throws away the
   * department's audit history, which is the thing most worth keeping.
   */
  @Patch(':id')
  @RequirePermission('department:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) body: UpdateDepartment,
    @IfMatch() version: number,
  ): Promise<Resource<DepartmentRecord>> {
    return {
      data: await this.departments.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('department:manage')
  async archive(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<DepartmentRecord>> {
    return {
      data: await this.departments.setArchived(id, true, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('department:manage')
  async restore(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<DepartmentRecord>> {
    return {
      data: await this.departments.setArchived(id, false, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
