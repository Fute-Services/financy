import { randomBytes } from 'node:crypto';

import { loadWorkspaceEnv } from '@financy/db';

/**
 * Test environment.
 *
 * The workspace `.env` is loaded first, so a machine with a working database
 * is used as configured. Without it the suite fell back to a guessed
 * connection string — right shape, wrong port, wrong password — and every
 * integration test failed with a `500` that said nothing about the cause.
 *
 * `DATABASE_TEST_URL` then wins over `DATABASE_URL`, so a run can never write
 * to the development database by accident.
 */
loadWorkspaceEnv();

const testDatabase = process.env['DATABASE_TEST_URL'];
if (testDatabase !== undefined && testDatabase !== '') {
  process.env['DATABASE_URL'] = testDatabase;
}

/**
 * The config schema refuses to start on a missing or placeholder value, which
 * is the behaviour we want in every real environment and an obstacle in a unit
 * run. These fill the gaps and only the gaps, so CI can still point the suite
 * wherever it likes by exporting its own.
 *
 * The secrets are generated per run rather than hard-coded, so a value that
 * only works because a test happened to know it cannot pass.
 */
function fallback(key: string, value: string): void {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

fallback('NODE_ENV', 'test');
fallback('APP_ENV', 'test');
fallback('LOG_LEVEL', 'fatal');
fallback('LOG_PRETTY', 'false');
fallback(
  'DATABASE_URL',
  'postgresql://financy_app:financy_app@localhost:5432/financy_test?schema=public',
);

for (const key of ['SESSION_SECRET', 'ENCRYPTION_KEY', 'SIGNED_URL_SECRET']) {
  fallback(key, randomBytes(32).toString('base64'));
}
