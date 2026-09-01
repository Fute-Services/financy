/**
 * Seed entrypoint.
 *
 * Two seeds, kept strictly separate (docs/09 §10):
 *
 * - **system** — the permission catalogue and the five system roles.
 *   Idempotent, and run in *every* environment including production.
 *   Idempotence is not a nicety here: this runs on every deploy, so a seed
 *   that inserted unconditionally would duplicate the catalogue the second
 *   time it executed.
 * - **demo** — a realistic organisation. Never run outside local and
 *   development, which the guard below enforces rather than trusts.
 */

import { createPrismaClient } from '../client.js';
import { loadWorkspaceEnv } from '../workspace-env.js';
import { seedDemo } from './demo.js';
import { seedSystem } from './system.js';

/**
 * `prisma.config.ts` loads `.env` for the Prisma CLI, but the seed runs as a
 * plain script and inherits none of that — so without this, `pnpm db:seed`
 * fails on a freshly configured checkout even though step 2 of the README
 * created the file it needs.
 */
loadWorkspaceEnv();

type SeedKind = 'system' | 'demo';

function requestedSeeds(argv: readonly string[]): SeedKind[] {
  const system = argv.includes('--system');
  const demo = argv.includes('--demo');

  // No flag means "set this environment up", which is both for a developer
  // and system-only for anything else.
  if (!system && !demo) {
    return isDemoAllowed() ? ['system', 'demo'] : ['system'];
  }

  return [...(system ? (['system'] as const) : []), ...(demo ? (['demo'] as const) : [])];
}

function isDemoAllowed(): boolean {
  const appEnv = process.env['APP_ENV'] ?? 'local';
  return appEnv === 'local' || appEnv === 'test' || appEnv === 'development';
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  }

  const seeds = requestedSeeds(process.argv.slice(2));

  if (seeds.includes('demo') && !isDemoAllowed()) {
    throw new Error(
      `Refusing to run the demo seed with APP_ENV=${process.env['APP_ENV'] ?? 'unset'}. Demo data belongs in local and development only.`,
    );
  }

  const client = createPrismaClient({ databaseUrl });

  try {
    // Sequential on purpose: the demo organisation provisions its own roles
    // from the catalogue the system seed writes.
    for (const seed of seeds) {
      if (seed === 'system') {
        const result = await seedSystem(client);
        console.warn(
          `seed:system — permissions +${result.permissionsCreated}/~${result.permissionsUpdated}, ` +
            `organisations converged ${result.organizationsConverged} (grants +${result.grantsAdded}/-${result.grantsRemoved})`,
        );
      }

      if (seed === 'demo') {
        const result = await seedDemo(client);
        console.warn(
          `seed:demo — organisation ${result.organizationId}, roles +${result.rolesCreated}, grants +${result.grantsAdded}, entities +${result.entitiesCreated}, departments +${result.departmentsCreated}, categories +${result.categoriesCreated}, projects +${result.projectsCreated}`,
        );
      }
    }
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
