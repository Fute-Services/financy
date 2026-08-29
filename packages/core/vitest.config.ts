import { defineConfig } from 'vitest/config';

/**
 * `@financy/core` holds the money. It carries the highest coverage floor in
 * the repository — 100% across the board — per docs/16-TESTING-STRATEGY.md §10.
 * These are pure functions with no I/O, so full coverage is cheap and there is
 * no excuse for a gap.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/index.ts'],
      thresholds: {
        lines: 100,
        branches: 95,
        functions: 100,
        statements: 100,
      },
    },
  },
});
