import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from './config.service.js';

/** A minimal environment that validates, so each test can change one thing. */
function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://financy_app:pw@localhost:5432/financy_dev',
    SESSION_SECRET: Buffer.alloc(32, 1).toString('base64'),
    ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
    SIGNED_URL_SECRET: Buffer.alloc(32, 3).toString('base64'),
    ...overrides,
  };
}

function issuePaths(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigurationError) return error.issues.map((issue) => issue.path);
    throw error;
  }
}

describe('defaults', () => {
  it('starts a local developer with only the four required values', () => {
    const config = loadConfig(validEnv());

    expect(config.APP_ENV).toBe('local');
    expect(config.API_PORT).toBe(4100);
    expect(config.WEB_PORT).toBe(3100);
    expect(config.DOCUMENT_PROVIDER).toBe('local');
    expect(config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('coerces the strings the environment actually delivers', () => {
    const config = loadConfig(
      validEnv({ API_PORT: '5000', LOG_PRETTY: 'true', OTEL_ENABLED: '0' }),
    );

    expect(config.API_PORT).toBe(5000);
    expect(config.LOG_PRETTY).toBe(true);
    expect(config.OTEL_ENABLED).toBe(false);
  });

  it('splits the CORS origin list and drops the blanks', () => {
    expect(
      loadConfig(validEnv({ CORS_ORIGINS: 'http://a.test, ,http://b.test' })).CORS_ORIGINS,
    ).toEqual(['http://a.test', 'http://b.test']);
  });

  it('treats an empty optional as absent rather than as an empty string', () => {
    expect(loadConfig(validEnv({ REDIS_URL: '   ' })).REDIS_URL).toBeUndefined();
  });
});

describe('required values', () => {
  it('refuses to start without a database URL', () => {
    expect(issuePaths(validEnv({ DATABASE_URL: undefined }))).toContain('DATABASE_URL');
  });

  it('reports every problem at once, not the first', () => {
    const paths = issuePaths({});
    expect(paths).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'SESSION_SECRET',
        'ENCRYPTION_KEY',
        'SIGNED_URL_SECRET',
      ]),
    );
  });

  it('names the variable and how to fix it in the message', () => {
    try {
      loadConfig(validEnv({ SESSION_SECRET: 'short' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigurationError).message).toContain('SESSION_SECRET');
      expect((error as ConfigurationError).message).toContain('32 bytes');
    }
  });
});

describe('secrets', () => {
  /**
   * `'CHANGE_ME_32_BYTES_BASE64'` decodes to enough bytes to satisfy a naive
   * length check, so the placeholder is rejected by name. Otherwise the
   * example file's value reaches production intact.
   */
  it('rejects the placeholder from .env.example', () => {
    expect(issuePaths(validEnv({ SESSION_SECRET: 'CHANGE_ME_32_BYTES_BASE64' }))).toContain(
      'SESSION_SECRET',
    );
  });

  it('rejects a key shorter than 32 bytes once decoded', () => {
    expect(
      issuePaths(validEnv({ ENCRYPTION_KEY: Buffer.alloc(16, 9).toString('base64') })),
    ).toContain('ENCRYPTION_KEY');
  });

  /**
   * Reusing one value means a leak of the signed-URL key is also a
   * session-forgery key — one incident becomes three.
   */
  it('rejects the same value used for two secrets', () => {
    const shared = Buffer.alloc(32, 7).toString('base64');
    expect(issuePaths(validEnv({ SESSION_SECRET: shared, ENCRYPTION_KEY: shared }))).toContain(
      'ENCRYPTION_KEY',
    );
  });
});

describe('the database role', () => {
  /** Audit finding P1: never the superuser, in any environment. */
  it.each([
    'postgresql://postgres:pw@localhost:5432/financy_dev',
    'postgres://postgres@localhost:5432/financy_dev',
  ])('rejects connecting as postgres (%s)', (url) => {
    expect(issuePaths(validEnv({ DATABASE_URL: url }))).toContain('DATABASE_URL');
  });

  it('accepts a least-privilege role', () => {
    expect(
      issuePaths(validEnv({ DATABASE_URL: 'postgresql://financy_app:pw@db:5432/financy' })),
    ).toEqual([]);
  });

  it('does not mistake a database named postgres for the superuser', () => {
    expect(
      issuePaths(validEnv({ DATABASE_URL: 'postgresql://financy_app:pw@localhost:5432/postgres' })),
    ).toEqual([]);
  });
});

describe('production guards', () => {
  const production = (overrides: Record<string, string | undefined> = {}) =>
    validEnv({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      DOCUMENT_PROVIDER: 's3',
      S3_BUCKET: 'financy-docs',
      S3_REGION: 'eu-west-1',
      REDIS_URL: 'redis://redis:6379',
      ...overrides,
    });

  it('accepts a correctly configured production environment', () => {
    expect(issuePaths(production())).toEqual([]);
  });

  /** ADR-0006 — the inline queue loses every job on restart. */
  it('refuses production without Redis', () => {
    expect(issuePaths(production({ REDIS_URL: undefined }))).toContain('REDIS_URL');
  });

  /** ADR-0008 — a container filesystem is ephemeral; receipts would vanish. */
  it('refuses the local document provider in production', () => {
    expect(issuePaths(production({ DOCUMENT_PROVIDER: 'local' }))).toContain('DOCUMENT_PROVIDER');
  });

  it('applies the same rules to staging', () => {
    expect(issuePaths(production({ APP_ENV: 'staging', REDIS_URL: undefined }))).toContain(
      'REDIS_URL',
    );
  });

  it('requires a bucket and region when the provider is s3', () => {
    const paths = issuePaths(production({ S3_BUCKET: undefined, S3_REGION: undefined }));
    expect(paths).toEqual(expect.arrayContaining(['S3_BUCKET', 'S3_REGION']));
  });

  it('requires an SMTP URL when the notification provider is smtp', () => {
    expect(issuePaths(production({ NOTIFICATION_PROVIDER: 'smtp' }))).toContain('SMTP_URL');
  });

  it('refuses pretty logs, which no aggregator can parse', () => {
    expect(issuePaths(production({ LOG_PRETTY: 'true' }))).toContain('LOG_PRETTY');
  });

  it('permits all of these locally, which is the point of having environments', () => {
    expect(
      issuePaths(validEnv({ APP_ENV: 'local', DOCUMENT_PROVIDER: 'local', LOG_PRETTY: 'true' })),
    ).toEqual([]);
  });
});
