/**
 * Report — and optionally free — whatever is holding the project's ports.
 *
 * `EADDRINUSE` is the most common way to lose five minutes on this project:
 * a dev server survives a closed terminal, a crashed Playwright run leaves one
 * behind, or two people on the same machine both start the stack. The message
 * Node prints names the port and nothing else, so the next step is always the
 * same bit of platform-specific incantation nobody remembers.
 *
 *   pnpm ports          # what is listening, and what it is
 *   pnpm ports --free   # stop it, and the watchers behind it
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

function stop(pid) {
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

for (const { port, label } of DEFAULT_PORTS) {
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
const strays = strayProcesses().filter(({ pid }) => !stopped.has(pid));

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
