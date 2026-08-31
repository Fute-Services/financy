import {
  listPeopleQuerySchema,
  type ListPeopleQuery,
  type OffsetCollection,
  type Person,
} from '@financy/contracts';
import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { PeopleService } from './people.service.js';

/**
 * `/v1/people` (docs/10 §5.3).
 *
 * Read-only for now. Inviting, changing a role, and deactivating are writes
 * that must each record an audit event and, for role changes, refuse
 * self-elevation — they arrive with task 1.5, and shipping a button that does
 * none of that would be worse than not shipping the button (docs/19 §5).
 */
@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  @RequirePermission('user:read')
  async list(
    @Query(new ZodValidationPipe(listPeopleQuerySchema)) query: ListPeopleQuery,
  ): Promise<OffsetCollection<Person>> {
    const { items, total } = await this.people.list(query);

    return {
      data: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: total,
        // Ceiling, and at least one: a caller looking at an empty list should
        // see "page 1 of 1", not "page 1 of 0", which reads like a bug.
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      meta: { correlationId: getCorrelationId() },
    };
  }
}
