'use client';

import { createContext, useContext, useMemo } from 'react';

import type { SessionResponse } from '@financy/contracts';

import type { Session } from '@/lib/session';

/**
 * Makes the server-resolved session available to the client components in the
 * shell — the sidebar, the command palette, the organisation switcher.
 *
 * It resolves nothing itself. The session is fetched in the layout, on the
 * server, with the `httpOnly` cookie the browser cannot read; this only
 * carries it down. An earlier version derived the role from a query parameter
 * so the permission-aware navigation could be demonstrated before the API
 * existed, which meant the shell could show a role nobody actually held.
 *
 * The permission set drives rendering only. Every endpoint re-checks
 * server-side (docs/03 §7).
 */

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionResponse;
  children: React.ReactNode;
}): React.JSX.Element {
  // `permissions` crosses the server/client boundary as an array and is
  // rebuilt as a Set here — a Set does not survive serialisation, and the
  // components downstream want membership checks, not a linear scan.
  const value = useMemo<Session>(
    () => ({ ...session, permissions: new Set(session.permissions) }),
    [session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);

  if (session === null) {
    throw new Error('useSession must be used inside a SessionProvider.');
  }

  return session;
}
