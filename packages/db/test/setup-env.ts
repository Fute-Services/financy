import { loadWorkspaceEnv } from '../src/workspace-env.js';

/**
 * Load the workspace `.env` so the integration suite finds a database.
 *
 * Without this, `DATABASE_TEST_URL` is unset under Vitest and every
 * integration test skips — on a machine where a database is configured and
 * working. Silently skipping is worse than failing: the suite stays green
 * while proving nothing, which is exactly the state these tests exist to
 * prevent.
 */
loadWorkspaceEnv();
