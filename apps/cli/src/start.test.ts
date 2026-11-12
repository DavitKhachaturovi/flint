/** AGENT-02 (D-185 Q2): locating Flint and starting it when it isn't running. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentState } from '@flint/core/agents';
import { afterEach, describe, expect, it } from 'vitest';
import type { Connection } from './client.js';
import { FlintError, MESSAGES } from './errors.js';
import {
  appDataDir,
  flintExePath,
  isAlive,
  isDevelopment,
  readState,
  readToken,
} from './locate.js';
import { reachFlint, type ReachDeps } from './start.js';
import { tempDir } from './test-helpers.js';

const RUNNING: AgentState = {
  protocol: 1,
  pid: 4242,
  on: true,
  readOnly: false,
  paused: false,
  pipe: '\\\\.\\pipe\\flint-agents-test',
  version: '1.8.0',
};

const CONNECTION: Connection = {
  send: () => Promise.reject(new Error('unused')),
  close: () => {},
  closed: false,
};

/** A world where Flint's state, liveness, the exe and the pipe are plain variables. */
function world(initial: {
  state?: AgentState | null;
  alive?: boolean;
  exists?: boolean;
  listening?: boolean;
}) {
  const w = {
    state: initial.state ?? null,
    alive: initial.alive ?? true,
    exists: initial.exists ?? true,
    listening: initial.listening ?? true,
    token: 'secret' as string | null,
    started: [] as string[],
    connects: 0,
    clock: 0,
    /** Runs when Flint is started (what the started Flint does). */
    onStart: (): void => {},
  };
  const deps: ReachDeps = {
    readState: () => w.state,
    readToken: () => w.token,
    isAlive: () => w.alive,
    exists: () => w.exists,
    start: (exe) => {
      w.started.push(exe);
      w.onStart();
    },
    connect: () => {
      w.connects += 1;
      return w.listening ? Promise.resolve(CONNECTION) : Promise.reject(new Error('ENOENT'));
    },
    sleep: () => {
      w.clock += 100;
      return Promise.resolve();
    },
    now: () => w.clock,
  };
  return { w, deps };
}

const reach = (deps: ReachDeps, options: { noStart?: boolean; exe?: string | null } = {}) =>
  reachFlint({
    dir: 'C:\\AppData\\Flint',
    noStart: options.noStart ?? false,
    exe: options.exe === undefined ? 'C:\\Programs\\flint\\Flint.exe' : options.exe,
    deps,
  });

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof FlintError
      ? `${error.body.code}: ${error.body.message}`
      : String(error);
  }
};

describe('reachFlint', () => {
  it('connects to a running Flint without starting it', async () => {
    const { w, deps } = world({ state: RUNNING });
    const reached = await reach(deps);
    expect(reached).toEqual({ connection: CONNECTION, state: RUNNING, token: 'secret' });
    expect(w.started).toEqual([]);
  });

  it('says agents are off (exit 4) without starting anything', async () => {
    const { w, deps } = world({ state: { ...RUNNING, on: false, pipe: null } });
    expect(await codeOf(reach(deps))).toBe(`off: ${MESSAGES.off}`);
    expect(w.started).toEqual([]);
  });

  it('with --no-start: not running (exit 3)', async () => {
    const { w, deps } = world({ state: RUNNING, alive: false });
    expect(await codeOf(reach(deps, { noStart: true }))).toBe("not_running: Flint isn't running.");
    expect(w.started).toEqual([]);
  });

  it('a missing Flint.exe: not installed, with its path', async () => {
    const { deps } = world({ state: null, exists: false });
    expect(await codeOf(reach(deps))).toBe(
      "not_installed: Flint isn't installed at C:\\Programs\\flint\\Flint.exe.",
    );
  });

  it("the development build without FLINT_EXE can't start Flint", async () => {
    const { deps } = world({ state: null });
    expect(await codeOf(reach(deps, { exe: null }))).toBe(`not_running: ${MESSAGES.devNotRunning}`);
  });

  it('starts Flint once (a stale state with a dead pid) and connects when its pipe answers', async () => {
    const { w, deps } = world({ state: { ...RUNNING, pid: 1 }, alive: false, listening: false });
    w.onStart = () => {
      w.state = RUNNING;
      w.alive = true;
    };
    const sleep = deps.sleep;
    let polls = 0;
    const reached = reachFlint({
      dir: 'x',
      noStart: false,
      exe: 'C:\\Flint.exe',
      deps: {
        ...deps,
        sleep: async (ms) => {
          polls += 1;
          if (polls === 3) w.listening = true;
          await sleep(ms);
        },
      },
    });
    expect((await reached).token).toBe('secret');
    expect(w.started).toEqual(['C:\\Flint.exe']);
    expect(w.connects).toBe(3);
  });

  it('a Flint started with agents off: off (Flint stays in the tray)', async () => {
    const { w, deps } = world({ state: null });
    w.onStart = () => {
      w.state = { ...RUNNING, on: false, pipe: null };
    };
    expect(await codeOf(reach(deps))).toBe(`off: ${MESSAGES.off}`);
    expect(w.started).toHaveLength(1);
  });

  it('gives up after 20 s', async () => {
    const started = world({ state: null });
    expect(await codeOf(reach(started.deps))).toBe(`unreachable: ${MESSAGES.notStarted(20)}`);
    expect(started.w.clock).toBe(20_000);
    const running = world({ state: RUNNING, listening: false });
    expect(await codeOf(reach(running.deps))).toBe(`unreachable: ${MESSAGES.noAnswer(20)}`);
  });

  it('waits for the token file of a Flint that is still starting', async () => {
    const { w, deps } = world({ state: RUNNING });
    w.token = null;
    const sleep = deps.sleep;
    const reached = await reachFlint({
      dir: 'x',
      noStart: false,
      exe: null,
      deps: {
        ...deps,
        sleep: async (ms) => {
          w.token = 'late';
          await sleep(ms);
        },
      },
    });
    expect(reached.token).toBe('late');
  });
});

describe('locating Flint', () => {
  const dirs: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of dirs.splice(0)) dispose();
  });

  it('uses FLINT_APP_DATA, else %APPDATA%\\Flint or Flint (development)', () => {
    expect(appDataDir({ FLINT_APP_DATA: 'T:\\data', APPDATA: 'C:\\R' }, true)).toBe('T:\\data');
    expect(appDataDir({ APPDATA: 'C:\\R' }, false)).toBe(join('C:\\R', 'Flint'));
    expect(appDataDir({ APPDATA: 'C:\\R' }, true)).toBe(join('C:\\R', 'Flint (development)'));
    expect(isDevelopment({ FLINT_IDENTITY: 'development' }, false)).toBe(true);
    expect(isDevelopment({}, true)).toBe(true);
    expect(isDevelopment({}, false)).toBe(false);
  });

  it('finds Flint.exe two folders above flint.exe (the installed one ignores FLINT_EXE)', () => {
    const sea = {
      development: false,
      execPath: 'C:\\P\\flint\\resources\\bin\\flint.exe',
      isSea: true,
    };
    expect(flintExePath({}, sea)).toBe('C:\\P\\flint\\Flint.exe');
    // D-185 security review: the test override never applies to the installed exe.
    expect(flintExePath({ FLINT_EXE: 'D:\\fake\\Flint.exe' }, sea)).toBe('C:\\P\\flint\\Flint.exe');
    expect(flintExePath({ FLINT_EXE: 'D:\\fake\\Flint.exe' }, { ...sea, isSea: false })).toBe(
      'D:\\fake\\Flint.exe',
    );
    expect(flintExePath({ LOCALAPPDATA: 'C:\\L' }, { ...sea, isSea: false })).toBe(
      'C:\\L\\Programs\\flint\\Flint.exe',
    );
    expect(flintExePath({}, { ...sea, development: true })).toBeNull();
  });

  it('reads the state and the token, tolerating missing and malformed files', () => {
    const dir = tempDir();
    dirs.push(dir.dispose);
    expect(readState(dir.path)).toBeNull();
    expect(readToken(dir.path)).toBeNull();
    writeFileSync(join(dir.path, 'agent-state.json'), '{"pid": "x"');
    expect(readState(dir.path)).toBeNull();
    writeFileSync(join(dir.path, 'agent-state.json'), JSON.stringify(RUNNING));
    expect(readState(dir.path)).toEqual(RUNNING);
    writeFileSync(join(dir.path, 'agent-token'), '  abc123\r\n');
    expect(readToken(dir.path)).toBe('abc123');
  });

  it('tells a live process from a dead one', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(0)).toBe(false);
    expect(isAlive(-5)).toBe(false);
    expect(isAlive(2 ** 30)).toBe(false);
  });
});
