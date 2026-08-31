'use client';

import { Sidebar } from './sidebar';
import { useSession } from './session-provider';

/**
 * Chrome around the page content.
 *
 * There is no top bar. Everything a top bar usually carries has a better home:
 * the organisation and the account went into the switcher at the top of the
 * sidebar, search became `⌘K`, and the page title belongs to the page — it is
 * the one piece of chrome that changes per route, so putting it in a shared
 * bar means the shell re-renders for something only the page knows.
 *
 * What is left is one vertical rule and the content, which is the point: on a
 * screen full of financial data, chrome is the thing competing with the
 * numbers for attention.
 */

/**
 * Highest roadmap phase whose modules actually exist.
 *
 * Raised as each phase lands, and only once the *screens* are real — not once
 * the endpoints behind them are. Phase 1 now qualifies: People, Settings, and
 * the Audit log each read a live endpoint, enforce their permission, and show
 * the caller's own organisation and nobody else's.
 *
 * Everything from Phase 2 up is still a stub, and the palette marks it as one.
 * Raising this number ahead of the screens would silently turn every "not
 * built yet" marker into a promise the application does not keep.
 */
const BUILT_PHASES = 1;

/**
 * Counts beside a pinned item, keyed by href.
 *
 * Empty until the endpoints behind them exist. A hard-coded `3` next to
 * Approvals would be the most convincing lie on the screen — it is exactly the
 * number a person acts on — so there is nothing here rather than a plausible
 * number (docs/19 §5).
 */
const NAV_COUNTS: Partial<Record<string, number>> = {};

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const session = useSession();

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--surface-page)]">
      <Sidebar session={session} builtPhases={BUILT_PHASES} counts={NAV_COUNTS} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-8 py-7">{children}</div>
      </main>
    </div>
  );
}
