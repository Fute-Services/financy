/**
 * The permission catalogue, as typed constants (roadmap task 1.4.1).
 *
 * This is the **single** definition. The seed writes these rows into
 * `permissions` and `role_permissions`; the API guard checks against what was
 * seeded; the web app renders from the set returned by `GET /v1/auth/session`.
 * Before this file existed the catalogue was written twice — once for the
 * seed and once for the frontend — and the two had already diverged, which is
 * the entire argument for keeping it here.
 *
 * `docs/03-USER-ROLES-PERMISSIONS.md §3` remains the *specification*. This is
 * its executable form, and `permissions.test.ts` asserts the properties that
 * document states as invariants.
 *
 * **Scope is not represented here.** A `○` in the documented matrix means
 * "granted, but only over certain rows" — which rows is decided server-side by
 * the scope predicate on the membership, never by the presence of a
 * permission. A permission answers *may you do this at all*; scope answers
 * *to what*. Conflating them is how a manager ends up approving another
 * department's spend.
 */

/** `<resource>:<action>` — lowercase, colon-separated, stable forever. */
export interface PermissionDefinition {
  readonly key: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
}

function define(key: string, description: string): PermissionDefinition {
  const [resource, action] = key.split(':');

  /* c8 ignore start -- unreachable: every literal below is well-formed, and
     the format test proves it. The guard exists so a future typo fails here
     rather than seeding a row with an undefined resource. */
  if (resource === undefined || action === undefined || action.includes(':')) {
    throw new Error(`Malformed permission key: ${key}`);
  }
  /* c8 ignore stop */

  return { key, resource, action, description };
}

// ── The catalogue (docs/03 §3) ────────────────────────────────────────────

export const PERMISSIONS: readonly PermissionDefinition[] = [
  // §3.1 Organisation and access
  define('organization:read', 'View organisation settings.'),
  define('organization:update', 'Change organisation settings.'),
  define('entity:read', 'View legal entities.'),
  define('entity:manage', 'Create, edit, and archive legal entities.'),
  define('department:read', 'View the department tree.'),
  define('department:manage', 'Create, edit, re-parent, and archive departments.'),
  define('user:read', 'View members of the organisation.'),
  define('user:invite', 'Invite a person to the organisation.'),
  define('user:update', 'Change a membership’s department, manager, or entity scope.'),
  define('user:deactivate', 'Deactivate a membership and revoke its sessions.'),
  define('membership:manage_role', 'Change which role a membership holds. Requires step-up.'),
  define('session:revoke_any', 'View and revoke another member’s sessions.'),
  define('security_event:read', 'Read the security event stream.'),

  // §3.2 Policy and approvals
  define('policy:read', 'View spending policies and simulate a decision.'),
  define('policy:manage', 'Create policies and publish new versions.'),
  define('approval:read', 'View approval instances and steps.'),
  define('approval:act', 'Approve, reject, or return a step.'),
  define('approval:delegate', 'Delegate your own approval authority to another member.'),
  define(
    'approval:delegate_any',
    'Delegate another member’s approval authority — an administrative act, since the holder never agreed to lend it.',
  ),
  define('approval:override', 'Force a decision on a stalled chain. Reason mandatory.'),

  // §3.3 Spend, cards, transactions
  define('spend_request:create', 'Raise a spend request.'),
  define('spend_request:read', 'View spend requests within scope.'),
  define('spend_request:read_all', 'View every spend request in the organisation.'),
  define('spend_request:update', 'Edit a spend request that is still a draft.'),
  define('spend_request:cancel', 'Cancel a spend request.'),
  define('card:read', 'View cards within scope.'),
  define('card:read_all', 'View every card in the organisation.'),
  define('card:create', 'Issue a card.'),
  define('card:update_limit', 'Change a card’s spending limit.'),
  define('card:lock', 'Freeze or unfreeze a card.'),
  define('card:terminate', 'Permanently terminate a card.'),
  define('transaction:read', 'View transactions within scope.'),
  define('transaction:read_all', 'View every transaction in the organisation.'),
  define('transaction:categorize', 'Set a transaction’s category and cost coding.'),
  define('transaction:review', 'Complete finance review of a transaction.'),
  define('transaction:import', 'Import transactions from a file or provider.'),

  // §3.4 Expenses, receipts, reimbursements
  define('expense:create', 'Submit an expense.'),
  define('expense:read_all', 'View every expense in the organisation.'),
  define('expense:read', 'View expenses within scope.'),
  define('expense:approve', 'Approve or return an expense.'),
  define('receipt:upload', 'Upload a receipt.'),
  define('receipt:read', 'View and download receipts within scope.'),
  define('receipt:read_all', 'View every receipt in the organisation.'),
  define('receipt:delete', 'Delete a receipt that is not attached to a record.'),
  define('reimbursement:create', 'Claim a reimbursement.'),
  define('reimbursement:read_all', 'View every reimbursement in the organisation.'),
  define('reimbursement:read', 'View reimbursements within scope.'),
  define('reimbursement:approve', 'Approve a reimbursement batch.'),
  define('reimbursement:mark_paid', 'Record that a reimbursement has been paid.'),

  // §3.5 Budgets, reports, accounting
  define('budget:read', 'View budgets and their utilisation.'),
  define('budget:manage', 'Create budgets and allocate funds.'),
  define('report:read', 'Run reports within scope.'),
  define('report:export', 'Export report results.'),
  define('accounting_code:manage', 'Manage the chart of accounts, cost centres, and tax codes.'),
  define('accounting:export', 'Generate an accounting export batch.'),

  // §3.6 Vendors, bills, procurement (Phase 5)
  define('vendor:read', 'View vendors.'),
  define('vendor:manage', 'Create, edit, and merge vendors.'),
  define('bill:read', 'View bills within scope.'),
  define('bill:create', 'Enter a bill.'),
  define('bill:approve', 'Approve a bill.'),
  define('bill:mark_paid', 'Record that a bill has been paid.'),
  define('purchase_order:create', 'Raise a purchase request or order.'),
  define('purchase_order:read', 'View purchase orders within scope.'),
  define('purchase_order:approve', 'Approve a purchase order.'),

  // §3.7 Audit and integrations
  //
  // There is deliberately no `audit_event:create`, `:update`, or `:delete`.
  // Those permissions do not exist, because audit events are written only by
  // the audit service on a path with no API surface (docs/03 §3.7).
  define('audit_event:read', 'Read the audit trail.'),
  define('audit_event:export', 'Export the audit trail. Itself audited.'),
  define('integration:read', 'View configured integrations.'),
  define('integration:manage', 'Connect and configure integrations.'),
  define('notification:read_own', 'Read and manage your own notifications.'),
] as const;

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((permission) => permission.key);

// ── Roles ─────────────────────────────────────────────────────────────────

export const ROLE_KEYS = ['ORG_ADMIN', 'FINANCE_ADMIN', 'MANAGER', 'EMPLOYEE', 'AUDITOR'] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  ORG_ADMIN: 'Organisation admin',
  FINANCE_ADMIN: 'Finance admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  AUDITOR: 'Auditor',
};

export const ROLE_DESCRIPTIONS: Readonly<Record<RoleKey, string>> = {
  ORG_ADMIN:
    'Configures the organisation and controls access. Deliberately not an automatic approver of spend, and cannot mark a reimbursement paid — configuration authority and transaction authority are separated.',
  FINANCE_ADMIN:
    'Owns the financial record: reviews and codes transactions, manages budgets, processes reimbursements, runs reports. Cannot change roles or permissions.',
  MANAGER:
    'Departmental budget holder. Approves spend within their department scope and sees their team’s data — and no one else’s.',
  EMPLOYEE:
    'Submits spend requests, uses assigned cards, uploads receipts, claims reimbursements. Sees only their own records.',
  AUDITOR:
    'Reads everything, changes nothing. Enforced structurally: the role holds no mutation permission, and a second guard rejects every non-GET request independently.',
};

/** Which rows a role's permissions apply to by default (docs/03 §1.2). */
export const MEMBERSHIP_SCOPES = ['SELF', 'DEPARTMENT', 'ENTITY', 'ORGANISATION'] as const;
export type MembershipScope = (typeof MEMBERSHIP_SCOPES)[number];

export const DEFAULT_ROLE_SCOPE: Readonly<Record<RoleKey, MembershipScope>> = {
  ORG_ADMIN: 'ORGANISATION',
  FINANCE_ADMIN: 'ORGANISATION',
  MANAGER: 'DEPARTMENT',
  EMPLOYEE: 'SELF',
  AUDITOR: 'ORGANISATION',
};

/** Held by every role. Nobody can navigate the product without them. */
const UNIVERSAL = [
  'organization:read',
  'entity:read',
  'department:read',
  'notification:read_own',
] as const;

/**
 * Role → permission grants, transcribed from the matrix in `docs/03 §3`.
 *
 * Both `✔` and `○` are grants; the difference between them is scope, which
 * lives on the membership. `✖` is simply an absent entry.
 */
export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly string[]>> = {
  ORG_ADMIN: [
    ...UNIVERSAL,
    'organization:update',
    'entity:manage',
    'department:manage',
    'user:read',
    'user:invite',
    'user:update',
    'user:deactivate',
    'membership:manage_role',
    'session:revoke_any',
    'security_event:read',
    'policy:read',
    'policy:manage',
    'approval:read',
    'approval:delegate',
    'approval:delegate_any',
    'spend_request:create',
    'spend_request:read',
    'spend_request:read_all',
    'spend_request:update',
    'spend_request:cancel',
    'card:read',
    'card:read_all',
    'card:create',
    'card:lock',
    'card:terminate',
    'transaction:read',
    'transaction:read_all',
    'receipt:read_all',
    'expense:read_all',
    'reimbursement:read_all',
    'transaction:import',
    'expense:create',
    'expense:read',
    'receipt:upload',
    'receipt:read',
    'reimbursement:create',
    'reimbursement:read',
    'budget:read',
    'report:read',
    'report:export',
    'vendor:read',
    'vendor:manage',
    'bill:read',
    'bill:create',
    'purchase_order:create',
    'purchase_order:read',
    'audit_event:read',
    'audit_event:export',
    'integration:read',
    'integration:manage',
  ],

  FINANCE_ADMIN: [
    ...UNIVERSAL,
    'user:read',
    'policy:read',
    'policy:manage',
    'approval:read',
    'approval:act',
    'approval:delegate',
    'approval:delegate_any',
    'approval:override',
    'spend_request:create',
    'spend_request:read',
    'spend_request:read_all',
    'spend_request:update',
    'spend_request:cancel',
    'card:read',
    'card:read_all',
    'card:create',
    'card:update_limit',
    'card:lock',
    'card:terminate',
    'transaction:read',
    'transaction:read_all',
    'receipt:read_all',
    'expense:read_all',
    'reimbursement:read_all',
    'transaction:categorize',
    'transaction:review',
    'transaction:import',
    'expense:create',
    'expense:read',
    'expense:approve',
    'receipt:upload',
    'receipt:read',
    'receipt:delete',
    'reimbursement:create',
    'reimbursement:read',
    'reimbursement:approve',
    'reimbursement:mark_paid',
    'budget:read',
    'budget:manage',
    'report:read',
    'report:export',
    'accounting_code:manage',
    'accounting:export',
    'vendor:read',
    'vendor:manage',
    'bill:read',
    'bill:create',
    'bill:approve',
    'bill:mark_paid',
    'purchase_order:create',
    'purchase_order:read',
    'purchase_order:approve',
    'audit_event:read',
    'integration:read',
  ],

  MANAGER: [
    ...UNIVERSAL,
    'user:read',
    'policy:read',
    'approval:read',
    'approval:act',
    'approval:delegate',
    'spend_request:create',
    'spend_request:read',
    'spend_request:update',
    'spend_request:cancel',
    'card:read',
    'card:lock',
    'transaction:read',
    'transaction:categorize',
    'expense:create',
    'expense:read',
    'expense:approve',
    'receipt:upload',
    'receipt:read',
    'reimbursement:create',
    'reimbursement:read',
    'reimbursement:approve',
    'budget:read',
    'report:read',
    'report:export',
    'vendor:read',
    'bill:read',
    'bill:approve',
    'purchase_order:create',
    'purchase_order:read',
    'purchase_order:approve',
  ],

  EMPLOYEE: [
    ...UNIVERSAL,
    'policy:read',
    'approval:read',
    'spend_request:create',
    'spend_request:read',
    'spend_request:update',
    'spend_request:cancel',
    'card:read',
    'card:lock',
    'transaction:read',
    'transaction:categorize',
    'expense:create',
    'expense:read',
    'receipt:upload',
    'receipt:read',
    'receipt:delete',
    'reimbursement:create',
    'reimbursement:read',
    'vendor:read',
    'purchase_order:create',
    'purchase_order:read',
  ],

  /**
   * Every entry is a read (INV-05). There is no mutation permission in this
   * list, no code path that would add one, and a test that fails if either
   * ever changes — plus an independent guard that rejects any non-`GET` from
   * an auditor regardless of what this list says.
   */
  AUDITOR: [
    ...UNIVERSAL,
    'user:read',
    'security_event:read',
    'policy:read',
    'approval:read',
    'spend_request:read',
    'spend_request:read_all',
    'card:read',
    'card:read_all',
    'transaction:read',
    'transaction:read_all',
    'receipt:read_all',
    'expense:read_all',
    'reimbursement:read_all',
    'expense:read',
    'receipt:read',
    'reimbursement:read',
    'budget:read',
    'report:read',
    'report:export',
    'vendor:read',
    'bill:read',
    'purchase_order:read',
    'audit_event:read',
    'audit_event:export',
    'integration:read',
  ],
};

/**
 * Actions that only ever read. Used by the auditor invariant test, and by the
 * auditor read-only guard, so "read-only" has one definition rather than two.
 */
export const READ_ONLY_ACTIONS: readonly string[] = ['read', 'read_all', 'read_own', 'export'];

export function isReadOnlyPermission(key: string): boolean {
  const action = key.split(':')[1];
  return action !== undefined && READ_ONLY_ACTIONS.includes(action);
}

export function permissionsForRole(role: RoleKey): ReadonlySet<string> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function hasPermission(granted: ReadonlySet<string>, permission: string): boolean {
  return granted.has(permission);
}
