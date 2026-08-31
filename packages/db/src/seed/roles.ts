import { ROLE_DESCRIPTIONS, ROLE_KEYS, ROLE_LABELS, ROLE_PERMISSIONS } from '@financy/contracts';

import { newId } from '@financy/core';

import type { Prisma } from '@prisma/client';

/**
 * The client as seen inside an interactive transaction.
 *
 * Prisma's own alias, rather than a hand-rolled `Omit`: the set of methods it
 * removes changes between versions, and a local copy drifts silently until a
 * caller passes something that no longer fits.
 */
type TransactionClient = Prisma.TransactionClient;

export interface RoleProvisionResult {
  rolesCreated: number;
  rolesUpdated: number;
  grantsAdded: number;
  grantsRemoved: number;
  roleIdByKey: Map<string, string>;
}

/**
 * Give an organisation its five roles, with the grants from the catalogue.
 *
 * Called at registration (task 1.3.2) and by the demo seed, and safe to call
 * again: it *converges* rather than merely avoiding duplicates. A permission
 * removed from the catalogue has its grant withdrawn, so revoking a capability
 * is a code change rather than a hand-written migration — which matters
 * because the alternative is the kind of cleanup everyone forgets.
 *
 * Roles are per-organisation because the composite foreign key from
 * `memberships` demands it; see the comment on the `Role` model.
 *
 * Runs inside the caller's transaction so that a half-provisioned organisation
 * cannot exist. An organisation whose roles were created but whose grants were
 * not is an organisation where the administrator can do nothing.
 */
export async function provisionOrganizationRoles(
  tx: TransactionClient,
  organizationId: string,
): Promise<RoleProvisionResult> {
  const result: RoleProvisionResult = {
    rolesCreated: 0,
    rolesUpdated: 0,
    grantsAdded: 0,
    grantsRemoved: 0,
    roleIdByKey: new Map(),
  };

  // The catalogue is global and seeded once. Resolving it here rather than
  // per-role keeps this to one query regardless of how many roles there are.
  const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
  const permissionIdByKey = new Map(permissions.map((row) => [row.key, row.id]));

  if (permissionIdByKey.size === 0) {
    throw new Error(
      'The permission catalogue is empty. Run the system seed (`pnpm db:seed:system`) before provisioning an organisation.',
    );
  }

  for (const roleKey of ROLE_KEYS) {
    const existing = await tx.role.findFirst({
      where: { organizationId, key: roleKey },
      select: { id: true, name: true, description: true, isSystem: true },
    });

    let roleId: string;

    if (existing === null) {
      const created = await tx.role.create({
        data: {
          id: newId(),
          organizationId,
          key: roleKey,
          name: ROLE_LABELS[roleKey],
          description: ROLE_DESCRIPTIONS[roleKey],
          isSystem: true,
        },
        select: { id: true },
      });

      roleId = created.id;
      result.rolesCreated += 1;
    } else {
      roleId = existing.id;

      // Only write when something differs. An unconditional update touches
      // every row on every deploy, which turns "what changed in this release"
      // into noise.
      const changed =
        existing.name !== ROLE_LABELS[roleKey] ||
        existing.description !== ROLE_DESCRIPTIONS[roleKey] ||
        !existing.isSystem;

      if (changed) {
        await tx.role.update({
          where: { id: roleId },
          data: {
            name: ROLE_LABELS[roleKey],
            description: ROLE_DESCRIPTIONS[roleKey],
            isSystem: true,
          },
        });
        result.rolesUpdated += 1;
      }
    }

    result.roleIdByKey.set(roleKey, roleId);

    const desired = new Set(
      ROLE_PERMISSIONS[roleKey].map((key) => {
        const permissionId = permissionIdByKey.get(key);

        // A contract test asserts this cannot happen. The throw is here
        // because the alternative is provisioning a role that silently lacks a
        // permission, which surfaces as an inexplicable 403 in production.
        if (permissionId === undefined) {
          throw new Error(
            `Role ${roleKey} grants unknown permission "${key}". The catalogue in @financy/contracts is out of step with the seeded permissions.`,
          );
        }

        return permissionId;
      }),
    );

    const current = await tx.rolePermission.findMany({
      where: { roleId },
      select: { permissionId: true },
    });
    const currentIds = new Set(current.map((row) => row.permissionId));

    const toAdd = [...desired].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !desired.has(id));

    if (toAdd.length > 0) {
      // One round trip, not one per grant.
      //
      // A loop of `create` calls was tried and is wrong against a remote
      // database: 185 grants meant 185 round trips to Atlas, which took over
      // five seconds and expired the interactive transaction. Against a local
      // PostgreSQL the same loop finished instantly, which is exactly how that
      // mistake survives review.
      //
      // MongoDB has no composite primary key, so each join row carries its own
      // `_id`. The unique index on (roleId, permissionId) is what still makes a
      // duplicate grant impossible. `skipDuplicates` is PostgreSQL-only, so a
      // concurrent provisioning run aborts this transaction instead of being
      // absorbed — which is correct: the retry finds the rows already present
      // and adds nothing.
      await tx.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ id: newId(), roleId, permissionId })),
      });

      result.grantsAdded += toAdd.length;
    }

    if (toRemove.length > 0) {
      await tx.rolePermission.deleteMany({ where: { roleId, permissionId: { in: toRemove } } });
      result.grantsRemoved += toRemove.length;
    }
  }

  return result;
}
