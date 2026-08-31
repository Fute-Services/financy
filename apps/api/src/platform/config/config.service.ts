import { Injectable } from '@nestjs/common';

import { configSchema, type AppConfig } from './config.schema.js';

/**
 * Thrown when the environment does not validate.
 *
 * Carries the full field-keyed report rather than the first failure, so a
 * misconfigured deployment is fixed in one pass instead of one variable per
 * restart.
 */
export class ConfigurationError extends Error {
  constructor(readonly issues: ReadonlyArray<{ path: string; message: string }>) {
    const detail = issues.map((issue) => `  · ${issue.path}: ${issue.message}`).join('\n');
    super(`Invalid environment configuration:\n${detail}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * Parse and validate the environment.
 *
 * A pure function of the record it is given — not of `process.env` — so the
 * rules can be tested exhaustively without mutating global state and without
 * a test accidentally depending on the developer's own `.env`.
 */
export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : '(config)',
        message: issue.message,
      })),
    );
  }

  return result.data;
}

/**
 * Typed access to the validated configuration.
 *
 * Every consumer reads through this rather than `process.env`, so there is
 * exactly one place where a variable is named, typed, and defaulted. A
 * `process.env.SOMETHING` elsewhere in the codebase is a variable nobody
 * validated and nobody documented.
 */
@Injectable()
export class ConfigService {
  constructor(private readonly config: AppConfig) {}

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  get all(): Readonly<AppConfig> {
    return this.config;
  }

  /** Staging and production. Used for the rules that must not relax there. */
  get isProductionLike(): boolean {
    return this.config.APP_ENV === 'production' || this.config.APP_ENV === 'staging';
  }

  get isTest(): boolean {
    return this.config.NODE_ENV === 'test' || this.config.APP_ENV === 'test';
  }
}
