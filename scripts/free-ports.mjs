/**
 * Report — and optionally free — whatever is holding the project's ports.
 *
 * `EADDRINUSE` is the most common way to lose five minutes on this project:
 * a dev server survives a closed terminal, a crashed Playwright run leaves one
 * behind, or two people on the same machine both start the stack. The message
 * Node prints names the port and nothing else, so the next step is always the
 * same bit of platform-specific incantation nobody remembers.
 *
 *   pnpm ports                 # what is listening, and what it is
 *   pnpm ports --free          # stop it, and the watchers behind it
 *   pnpm ports --free --only web   # stop only the frontend's, leave the API alone
 *
 * `npm start` runs the `--free` form first, which is why it works from a dirty
 * machine when `pnpm dev` does not. The cost of that is real and deliberate: a
 * whole-repository `--free` also stops a `pnpm test` running in another
 * terminal, because a test run is exactly the kind of stray this is hunting.
 *
 * `--free` stops more than the listener, and that is the whole point of the
 * second half of this file. Killing only the process holding the port leaves
 * the watchers that spawned it — `turbo run dev`, `nest start --watch`, three
 * `tsc --watch` — alive and rebuilding. One of them keeps a file handle on
 * Prisma's query engine, so the next `pnpm build` fails with
 *
 *   EPERM: operation not permitted, rename … query_engine-windows.dll.node
 *
 * which is a much worse five minutes than the one this script was written for,
 * because nothing in that message suggests a stray process.
 *
 * A Node script rather than a shell one-liner because the reference host is
 * Windows with no WSL (NFR-OPS-002), and `lsof` does not exist there.
 *
 * It never kills anything without `--free`, and it prints the command line of
 * each process first — the port might be held by something you actually want.
 */
import { execFileSync } from 'node:child_process';

/** The ports this project binds. Overridable, because `.env` can move them. */
const DEFAULT_PORTS = [
  { port: Number(process.env.WEB_PORT ?? 3100), label: 'web' },
  { port: Number(process.env.API_PORT ?? 4100), label: 'api' },
];

const shouldFree = process.argv.includes('--free');
const isWindows = process.platform === 'win32';

/**
 * `--only web` / `--only api`, so a package can free its own port on the way up
 * without stopping its sibling — `npm start` inside one app must not take down
 * the other one somebody has running next to it.
 *
 * Narrowing also skips the stray sweep at the bottom of this file: a stray
 * `tsc --watch` cannot be attributed to one app, and stopping the whole
 * repository's watchers from inside one of them would be a surprise.
 */
const onlyLabel = (() => {
  const at = process.argv.indexOf('--only');
  return at === -1 ? null : (process.argv[at + 1] ?? null);
})();

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // A non-zero exit here means "nothing found", which is not an error.
    return '';
  }
}

/** @returns {Array<{ pid: number; command: string }>} */
function listenersOn(port) {
  if (isWindows) {
    const output = run('powershell', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue |` +
        ' Select-Object -ExpandProperty OwningProcess -Unique |' +
        ' ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue;' +
        ' "$_`t$(if ($p) { $p.CommandLine } else { "(exited)" })" }',
    ]);

    return parseRows(output);
  }

  const pids = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  return [...new Set(pids)].map((pid) => ({
    pid: Number(pid),
    command: run('ps', ['-p', pid, '-o', 'args=']).trim() || '(exited)',
  }));
}

/** `pid<TAB>command line` per line, which is what both PowerShell blocks emit. */
function parseRows(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [pid, ...rest] = line.split('\t');
      return { pid: Number(pid), command: rest.join('\t').trim() };
    })
    .filter(({ pid }) => Number.isFinite(pid) && pid !== process.pid);
}

/**
 * Every node process belonging to this repository, listener or not.
 *
 * Seeded from processes whose command line names this directory, then grown
 * **upwards through dev orchestrators only** (`pnpm`, `turbo`, `corepack`), so
 * a matched child pulls in the shell that spawned it, and downwards to that
 * shell's other children. The orchestrator restriction is what keeps this from
 * walking into another project's tree on a machine running several — which the
 * reference host is.
 *
 * @returns {Array<{ pid: number; command: string }>}
 */
function strayProcesses() {
  const root = process.cwd();

  if (!isWindows) {
    return run('ps', ['-eo', 'pid=,args='])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && line.includes(root))
      .map((line) => {
        const match = /^(\d+)\s+(.*)$/.exec(line);
        return match === null ? null : { pid: Number(match[1]), command: match[2] };
      })
      .filter((row) => row !== null && row.pid !== process.pid);
  }

  // Single-quoted in PowerShell, so backslashes in the path need no escaping;
  // a path containing a quote would, and cannot occur here.
  const script = [
    `$all = Get-CimInstance Win32_Process -Filter "Name='node.exe'"`,
    '$byId = @{}',
    'foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }',
    '$marked = [System.Collections.Generic.HashSet[int]]::new()',
    `foreach ($p in $all) { if ($p.CommandLine -like '*${root}*') { [void]$marked.Add([int]$p.ProcessId) } }`,
    '$changed = $true',
    'while ($changed) {',
    '  $changed = $false',
    '  foreach ($id in @($marked)) {',
    '    $parent = $byId[[int]$byId[$id].ParentProcessId]',
    `    if ($parent -and -not $marked.Contains([int]$parent.ProcessId) -and $parent.CommandLine -match 'pnpm|turbo|corepack') {`,
    '      [void]$marked.Add([int]$parent.ProcessId)',
    '      $changed = $true',
    '    }',
    '  }',
    '  foreach ($p in $all) {',
    '    if ($marked.Contains([int]$p.ParentProcessId) -and -not $marked.Contains([int]$p.ProcessId)) {',
    '      [void]$marked.Add([int]$p.ProcessId)',
    '      $changed = $true',
    '    }',
    '  }',
    '}',
    'foreach ($id in $marked) { "$id`t$($byId[$id].CommandLine)" }',
  ].join('\n');

  return parseRows(run('powershell', ['-NoProfile', '-Command', script]));
}

/**
 * This process and everything that spawned it.
 *
 * The stray sweep grows upwards through `pnpm`, `turbo` and `corepack` — which
 * is exactly what `npm start` runs under. Without this guard it stops the very
 * shell that is waiting to launch the dev server, and the `&&` after it never
 * fires. The failure is intermittent, because it depends on how the package
 * manager happened to shell out, which is the worst kind to leave inside a
 * script whose entire job is cleanup.
 */
const protectedPids = (() => {
  const parentOf = new Map();

  if (isWindows) {
    const rows = run('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
    ]);

    for (const line of rows.split(/\r?\n/)) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(pid) && Number.isFinite(ppid)) parentOf.set(pid, ppid);
    }
  } else {
    for (const line of run('ps', ['-eo', 'pid=,ppid=']).split(/\r?\n/)) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (Number.isFinite(pid) && Number.isFinite(ppid)) parentOf.set(pid, ppid);
    }
  }

  const chain = new Set();
  let current = process.pid;

  // Bounded by the `has` check, because a torn process table can describe a cycle.
  while (Number.isFinite(current) && current > 0 && !chain.has(current)) {
    chain.add(current);
    current = parentOf.get(current) ?? 0;
  }

  return chain;
})();

function stop(pid) {
  if (protectedPids.has(pid)) return;

  if (isWindows) {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
    ]);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

function truncate(command) {
  return command.length > 90 ? `${command.slice(0, 90)}…` : command;
}

const stopped = new Set();
let found = 0;

const ports =
  onlyLabel === null ? DEFAULT_PORTS : DEFAULT_PORTS.filter(({ label }) => label === onlyLabel);

if (ports.length === 0) {
  const known = DEFAULT_PORTS.map(({ label }) => label).join(', ');
  console.error(`Unknown --only value "${onlyLabel}". Expected one of: ${known}.`);
  process.exit(1);
}

for (const { port, label } of ports) {
  const listeners = listenersOn(port);

  if (listeners.length === 0) {
    console.log(`  ${String(port).padEnd(5)} ${label.padEnd(4)} free`);
    continue;
  }

  found += listeners.length;

  for (const { pid, command } of listeners) {
    console.log(`  ${String(port).padEnd(5)} ${label.padEnd(4)} pid ${pid} — ${truncate(command)}`);

    if (shouldFree) {
      stop(pid);
      stopped.add(pid);
      console.log(`  ${' '.repeat(10)} stopped`);
    }
  }
}

// The watchers, which hold no port and so never appeared above.
const strays =
  onlyLabel === null ? strayProcesses().filter(({ pid }) => !stopped.has(pid)) : [];

if (strays.length > 0) {
  console.log(
    `\n${strays.length} other process${strays.length === 1 ? '' : 'es'} from this repository ${strays.length === 1 ? 'is' : 'are'} still running:`,
  );

  for (const { pid, command } of strays) {
    console.log(`  pid ${pid} — ${truncate(command)}`);

    if (shouldFree) {
      stop(pid);
      stopped.add(pid);
    }
  }

  if (shouldFree) console.log('  …stopped.');
}

if (shouldFree && stopped.size > 0) {
  console.log('\nStopped. `pnpm dev` will start now, and `pnpm build` will not hit EPERM.');
} else if (found === 0 && strays.length === 0) {
  console.log('\nBoth ports are free, with nothing left running. `pnpm dev` will start.');
} else if (!shouldFree) {
  console.log('\nRun `pnpm ports --free` to stop these, if none of them is something you want.');
}
