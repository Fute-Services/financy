/**
 * Notifications (docs/10 §5.14, FR-NOT-001…003, epic 2.5).
 *
 * ## The event type is the unit of preference, not the channel
 *
 * "Email me about approvals but not about receipts" is the sentence people
 * actually say. A preference model keyed only by channel can express "no
 * email" and nothing finer, so the first person who wants approval mail and
 * not digest mail turns email off entirely — and then misses an approval.
 *
 * ## Defaults live here, not in a row per member
 *
 * A member with no preference row gets `DEFAULT_PREFERENCES`. Writing thirty
 * rows at registration would be thirty choices nobody made, and would freeze
 * today's defaults for every account created before a default changed.
 *
 * ## Nothing here can turn off the record
 *
 * `inApp` and `email` are delivery. The notification row is written either
 * way, because "I was never told" is a question the record has to be able to
 * answer, and a preference that suppressed the record would make the answer
 * "we don't know".
 */

import { z } from 'zod';

import { idSchema, timestampSchema, versionSchema } from './primitives.js';

/**
 * Every event somebody can be told about.
 *
 * The six from FR-NOT-001, and they are declared in full here even though
 * three of them are emitted by phases that do not exist yet. The preference
 * screen is built from this list: shipping it with three entries and adding
 * the others later would mean a member who turned everything off in Phase 2
 * silently starts receiving budget mail in Phase 4.
 */
export const NOTIFICATION_EVENTS = [
  'approval.requested',
  'approval.decided',
  'approval.reminder',
  'approval.escalated',
  'spend_request.returned',
  'receipt.missing',
  'budget.threshold',
  'reimbursement.paid',
  'policy.exception',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEvent, string>> = {
  'approval.requested': 'Something needs my approval',
  'approval.decided': 'My request was decided',
  'approval.reminder': 'An approval is still waiting for me',
  'approval.escalated': 'An approval was escalated',
  'spend_request.returned': 'My request was sent back',
  'receipt.missing': 'A receipt is missing',
  'budget.threshold': 'A budget crossed a threshold',
  'reimbursement.paid': 'A reimbursement was paid',
  'policy.exception': 'A policy exception was recorded',
};

export const NOTIFICATION_EVENT_DESCRIPTIONS: Readonly<Record<NotificationEvent, string>> = {
  'approval.requested': 'A spend request has reached a step you can act on.',
  'approval.decided': 'A request you raised was approved, rejected, or overridden.',
  'approval.reminder': 'A step you can act on has been waiting a while.',
  'approval.escalated': 'A step passed its deadline and moved on without you.',
  'spend_request.returned': 'An approver sent your request back for changes.',
  'receipt.missing': 'A daily summary of charges still needing a receipt.',
  'budget.threshold': 'A budget you own crossed 80% or went over.',
  'reimbursement.paid': 'A reimbursement to you was marked paid.',
  'policy.exception': 'A policy was overridden or a control was bypassed.',
};

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * What a member gets before they choose anything.
 *
 * **Everything that needs an action from them is on by default; everything
 * that is a summary is off.** A person who misses an approval blocks somebody
 * else's work, so those default on. A digest that arrives unasked is the mail
 * people build a filter for, and the filter catches the approval too.
 */
export const DEFAULT_PREFERENCES: Readonly<
  Record<NotificationEvent, { inApp: boolean; email: boolean }>
> = {
  'approval.requested': { inApp: true, email: true },
  'approval.decided': { inApp: true, email: true },
  'approval.reminder': { inApp: true, email: true },
  'approval.escalated': { inApp: true, email: true },
  'spend_request.returned': { inApp: true, email: true },
  'receipt.missing': { inApp: true, email: false },
  'budget.threshold': { inApp: true, email: true },
  'reimbursement.paid': { inApp: true, email: true },
  'policy.exception': { inApp: true, email: false },
};

export const notificationSchema = z.object({
  id: idSchema,
  eventType: z.enum(NOTIFICATION_EVENTS),
  title: z.string(),
  body: z.string(),
  resourceType: z.string().nullable(),
  resourceId: idSchema.nullable(),
  /** What was actually delivered, not what was intended. */
  channelsDelivered: z.array(z.enum(NOTIFICATION_CHANNELS)),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  readAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  /** The default view is everything; the bell shows unread. */
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  eventType: z.enum(NOTIFICATION_EVENTS).optional(),
});

/**
 * The unread count travels with the list.
 *
 * The bell needs it on every page of the application, and a second endpoint
 * for one integer is a second request on every navigation.
 */
export const notificationSummarySchema = z.object({
  unread: z.int().min(0),
  total: z.int().min(0),
});

export const notificationPreferenceSchema = z.object({
  eventType: z.enum(NOTIFICATION_EVENTS),
  inApp: z.boolean(),
  email: z.boolean(),
  /** False when this is the default rather than something the member chose. */
  isDefault: z.boolean(),
  version: versionSchema.nullable(),
});

/**
 * Preferences are written as a set, not one at a time.
 *
 * The screen is a grid of checkboxes and somebody ticks four of them before
 * pressing save. Nine round trips would give nine chances to half-apply.
 */
export const updateNotificationPreferencesSchema = z.strictObject({
  preferences: z
    .array(
      z.strictObject({
        eventType: z.enum(NOTIFICATION_EVENTS),
        inApp: z.boolean(),
        email: z.boolean(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_EVENTS.length)
    .refine((rows) => new Set(rows.map((row) => row.eventType)).size === rows.length, {
      error: 'Each event type may appear only once.',
    }),
});

export type NotificationRecord = z.infer<typeof notificationSchema>;
export type NotificationSummary = z.infer<typeof notificationSummarySchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type NotificationPreferenceRecord = z.infer<typeof notificationPreferenceSchema>;
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;
