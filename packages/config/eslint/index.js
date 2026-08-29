import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Shared ESLint flat config base.
 *
 * The `architecture` block below is not style enforcement — it is the
 * mechanised form of the boundaries described in docs/08-ARCHITECTURE.md §4.3.
 * Discipline that is not mechanised is not discipline: every one of these
 * rules exists because violating it silently breaks a documented guarantee.
 */

/** Rules that hold everywhere, in every package. */
export const universalRules = {
  // ── Correctness ────────────────────────────────────────────────────────
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-debugger': 'error',
  'no-alert': 'error',
  'no-return-await': 'off',
  '@typescript-eslint/return-await': ['error', 'in-try-catch'],
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',

  // ── Type safety (NFR-MNT-001) ──────────────────────────────────────────
  // `any` is permitted only with an inline justification comment, which the
  // reviewer will see. It is a warning rather than an error so that a
  // genuinely necessary escape hatch does not block a build.
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
  ],

  // ── Security (docs/12-SECURITY-MODEL.md §8) ────────────────────────────
  // Math.random is never acceptable for anything reaching a token, key, id,
  // or nonce, and the call site rarely makes that obvious. Ban it outright.
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message:
        'Math.random is not cryptographically secure. Use crypto.randomBytes / crypto.randomUUID. See docs/12-SECURITY-MODEL.md §8.',
    },
  ],
  'no-restricted-globals': [
    'error',
    {
      name: 'eval',
      message: 'eval is prohibited.',
    },
  ],
};

/**
 * Architecture boundary rules.
 *
 * Each entry maps to a documented guarantee. Removing one silently removes
 * the guarantee, so each carries the reason in its message.
 */
export const architectureRules = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: '@prisma/client',
          message:
            'PrismaClient may only be imported by @financy/db and the platform database module. Everything else goes through a repository. See ADR-0003 and docs/08-ARCHITECTURE.md §4.3.',
        },
        {
          name: 'bullmq',
          message:
            'bullmq may only be imported by BullMqQueueAdapter. Everything else depends on QueuePort, so the codebase stays runnable without Redis. See ADR-0006.',
        },
      ],
      patterns: [
        {
          group: ['**/modules/*/!(index)', '**/modules/*/**'],
          message:
            'Import a module through its public index.ts only. Deep imports couple you to another module\'s internals. See docs/08-ARCHITECTURE.md §4.3.',
        },
        {
          group: ['**/platform/database/prisma*'],
          message: 'Use the injected repository, not the Prisma client directly.',
        },
      ],
    },
  ],
};

/** Ignore patterns shared by every package. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/generated/**',
  '**/*.config.js',
  '**/*.config.mjs',
];

/**
 * @param {{ tsconfigRootDir: string; project?: string | string[]; browser?: boolean }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createBaseConfig(options) {
  const { tsconfigRootDir, project = './tsconfig.json', browser = false } = options;

  return [
    { ignores },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { project, tsconfigRootDir },
        globals: {
          ...globals.node,
          ...(browser ? globals.browser : {}),
        },
      },
      rules: {
        ...universalRules,
        ...architectureRules,
      },
    },
    {
      // Tests may be looser: `any` in a fixture is not a design problem, and
      // asserting on a rejected promise legitimately produces floating ones.
      files: ['**/*.{test,spec}.ts', '**/*.{test,spec}.tsx', '**/test/**', '**/tests/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-restricted-imports': 'off',
      },
    },
  ];
}

export default createBaseConfig;
