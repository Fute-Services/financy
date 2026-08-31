import { ROLE_PERMISSIONS, type RoleKey } from './permissions';

/**
 * Session accessor.
 *
 * The shape below is **exactly** `SessionResponse` from `@financy/contracts`,
 * which is what `GET /v1/auth/session` returns. That endpoint now exists and
 * works; wiring the browser to it is the next step (task 1.7.10), and keeping
 * the shapes identical means that swap touches this file and nothing else.
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
  slug: string;
  name: string;
  baseCurrency: string;
}

export interface Session {
  user: SessionUser;
  organization: SessionOrganization;
  /** Every organisation this user belongs to, for the switcher. */
  organizations: Array<{ id: string; slug: string; name: string; roleKey: RoleKey }>;
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
      slug: 'acme',
      name: 'Acme Ltd',
      baseCurrency: 'USD',
    },
    organizations: [
      { id: '01936d2a-0000-7000-8000-0000000000ff', slug: 'acme', name: 'Acme Ltd', roleKey },
    ],
    roleKey,
    permissions: new Set(ROLE_PERMISSIONS[roleKey]),
    isSandbox: true,
  };
}
