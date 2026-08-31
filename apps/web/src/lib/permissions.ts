/**
 * The permission catalogue, for the frontend.
 *
 * This file used to hold its own copy of the matrix from
 * `docs/03-USER-ROLES-PERMISSIONS.md §3`. It had already drifted —
 * `spend_request:update` was granted to four roles in the documentation and to
 * none of them here — which is exactly the failure a second copy produces:
 * silently, and in the direction of the copy nobody re-reads.
 *
 * So there is one definition now, in `@financy/contracts`, shared by the seed
 * that writes `role_permissions`, the guard that checks them, and this. The
 * re-export stays so the `@/lib/permissions` import path keeps working, and
 * because this is the right place to say what the frontend may and may not do
 * with any of it:
 *
 * **Permissions drive rendering only.** They decide whether a link or a button
 * is shown. They never decide whether an action is allowed — every guarded
 * endpoint enforces the same rule independently, and the API test suite
 * verifies each denial path without involving the frontend at all
 * (docs/03 §7). A permission check in this application is a courtesy to the
 * user, not a control.
 *
 * From Phase 1 the *runtime* set comes from `GET /v1/auth/session`, which
 * returns what the server actually resolved for the caller's membership. These
 * constants remain for labels, descriptions, and the invite-screen preview.
 */

export {
  DEFAULT_ROLE_SCOPE,
  MEMBERSHIP_SCOPES,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  hasPermission,
  isReadOnlyPermission,
  permissionsForRole,
  type MembershipScope,
  type PermissionDefinition,
  type RoleKey,
} from '@financy/contracts';
