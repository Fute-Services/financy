import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest base.
 *
 * Coverage thresholds are deliberately per-package rather than global — see
 * docs/16-TESTING-STRATEGY.md §10. `packages/core` and the policy/approval
 * modules carry the highest floors because they hold the money and the rules.
 */
export const baseConfig = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts', 'src/**/*.d.ts'],
    },
  },
});

/**
 * @param {{ lines?: number; branches?: number; functions?: number; statements?: number }} thresholds
 */
export function withCoverage(thresholds) {
  return defineConfig({
    test: {
      ...baseConfig.test,
      coverage: {
        ...baseConfig.test.coverage,
        thresholds: {
          lines: thresholds.lines ?? 80,
          branches: thresholds.branches ?? 75,
          functions: thresholds.functions ?? 80,
          statements: thresholds.statements ?? 80,
        },
      },
    },
  });
}

export default baseConfig;
