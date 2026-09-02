import { redirect } from 'next/navigation';
import type { NotificationRecord, OffsetCollection, QueueItem, Resource } from '@financy/contracts';

import { SessionProvider } from '@/components/session-provider';
import { Shell } from '@/components/shell';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';

/**
 * The authenticated shell.
 *
 * The session is resolved **here**, on the server, before anything renders.
 * Two consequences worth stating:
 *
 * - There is no logged-out flash and no loading skeleton for the chrome. The
 *   first byte the browser receives already has the right organisation name in
 *   it.
 * - Every page under this layout can assume a session exists. A page that had
 *   to handle "maybe signed in" would handle it slightly differently each
 *   time, and one of those would be wrong.
 *
 * The redirect is a convenience, not a control. It is the API that refuses an
 * unauthenticated request; this only saves the user from a screen full of
 * empty states.
 */

/**
 * Highest roadmap phase whose modules actually exist.
 *
 * Raised as each phase lands, and only once the *screens* are real — not once
 * the endpoints behind them are. Phase 4 now qualifies: the overview,
 * budgets, and the report gallery each read a live endpoint and enforce their
 * permission, alongside everything Phases 1 to 3 delivered.
 *
 * Raising this number ahead of the screens would silently turn every "not
 * built yet" marker into a promise the application does not keep.
 */
const BUILT_PHASES = 4;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null) {
    redirect('/login');
  }

  return (
    <SessionProvider session={session}>
      <Shell builtPhases={BUILT_PHASES} counts={await navCounts(session)}>
        {children}
      </Shell>
    </SessionProvider>
  );
}

/**
 * The two numbers on the sidebar.
 *
 * **Both requests can fail without taking the page with them.** A count is
 * decoration around navigation; a layout that threw because the approval queue
 * was briefly unavailable would take out every screen in the application to
 * avoid showing one badge. On failure the badge is absent, never stale and
 * never zero — "0 waiting" and "we could not ask" are different statements and
 * only one of them is true.
 *
 * Fetched in the layout rather than by each page, because they appear on every
 * screen. `apiFetch` is uncached, so they are as current as the render.
 */
async function navCounts(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<Partial<Record<string, number>>> {
  const [queue, inbox] = await Promise.all([
    can(session, 'approval:read')
      ? apiFetch<Resource<QueueItem[]>>('/approvals/queue').catch(() => null)
      : Promise.resolve(null),
    can(session, 'notification:read_own')
      ? apiFetch<OffsetCollection<NotificationRecord> & { summary: { unread: number } }>(
          '/notifications?pageSize=1&unreadOnly=true',
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    ...(queue === null ? {} : { '/approvals': queue.data.length }),
    ...(inbox === null ? {} : { '/notifications': inbox.summary.unread }),
  };
}
