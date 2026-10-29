import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { benchmarkList, benchmarkLists, medianDuration } from '@flint/core/bench';
import { parseDocument } from '@flint/core/format';
import { parseCapture } from '@flint/core/shorthand';
import { app, dialog, powerMonitor, screen, shell } from 'electron';
import { runBench, type BenchHooks, type BenchResult } from './bench.js';
import type { CapturePopup } from './popup.js';

/**
 * The R-1 laptop benchmark (docs/06 §1): a separate build (`npm run dist:bench`) that measures the
 * capture popup over a real full-screen Teams call on an average laptop. It installs nothing,
 * registers nothing, keeps its data in `bench-data` next to the exe, and writes its results there.
 */

const TITLE = 'Flint R-1 benchmark';
const ITERATIONS = 50;
const COUNTDOWN_SECONDS = 10;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function teamsRunning(): boolean {
  try {
    const output = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return /^"(ms-teams|Teams)\.exe"/im.test(output);
  } catch {
    return false;
  }
}

function machine(): Record<string, unknown> {
  return {
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    logicalCores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    windows: `${process.getSystemVersion()} (${release()})`,
    onBattery: powerMonitor.isOnBatteryPower(),
    teamsRunning: teamsRunning(),
    displays: screen
      .getAllDisplays()
      .map((display) => `${display.size.width}x${display.size.height} @${display.scaleFactor}x`),
  };
}

/** The M1 measurements that docs/06 asks to repeat on an average laptop (same workload). */
function coreTimings(): Record<string, number> {
  const now = (): number => performance.now();
  const text = benchmarkList();
  const lists = benchmarkLists();
  const at = new Date(2026, 9, 29, 14, 30);
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    parse1000TaskListMs: round(medianDuration(200, () => parseDocument(text), now)),
    shorthandPerKeystrokeMs: round(
      medianDuration(
        5000,
        () =>
          parseCapture('fix token refresh in the importer !h ##unicorn @tomorrow 10', {
            now: at,
            lists,
          }),
        now,
      ),
    ),
  };
}

function report(result: BenchResult, timings: Record<string, number>): string {
  const line = (name: string, value: { p50: number; p95: number; max: number; count: number }) =>
    `${name}: p50 ${value.p50} ms, p95 ${value.p95} ms, max ${value.max} ms (${value.count}/${result.iterations})`;
  return [
    line(
      'Hotkey to focused popup (target < 50 ms, hard limit 100 ms)',
      result.hotkeyToFocusedFrameMs,
    ),
    line('Enter to hidden, focus back (target < 50 ms)', result.enterToHiddenAndFocusReturnedMs),
    `Window in front looked like Teams: ${result.targetLooksLikeTeams ? 'yes' : 'no'}`,
    `Foreground fallback needed: ${result.foregroundFallbackNeeded}`,
    `Failures: ${result.failures.length}${result.stoppedEarly ? `; stopped early: ${result.stoppedEarly}` : ''}`,
    `Parse 1,000-task list: ${timings.parse1000TaskListMs} ms; shorthand per keystroke: ${timings.shorthandPerKeystrokeMs} ms`,
  ].join('\n');
}

export async function runLaptopBench(
  popup: CapturePopup,
  hooks: BenchHooks,
  hotkey: { readonly modifiers: readonly number[]; readonly key: number },
  hotkeyRegistered: boolean,
  log: (message: string) => void,
): Promise<void> {
  if (!hotkeyRegistered) {
    await dialog.showMessageBox({
      type: 'error',
      title: TITLE,
      message: 'Ctrl+Shift+Space is already in use.',
      detail:
        'Another app holds the capture hotkey, often a running Flint. Quit it (Flint: tray icon → Quit Flint) and start the benchmark again. Nothing was measured.',
    });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: TITLE,
    message: 'Measure the capture popup during a Teams call',
    detail: [
      '1. Start a Teams call (Meet now on your own is fine), turn the camera on, mute yourself, and make the meeting window full screen.',
      `2. Click Start, then within ${COUNTDOWN_SECONDS} seconds click on the Teams meeting window.`,
      `3. Don't touch the keyboard or mouse for about a minute. Flint presses Ctrl+Shift+Space ${ITERATIONS} times and closes its popup with Enter; nothing is typed into Teams. If you switch windows, it stops.`,
      '4. The results appear in a window at the end and are saved next to this program.',
      '',
      'To stop early: tray icon → Quit Flint.',
    ].join('\n'),
    buttons: ['Start', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;

  await pause(COUNTDOWN_SECONDS * 1000);
  log('R-1 laptop benchmark started');
  const result = await runBench(popup, hooks, hotkey, ITERATIONS, 'foreground');
  const timings = coreTimings();
  const summary = report(result, timings);
  log(`R-1 laptop benchmark finished\n${summary}`);

  const folder = dirname(app.getPath('exe'));
  const stamp = result.measuredAt.slice(0, 16).replace(/[:T]/g, '-');
  const file = join(folder, `R-1 results ${stamp}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ ...result, coreTimings: timings, machine: machine() }, null, 2)}\n`,
  );
  const { response: next } = await dialog.showMessageBox({
    type: result.stoppedEarly ? 'warning' : 'info',
    title: TITLE,
    message: result.stoppedEarly ? 'Benchmark stopped early' : 'Benchmark finished',
    detail: `${summary}\n\nSaved to:\n${file}`,
    buttons: ['Show the file', 'Close'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (next === 0) shell.showItemInFolder(file);
}
