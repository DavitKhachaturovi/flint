import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FinishedSession } from '@flint/core/focus';
import { DEFAULT_FOCUS_SETTINGS, type FocusSettings } from '../shared/focus.js';
import { FocusTimer } from './focus-timer.js';
import { findFocusActivation, focusToastXml } from './toast.js';

/** FOCUS-01, FOCUS-04 (D-170, docs/05 §5): the main process's Focus timer. */

const MIN = 60_000;
let base: string;
let clock: number;
let settings: FocusSettings;
const timers: FocusTimer[] = [];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-focus-timer-'));
  clock = new Date(2026, 2, 10, 10, 0).getTime();
  settings = DEFAULT_FOCUS_SETTINGS;
});
afterEach(async () => {
  for (const timer of timers.splice(0)) {
    timer.stop();
    await timer.settled();
  }
  await rm(base, { recursive: true, force: true });
});

async function start(): Promise<{ timer: FocusTimer; ended: FinishedSession[] }> {
  const ended: FinishedSession[] = [];
  const timer = await FocusTimer.start({
    path: join(base, 'focus-state.json'),
    settings: () => settings,
    now: () => new Date(clock),
    finished: (result) => ended.push(result),
    headsUp: () => undefined,
    changed: () => undefined,
    log: () => undefined,
  });
  timers.push(timer);
  return { timer, ended };
}

describe('the Focus timer service', () => {
  it('starts, saves, and ends a session as its timeout would', async () => {
    const { timer, ended } = await start();
    timer.command({ kind: 'toggle' });
    expect(timer.state.endsAt).toBe(clock + 25 * MIN);
    await timer.settled();
    const saved = JSON.parse(await readFile(join(base, 'focus-state.json'), 'utf8')) as {
      endsAt: number;
    };
    expect(saved.endsAt).toBe(clock + 25 * MIN);
    clock += 25 * MIN;
    timer.check();
    expect(ended).toMatchObject([{ ended: 'focus', counted: true, quiet: false }]);
    expect(timer.state).toMatchObject({ mode: 'short', endsAt: null, session: 2 });
  });

  it('a session still within its time goes on after a restart', async () => {
    const first = await start();
    first.timer.command({ kind: 'toggle' });
    first.timer.stop();
    await first.timer.settled();
    clock += 10 * MIN;
    const second = await start();
    expect(second.timer.state.endsAt).toBe(clock + 15 * MIN);
    expect(second.ended).toEqual([]);
  });

  it('one that ended while Flint was closed is closed quietly at the start', async () => {
    const first = await start();
    first.timer.command({ kind: 'toggle' });
    first.timer.stop();
    await first.timer.settled();
    clock += 2 * 60 * MIN;
    const second = await start();
    expect(second.ended).toMatchObject([{ ended: 'focus', counted: false, quiet: true }]);
    expect(second.timer.state).toMatchObject({ mode: 'short', endsAt: null, session: 1 });
  });

  it('the toast start waits for nothing that runs; settings change a ready mode only', async () => {
    const { timer } = await start();
    settings = { ...settings, focusMinutes: 50 };
    timer.settingsChanged();
    expect(timer.state.left).toBe(50 * MIN);
    timer.startWaiting();
    const endsAt = timer.state.endsAt;
    timer.startWaiting();
    expect(timer.state.endsAt).toBe(endsAt);
    timer.command({ kind: 'mode', mode: 'long' });
    expect(timer.state).toMatchObject({ mode: 'long', endsAt: null, left: 15 * MIN });
  });
});

describe('Focus toasts (FOCUS-04)', () => {
  it('an ordinary, silent toast with one button through the build scheme', () => {
    const xml = focusToastXml(
      { title: 'Focus session done', body: 'Time for a break', button: 'Start break' },
      { protocol: 'flint-dev', hideText: false },
    );
    expect(xml).toBe(
      '<toast launch="flint-dev://focus/open" activationType="protocol"><visual><binding template="ToastGeneric"><text>Focus session done</text><text>Time for a break</text></binding></visual><actions><action content="Start break" arguments="flint-dev://focus/start" activationType="protocol"/></actions><audio silent="true"/></toast>',
    );
    expect(xml).not.toContain('scenario');
  });

  it('no button for the heads-up; the second line hidden with REM-10', () => {
    const xml = focusToastXml(
      { title: '5 minutes left', body: 'Fix <the> loop', button: null },
      { protocol: 'flint', hideText: true },
    );
    expect(xml).not.toContain('<actions>');
    expect(xml).not.toContain('Fix');
  });

  it('finds the activation in a command line', () => {
    expect(findFocusActivation(['Flint.exe', 'flint://focus/start'], 'flint')).toBe('start');
    expect(findFocusActivation(['flint://focus/open'], 'flint')).toBe('open');
    expect(
      findFocusActivation(['flint://focus/nap', 'flint://reminder/done?id=k3f9'], 'flint'),
    ).toBe(null);
    expect(findFocusActivation(['flint-dev://focus/start'], 'flint')).toBeNull();
  });
});
