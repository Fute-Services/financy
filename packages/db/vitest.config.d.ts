/**
 * The tenant scope is the code that stands between one organisation's data and
 * another's, so it carries a 100% floor. It is a pure function with no I/O —
 * there is no excuse for an untested branch in it.
 *
 * Integration tests against a real PostgreSQL arrive in Phase 1 alongside the
 * schema; they live in `test/` and run under a separate Vitest project so the
 * unit suite stays runnable with no database.
 */
declare const _default: import('vite', { with: { 'resolution-mode': 'import' } }).UserConfig;
export default _default;
//# sourceMappingURL=vitest.config.d.ts.map
