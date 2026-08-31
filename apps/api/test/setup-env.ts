import { randomBytes } from 'node:crypto';

/**
 * Test environment defaults.
 *
 * The config schema refuses to start on a missing or placeholder value, which
 * is the behaviour we want in every real environment and an obstacle in a unit
 * run. These fill the gaps — and only the gaps: anything already exported wins,
 * so CI can point the suite at its own PostgreSQL service by setting
 * `DATABASE_URL` without editing this file.
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

/**
 * `DATABASE_TEST_URL` wins when it is set, so a developer with both databases
 * provisioned never has a test run touch `financy_dev`.
 */
fallback(
  'DATABASE_URL',
  process.env['DATABASE_TEST_URL'] ??
    'postgresql://financy_app:financy_app@localhost:5432/financy_test',
);

for (const key of ['SESSION_SECRET', 'ENCRYPTION_KEY', 'SIGNED_URL_SECRET']) {
  fallback(key, randomBytes(32).toString('base64'));
}
