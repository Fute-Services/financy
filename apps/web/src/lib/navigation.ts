/**
 * The navigation manifest.
 *
 * Declared once, rendered by the sidebar, and filtered by the session's
 * permission set. Hiding an item the user cannot use is a **usability
 * affordance, not a security control** — the corresponding API endpoint
 * enforces the same permission independently, and navigating directly to a
 * hidden route renders the permission state rather than a 404
 * (docs/04-INFORMATION-ARCHITECTURE.md §2).
 */

export type NavGroup = 'primary' | 'spend' | 'plan' | 'payables' | 'admin';

export interface NavItem {
  label: string;
  href: string;
  /** Permission required to see it. `null` means any active membership. */
  permission: string | null;
  group: NavGroup;
  /** Roadmap phase that delivers it. Anything past Phase 1 is not built yet. */
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  icon: IconName;
}

export type IconName =
  | 'dashboard'
  | 'send'
  | 'card'
  | 'list'
  | 'receipt'
  | 'gauge'
  | 'invoice'
  | 'cart'
  | 'building'
  | 'chart'
  | 'ledger'
  | 'users'
  | 'shield'
  | 'cog'
  | 'history';

export const NAV_GROUPS: Array<{ id: NavGroup; label: string | null }> = [
  { id: 'primary', label: null },
  { id: 'spend', label: 'Spend' },
  { id: 'plan', label: 'Plan' },
  { id: 'payables', label: 'Payables' },
  { id: 'admin', label: 'Admin' },
];

export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/overview', permission: null, group: 'primary', phase: 4, icon: 'dashboard' },

  { label: 'Spend', href: '/spend', permission: 'spend_request:read', group: 'spend', phase: 2, icon: 'send' },
  { label: 'Cards', href: '/cards', permission: 'card:read', group: 'spend', phase: 2, icon: 'card' },
  { label: 'Transactions', href: '/transactions', permission: 'transaction:read', group: 'spend', phase: 2, icon: 'list' },
  { label: 'Expenses', href: '/expenses', permission: 'expense:read', group: 'spend', phase: 3, icon: 'receipt' },

  { label: 'Budgets', href: '/budgets', permission: 'budget:read', group: 'plan', phase: 4, icon: 'gauge' },
  { label: 'Reports', href: '/reports', permission: 'report:read', group: 'plan', phase: 4, icon: 'chart' },

  { label: 'Bills', href: '/bills', permission: 'bill:read', group: 'payables', phase: 5, icon: 'invoice' },
  { label: 'Procurement', href: '/procurement', permission: 'purchase_order:read', group: 'payables', phase: 5, icon: 'cart' },
  { label: 'Vendors', href: '/vendors', permission: 'vendor:read', group: 'payables', phase: 5, icon: 'building' },

  { label: 'Accounting', href: '/accounting', permission: 'accounting_code:manage', group: 'admin', phase: 6, icon: 'ledger' },
  { label: 'People', href: '/people', permission: 'user:read', group: 'admin', phase: 1, icon: 'users' },
  { label: 'Policies', href: '/policies', permission: 'policy:read', group: 'admin', phase: 2, icon: 'shield' },
  { label: 'Settings', href: '/settings/organization', permission: 'organization:read', group: 'admin', phase: 1, icon: 'cog' },
  { label: 'Audit log', href: '/audit', permission: 'audit_event:read', group: 'admin', phase: 1, icon: 'history' },
];

export function itemsForGroup(group: NavGroup, permissions: ReadonlySet<string>): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.group === group && (item.permission === null || permissions.has(item.permission)),
  );
}
