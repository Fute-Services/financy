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
  /** The organisation being switched to, or `null`. Doubles as the busy flag. */
  const [switching, setSwitching] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Switch the session's active organisation.
   *
   * The list in this menu was rendered as plain `<div>`s for a long time — the
   * organisations were named, and clicking one did nothing. Somebody with
   * memberships in two companies could see the second and never reach it,
   * which on a demo account meant staring at a full application with no data
   * in it and concluding the application was broken.
   *
   * A full navigation rather than `router.refresh()`, for the reason signing
   * in uses one: everything on screen — the sidebar's permission-filtered
   * items, the counts, every cached server render — belongs to the previous
   * organisation. Refreshing re-renders the tree against a router cache still
   * holding the old tenant's data, and the first frame after the switch shows
   * one organisation's chrome around another's figures. Replacing the document
   * is the only thing that cannot half-apply.
   */
  async function switchTo(organizationId: string): Promise<void> {
    if (organizationId === session.organization.id) {
      setOpen(false);
      return;
    }

    setSwitching(organizationId);

    try {
      const response = await fetch('/api/auth/switch-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });

      if (response.ok) {
        // Deliberately not clearing `switching`: the page is being replaced,
        // and re-enabling the row mid-navigation is what made signing in look
        // like it needed two clicks.
        window.location.assign('/overview');
        return;
      }
    } catch {
      // Fall through to the reset below. There is no error surface in this
      // menu and inventing one for a case the user can retry by clicking again
      // would be more chrome than the failure is worth.
    }

    setSwitching(null);
  }

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
                  busy={switching === organization.id}
                  disabled={switching !== null}
                  onSelect={() => {
                    void switchTo(organization.id);
                  }}
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

/**
 * One organisation in the menu.
 *
 * A `<button>`, not a `<div>`. It was a div — styled like a row, listed under
 * a heading, inside a `role="menu"`, and inert. Nothing about it said "this is
 * not clickable", which is the worst kind of dead control: it does not look
 * broken, it looks like the click failed.
 *
 * `role="menuitemradio"` because that is what this list is — a set of options
 * of which exactly one is current. It gives a screen-reader user the selected
 * state that the dot beside the active row gives everyone else.
 */
function MenuRow({
  label,
  hint,
  active,
  busy,
  disabled,
  onSelect,
}: {
  label: string;
  hint: string;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors',
        active ? 'text-ink-900' : 'text-ink-600',
        // The active row is not a target — it is where you already are — so it
        // gets no hover affordance, while the others do.
        active ? 'cursor-default' : 'hover:bg-ink-50',
        disabled && !busy && 'opacity-60',
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      <span className="text-[11px] text-ink-400">{busy ? 'Switching…' : hint}</span>
      {active && <span className="text-cobalt-600">·</span>}
    </button>
  );
}
