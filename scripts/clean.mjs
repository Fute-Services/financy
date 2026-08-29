/**
 * Cross-platform clean.
 *
 * A Node script rather than a shell one-liner because the reference
 * development host is Windows with no WSL (NFR-OPS-002) — `rm -rf` in a
 * package.json script would simply fail there.
 */
import { rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories removed at the repository root. */
const ROOT_TARGETS = ['.turbo', 'coverage', 'test-results', 'playwright-report'];

/** Directories removed inside every workspace package. */
const PACKAGE_TARGETS = ['dist', '.next', '.turbo', 'coverage', 'tsconfig.tsbuildinfo'];

/** Workspace roots, matching pnpm-workspace.yaml. */
const WORKSPACE_ROOTS = ['apps', 'packages'];

let removed = 0;

function remove(path) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  removed += 1;
  console.log(`  removed ${path.replace(ROOT, '.')}`);
}

for (const target of ROOT_TARGETS) remove(join(ROOT, target));

for (const workspace of WORKSPACE_ROOTS) {
  const workspacePath = join(ROOT, workspace);
  if (!existsSync(workspacePath)) continue;

  for (const entry of readdirSync(workspacePath)) {
    const packagePath = join(workspacePath, entry);
    if (!statSync(packagePath).isDirectory()) continue;
    for (const target of PACKAGE_TARGETS) remove(join(packagePath, target));
  }
}

console.log(
  removed === 0 ? 'Nothing to clean.' : `Cleaned ${removed} path${removed === 1 ? '' : 's'}.`,
);
console.log('node_modules is left alone — remove it with `pnpm install --force` if needed.');
