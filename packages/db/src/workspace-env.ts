import { existsSync } from 'node:fs';
import path from 'node:path';

import { config as loadEnvFile } from 'dotenv';

/**
 * Find and load the workspace's single `.env`.
 *
 * Walks up from the working directory rather than resolving a fixed relative
 * path, because the callers run from different places: `pnpm db:seed` from the
 * repository root, `pnpm --filter @financy/db seed` from `packages/db`, and
 * Vitest from wherever the runner happened to start. A hard-coded `../../..`
 * is correct for exactly one of those and silently wrong for the others —
 * silently, because a missing `.env` looks identical to an unset variable.
 *
 * `import.meta.url` would be the obvious way to anchor this, and cannot be
 * used: this package compiles to CommonJS, where it is a syntax error.
 *
 * `override: false`, so a variable already exported wins. That is how CI and
 * production supply theirs, and why the file being absent there is not an
 * error.
 */
export function loadWorkspaceEnv(startDirectory: string = process.cwd()): string | undefined {
  let directory = path.resolve(startDirectory);

  // Stop at the filesystem root: `path.dirname('/')` returns '/', so the loop
  // needs the equality check rather than a truthiness test to terminate.
  for (;;) {
    const candidate = path.join(directory, '.env');

    if (existsSync(candidate)) {
      loadEnvFile({ path: candidate, override: false, quiet: true });
      return candidate;
    }

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
