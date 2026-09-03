import {
  exportAuditEventsQuerySchema,
  listAuditEventsQuerySchema,
  listSecurityEventsQuerySchema,
  type AuditEvent,
  type CursorCollection,
  type ExportAuditEventsQuery,
  type ListAuditEventsQuery,
  type ListSecurityEventsQuery,
  type Resource,
  type SecurityEvent,
} from '@financy/contracts';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { RequirePermission } from '../../platform/authorization/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { AuditExportService } from './audit-export.service.js';
import { AuditReadService } from './audit-read.service.js';
import { SecurityEventReadService } from './security-event-read.service.js';

/**
 * `/v1/audit-events` and `/v1/security-events` (docs/10 §5.5).
 *
 * `GET` and nothing else, permanently. There is no `POST`, because an endpoint
 * that accepted an audit event would accept a false one; there is no `DELETE`,
 * because a trail somebody can prune is not evidence. Events are written by
 * `AuditService` inside the transaction that made the change (ADR-0016), and
 * retention is a scheduled job with its own authority.
 *
 * Three permissions, not one. `audit_event:read` is held by administrators and
 * auditors; `audit_event:export` is separate because a complete copy of the
 * trail leaving the system is a different act from reading a page of it; and
 * `security_event:read` is separate again because the security log answers a
 * different question and is useful to a narrower group.
 */
@Controller()
export class AuditReadController {
  constructor(
    private readonly audit: AuditReadService,
    private readonly securityEvents: SecurityEventReadService,
    private readonly exporter: AuditExportService,
  ) {}

  @Get('audit-events')
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

  /**
   * Registered before `:resourceType/:resourceId`, because Nest matches in
   * declaration order and `export` would otherwise be read as a resource
   * type — answering an empty history instead of a file.
   */
  @Get('audit-events/export')
  @RequirePermission('audit_event:export')
  async export(
    @Query(new ZodValidationPipe(exportAuditEventsQuerySchema)) query: ExportAuditEventsQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const result = await this.exporter.export(query);

    response.setHeader('Content-Type', result.contentType);
    // `attachment`, always. An audit export rendered inline in a browser is a
    // document from an untrusted source being displayed by a trusting viewer.
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    // So a caller can tell a complete export from one that hit the ceiling
    // without counting the lines themselves.
    response.setHeader('X-Row-Count', String(result.rowCount));
    response.setHeader('X-Truncated', String(result.truncated));

    return result.body;
  }

  /**
   * Every event touching one record, oldest first (task 1.6.4).
   *
   * Chronological, unlike the list. "What has been happening" is a question
   * about the recent past and reads newest first; "how did this record get
   * into its current state" only makes sense read forwards.
   */
  @Get('audit-events/:resourceType/:resourceId')
  @RequirePermission('audit_event:read')
  async history(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
  ): Promise<Resource<AuditEvent[]>> {
    return {
      data: await this.audit.history(resourceType, resourceId),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get('security-events')
  @RequirePermission('security_event:read')
  async securityLog(
    @Query(new ZodValidationPipe(listSecurityEventsQuerySchema)) query: ListSecurityEventsQuery,
  ): Promise<CursorCollection<SecurityEvent>> {
    const { items, nextCursor, hasMore } = await this.securityEvents.list(query);

    return {
      data: items,
      pagination: { nextCursor, hasMore, limit: query.limit },
      meta: { correlationId: getCorrelationId() },
    };
  }
}
