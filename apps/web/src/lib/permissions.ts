/**
 * The permission catalogue, mirrored for the frontend.
 *
 * The **authoritative** source is the seeded `permissions` / `role_permissions`
 * tables and the server-side guard. This copy exists so the navigation and
 * action affordances can be rendered without a round trip, and it is replaced
 * in Phase 1 by the set returned from `GET /v1/auth/session`.
 *
 * It is a rendering aid, never an access control. Every guarded endpoint
 * enforces the same rule independently, and the API test suite verifies each
 * denial path without involving the frontend at all
 * (docs/03-USER-ROLES-PERMISSIONS.md §7).
 */

export type RoleKey = 'ORG_ADMIN' | 'FINANCE_ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'AUDITOR';

export const ROLE_LABELS: Record<RoleKey, string> = {
  ORG_ADMIN: 'Organisation admin',
  FINANCE_ADMIN: 'Finance admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  AUDITOR: 'Auditor',
};

export const ROLE_DESCRIPTIONS: Record<RoleKey, string> = {
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

const COMMON_READ = ['organization:read', 'entity:read', 'department:read', 'notification:read_own'];

/**
 * Role → permission mapping, from the matrix in docs/03 §3.
 *
 * Scope qualifiers (SELF / DEPARTMENT / ENTITY / ORGANISATION) are applied
 * server-side as a mandatory query predicate and are not represented here —
 * the frontend never decides which *rows* a user may see.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, string[]> = {
  ORG_ADMIN: [
    ...COMMON_READ,
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
    'spend_request:create',
    'spend_request:read',
    'spend_request:read_all',
    'card:read',
    'card:create',
    'card:lock',
    'card:terminate',
    'transaction:read',
    'transaction:read_all',
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
    ...COMMON_READ,
    'user:read',
    'policy:read',
    'policy:manage',
    'approval:read',
    'approval:act',
    'approval:delegate',
    'approval:override',
    'spend_request:create',
    'spend_request:read',
    'spend_request:read_all',
    'spend_request:cancel',
    'card:read',
    'card:create',
    'card:update_limit',
    'card:lock',
    'card:terminate',
    'transaction:read',
    'transaction:read_all',
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
    ...COMMON_READ,
    'user:read',
    'policy:read',
    'approval:read',
    'approval:act',
    'approval:delegate',
    'spend_request:create',
    'spend_request:read',
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
    ...COMMON_READ,
    'policy:read',
    'approval:read',
    'spend_request:create',
    'spend_request:read',
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

  // Every entry is a read. There is no mutation permission in this list, and
  // there is no code path that would add one.
  AUDITOR: [
    ...COMMON_READ,
    'user:read',
    'security_event:read',
    'policy:read',
    'approval:read',
    'spend_request:read',
    'spend_request:read_all',
    'card:read',
    'transaction:read',
    'transaction:read_all',
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

export function hasPermission(permissions: ReadonlySet<string>, permission: string): boolean {
  return permissions.has(permission);
}
