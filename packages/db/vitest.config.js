'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const config_1 = require('vitest/config');
/**
 * The tenant scope is the code that stands between one organisation's data and
 * another's, so it carries a 100% floor. It is a pure function with no I/O —
 * there is no excuse for an untested branch in it.
 *
 * Integration tests against a real PostgreSQL arrive in Phase 1 alongside the
 * schema; they live in `test/` and run under a separate Vitest project so the
 * unit suite stays runnable with no database.
 */
exports.default = (0, config_1.defineConfig)({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      include: ['src/tenancy/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/index.ts'],
      thresholds: { lines: 100, branches: 95, functions: 100, statements: 100 },
    },
  },
});
//# sourceMappingURL=vitest.config.js.map
