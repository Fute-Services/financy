import path from 'node:path';

import { Global, Module } from '@nestjs/common';
import { config as loadEnvFile } from 'dotenv';

import type { AppConfig } from './config.schema.js';
import { ConfigService, loadConfig } from './config.service.js';

/**
 * Load the repository-root `.env`.
 *
 * One file for the whole workspace, matching the six-step setup in
 * `README.md` and the Prisma CLI's config. `override: false` means a variable
 * already present in the environment wins — which is how CI and production
 * supply theirs, and why the file being absent there is not an error.
 */
function loadDotEnv(): void {
  // Try the repository root first, then the current directory, so the API
  // starts whether it is run from `apps/api` or from the workspace root.
  loadEnvFile({ path: path.resolve(process.cwd(), '../../.env'), override: false, quiet: true });
  loadEnvFile({ path: path.resolve(process.cwd(), '.env'), override: false, quiet: true });
}

let cached: AppConfig | undefined;

/**
 * Read and validate the environment, once per process.
 *
 * Called by `main.ts` **before** `NestFactory.create`, so a configuration
 * mistake produces the plain field-by-field report a person can act on. Left
 * to the module factory instead, Nest catches the throw, logs it through its
 * own exception handler with a framework stack trace, and the useful part —
 * which variable, and what to do about it — arrives buried in dependency
 * injection internals that have nothing to do with the problem.
 *
 * Memoised because the environment does not change mid-process, and because
 * `ConfigModule` then reuses what bootstrap already validated rather than
 * parsing a second time.
 */
export function loadEnvironment(): AppConfig {
  if (cached === undefined) {
    loadDotEnv();
    cached = loadConfig(process.env);
  }

  return cached;
}

/**
 * Global because configuration is genuinely cross-cutting: nearly every
 * platform module needs it, and threading it through imports would add a line
 * of ceremony to each without adding a decision anyone has to make.
 */
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useFactory: (): ConfigService => new ConfigService(loadEnvironment()),
    },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
