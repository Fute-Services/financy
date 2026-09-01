import {
  listNotificationsQuerySchema,
  updateNotificationPreferencesSchema,
  type ListNotificationsQuery,
  type NotificationPreferenceRecord,
  type NotificationRecord,
  type NotificationSummary,
  type OffsetCollection,
  type Resource,
  type UpdateNotificationPreferences,
} from '@financy/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { NotificationsService } from './notifications.service.js';

/**
 * `/v1/notifications` (docs/10 §5.14).
 *
 * **Every route is `notification:read_own`, including the writes.** Marking
 * something as read is not a power over anybody else's data — the only rows
 * reachable here are the caller's own, enforced in the service rather than by
 * a permission, because there is no permission that could express "your own"
 * and no role that should be able to read somebody else's inbox. Every role
 * holds this one for that reason.
 *
 * **There is no route that creates a notification.** They are written by jobs,
 * from events (FR-NOT-003). An endpoint would be a way to send somebody a
 * message that looks like it came from the system.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * The list, and the unread count with it.
   *
   * The count travels in `meta` rather than from a second endpoint, because
   * the bell needs it on every page of the application and a separate request
   * for one integer is a request on every navigation.
   */
  @Get()
  @RequirePermission('notification:read_own')
  async list(
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<OffsetCollection<NotificationRecord> & { summary: NotificationSummary }> {
    const { items, total, summary } = await this.notifications.list(query);

    return {
      data: items,
      summary,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Declared before `:id`, or `read-all` would be read as a notification id
   * and answer 404 for every call.
   */
  @Post('read-all')
  @HttpCode(200)
  @RequirePermission('notification:read_own')
  async readAll(): Promise<Resource<{ marked: number }>> {
    return {
      data: await this.notifications.markAllRead(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get('preferences')
  @RequirePermission('notification:read_own')
  async preferences(): Promise<Resource<NotificationPreferenceRecord[]>> {
    return {
      data: await this.notifications.preferences(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * No `If-Match`.
   *
   * The record being edited is the caller's own preferences, and there is no
   * second writer to lose to: two devices belonging to one person saving at
   * the same moment is not a conflict anybody needs told about. Everywhere
   * else a version is mandatory because the losing writer is somebody else.
   */
  @Patch('preferences')
  @RequirePermission('notification:read_own')
  async updatePreferences(
    @Body(new ZodValidationPipe(updateNotificationPreferencesSchema))
    body: UpdateNotificationPreferences,
  ): Promise<Resource<NotificationPreferenceRecord[]>> {
    return {
      data: await this.notifications.updatePreferences(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('notification:read_own')
  async read(@Param('id') id: string): Promise<Resource<NotificationRecord>> {
    return {
      data: await this.notifications.markRead(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Dismiss: it leaves the list and the row stays.
   *
   * A soft delete (docs/09 §4), because "I was never told" is a question the
   * record has to be able to answer, and a hard delete would let the answer be
   * removed by the person asking.
   */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('notification:read_own')
  async dismiss(@Param('id') id: string): Promise<void> {
    await this.notifications.dismiss(id);
  }
}
