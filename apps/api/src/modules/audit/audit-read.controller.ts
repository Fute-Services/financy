import {
  listAuditEventsQuerySchema,
  type AuditEvent,
  type CursorCollection,
  type ListAuditEventsQuery,
} from '@financy/contracts';
import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { AuditReadService } from './audit-read.service.js';

/**
 * `/v1/audit-events` (docs/10 §5.5).
 *
 * `GET` and nothing else, permanently. There is no `POST`, because an endpoint
 * that accepted an audit event would accept a false one; there is no `DELETE`,
 * because a trail somebody can prune is not evidence. Events are written by
 * `AuditService` inside the transaction that made the change (ADR-0016), and
 * retention is a scheduled job with its own authority.
 */
@Controller('audit-events')
export class AuditReadController {
  constructor(private readonly audit: AuditReadService) {}

  @Get()
  @RequirePermission('audit_event:read')
  async list(
    @Query(new ZodValidationPipe(listAuditEventsQuerySchema)) query: ListAuditEventsQuery,
  ): Promise<CursorCollection<AuditEvent>> {
    const { items, nextCursor, hasMore } = await this.audit.list(query);

    return {
      data: items,
      pagination: { nextCursor, hasMore, limit: query.limit },
      meta: { correlationId: getCorrelationId() },
    };
  }
}
