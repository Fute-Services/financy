import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS relies on `emitDecoratorMetadata` for constructor injection, and
 * esbuild — which Vitest uses by default — does not emit it. Without the SWC
 * transform, `Test.createTestingModule` cannot resolve a single dependency,
 * and every failure looks like a missing provider rather than a missing
 * compiler feature.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    setupFiles: ['./test/setup-env.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/**/index.ts',
        'src/**/*.module.ts',
        // Bootstrap is exercised by the end-to-end suite, which starts a real
        // application; counting its lines here would only measure whether the
        // process happened to start during a unit run.
        'src/main.ts',
      ],
      thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 },
    },
  },
});
