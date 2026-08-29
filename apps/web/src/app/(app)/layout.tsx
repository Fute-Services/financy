import { Suspense } from 'react';
import { SessionProvider } from '@/components/session-provider';
import { Shell } from '@/components/shell';

/**
 * Authenticated application shell.
 *
 * Fixed 240px sidebar, 56px top bar, fluid content region capped at 1600px
 * (docs/04-INFORMATION-ARCHITECTURE.md §1).
 *
 * The layout stays a server component and does no session work itself: the
 * App Router does not pass `searchParams` to layouts, so anything derived from
 * the query string has to happen below a client boundary. `SessionProvider`
 * is that boundary. `children` is still rendered on the server and passed
 * through, so pages remain server components.
 *
 * `Suspense` is required because `SessionProvider` calls `useSearchParams`.
 */
export default function AppLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Suspense fallback={<ShellFallback />}>
      <SessionProvider>
        <Shell>{children}</Shell>
      </SessionProvider>
    </Suspense>
  );
}

function ShellFallback(): React.JSX.Element {
  return (
    <div className="flex h-screen overflow-hidden">
      <div className="w-60 shrink-0 bg-[var(--surface-nav)]" />
      <div className="flex-1 border-b border-[var(--border-default)]" />
    </div>
  );
}
