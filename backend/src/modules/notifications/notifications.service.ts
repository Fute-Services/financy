import {
  DEFAULT_PREFERENCES,
  NOTIFICATION_EVENTS,
  type ListNotificationsQuery,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPreferenceRecord,
  type NotificationRecord,
  type NotificationSummary,
  type UpdateNotificationPreferences,
} from '@financy/contracts';
import { NotFoundError, newId } from '@financy/core';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ConfigService } from '../../platform/config/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext } from '../../platform/request-context/index.js';
import { NOTIFICATION_PROVIDER, type NotificationProvider } from './notification-provider.js';

export interface DeliverInput {
  organizationId: string;
  eventType: NotificationEvent;
  recipientMembershipIds: readonly string[];
  /** Per recipient, so a job cannot half-deliver and then duplicate. */
  dedupeKey: string;
  title: string;
  body: string;
  actionLabel: string;
  /** Relative path; made absolute for mail from `WEB_BASE_URL`. */
  path: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Notifications (epic 2.5).
 *
 * ## The record is written whatever the preferences say
 *
 * `inApp` and `email` decide *delivery*. Turning both off does not stop the
 * row being written — "I was never told" has to be answerable, and a
 * preference that erased the evidence would make the answer "we don't know".
 * What it does stop is the row appearing in that person's list and an email
 * being sent, which is what the person actually asked for.
 *
 * ## Delivery is recorded, not intended
 *
 * `channelsDelivered` holds what actually happened. An email that threw every
 * retry leaves `['IN_APP']`, so the support answer is "it was in the app and
 * the mail failed" rather than a confident claim nobody can check.
 *
 * ## Everything here is called from a job, never from a request
 *
 * FR-NOT-003. A provider outage inside a request would make *approving a spend
 * request* fail because the notification failed, and the person pressing the
 * button would reasonably conclude the approval had not happened.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
  ) {}

  /**
   * Write and deliver one notification to each recipient.
   *
   * Recipients are processed independently: one address that bounces must not
   * stop the other four people being told. The job's own error handling gets
   * the failure, and it retries the whole set — which is safe, because
   * `dedupeKey` makes a second delivery to somebody already reached a no-op.
   */
  async deliver(input: DeliverInput): Promise<{ written: number; emailed: number }> {
    const recipients = [...new Set(input.recipientMembershipIds)];

    if (recipients.length === 0) return { written: 0, emailed: 0 };

    const members = await this.database.unscoped.membership.findMany({
      where: {
        id: { in: recipients },
        organizationId: input.organizationId,
        // Somebody deactivated yesterday does not need mail about today's
        // approvals, and their address may have been reassigned.
        status: 'ACTIVE',
      },
      select: { id: true, user: { select: { email: true, fullName: true } } },
    });

    const preferences = await this.preferencesFor(
      input.organizationId,
      members.map((member) => member.id),
      input.eventType,
    );

    let written = 0;
    let emailed = 0;
    let failed: Error | null = null;

    for (const member of members) {
      const preference = preferences.get(member.id) ?? DEFAULT_PREFERENCES[input.eventType];
      const delivered: NotificationChannel[] = [];

      if (preference.email) {
        try {
          await this.provider.send({
            organizationId: input.organizationId,
            to: member.user.email,
            toName: member.user.fullName,
            subject: input.title,
            body: input.body,
            actionUrl: this.absolute(input.path),
            actionLabel: input.actionLabel,
          });

          delivered.push('EMAIL');
          emailed += 1;
        } catch (error) {
          // Remembered, not thrown: the in-app copy is still worth writing,
          // and the row must not claim an email that did not go. The first
          // failure is re-thrown at the end so the job retries.
          failed ??= error instanceof Error ? error : new Error(String(error));

          this.logger.warn(
            { membershipId: member.id, eventType: input.eventType, err: error },
            'Sending a notification email failed.',
          );
        }
      }

      if (preference.inApp) delivered.push('IN_APP');

      try {
        await this.database.unscoped.notification.create({
          data: {
            id: newId(),
            organizationId: input.organizationId,
            recipientMembershipId: member.id,
            eventType: input.eventType,
            dedupeKey: input.dedupeKey,
            title: input.title,
            body: input.body,
            resourceType: input.resourceType ?? null,
            resourceId: input.resourceId ?? null,
            channelsDelivered: delivered,
            metadata: (input.metadata ?? null) as never,
            // Written explicitly, and this is not decoration. On MongoDB an
            // optional field never written is *absent*, and Prisma's `null`
            // filter does not match absent (ADR-0017) — so the unread count
            // and the "not dismissed" predicate would both silently answer
            // zero for every notification this system has ever created. The
            // failure is invisible: no error, no empty state, just a bell that
            // never lights up.
            readAt: null,
            deletedAt: null,
          },
        });

        written += 1;
      } catch (error) {
        // The unique index refused it, which means this recipient was already
        // told — a retry after a partial failure, which is the case the index
        // exists for. Anything else is a real error.
        const already = await this.database.unscoped.notification.findFirst({
          where: { recipientMembershipId: member.id, dedupeKey: input.dedupeKey },
          select: { id: true },
        });

        if (already === null) throw error;
      }
    }

    if (failed !== null) throw failed;

    return { written, emailed };
  }

  async list(
    query: ListNotificationsQuery,
  ): Promise<{ items: NotificationRecord[]; total: number; summary: NotificationSummary }> {
    const membershipId = requireMembership();

    const where = {
      recipientMembershipId: membershipId,
      deletedAt: null,
      ...(query.unreadOnly === true ? { readAt: null } : {}),
      ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
    };

    const [total, unread, rows] = await Promise.all([
      this.database.client.notification.count({ where }),
      this.database.client.notification.count({
        where: { recipientMembershipId: membershipId, deletedAt: null, readAt: null },
      }),
      this.database.client.notification.findMany({
        where,
        select: SELECT,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      items: rows.map(toRecord),
      summary: { unread, total },
    };
  }

  /**
   * Mark one as read.
   *
   * Scoped to the caller's own row, so this is a `404` for somebody else's
   * notification rather than a `403` — the id must not become a way to learn
   * that a colleague was told something.
   */
  async markRead(id: string): Promise<NotificationRecord> {
    const membershipId = requireMembership();

    const existing = await this.database.client.notification.findFirst({
      where: { id, recipientMembershipId: membershipId, deletedAt: null },
      select: SELECT,
    });

    if (existing === null) throw new NotFoundError('Notification');

    // Already-read stays as it was. Re-stamping would move a notification back
    // to the top of "read just now" every time the list is opened.
    if (existing.readAt !== null) return toRecord(existing);

    const updated = await this.database.unscoped.notification.update({
      where: { id },
      data: { readAt: new Date() },
      select: SELECT,
    });

    return toRecord(updated);
  }

  /** No `If-Match`: marking as read is idempotent and has no losing writer. */
  async markAllRead(): Promise<{ marked: number }> {
    const membershipId = requireMembership();

    const result = await this.database.unscoped.notification.updateMany({
      where: { recipientMembershipId: membershipId, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });

    return { marked: result.count };
  }

  async dismiss(id: string): Promise<void> {
    const membershipId = requireMembership();

    const existing = await this.database.client.notification.findFirst({
      where: { id, recipientMembershipId: membershipId, deletedAt: null },
      select: { id: true },
    });

    if (existing === null) throw new NotFoundError('Notification');

    await this.database.unscoped.notification.update({
      where: { id },
      data: { deletedAt: new Date(), readAt: new Date() },
    });
  }

  /**
   * Every event type, with what this member has chosen or the default.
   *
   * The full list, always. A screen built from the rows that exist would show
   * nothing to somebody who has never changed anything, which is everybody on
   * their first visit.
   */
  async preferences(): Promise<NotificationPreferenceRecord[]> {
    const membershipId = requireMembership();

    const rows = await this.database.client.notificationPreference.findMany({
      where: { membershipId },
      select: { eventType: true, inApp: true, email: true, version: true },
    });

    const chosen = new Map(rows.map((row) => [row.eventType, row]));

    return NOTIFICATION_EVENTS.map((eventType) => {
      const row = chosen.get(eventType);

      if (row === undefined) {
        return {
          eventType,
          ...DEFAULT_PREFERENCES[eventType],
          isDefault: true,
          version: null,
        };
      }

      return {
        eventType,
        inApp: row.inApp,
        email: row.email,
        isDefault: false,
        version: row.version,
      };
    });
  }

  async updatePreferences(
    input: UpdateNotificationPreferences,
  ): Promise<NotificationPreferenceRecord[]> {
    const membershipId = requireMembership();
    const organizationId = requireOrganization();

    // One transaction for the set: the screen saves a grid, and half a grid
    // applied is a person who believes they turned four things off and turned
    // two off.
    await this.database.unscoped.$transaction(async (tx) => {
      for (const row of input.preferences) {
        const existing = await tx.notificationPreference.findFirst({
          where: { membershipId, eventType: row.eventType },
          select: { id: true, version: true },
        });

        if (existing === null) {
          await tx.notificationPreference.create({
            data: {
              id: newId(),
              organizationId,
              membershipId,
              eventType: row.eventType,
              inApp: row.inApp,
              email: row.email,
            },
          });

          continue;
        }

        await tx.notificationPreference.update({
          where: { id: existing.id },
          data: { inApp: row.inApp, email: row.email, version: { increment: 1 } },
        });
      }
    });

    return this.preferences();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async preferencesFor(
    organizationId: string,
    membershipIds: readonly string[],
    eventType: NotificationEvent,
  ): Promise<Map<string, { inApp: boolean; email: boolean }>> {
    if (membershipIds.length === 0) return new Map();

    const rows = await this.database.unscoped.notificationPreference.findMany({
      where: { organizationId, membershipId: { in: [...membershipIds] }, eventType },
      select: { membershipId: true, inApp: true, email: true },
    });

    return new Map(rows.map((row) => [row.membershipId, { inApp: row.inApp, email: row.email }]));
  }

  private absolute(path: string): string {
    const base = this.config.get('WEB_BASE_URL').replace(/\/$/, '');
    return `${base}${path}`;
  }
}

const SELECT = {
  id: true,
  eventType: true,
  title: true,
  body: true,
  resourceType: true,
  resourceId: true,
  channelsDelivered: true,
  metadata: true,
  readAt: true,
  createdAt: true,
} as const;

interface Row {
  id: string;
  eventType: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  channelsDelivered: string[];
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
}

function toRecord(row: Row): NotificationRecord {
  return {
    id: row.id,
    eventType: row.eventType as NotificationEvent,
    title: row.title,
    body: row.body,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    channelsDelivered: row.channelsDelivered as NotificationChannel[],
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function requireMembership(): string {
  const membershipId = getContext()?.membershipId;

  if (membershipId === undefined) {
    throw new Error('Notifications are addressed to a membership, and there is none in context.');
  }

  return membershipId;
}

function requireOrganization(): string {
  const organizationId = getContext()?.organizationId;

  if (organizationId === undefined) {
    throw new Error('Notification preferences cannot be written without a tenant context.');
  }

  return organizationId;
}
