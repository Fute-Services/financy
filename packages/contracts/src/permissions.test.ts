import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROLE_SCOPE,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  hasPermission,
  isReadOnlyPermission,
  permissionsForRole,
} from './permissions.js';

describe('the catalogue', () => {
  it('has no duplicate keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('uses the documented <resource>:<action> shape throughout', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.key, permission.key).toMatch(/^[a-z][a-z_]*:[a-z][a-z_]*$/);
      expect(`${permission.resource}:${permission.action}`).toBe(permission.key);
    }
  });

  it('describes every permission — the invite screen renders these', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.description.length, permission.key).toBeGreaterThan(0);
    }
  });

  /**
   * docs/03 §3.7: these permissions do not exist. Audit events are written
   * only by the audit service, on a path with no API surface — so there is
   * nothing for a permission to guard, and having one would imply otherwise.
   */
  it.each(['audit_event:create', 'audit_event:update', 'audit_event:delete'])(
    'does not define %s',
    (key) => {
      expect(PERMISSION_KEYS).not.toContain(key);
    },
  );
});

describe('role grants', () => {
  it('covers every role', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_KEYS].sort());
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLE_KEYS].sort());
    expect(Object.keys(ROLE_DESCRIPTIONS).sort()).toEqual([...ROLE_KEYS].sort());
    expect(Object.keys(DEFAULT_ROLE_SCOPE).sort()).toEqual([...ROLE_KEYS].sort());
  });

  /**
   * The seed writes `role_permissions` rows by joining these keys against the
   * `permissions` table. A key that is not in the catalogue produces no row
   * and silently grants nothing — a permission failure in production that
   * looks like a guard bug.
   */
  it('grants only permissions that exist in the catalogue', () => {
    for (const role of ROLE_KEYS) {
      for (const key of ROLE_PERMISSIONS[role]) {
        expect(PERMISSION_KEYS, `${role} → ${key}`).toContain(key);
      }
    }
  });

  it('lists no permission twice for one role', () => {
    for (const role of ROLE_KEYS) {
      const granted = ROLE_PERMISSIONS[role];
      expect(new Set(granted).size, role).toBe(granted.length);
    }
  });

  it('gives every role the four permissions the product cannot be navigated without', () => {
    for (const role of ROLE_KEYS) {
      const granted = permissionsForRole(role);
      for (const key of [
        'organization:read',
        'entity:read',
        'department:read',
        'notification:read_own',
      ]) {
        expect(granted.has(key), `${role} → ${key}`).toBe(true);
      }
    }
  });

  it('leaves no permission unreachable by every role', () => {
    const grantedAnywhere = new Set(ROLE_KEYS.flatMap((role) => [...ROLE_PERMISSIONS[role]]));
    const orphaned = PERMISSION_KEYS.filter((key) => !grantedAnywhere.has(key));

    expect(orphaned, `Defined but granted to nobody: ${orphaned.join(', ')}`).toEqual([]);
  });
});

describe('the invariants docs/03 §4 states', () => {
  /**
   * INV-05. The structural half: the auditor role holds no permission whose
   * action can change anything. The independent half — a guard rejecting every
   * non-GET from an auditor — is asserted in the API suite, because two
   * mechanisms that can fail separately are the point.
   */
  it('INV-05 — the auditor role holds no mutating permission', () => {
    const mutating = ROLE_PERMISSIONS.AUDITOR.filter((key) => !isReadOnlyPermission(key));

    expect(mutating, `Auditor must be read-only; found: ${mutating.join(', ')}`).toEqual([]);
  });

  /**
   * docs/03 §2.1 and §3.2: configuration authority and transaction authority
   * are separated. An org admin controls who may approve, and does not
   * approve; letting them do both would make the separation cosmetic.
   */
  it('the organisation admin can neither act on nor override an approval', () => {
    const granted = permissionsForRole('ORG_ADMIN');
    expect(granted.has('approval:act')).toBe(false);
    expect(granted.has('approval:override')).toBe(false);
  });

  it('the organisation admin cannot move money or change a card limit', () => {
    const granted = permissionsForRole('ORG_ADMIN');
    expect(granted.has('reimbursement:mark_paid')).toBe(false);
    expect(granted.has('bill:mark_paid')).toBe(false);
    expect(granted.has('card:update_limit')).toBe(false);
  });

  /** docs/03 §3.1: only the org admin administers access. */
  it('no role other than the organisation admin can change a role', () => {
    for (const role of ROLE_KEYS) {
      expect(permissionsForRole(role).has('membership:manage_role'), role).toBe(
        role === 'ORG_ADMIN',
      );
    }
  });

  it('finance alone holds override, and it is not held by an approver of convenience', () => {
    for (const role of ROLE_KEYS) {
      expect(permissionsForRole(role).has('approval:override'), role).toBe(
        role === 'FINANCE_ADMIN',
      );
    }
  });

  it('an employee sees no budget or report', () => {
    const granted = permissionsForRole('EMPLOYEE');
    expect(granted.has('budget:read')).toBe(false);
    expect(granted.has('report:read')).toBe(false);
    expect(granted.has('user:read')).toBe(false);
  });

  /**
   * The `:read_all` permissions are what the services use to decide whether a
   * read is narrowed to the caller's own records, so a role holding one and
   * not another sees the whole organisation's cards and only its own charges —
   * a split nobody designed and nobody would notice.
   */
  it('gives the organisation-wide reads together, or not at all', () => {
    const companions = [
      'spend_request:read_all',
      'transaction:read_all',
      'card:read_all',
      'receipt:read_all',
    ] as const;

    for (const role of ROLE_KEYS) {
      const granted = permissionsForRole(role);
      const held = companions.filter((permission) => granted.has(permission));

      expect(
        held.length === 0 || held.length === companions.length,
        `${role}: ${held.join(', ')}`,
      ).toBe(true);
    }
  });

  it('narrows every role that reads without an organisation-wide grant', () => {
    for (const role of ROLE_KEYS) {
      const granted = permissionsForRole(role);

      // `card:read` without `card:read_all` is the scoped case, and it is the
      // one the service must narrow. Asserted here so that adding a role with
      // an unscoped read is a decision somebody makes rather than one that
      // arrives by copying a list.
      if (granted.has('card:read') && !granted.has('card:read_all')) {
        expect(DEFAULT_ROLE_SCOPE[role], role).not.toBe('ORGANISATION');
      }
    }
  });

  it('every role that can raise a spend request can also edit its own draft', () => {
    for (const role of ROLE_KEYS) {
      const granted = permissionsForRole(role);
      if (granted.has('spend_request:create')) {
        expect(granted.has('spend_request:update'), role).toBe(true);
      }
    }
  });
});

describe('helpers', () => {
  it('classifies read actions as read-only and everything else as mutating', () => {
    expect(isReadOnlyPermission('transaction:read')).toBe(true);
    expect(isReadOnlyPermission('spend_request:read_all')).toBe(true);
    expect(isReadOnlyPermission('notification:read_own')).toBe(true);
    expect(isReadOnlyPermission('report:export')).toBe(true);
    expect(isReadOnlyPermission('card:terminate')).toBe(false);
    expect(isReadOnlyPermission('policy:manage')).toBe(false);
  });

  it('treats a malformed key as mutating rather than assuming it is safe', () => {
    expect(isReadOnlyPermission('nonsense')).toBe(false);
  });

  it('answers membership questions from a resolved set', () => {
    const granted = permissionsForRole('MANAGER');
    expect(hasPermission(granted, 'approval:act')).toBe(true);
    expect(hasPermission(granted, 'approval:override')).toBe(false);
  });
});
