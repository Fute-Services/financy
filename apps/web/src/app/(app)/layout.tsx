import { redirect } from 'next/navigation';

import { SessionProvider } from '@/components/session-provider';
import { Shell } from '@/components/shell';
import { getSession } from '@/lib/session';

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
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
