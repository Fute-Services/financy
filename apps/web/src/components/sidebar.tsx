'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@financy/ui';

import { CommandPalette } from './command-palette';
import { Icon, Logo } from './icons';
import { OrgSwitcher } from './org-switcher';
import { pinnedItems, type NavItem } from '@/lib/navigation';
import type { Session } from '@/lib/session';

/**
 * Navigation.
 *
 * Short on purpose. It holds the handful of destinations a person returns to
 * without deciding to; `⌘K` holds the rest. A sidebar listing every module is
 * a table of contents — it grows with the product until nobody reads it, and
 * the items that matter get harder to find precisely as more are added.
 *
 * Counts are the other half of the idea. "Approvals" is a place; "Approvals 3"
 * is a reason to go there, and it is the only thing on this panel that changes
 * during a working day.
 */
export function Sidebar({
  session,
  builtPhases,
  counts,
}: {
  session: Session;
  builtPhases: number;
  counts: Partial<Record<string, number>>;
}): React.JSX.Element {
  const pathname = usePathname();
  const pinned = pinnedItems(session.permissions);

  return (
    <nav
      aria-label="Primary"
      className="flex w-[212px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--surface-nav)]"
    >
      <div className="px-2.5 pt-2.5">
        <OrgSwitcher session={session} />
      </div>

      <div className="px-2.5 pt-1.5">
        <CommandPalette permissions={session.permissions} builtPhases={builtPhases} />
      </div>

      <ul className="mt-3 flex-1 space-y-px overflow-y-auto px-2.5 pb-4">
        {pinned.map((item) => (
          <li key={item.href}>
            <NavLink
              item={item}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              available={item.phase <= builtPhases}
              count={counts[item.href]}
            />
          </li>
        ))}
      </ul>

      <div className="border-t border-white/8 px-2.5 py-2.5">
        {session.isSandbox && (
          <p
            className="mb-2 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px] leading-tight"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-warning-text) 14%, transparent)',
              color: 'var(--color-warning-text)',
            }}
            title="Cards, payments, and accounting are mock adapters. No money moves."
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: 'var(--color-warning-text)' }}
              aria-hidden="true"
            />
            Sandbox mode
          </p>
        )}

        <p className="flex items-center gap-1.5 px-1 text-[11px] text-ink-600">
          <span className="text-ink-600">
            <Logo />
          </span>
          Financy
        </p>
      </div>
    </nav>
  );
}

function NavLink({
  item,
  active,
  available,
  count,
}: {
  item: NavItem;
  active: boolean;
  available: boolean;
  count: number | undefined;
}): React.JSX.Element {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-[30px] items-center gap-2.5 rounded-[var(--radius-sm)] px-2 text-[13px]',
        'transition-colors duration-100',
        active
          ? 'bg-white/10 font-medium text-white'
          : 'text-ink-300 hover:bg-white/6 hover:text-white',
      )}
    >
      <span className={active ? 'text-cobalt-400' : 'text-ink-500 group-hover:text-ink-300'}>
        <Icon name={item.icon} />
      </span>
      <span className="flex-1 truncate">{item.label}</span>

      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-cobalt-500/25 px-1.5 text-[11px] font-medium text-cobalt-200 tabular-nums">
          {count}
        </span>
      )}

      {!available && count === undefined && (
        <span
          className="text-[10px] text-ink-600 tabular-nums"
          title={`Delivered in Phase ${item.phase}`}
        >
          P{item.phase}
        </span>
      )}
    </Link>
  );
}
