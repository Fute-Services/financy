/**
 * Environment configuration, validated at startup (docs/08 §7, docs/17 §3).
 *
 * The whole point of this file is that a misconfigured process **refuses to
 * start**. The alternative — booting and discovering at 3 a.m. that
 * `SESSION_SECRET` was the empty string, or that production has been running
 * against the local filesystem document provider for a week — is not a
 * degraded mode, it is an incident with a delayed fuse.
 *
 * So: every variable is declared, every variable is typed, and the
 * environment-dependent rules at the bottom are checked here rather than
 * trusted to a deployment checklist.
 */

import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);
const appEnvSchema = z.enum(['local', 'test', 'development', 'staging', 'production']);

/** A port number, arriving as a string because everything in the env does. */
const portSchema = z.coerce.number().int().min(1).max(65_535);

const booleanSchema = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * A 32-byte key, base64-encoded.
 *
 * The length is checked after decoding, not before: `'CHANGE_ME'.length` is
 * comfortably non-zero, so a schema that only asserted "not empty" would let
 * the placeholder from `.env.example` reach production untouched.
 */
const secretKeySchema = z
  .string({ error: 'is missing — generate one with node -e "…randomBytes(32)…"' })
  .min(1)
  .refine((value) => Buffer.from(value, 'base64').byteLength >= 32, {
    error: 'must be at least 32 bytes, base64-encoded (node -e "…randomBytes(32)…")',
  });

/** Comma-separated origins → a trimmed, non-empty list. */
const originListSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

export const configSchema = z
  .object({
    // ── Application ───────────────────────────────────────────────────────
    NODE_ENV: nodeEnvSchema.default('development'),
    APP_ENV: appEnvSchema.default('local'),
    API_PORT: portSchema.default(4100),
    WEB_PORT: portSchema.default(3100),
    API_BASE_URL: z.url().default('http://localhost:4100'),
    WEB_BASE_URL: z.url().default('http://localhost:3100'),
    CORS_ORIGINS: originListSchema,

    // ── Database ──────────────────────────────────────────────────────────
    DATABASE_URL: z
      .string({ error: 'is missing — see README, "Provisioning the database"' })
      .min(1, { error: 'is required' }),
    DATABASE_TEST_URL: optionalString,
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),

    // ── Sessions and cryptography ─────────────────────────────────────────
    SESSION_COOKIE_NAME: z.string().min(1).default('financy_session'),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(30),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).default(12),
    SESSION_SECRET: secretKeySchema,
    ENCRYPTION_KEY: secretKeySchema,
    SIGNED_URL_SECRET: secretKeySchema,
    STEP_UP_WINDOW_MINUTES: z.coerce.number().int().min(1).default(5),

    // ── Queue ─────────────────────────────────────────────────────────────
    REDIS_URL: optionalString,
    QUEUE_PREFIX: z.string().min(1).default('financy'),

    // ── Object storage ────────────────────────────────────────────────────
    DOCUMENT_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().min(1).default('./.storage'),
    STORAGE_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).default(20_971_520),
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ENDPOINT: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,

    // ── Providers ─────────────────────────────────────────────────────────
    CARD_PROVIDER: z.enum(['mock']).default('mock'),
    PAYMENT_PROVIDER: z.enum(['manual']).default('manual'),
    ACCOUNTING_PROVIDER: z.enum(['csv']).default('csv'),
    OCR_PROVIDER: z.enum(['noop']).default('noop'),
    NOTIFICATION_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    IDENTITY_PROVIDER: z.enum(['local']).default('local'),
    FX_RATE_PROVIDER: z.enum(['static']).default('static'),
    SMTP_URL: optionalString,
    MAIL_FROM: z.string().min(1).default('Financy <no-reply@example.test>'),

    // ── Observability ─────────────────────────────────────────────────────
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: booleanSchema.default(false),
    OTEL_ENABLED: booleanSchema.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
    OTEL_SERVICE_NAME: z.string().min(1).default('financy-api'),
    SENTRY_DSN: optionalString,

    // ── Rate limiting ─────────────────────────────────────────────────────
    RATE_LIMIT_ENABLED: booleanSchema.default(true),

    // ── Feature flags ─────────────────────────────────────────────────────
    FEATURE_MFA_ENROLLMENT: booleanSchema.default(false),
    FEATURE_RLS_ENFORCED: booleanSchema.default(false),
  })
  .superRefine((config, ctx) => {
    const isProduction = config.APP_ENV === 'production' || config.APP_ENV === 'staging';

    /**
     * ADR-0006. The inline queue runs jobs in-process after commit, which is
     * correct for development and a liability in production: a restart loses
     * every queued job, and a job that outlives the request blocks the
     * response. Refusing to start is the honest failure.
     */
    if (isProduction && config.REDIS_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: `REDIS_URL is required when APP_ENV=${config.APP_ENV}. The inline queue adapter is a development convenience and loses jobs on restart. See ADR-0006.`,
      });
    }

    /**
     * ADR-0008. The local document provider writes receipts to the container
     * filesystem, which is ephemeral. In production that is silent data loss
     * of the evidence this product exists to keep.
     */
    if (isProduction && config.DOCUMENT_PROVIDER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['DOCUMENT_PROVIDER'],
        message: `DOCUMENT_PROVIDER=local is not permitted when APP_ENV=${config.APP_ENV}: container filesystems are ephemeral, so uploaded receipts would be lost. See ADR-0008.`,
      });
    }

    if (config.DOCUMENT_PROVIDER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_REGION'] as const) {
        if (config[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when DOCUMENT_PROVIDER=s3.`,
          });
        }
      }
    }

    if (config.NOTIFICATION_PROVIDER === 'smtp' && config.SMTP_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'SMTP_URL is required when NOTIFICATION_PROVIDER=smtp.',
      });
    }

    /**
     * The application must never connect as the PostgreSQL superuser, in any
     * environment (audit finding P1). Checked here because it is the one
     * place every environment passes through, and because the mistake is easy
     * to make while getting a local database working and then never revisited.
     */
    if (/:\/\/postgres(:|@)/.test(config.DATABASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message:
          'The application must not connect as the postgres superuser. Create a least-privilege role — see README, "Provisioning the database".',
      });
    }

    /**
     * `.env.example` ships placeholders so the file is self-documenting. They
     * pass the length check once base64-decoded in some cases, so they are
     * rejected by name.
     */
    for (const key of ['SESSION_SECRET', 'ENCRYPTION_KEY', 'SIGNED_URL_SECRET'] as const) {
      if (config[key].includes('CHANGE_ME')) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} still holds the placeholder from .env.example. Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
        });
      }
    }

    /**
     * Three distinct secrets, because reusing one means a leak of the
     * signed-URL key is also a session-forgery key.
     */
    const secrets = [config.SESSION_SECRET, config.ENCRYPTION_KEY, config.SIGNED_URL_SECRET];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['ENCRYPTION_KEY'],
        message:
          'SESSION_SECRET, ENCRYPTION_KEY, and SIGNED_URL_SECRET must differ. Sharing one makes a leak of any of them a compromise of all three.',
      });
    }

    if (isProduction && config.LOG_PRETTY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOG_PRETTY'],
        message: 'LOG_PRETTY must be false outside development — log aggregators need JSON.',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
