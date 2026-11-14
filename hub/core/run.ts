// Starts the hub (core/main.ts) and starts it again when it asks to be: that
// is how a place chosen on screen takes effect (POST /api/missions/select).
//
// Only the "restart me" exit code restarts it. Any other exit ends this
// supervisor too, with the hub's own code, so a failure is never hidden behind
// a restart. More than 3 restarts in 10 seconds is a loop: it stops and says so.
//
//   npm run core          (or: node core/run.ts)
//
// "node core/main.ts" still runs the hub alone; it then cannot switch places by itself.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The exit code the hub uses to ask for a restart. */
export const RESTART_CODE = 75;
/** Set in the hub's environment when it runs under this supervisor. */
export const SUPERVISED_ENV = 'ASTRUM_SUPERVISED';

export interface SuperviseOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  restartCode?: number;
  /** More restarts than this within `windowMs` stops the supervisor. */
  maxRestarts?: number;
  windowMs?: number;
  /** Wait before starting again, so the old process has let go of its port. */
  delayMs?: number;
  log?: (line: string) => void;
  stdio?: 'inherit' | 'ignore';
}

export interface Supervisor {
  /** The supervisor's exit code once it is done: the child's own code, or 1 for a loop. */
  done: Promise<number>;
  /** Passes a signal to the child and ends once it exits, without restarting. */
  stop(signal?: NodeJS.Signals): void;
  /** How many times the child has been restarted. */
  restarts(): number;
}

export function supervise(opts: SuperviseOptions): Supervisor {
  const restartCode = opts.restartCode ?? RESTART_CODE;
  const maxRestarts = opts.maxRestarts ?? 3;
  const windowMs = opts.windowMs ?? 10_000;
  const log = opts.log ?? ((line: string) => console.log(`[run] ${line}`));
  const recent: number[] = [];
  let count = 0;
  let child: ChildProcess | null = null;
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let finish: (code: number) => void = () => {};
  const done = new Promise<number>((resolve) => { finish = resolve; });

  const start = () => {
    timer = null;
    const proc = spawn(opts.command, opts.args, { stdio: opts.stdio ?? 'inherit', env: { ...(opts.env ?? process.env), [SUPERVISED_ENV]: '1' } });
    child = proc;
    proc.once('error', (err) => {
      log(`Could not start the hub: ${err.message}`);
      finish(1);
    });
    proc.once('exit', (code, signal) => {
      child = null;
      if (stopping) return finish(code ?? 0);
      if (code === restartCode) {
        const now = Date.now();
        recent.push(now);
        while (recent.length && recent[0] < now - windowMs) recent.shift();
        if (recent.length > maxRestarts) {
          log(`The hub asked to restart ${recent.length} times in ${windowMs / 1000} seconds. Stopping: something is wrong. Start it again by hand.`);
          return finish(1);
        }
        count++;
        log('The hub is restarting on the place chosen on screen.');
        timer = setTimeout(start, opts.delayMs ?? 200);
        return;
      }
      if (code === 0) log('The hub stopped.');
      else log(`The hub stopped with ${code === null ? `signal ${signal}` : `code ${code}`}. Not restarting it: see the lines above for why.`);
      finish(code ?? 1);
    });
  };
  start();

  return {
    done,
    restarts: () => count,
    stop(signal: NodeJS.Signals = 'SIGTERM') {
      stopping = true;
      if (timer) { clearTimeout(timer); timer = null; finish(0); return; }
      if (child) child.kill(signal);
      else finish(0);
    },
  };
}

if (import.meta.main) {
  const main = join(dirname(fileURLToPath(import.meta.url)), 'main.ts');
  const run = supervise({ command: process.execPath, args: [...process.execArgv, main, ...process.argv.slice(2)] });
  // Ctrl-C reaches the hub too (same terminal): it shuts down by itself, and this ends with it.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => run.stop(signal));
  process.exitCode = await run.done;
}
