import { defineConfig } from 'vitest/config';

/**
 * The contract package is small, pure, and load-bearing for both applications,
 * so it carries a high floor. Every schema here is reachable from a test
 * without any infrastructure.
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
      thresholds: { lines: 95, branches: 90, functions: 95, statements: 95 },
    },
  },
});
