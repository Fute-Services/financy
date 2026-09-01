import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProject,
  type ProjectRecord,
  type Resource,
  type UpdateProject,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { ProjectsService } from './projects.service.js';

/**
 * `/v1/projects` (docs/10 §5.4).
 *
 * Gated on `department:read` / `department:manage` rather than a permission
 * of their own: a project is a slice of the department structure, whoever
 * manages that structure manages these, and a permission held by nobody is a
 * permission that gets granted carelessly the first time somebody needs it.
 *
 * Closing and archiving are separate endpoints because they mean different
 * things. A **closed** project is finished and still belongs in reports; an
 * **archived** one should not have existed, or no longer matters, and drops
 * out of the pickers.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('department:read')
  async list(): Promise<Resource<ProjectRecord[]>> {
    return {
      data: await this.projects.list(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('department:read')
  async get(@Param('id') id: string): Promise<Resource<ProjectRecord>> {
    return {
      data: await this.projects.get(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post()
  @RequirePermission('department:manage')
  async create(
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject,
  ): Promise<Resource<ProjectRecord>> {
    return {
      data: await this.projects.create(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Patch(':id')
  @RequirePermission('department:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProject,
    @IfMatch() version: number,
  ): Promise<Resource<ProjectRecord>> {
    return {
      data: await this.projects.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('department:manage')
  async close(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ProjectRecord>> {
    return {
      data: await this.projects.setStatus(id, 'CLOSED', version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('department:manage')
  async reopen(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ProjectRecord>> {
    return {
      data: await this.projects.setStatus(id, 'ACTIVE', version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('department:manage')
  async archive(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ProjectRecord>> {
    return {
      data: await this.projects.setArchived(id, true, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('department:manage')
  async restore(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<ProjectRecord>> {
    return {
      data: await this.projects.setArchived(id, false, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
