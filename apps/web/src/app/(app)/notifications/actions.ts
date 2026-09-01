'use server';

import type { NotificationPreferenceRecord, Resource } from '@financy/contracts';
import { NOTIFICATION_EVENTS } from '@financy/contracts';

import { apiFetch } from '@/lib/api';
import { create, runWrite, text, type FormState } from '@/lib/actions';

/**
 * The notification centre's writes.
 *
 * **Every path that shows a count is revalidated, not just this page.** The
 * unread count lives in the sidebar on every screen, so marking something read
 * here and leaving the rest cached produces a badge that still says 3 while
 * the list is empty — which reads as the click having failed.
 */
const PATHS = ['/notifications', '/overview', '/approvals'];

export async function markNotificationRead(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(PATHS, () => create<Resource<unknown>>(`/notifications/${id}/read`, {}));
}

export async function markAllNotificationsRead(): Promise<FormState> {
  return runWrite(
    PATHS,
    () => create<Resource<{ marked: number }>>('/notifications/read-all', {}),
    'Everything marked as read.',
  );
}

/**
 * Dismiss.
 *
 * The row leaves the list and the record stays (docs/09 §4). Worth saying in
 * the confirmation, because "dismiss" reads like "delete" and somebody
 * clearing an inbox should know the audit answer to "was I told?" is unchanged.
 */
export async function dismissNotification(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(PATHS, () => apiFetch<void>(`/notifications/${id}`, { method: 'DELETE' }));
}

/**
 * Save the whole preference grid in one request.
 *
 * The form carries a checkbox per event type per channel, and an unchecked box
 * sends nothing at all — so the value is read as "is this name present?"
 * rather than as a value. Reading it any other way turns "off" into "unchanged"
 * and makes the switches impossible to turn off.
 */
export async function saveNotificationPreferences(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const preferences = NOTIFICATION_EVENTS.map((eventType) => ({
    eventType,
    inApp: form.get(`inApp:${eventType}`) !== null,
    email: form.get(`email:${eventType}`) !== null,
  }));

  return runWrite(
    PATHS,
    () =>
      apiFetch<Resource<NotificationPreferenceRecord[]>>('/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences }),
      }),
    'Saved. New notifications follow these from now on.',
  );
}
