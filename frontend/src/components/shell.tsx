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

      {/*
        The content column is anchored to the sidebar, not centred in what is
        left of the window.

        It used to be `mx-auto max-w-[1180px]`. On a 1440px window that is
        nearly invisible, which is why it survived; on a 1920px one the sidebar
        ends at 212px and the content began at 476px, leaving a 264px dead
        gutter between the navigation and the thing it navigates to. A gap that
        much larger than the page's own padding does not read as breathing
        room — it reads as a column that has come unstuck from the chrome.

        So: no `mx-auto`. The column starts one padding-width from the sidebar
        at every size, and the cap only decides where it stops growing. That
        cap is 1440 rather than 1180 because the widest screens here are
        transaction and audit tables, and 260px of extra width is another
        column of figures rather than wasted space.
      */}
      {/*
        Tighter than it was — px-8 py-7 around a 32px table row is a page
        border wider than three rows are tall. A console spends its space on
        rows, not on margins.
      */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-[1520px] px-6 py-5">{children}</div>
      </main>
    </div>
  );
}
