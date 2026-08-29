import { ROLE_PERMISSIONS, type RoleKey } from './permissions';

/**
 * Session accessor.
 *
 * **Phase 0 placeholder.** Today this returns a fixed development session so
 * the shell, navigation, and permission-aware rendering can be built and seen.
 * In Phase 1 (roadmap task 1.3.4) it is replaced by a call to
 * `GET /v1/auth/session`, which returns the user, the active membership, the
 * role, and the server-resolved permission set.
 *
 * The shape below is deliberately identical to that endpoint's response, so
 * swapping the implementation touches this file and nothing else.
 *
 * Nothing here is a security boundary. The permission set drives *rendering*
 * only — every endpoint re-checks server-side, independently
 * (docs/03-USER-ROLES-PERMISSIONS.md §7).
 */

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
}

export interface SessionOrganization {
  id: string;
  name: string;
  baseCurrency: string;
}

export interface Session {
  user: SessionUser;
  organization: SessionOrganization;
  roleKey: RoleKey;
  permissions: ReadonlySet<string>;
  /** True while any provider is a mock or sandbox adapter (ADR-0014). */
  isSandbox: boolean;
}

/** Roles the developer preview can switch between, to exercise the RBAC UI. */
export const PREVIEW_ROLES: RoleKey[] = [
  'ORG_ADMIN',
  'FINANCE_ADMIN',
  'MANAGER',
  'EMPLOYEE',
  'AUDITOR',
];

export function getSession(roleKey: RoleKey = 'ORG_ADMIN'): Session {
  return {
    user: {
      id: '01936d2a-0000-7000-8000-000000000001',
      fullName: 'Preview User',
      email: 'preview@financy.local',
    },
    organization: {
      id: '01936d2a-0000-7000-8000-0000000000ff',
      name: 'Acme Ltd',
      baseCurrency: 'USD',
    },
    roleKey,
    permissions: new Set(ROLE_PERMISSIONS[roleKey]),
    isSandbox: true,
  };
}
