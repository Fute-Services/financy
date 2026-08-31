import { PERMISSIONS } from '@financy/contracts';
import { newId } from '@financy/core';

import type { PrismaClient } from '../client.js';

export interface SystemSeedResult {
  permissionsCreated: number;
  permissionsUpdated: number;
}

/**
 * The system seed: the global permission catalogue.
 *
 * Runs in **every** environment, including production, on every deploy. That
 * is what makes idempotence a correctness requirement rather than a nicety — a
 * seed that inserted unconditionally would duplicate the catalogue the second
 * time it ran.
 *
 * It seeds permissions and nothing else. Roles are **per-organisation**
 * (see the `Role` model), so they are provisioned with the organisation by
 * `provisionOrganizationRoles`, and categories are tenant-scoped for the same
 * reason. There is no organisation for a system seed to attach either to.
 */
export async function seedSystem(prisma: PrismaClient): Promise<SystemSeedResult> {
  const result: SystemSeedResult = { permissionsCreated: 0, permissionsUpdated: 0 };

  // One transaction: a half-seeded catalogue is a broken authorisation system,
  // and a deploy that failed midway should leave the previous state intact.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.permission.findMany({
      select: { id: true, key: true, resource: true, action: true, description: true },
    });
    const byKey = new Map(existing.map((row) => [row.key, row]));

    for (const permission of PERMISSIONS) {
      const current = byKey.get(permission.key);

      if (current === undefined) {
        await tx.permission.create({
          data: {
            id: newId(),
            key: permission.key,
            resource: permission.resource,
            action: permission.action,
            description: permission.description,
          },
        });
        result.permissionsCreated += 1;
        continue;
      }

      const changed =
        current.resource !== permission.resource ||
        current.action !== permission.action ||
        current.description !== permission.description;

      if (changed) {
        await tx.permission.update({
          where: { id: current.id },
          data: {
            resource: permission.resource,
            action: permission.action,
            description: permission.description,
          },
        });
        result.permissionsUpdated += 1;
      }
    }

    /**
     * A permission removed from the catalogue is deliberately **not** deleted.
     *
     * Audit events reference permission keys in their payloads, and a
     * historical event that says "granted `card:issue`" must remain legible
     * after the permission is renamed. Its grants are withdrawn by
     * `provisionOrganizationRoles`, which removes the capability; the row stays
     * as vocabulary.
     */
  });

  return result;
}
