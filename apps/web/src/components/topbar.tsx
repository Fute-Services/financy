'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, cn } from '@financy/ui';
import { PREVIEW_ROLES } from '@/lib/session';
import { ROLE_LABELS, type RoleKey } from '@/lib/permissions';

/**
 * Top bar.
 *
 * The role switcher is a **developer preview control**, present only while the
 * auth module is being built (roadmap task 1.3). It changes which permissions
 * the shell renders with, so the RBAC-aware navigation and empty states can be
 * exercised for every role without seeding five accounts. It disappears when
 * `GET /v1/auth/session` becomes the source of the permission set.
 *
 * It is not a privilege escalation surface: it only affects rendering, and
 * there is no API behind it yet to authorise against.
 */
export function TopBar({
  organizationName,
  roleKey,
  isSandbox,
}: {
  organizationName: string;
  roleKey: RoleKey;
  isSandbox: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();

  function switchRole(next: string): void {
    const query = new URLSearchParams(params.toString());
    query.set('role', next);
    router.push(`?${query.toString()}`);
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-6">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-medium text-ink-800">{organizationName}</span>
        {isSandbox && (
          // Required by ADR-0014: while any provider is a mock, the product
          // says so plainly, everywhere. We never imply money moved when only
          // a record was created.
          <Badge tone="warning" title="All financial providers are mock or sandbox adapters">
            Sandbox
          </Badge>
        )}
      </div>

      <div className="flex-1" />

      <label className="flex items-center gap-2 text-xs text-ink-500">
        <span className="hidden sm:inline">Preview as</span>
        <select
          value={roleKey}
          onChange={(event) => switchRole(event.target.value)}
          className={cn(
            'h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)]',
            'bg-[var(--surface-raised)] px-2 text-xs text-ink-700',
            'focus:border-cobalt-600 focus:outline-none',
          )}
        >
          {PREVIEW_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex size-8 items-center justify-center rounded-full bg-cobalt-50 text-xs font-semibold text-cobalt-700">
        PU
      </div>
    </header>
  );
}
