/**
 * AGENT-02 (D-185 Q2): reaching Flint, starting it when it isn't running. Flint starts hidden in the
 * tray (`Flint.exe --hidden`, the start used at login), detached, and `flint` waits up to 20 s for
 * its pipe. Agents off is a clear error at once; Flint stays in the tray.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentState } from '@flint/core/agents';
import { connectPipe, type Connection } from './client.js';
import { FlintError, MESSAGES } from './errors.js';
import { isAlive, readState, readToken } from './locate.js';

/** How long `flint` waits for a Flint it started (or one still starting). */
export const START_TIMEOUT_MS = 20_000;
/** How often it looks again meanwhile. */
const POLL_MS = 100;

/** A connected Flint. */
export interface Reached {
  readonly connection: Connection;
  readonly state: AgentState;
  readonly token: string;
}

export interface ReachOptions {
  /** Flint's app-data folder (`locate.appDataDir`). */
  readonly dir: string;
  /** `--no-start` / `FLINT_NO_START=1`: never start Flint. */
  readonly noStart: boolean;
  /** The `Flint.exe` to start (`locate.flintExePath`); null: it can't be started from here. */
  readonly exe: string | null;
  readonly timeoutMs?: number;
  /** Injected in tests; the defaults are the real ones. */
  readonly deps?: Partial<ReachDeps>;
}

export interface ReachDeps {
  readonly readState: (dir: string) => AgentState | null;
  readonly readToken: (dir: string) => string | null;
  readonly isAlive: (pid: number) => boolean;
  readonly exists: (path: string) => boolean;
  readonly start: (exe: string) => void;
  readonly connect: (pipe: string) => Promise<Connection>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** Starts `Flint.exe --hidden` detached, so it outlives `flint` and keeps no console. */
export function startFlint(exe: string): void {
  const child = spawn(exe, ['--hidden'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    // A start that fails shows as the pipe never answering (`unreachable`).
  });
  child.unref();
}

const DEFAULT_DEPS: ReachDeps = {
  readState,
  readToken,
  isAlive,
  exists: existsSync,
  start: startFlint,
  connect: (pipe) => connectPipe(pipe),
  sleep: (ms) => delay(ms),
  now: () => Date.now(),
};

/**
 * Connects to the running Flint, starting it first if needed. Throws a `FlintError`:
 * `off` (exit 4), `not_running` / `not_installed` / `unreachable` (exit 3).
 */
export async function reachFlint(options: ReachOptions): Promise<Reached> {
  const deps: ReachDeps = { ...DEFAULT_DEPS, ...options.deps };
  const timeoutMs = options.timeoutMs ?? START_TIMEOUT_MS;
  const deadline = deps.now() + timeoutMs;
  let started = false;
  for (;;) {
    const state = deps.readState(options.dir);
    if (state && deps.isAlive(state.pid)) {
      if (!state.on) throw new FlintError({ code: 'off', message: MESSAGES.off });
      const token = deps.readToken(options.dir);
      if (state.pipe && token) {
        try {
          return { connection: await deps.connect(state.pipe), state, token };
        } catch {
          // Its pipe isn't listening yet (Flint is starting): look again.
        }
      }
    } else if (!started) {
      if (options.noStart)
        throw new FlintError({ code: 'not_running', message: MESSAGES.notRunning });
      if (options.exe === null)
        throw new FlintError({ code: 'not_running', message: MESSAGES.devNotRunning });
      if (!deps.exists(options.exe))
        throw new FlintError({
          code: 'not_installed',
          message: MESSAGES.notInstalled(options.exe),
        });
      deps.start(options.exe);
      started = true;
    }
    if (deps.now() >= deadline) {
      const seconds = Math.round(timeoutMs / 1000);
      throw new FlintError({
        code: 'unreachable',
        message: started ? MESSAGES.notStarted(seconds) : MESSAGES.noAnswer(seconds),
      });
    }
    await deps.sleep(POLL_MS);
  }
}
