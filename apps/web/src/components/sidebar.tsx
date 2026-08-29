'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@financy/ui';
import { Icon, Logo } from './icons';
import { NAV_GROUPS, itemsForGroup, type NavItem } from '@/lib/navigation';

/**
 * Primary navigation.
 *
 * Rendered from the manifest in `lib/navigation.ts` and filtered by the
 * session's permission set. A group header is hidden when every item inside it
 * is filtered out, so a restricted user sees a coherent menu rather than
 * a scattering of empty sections.
 *
 * Items whose module is not yet built carry a phase marker. That is deliberate
 * during the build-out: a link that leads nowhere with no explanation is worse
 * than one that says when it arrives.
 */
export function Sidebar({
  permissions,
  builtPhases,
}: {
  permissions: ReadonlySet<string>;
  builtPhases: number;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="flex w-60 shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--surface-nav)]"
    >
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span className="text-cobalt-600">
          <Logo />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">Financy</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-4">
        {NAV_GROUPS.map((group) => {
          const items = itemsForGroup(group.id, permissions);
          if (items.length === 0) return null;

          return (
            <div key={group.id} className="mb-1">
              {group.label && (
                <p className="mt-5 mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                      available={item.phase <= builtPhases}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function NavLink({
  item,
  active,
  available,
}: {
  item: NavItem;
  active: boolean;
  available: boolean;
}): React.JSX.Element {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-sm',
        'transition-colors duration-100',
        active
          ? 'bg-cobalt-600 font-medium text-white'
          : 'text-ink-300 hover:bg-white/6 hover:text-white',
      )}
    >
      <Icon name={item.icon} />
      <span className="flex-1 truncate">{item.label}</span>
      {!available && (
        <span
          className="rounded-[3px] bg-white/10 px-1.5 py-px text-[10px] font-medium text-ink-400"
          title={`Delivered in Phase ${item.phase}`}
        >
          P{item.phase}
        </span>
      )}
    </Link>
  );
}
