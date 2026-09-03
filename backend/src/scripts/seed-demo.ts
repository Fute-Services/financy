/**
 * Seed the demo organisation, including people.
 *
 * This lives in `backend` rather than `packages/db` for one reason: argon2 is
 * a native addon, and `@financy/db` is imported by contexts that must not pull
 * one in. `seedDemo` therefore takes the hasher as a parameter, and this script
 * is the caller that has one.
 *
 * `pnpm db:seed:demo` still works and still seeds structure alone. Run this
 * when you want accounts you can actually sign in as.
 */

import { createPrismaClient, loadWorkspaceEnv, seedDemo, DEMO_PASSWORD } from '@financy/db';

import { PasswordService } from '../modules/auth/index.js';

loadWorkspaceEnv();

function isDemoAllowed(): boolean {
  const appEnv = process.env['APP_ENV'] ?? 'local';
  return appEnv === 'local' || appEnv === 'test' || appEnv === 'development';
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  }

  // Checked here as well as in the db seed, because this entrypoint bypasses
  // that one entirely. A guard that only one of two doors has is not a guard.
  if (!isDemoAllowed()) {
    throw new Error(
      `Refusing to seed demo accounts with APP_ENV=${process.env['APP_ENV'] ?? 'unset'}. Demo credentials are published in the README; they belong nowhere but local and development.`,
    );
  }

  const client = createPrismaClient({ databaseUrl });
  const passwords = new PasswordService();

  try {
    const result = await seedDemo(client, {
      hashPassword: (plaintext) => passwords.hash(plaintext),
    });

    console.warn(
      `seed:demo — organisation ${result.organizationId}, roles +${result.rolesCreated}, grants +${result.grantsAdded}, entities +${result.entitiesCreated}, departments +${result.departmentsCreated}, categories +${result.categoriesCreated}, projects +${result.projectsCreated}, people +${result.peopleCreated}, memberships +${result.membershipsCreated}`,
    );

    if (result.peopleCreated > 0 || result.membershipsCreated > 0) {
      console.warn(`\nSign in with any of these. Password: ${DEMO_PASSWORD}\n`);
      console.warn('  demo@financy.app      organisation administrator');
      console.warn('  finance@acme.test     finance manager');
      console.warn('  manager@acme.test     department manager (Engineering)');
      console.warn('  employee@acme.test    employee (Platform)');
      console.warn('  auditor@acme.test     auditor, read-only');
    }
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
