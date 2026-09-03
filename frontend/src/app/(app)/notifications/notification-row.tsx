'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { NotificationRecord } from '@financy/contracts';
import { Badge, cn } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { dismissNotification, markNotificationRead } from './actions';

/**
 * One notification.
 *
 * ## Opening it is what marks it read
 *
 * A person who has opened the request has read the notification about it, and
 * asking them to also tick it off is asking them to do the software's
 * bookkeeping. The tick stays for the ones they decide are not worth opening —
 * which is a real decision and needs a way to record it.
 *
 * ## Unread is a weight, not a colour
 *
 * A dot and a heavier title, rather than a tinted row. Tinted rows in a list of
 * twenty read as a warning state, and these are ordinary — the ones that need
 * urgency say so in their own words.
 *
 * ## The channels are shown when something did not go
 *
 * `EMAIL` missing from a notification whose preference asked for it means the
 * mail failed, and the person is better served by seeing that than by
 * wondering why their inbox is empty. When everything went as asked, there is
 * nothing to say and nothing is shown.
 */
export function NotificationRow({
  notification,
}: {
  notification: NotificationRecord;
}): React.JSX.Element {
  const [readState, markRead, readPending] = useActionState(markNotificationRead, IDLE);
  const [, dismiss, dismissPending] = useActionState(dismissNotification, IDLE);

  const unread = notification.readAt === null;
  const href = resourceHref(notification);

  return (
    <div className={cn('flex items-start gap-3 px-5 py-3.5', dismissPending && 'opacity-50')}>
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          unread ? 'bg-cobalt-500' : 'bg-transparent',
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {href === null ? (
            <span className={cn('text-sm text-ink-800', unread && 'font-semibold')}>
              {notification.title}
            </span>
          ) : (
            <form action={markRead} className="contents">
              <input type="hidden" name="id" value={notification.id} />
              {/*
                A link and a submit in one: the anchor navigates, and the
                button posts the read. Both fire, and neither depends on the
                other having finished — a read that fails must not swallow the
                navigation, because the point of the row is the thing it points
                at.
              */}
              <Link
                href={href}
                onClick={(event) => {
                  event.currentTarget.closest('form')?.requestSubmit();
                }}
                className={cn(
                  'text-sm text-ink-800 hover:text-cobalt-600 hover:underline',
                  unread && 'font-semibold',
                )}
              >
                {notification.title}
              </Link>
            </form>
          )}

          {notification.channelsDelivered.includes('EMAIL') ? null : (
            <Badge tone="neutral" title="This one was not emailed.">
              In app only
            </Badge>
          )}
        </div>

        <p className="mt-0.5 text-[13px] text-ink-600">{notification.body}</p>

        <p className="mt-1 text-[12px] text-ink-400">
          <time dateTime={notification.createdAt}>{formatWhen(notification.createdAt)}</time>
          {readState.status === 'error' && (
            <span className="ml-2 text-[var(--color-danger-text)]">{readState.message}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {unread && (
          <form action={markRead}>
            <input type="hidden" name="id" value={notification.id} />
            <button
              type="submit"
              disabled={readPending}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-ink-500 hover:bg-[var(--surface-subtle)] hover:text-ink-800"
            >
              Mark read
            </button>
          </form>
        )}

        <form action={dismiss}>
          <input type="hidden" name="id" value={notification.id} />
          <button
            type="submit"
            disabled={dismissPending}
            title="Removes it from this list. The record that you were told stays."
            className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-ink-500 hover:bg-[var(--surface-subtle)] hover:text-ink-800"
          >
            Dismiss
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Where a notification points.
 *
 * `null` when it names a resource this build has no screen for — a bill, an
 * expense — rather than a link into a 404. The row still reads perfectly well
 * without one; a broken link reads as a broken product.
 */
function resourceHref(notification: NotificationRecord): string | null {
  if (notification.resourceId === null) return null;

  switch (notification.resourceType) {
    case 'spend_request':
      return `/spend/${notification.resourceId}`;
    case 'card':
      return `/cards/${notification.resourceId}`;
    case 'transaction':
      return `/transactions/${notification.resourceId}`;
    case null:
    default:
      return null;
  }
}

/**
 * Relative for the recent, absolute after that.
 *
 * "2 hours ago" is what somebody wants for this morning's approval and useless
 * for one from March, where the date is the thing being compared against a
 * statement.
 */
function formatWhen(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d ago`;

  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
