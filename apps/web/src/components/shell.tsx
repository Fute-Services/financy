'use client';

import { Sidebar } from './sidebar';
import { TopBar } from './topbar';
import { useSession } from './session-provider';

/**
 * Chrome around the page content.
 *
 * A client component so it can read the session context, but `children` is
 * passed through untouched — pages stay server components and are rendered on
 * the server, then slotted in here.
 */

/**
 * Highest roadmap phase whose modules actually exist.
 *
 * Drives the phase markers in the navigation. Raised as each phase lands, so a
 * link that leads to an unbuilt module says so rather than looking broken.
 */
const BUILT_PHASES = 0;

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const session = useSession();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar permissions={session.permissions} builtPhases={BUILT_PHASES} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          organizationName={session.organization.name}
          roleKey={session.roleKey}
          isSandbox={session.isSandbox}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
