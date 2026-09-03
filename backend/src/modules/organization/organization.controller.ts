import {
  updateOrganizationSchema,
  type OrganizationSettings,
  type OrganizationSummary,
  type Resource,
  type UpdateOrganization,
} from '@financy/contracts';
import { Body, Controller, Get, Patch } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { OrganizationService } from './organization.service.js';

/**
 * `/v1/organization` (docs/10 §5.4).
 *
 * The `GET` returns the organisation with its entities, departments, and
 * categories in one payload; the `PATCH` writes only the organisation's own
 * fields. Entities and departments have their own endpoints because they are
 * lists, and a PATCH that accepted a whole list would have to decide what an
 * omitted element means — a question with no good answer.
 */
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get()
  @RequirePermission('organization:read')
  async settings(): Promise<Resource<OrganizationSettings>> {
    return {
      data: await this.organization.settings(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * `If-Match` is mandatory, and `@IfMatch()` rejects a request without one.
   *
   * Two administrators with the settings screen open is the ordinary case,
   * not the exotic one. Without the precondition the second save silently
   * discards the first, and nothing in the audit log shows that a change was
   * lost — only that two were made (docs/09 §1.7).
   */
  @Patch()
  @RequirePermission('organization:update')
  async update(
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganization,
    @IfMatch() version: number,
  ): Promise<Resource<OrganizationSummary>> {
    return {
      data: await this.organization.update(body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}
