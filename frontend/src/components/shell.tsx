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
 *
 * **The counts arrive as props, resolved on the server by the layout.** They
 * were hard-coded to nothing while the endpoints behind them did not exist —
 * a plausible number beside Approvals would have been the most convincing lie
 * on the screen, since it is exactly the number a person acts on (docs/19 §5).
 * Now the endpoints exist, so the numbers are real or they are absent, and
 * a failure to fetch one shows no badge rather than a stale one.
 */
export function Shell({
  children,
  builtPhases,
  counts,
}: {
  children: React.ReactNode;
  builtPhases: number;
  counts: Partial<Record<string, number>>;
}): React.JSX.Element {
  const session = useSession();

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--surface-page)]">
      <Sidebar session={session} builtPhases={builtPhases} counts={counts} />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-8 py-7">{children}</div>
      </main>
    </div>
  );
}
