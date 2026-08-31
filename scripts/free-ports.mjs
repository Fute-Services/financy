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
 *   pnpm ports --free   # stop it
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

    return output
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [pid, ...rest] = line.split('\t');
        return { pid: Number(pid), command: rest.join('\t').trim() };
      });
  }

  const pids = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

  return [...new Set(pids)].map((pid) => ({
    pid: Number(pid),
    command: run('ps', ['-p', pid, '-o', 'args=']).trim() || '(exited)',
  }));
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

let found = 0;

for (const { port, label } of DEFAULT_PORTS) {
  const listeners = listenersOn(port);

  if (listeners.length === 0) {
    console.log(`  ${String(port).padEnd(5)} ${label.padEnd(4)} free`);
    continue;
  }

  found += listeners.length;

  for (const { pid, command } of listeners) {
    const truncated = command.length > 90 ? `${command.slice(0, 90)}…` : command;
    console.log(`  ${String(port).padEnd(5)} ${label.padEnd(4)} pid ${pid} — ${truncated}`);

    if (shouldFree) {
      stop(pid);
      console.log(`  ${' '.repeat(10)} stopped`);
    }
  }
}

if (found === 0) {
  console.log('\nBoth ports are free. `pnpm dev` will start.');
} else if (shouldFree) {
  console.log('\nStopped. `pnpm dev` will start now.');
} else {
  console.log('\nRun `pnpm ports --free` to stop these, if none of them is something you want.');
}
