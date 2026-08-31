import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration (docs/16 §8).
 *
 * These specs drive the real stack: a real browser, the real Next.js app, the
 * real API, and a real PostgreSQL. That is the point — everything below this
 * level mocks *something*, and the bugs that reach users are usually in the
 * seam between two things that each worked in isolation.
 *
 * Because they are the slowest and most expensive tests in the repository,
 * there are deliberately few of them: the critical journeys, and nothing that
 * a Supertest or unit test could have proven more cheaply.
 */

const WEB_PORT = Number(process.env['WEB_PORT'] ?? 3100);
const API_PORT = Number(process.env['API_PORT'] ?? 4100);

const WEB_BASE_URL = process.env['WEB_BASE_URL'] ?? `http://localhost:${WEB_PORT}`;
const API_BASE_URL = process.env['API_BASE_URL'] ?? `http://localhost:${API_PORT}`;

/** Set by the CI workflow. Governs retries, workers, and reuse of a server. */
const isCI = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.spec.ts',

  /**
   * Full isolation between specs. Sharing state across files is what produces
   * a suite that passes in one order and fails in another, and then gets
   * re-run rather than investigated.
   */
  fullyParallel: true,

  /**
   * `test.only` left in a file passes locally and silently skips everything
   * else in CI. Failing the run is the only reliable way to catch it.
   */
  forbidOnly: isCI,

  /**
   * One retry in CI, none locally. A retry hides flake, so it is a
   * concession to real network timing rather than a policy — a spec that
   * needs it more than occasionally is a spec to fix.
   */
  retries: isCI ? 1 : 0,
  /**
   * Two workers, everywhere.
   *
   * Playwright's local default is half the cores, and that was fine when the
   * database was a local PostgreSQL. It is not fine against Atlas: every
   * registration is a multi-write transaction crossing the internet, so six
   * workers queue behind each other and behind the dev server's first compile
   * of each route, and journeys that pass alone time out together. CI has the
   * same ceiling for the same reason.
   */
  workers: 2,

  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : [['list'], ['html', { open: 'never' }]],

  /**
   * Sixty seconds, because the slowest journey here is registration and
   * registration is genuinely slow: one transaction writing an organisation,
   * five roles, 185 grants, a user, a membership, an entity, and 36 categories,
   * each round trip going to a remote database. It takes ~3s against Atlas
   * versus ~140ms against a local PostgreSQL, and a locally-run spec pays the
   * dev server's first compile of each route on top.
   *
   * The per-assertion timeout stays short. A slow write is expected; an element
   * that takes five seconds to appear is a bug.
   */
  timeout: 60_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: WEB_BASE_URL,
    /** Only for failures — a trace per passing test is gigabytes of nothing. */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    /** UTC everywhere, so a date assertion cannot depend on the runner's zone. */
    timezoneId: 'UTC',
    locale: 'en-GB',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * Playwright starts the stack itself, so `pnpm test:e2e` works from a clean
   * checkout without a second terminal. In CI the servers are never reused —
   * a leftover process from a previous job would be testing the wrong build.
   */
  webServer: [
    {
      // CI runs the **built** artefact, because that is what deploys — a dev
      // server has different bundling, different error handling, and no
      // production build step to fail. Locally `dev` is used instead, so the
      // suite picks up an edit without a rebuild.
      command: isCI ? 'pnpm --filter @financy/api start' : 'pnpm --filter @financy/api dev',
      url: `${API_BASE_URL}/v1/health/live`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      cwd: '..',
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The port is passed explicitly rather than left to the package script,
      // which hard-codes 3100. Playwright is the process that decides where to
      // look, so it must also be the one that decides where the app binds —
      // otherwise changing `WEB_PORT` moves the probe and not the server.
      command: isCI
        ? `pnpm --filter @financy/web exec next start --port ${String(WEB_PORT)}`
        : `pnpm --filter @financy/web exec next dev --port ${String(WEB_PORT)}`,
      url: WEB_BASE_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      cwd: '..',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});

export { API_BASE_URL, WEB_BASE_URL };
