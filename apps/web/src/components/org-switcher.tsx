'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@financy/ui';

import { Icon } from './icons';
import { ROLE_LABELS } from '@/lib/permissions';
import type { Session } from '@/lib/session';

/**
 * The organisation switcher, and the account menu with it.
 *
 * One control rather than two, because in a multi-tenant product they are the
 * same question: *which organisation am I acting in, and as whom*. Splitting
 * them puts the role in one corner and the tenant in another, and the pair is
 * what actually determines what the person can do.
 *
 * The active organisation is stated permanently rather than on hover. A user
 * with memberships in several companies must never have to *check* which one
 * they are about to approve spend in.
 */
export function OrgSwitcher({ session }: { session: Session }): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Signing out revokes the session server-side, not just in the browser.
   * Clearing the cookie alone would leave a token that still works for anyone
   * who captured it, which is the whole reason sessions are server-held.
   *
   * `refresh()` before `replace()`: the shell resolves the session on the
   * server, and without it Next would serve the cached signed-in render of a
   * session that no longer exists.
   */
  async function signOut(): Promise<void> {
    setSigningOut(true);

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.refresh();
      // `replace`, so the back button does not return to a signed-in page.
      router.replace('/login');
    }
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initials = session.user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-colors hover:bg-white/6"
      >
        <span className="grid size-[22px] shrink-0 place-items-center rounded-[5px] bg-cobalt-600 text-[10px] font-semibold text-white">
          {session.organization.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-white">
            {session.organization.name}
          </span>
        </span>
        <span className="text-ink-500">
          <Icon name="list" />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-40 mt-1 w-[248px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-white py-1 shadow-xl"
        >
          <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-700">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink-900">
                {session.user.fullName}
              </span>
              <span className="block truncate text-[12px] text-ink-500">{session.user.email}</span>
            </span>
          </div>

          {session.organizations.length > 1 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">
                Organisations
              </p>
              {session.organizations.map((organization) => (
                <MenuRow
                  key={organization.id}
                  label={organization.name}
                  hint={ROLE_LABELS[organization.roleKey]}
                  active={organization.id === session.organization.id}
                />
              ))}
              <div className="my-1 h-px bg-[var(--border-subtle)]" />
            </>
          )}

          <p className="px-3 py-1.5 text-[12px] text-ink-500">
            Signed in as{' '}
            <span className="font-medium text-ink-700">
              {ROLE_LABELS[session.membership.roleKey]}
            </span>
          </p>

          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => {
              void signOut();
            }}
            className="w-full px-3 py-2 text-left text-[13px] text-ink-700 hover:bg-ink-50 disabled:opacity-60"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  hint,
  active,
}: {
  label: string;
  hint: string;
  active: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-[13px]',
        active ? 'text-ink-900' : 'text-ink-600',
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[11px] text-ink-400">{hint}</span>
      {active && <span className="text-cobalt-600">·</span>}
    </div>
  );
}
