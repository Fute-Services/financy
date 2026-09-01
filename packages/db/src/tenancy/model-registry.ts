/**
 * Which models carry `organizationId` and which do not.
 *
 * Registration is explicit and exhaustive on purpose. An allow-list of
 * tenant-scoped models on its own fails *open*: forget to add a model and its
 * queries silently run with no organisation predicate. Two lists plus a
 * rejection for anything in neither fails *closed*, which is the only
 * acceptable default when the failure mode is cross-tenant data exposure.
 *
 * `model-registry.test.ts` reads the generated Prisma client and asserts that
 * every model appears in exactly one list, so this cannot drift from the
 * schema.
 */

/**
 * Models with an `organizationId` column. Every query against one gets the
 * caller's organisation injected; a query without a tenant context throws.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set<string>([
  'Membership',
  'Role',
  'Entity',
  'Department',
  'Project',
  'Category',
  'Invitation',
  'AuditEvent',
  'SecurityEvent',
  // Phase 2. Every one carries `organizationId`. The registry test reads the
  // generated client and fails if a model appears in neither list, so adding
  // a model to the schema without deciding its tenancy is a failing build
  // rather than a query that silently runs with no organisation predicate.
  'Policy',
  'PolicyVersion',
  'SpendRequest',
  'ApprovalInstance',
  'ApprovalStep',
  'ApprovalAction',
  'ApprovalDelegation',
  'Card',
  'CardLimit',
  'Transaction',
  'TransactionAdjustment',
  'Notification',
  'NotificationPreference',
  'Receipt',
  'ReceiptAttachment',
]);

/**
 * Models that are deliberately global.
 *
 * Four distinct reasons, none of them "it was easier":
 *
 * - **`Organization`** *is* the tenant. Scoping it by `organizationId` would
 *   be circular. Access to an organisation row is controlled by the caller's
 *   membership instead.
 * - **`User`, `Session`, `MfaFactor`** belong to a person, not to a company
 *   (docs/09 §1.2). A user may hold memberships in several organisations, and
 *   login happens *before* any organisation is known — scoping these would
 *   make authentication impossible, since there is nothing to scope by yet.
 * - **`Permission`** is a seeded global catalogue — one vocabulary for the
 *   whole installation, with no tenant dimension.
 * - **`RolePermission`** is a join with no `organization_id` column of its own.
 *   It is reachable only through a `Role`, which *is* tenant-scoped, so the
 *   organisation predicate is applied one hop up where the column actually
 *   exists.
 *
 * `Role` is deliberately **not** in this list, though an earlier version of the
 * schema put it here. See the comment on the model: shared system roles with a
 * null `organizationId` cannot satisfy the composite foreign key from
 * `memberships`, so every organisation owns its own five instead — which makes
 * `Role` an ordinary tenant-scoped model.
 */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set<string>([
  'Organization',
  'User',
  'Permission',
  'RolePermission',
  'Session',
  'MfaFactor',
  // A job execution is the queue's own record, not a tenant's. It carries a
  // nullable `organizationId` for the jobs that have one — a nightly sweep
  // that fans out per organisation has none — and scoping the table by it
  // would make the row for a cross-tenant job unreadable by the runner that
  // wrote it.
  'JobExecution',
]);

export type ModelClassification = 'tenant-scoped' | 'global' | 'unregistered';

export function classifyModel(model: string): ModelClassification {
  if (TENANT_SCOPED_MODELS.has(model)) return 'tenant-scoped';
  if (GLOBAL_MODELS.has(model)) return 'global';
  return 'unregistered';
}

/**
 * A model in both lists is a contradiction — one of the two behaviours has to
 * be wrong, and which one is not something this module can guess.
 *
 * Exported so it can be tested with deliberately overlapping sets, and called
 * at module load with the real ones so the mistake surfaces on boot rather
 * than on whichever request happens to touch that model first.
 */
export function assertRegistriesDisjoint(
  tenantScoped: ReadonlySet<string>,
  global: ReadonlySet<string>,
): void {
  const overlap = [...tenantScoped].filter((model) => global.has(model));

  if (overlap.length > 0) {
    throw new Error(
      `Models registered as both tenant-scoped and global: ${overlap.join(', ')}. A model is one or the other.`,
    );
  }
}

assertRegistriesDisjoint(TENANT_SCOPED_MODELS, GLOBAL_MODELS);
