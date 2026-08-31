/**
 * The navigation manifest.
 *
 * Declared once, rendered by the sidebar and the command palette, and filtered
 * by the session's permission set. Hiding an item the user cannot use is a
 * **usability affordance, not a security control** — the corresponding API
 * endpoint enforces the same permission independently, and navigating directly
 * to a hidden route renders the permission state rather than a 404
 * (docs/04-INFORMATION-ARCHITECTURE.md §2).
 *
 * ## Why the sidebar is short
 *
 * Fourteen flat entries is a list, not a navigation. Nobody reads it; they
 * scan for the word they already had in mind, which is what a command palette
 * does better. So the sidebar carries only what a person returns to without
 * thinking — their inbox, their own spend, the queue waiting on them — and
 * `⌘K` carries everything else, including actions a link cannot express
 * ("approve SR-0042", "switch to Acme Europe").
 *
 * `pinned` is what earns a permanent slot. Everything else is `catalogue`:
 * reachable, searchable, and out of the way.
 */

export type NavSection = 'workspace' | 'spend' | 'record' | 'plan' | 'payables' | 'admin';

export interface NavItem {
  label: string;
  href: string;
  /** Permission required to see it. `null` means any active membership. */
  permission: string | null;
  section: NavSection;
  /** Roadmap phase that delivers it. Anything past `BUILT_PHASES` is a stub. */
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  icon: IconName;
  /** Shown in the sidebar. Everything else lives in the command palette. */
  pinned?: boolean;
  /** Extra words the palette matches on, for people who call it something else. */
  keywords?: string[];
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
  | 'history'
  | 'inbox'
  | 'check';

export const SECTION_LABELS: Record<NavSection, string> = {
  workspace: 'Workspace',
  spend: 'Spend',
  record: 'Record',
  plan: 'Plan',
  payables: 'Payables',
  admin: 'Admin',
};

export const NAV_ITEMS: NavItem[] = [
  // ── Pinned: the three things a person opens without deciding to ─────────
  {
    label: 'Overview',
    href: '/overview',
    permission: null,
    section: 'workspace',
    phase: 4,
    icon: 'dashboard',
    pinned: true,
    keywords: ['home', 'dashboard', 'start'],
  },
  {
    label: 'My spend',
    href: '/spend',
    permission: 'spend_request:read',
    section: 'spend',
    phase: 2,
    icon: 'send',
    pinned: true,
    keywords: ['requests', 'my requests', 'submit'],
  },
  {
    label: 'Approvals',
    href: '/approvals',
    permission: 'approval:read',
    section: 'spend',
    phase: 2,
    icon: 'check',
    pinned: true,
    keywords: ['queue', 'waiting', 'approve', 'reject'],
  },

  // ── Spend ────────────────────────────────────────────────────────────────
  {
    label: 'Cards',
    href: '/cards',
    permission: 'card:read',
    section: 'spend',
    phase: 2,
    icon: 'card',
    pinned: true,
    keywords: ['virtual card', 'freeze', 'limit'],
  },
  {
    label: 'Transactions',
    href: '/transactions',
    permission: 'transaction:read',
    section: 'spend',
    phase: 2,
    icon: 'list',
    keywords: ['charges', 'statement', 'reconcile'],
  },

  // ── Record ───────────────────────────────────────────────────────────────
  {
    label: 'Expenses',
    href: '/expenses',
    permission: 'expense:read',
    section: 'record',
    phase: 3,
    icon: 'receipt',
    keywords: ['claim', 'reimbursement', 'receipt'],
  },

  // ── Plan ─────────────────────────────────────────────────────────────────
  {
    label: 'Budgets',
    href: '/budgets',
    permission: 'budget:read',
    section: 'plan',
    phase: 4,
    icon: 'gauge',
    pinned: true,
    keywords: ['allocation', 'spend limit', 'utilisation'],
  },
  {
    label: 'Reports',
    href: '/reports',
    permission: 'report:read',
    section: 'plan',
    phase: 4,
    icon: 'chart',
    pinned: true,
    keywords: ['analytics', 'export', 'csv'],
  },

  // ── Payables ─────────────────────────────────────────────────────────────
  {
    label: 'Bills',
    href: '/bills',
    permission: 'bill:read',
    section: 'payables',
    phase: 5,
    icon: 'invoice',
    keywords: ['accounts payable', 'ap', 'invoice'],
  },
  {
    label: 'Procurement',
    href: '/procurement',
    permission: 'purchase_order:read',
    section: 'payables',
    phase: 5,
    icon: 'cart',
    keywords: ['purchase order', 'po', 'three-way match'],
  },
  {
    label: 'Vendors',
    href: '/vendors',
    permission: 'vendor:read',
    section: 'payables',
    phase: 5,
    icon: 'building',
    keywords: ['supplier', 'merchant', 'payee'],
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    label: 'People',
    href: '/people',
    permission: 'user:read',
    section: 'admin',
    phase: 1,
    icon: 'users',
    keywords: ['members', 'team', 'invite', 'roles'],
  },
  {
    label: 'Policies',
    href: '/policies',
    permission: 'policy:read',
    section: 'admin',
    phase: 2,
    icon: 'shield',
    keywords: ['rules', 'approval chain', 'limits'],
  },
  {
    label: 'Settings',
    href: '/settings/organization',
    permission: 'organization:read',
    section: 'admin',
    phase: 1,
    icon: 'cog',
    keywords: ['organisation', 'entities', 'departments', 'categories'],
  },
  {
    label: 'Audit log',
    href: '/audit',
    permission: 'audit_event:read',
    section: 'admin',
    phase: 1,
    icon: 'history',
    keywords: ['history', 'who changed', 'trail', 'evidence'],
  },
];

/** Items the caller may see, in manifest order. */
export function visibleItems(permissions: ReadonlySet<string>): NavItem[] {
  return NAV_ITEMS.filter((item) => item.permission === null || permissions.has(item.permission));
}

/** The short list that gets a permanent slot. */
export function pinnedItems(permissions: ReadonlySet<string>): NavItem[] {
  return visibleItems(permissions).filter((item) => item.pinned === true);
}

/** Everything, grouped by section, for the command palette. */
export function groupedItems(
  permissions: ReadonlySet<string>,
): Array<{ section: NavSection; items: NavItem[] }> {
  const order: NavSection[] = ['workspace', 'spend', 'record', 'plan', 'payables', 'admin'];

  return order
    .map((section) => ({
      section,
      items: visibleItems(permissions).filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Match a palette query against a label and its aliases.
 *
 * Subsequence matching, not `includes`: typing `arv` should find "Approvals",
 * because that is how people actually use a palette — a few letters from
 * anywhere in the word, not a prefix they had to get right.
 */
export function matchesQuery(item: NavItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;

  const haystacks = [item.label.toLowerCase(), ...(item.keywords ?? [])];

  return haystacks.some((haystack) => {
    if (haystack.includes(needle)) return true;

    let index = 0;
    for (const character of needle) {
      index = haystack.indexOf(character, index);
      if (index === -1) return false;
      index += 1;
    }
    return true;
  });
}

export function findItemByPath(path: string): NavItem | undefined {
  return (
    NAV_ITEMS.find((item) => item.href === path) ??
    NAV_ITEMS.find((item) => path.startsWith(`${item.href}/`)) ??
    (path === '/settings'
      ? NAV_ITEMS.find((item) => item.href === '/settings/organization')
      : undefined)
  );
}
