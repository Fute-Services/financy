import type { OrganizationSettings, Resource } from '@financy/contracts';
import { Controller, Get } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { OrganizationService } from './organization.service.js';

/**
 * `/v1/organization` (docs/10 §5.4).
 *
 * Read-only. Renaming the organisation, adding an entity, and editing the
 * department tree are writes that need optimistic concurrency, an audit event,
 * and — for the base currency — a lock once financial records exist. They
 * arrive with task 1.5; a form that saved without them would be a form that
 * silently loses a colleague's concurrent edit.
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
}
