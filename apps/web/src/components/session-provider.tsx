'use client';

import { createContext, useContext, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSession, type Session } from '@/lib/session';
import type { RoleKey } from '@/lib/permissions';

/**
 * Session context for the application shell.
 *
 * **Why a client context rather than a server-resolved prop:** layouts in the
 * App Router deliberately do not receive `searchParams` — they are not
 * re-rendered when the query string changes, so Next.js does not pass it.
 * Reading the role preview parameter in the layout silently yielded the
 * default role for every user, which made the permission-aware navigation
 * look like it was working when it was not.
 *
 * In Phase 1 (roadmap task 1.3.4) `getSession()` becomes a fetch of
 * `GET /v1/auth/session` against the httpOnly session cookie, and the query
 * parameter disappears. The context boundary stays exactly where it is, so
 * that swap touches this file and `lib/session.ts` and nothing else.
 *
 * Nothing here is a security boundary — the permission set drives rendering
 * only, and every endpoint re-checks server-side (docs/03 §7).
 */

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const params = useSearchParams();
  const roleKey = (params.get('role') as RoleKey | null) ?? 'ORG_ADMIN';

  const session = useMemo(() => getSession(roleKey), [roleKey]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession must be used inside a SessionProvider.');
  }
  return session;
}
