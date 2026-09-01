import type { Metadata } from 'next';
import Link from 'next/link';
import type {
  NotificationPreferenceRecord,
  NotificationRecord,
  OffsetCollection,
  Resource,
} from '@financy/contracts';
import { NOTIFICATION_EVENT_LABELS } from '@financy/contracts';
import { Card, CardBody, CardHeader, PermissionState, ScopeEmptyState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { NotificationRow } from './notification-row';
import { PreferenceGrid } from './preference-grid';
import { ReadAllButton } from './read-all-button';

export const metadata: Metadata = { title: 'Notifications' };

type Inbox = OffsetCollection<NotificationRecord> & { summary: { unread: number; total: number } };

/**
 * The notification centre.
 *
 * ## Unread is a filter, not a separate screen
 *
 * The two views differ by one query parameter, which keeps the URL shareable
 * and means "show me what I have not read" costs nothing to leave and return
 * to. A separate screen would need its own empty state, its own pagination,
 * and would drift.
 *
 * ## Every row is a link to the thing it is about
 *
 * A notification that cannot be acted on is an interruption. The row opens the
 * request and marks itself read in the same click, because a person who has
 * opened a thing has read the notification about it — asking them to also tick
 * it off is asking them to do the software's bookkeeping.
 *
 * ## The preferences live here, beside what they control
 *
 * Not in Settings. Somebody deciding they get too much of this is looking at
 * the too-much when they decide it, and a preference two screens away from its
 * effect is one people give up looking for and filter in their mail client
 * instead — where it catches the approvals too.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'notification:read_own')) {
    return (
      <>
        <PageHeader title="Notifications" />
        <Card>
          <PermissionState permission="notification:read_own" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const unreadOnly = params['unread'] === 'true';

  const [inbox, preferences] = await Promise.all([
    apiFetch<Inbox>(`/notifications?pageSize=50${unreadOnly ? '&unreadOnly=true' : ''}`),
    apiFetch<Resource<NotificationPreferenceRecord[]>>('/notifications/preferences'),
  ]);

  const items = inbox.data;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What happened while you were elsewhere. Every one of these points at something you can open."
        count={inbox.summary.unread === 0 ? 'All read' : `${String(inbox.summary.unread)} unread`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title={unreadOnly ? 'Unread' : 'Everything'}
              action={
                <div className="flex items-center gap-3">
                  <Link
                    href={unreadOnly ? '/notifications' : '/notifications?unread=true'}
                    className="text-[12px] text-[var(--color-accent-text)] hover:underline"
                  >
                    {unreadOnly ? 'Show everything' : 'Show unread only'}
                  </Link>
                  {inbox.summary.unread > 0 && <ReadAllButton />}
                </div>
              }
            />
            <CardBody className="p-0">
              {items.length === 0 ? (
                <div className="p-6">
                  {/*
                    No call to action. An empty inbox means there is nothing to
                    do, and suggesting otherwise would imply there is.
                  */}
                  <ScopeEmptyState
                    title={unreadOnly ? 'Nothing unread' : 'Nothing yet'}
                    description={
                      unreadOnly
                        ? 'You have read everything. Switch to “everything” to look back.'
                        : 'You will be told here when something needs you — an approval waiting, or a decision on something you asked for.'
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {items.map((notification) => (
                    <li key={notification.id}>
                      <NotificationRow notification={notification} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="What you get told about"
              description="These apply to new notifications. Turning something off never removes the record that it happened."
            />
            <CardBody>
              <PreferenceGrid preferences={preferences.data} labels={NOTIFICATION_EVENT_LABELS} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
