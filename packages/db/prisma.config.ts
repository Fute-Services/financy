import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma configuration.
 *
 * A config file rather than the `prisma` key in `package.json`, which is
 * deprecated and removed in Prisma 7.
 *
 * Declaring a config file also switches off Prisma's own `.env` discovery, so
 * the repository-root `.env` is loaded explicitly here. It has to be the root
 * one: this is a pnpm workspace with a single `.env` at the top (the six-step
 * setup in `README.md`), and a per-package `.env` would give the CLI and the
 * API different databases — the kind of divergence that is only noticed once a
 * migration has been applied to the wrong one.
 *
 * `override` is off, so a variable already exported in the shell — which is
 * how CI and production supply it — wins over the file.
 */
const packageDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(packageDir, '../../.env'), override: false, quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx src/seed/index.ts',
  },
});
