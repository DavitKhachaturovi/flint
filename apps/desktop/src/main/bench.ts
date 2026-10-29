import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { epochNow, type PopupSubmit } from '../shared/ipc.js';
import type { CapturePopup, FocusSample } from './popup.js';
import {
  forceForeground,
  foregroundWindow,
  handleValue,
  pressKeys,
  VirtualKey,
  windowTitle,
} from './win32.js';

/**
 * R-1 benchmark (docs/06 §1): presses the real global hotkey through Windows (`SendInput`) over a
 * full-screen stand-in window, and measures
 * - key → popup focused and painted (includes Windows delivering the hotkey),
 * - hotkey callback → popup focused and painted,
 * - Enter → popup hidden and focus back on the stand-in (D-27 budget).
 * Enter is only sent once the popup is confirmed in front, so no keystroke can reach another app.
 */

type Focused = FocusSample;
type Captured = PopupSubmit & { readonly hiddenAt: number; readonly returnedAt: number };

export interface BenchHooks {
  waitFocused(timeout: number): Promise<Focused | null>;
  waitCaptured(timeout: number): Promise<Captured | null>;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

function summary(values: readonly number[]): Record<string, number> {
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    count: values.length,
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(...values)),
  };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runBench(
  popup: CapturePopup,
  hooks: BenchHooks,
  hotkey: { readonly modifiers: readonly number[]; readonly key: number },
  iterations: number,
): Promise<void> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const standIn = new BrowserWindow({
    ...display.bounds,
    fullscreen: true,
    backgroundColor: '#202124',
    title: 'Flint R-1 benchmark: stand-in for a full-screen call',
    show: false,
  });
  await standIn.loadURL('data:text/html,<body style="background:%23202124"></body>');
  standIn.show();
  const standInHandle = handleValue(standIn.getNativeWindowHandle());
  await pause(500);
  forceForeground(standInHandle);
  await pause(300);

  const keyToFrame: number[] = [];
  const callbackToFrame: number[] = [];
  const enterToReturned: number[] = [];
  const failures: string[] = [];
  let fallbackNeeded = 0;

  for (let iteration = 0; iteration < iterations; iteration++) {
    if (foregroundWindow() !== standInHandle) {
      forceForeground(standInHandle);
      await pause(200);
    }
    const sentAt = epochNow();
    pressKeys(hotkey.modifiers, hotkey.key);
    const focused = await hooks.waitFocused(1000);
    const inFront = focused?.inFront === true;
    if (focused?.forced) fallbackNeeded++;
    if (!focused || !focused.inputFocused || !inFront) {
      failures.push(
        `#${iteration}: popup ${focused ? 'shown' : 'not shown'}, input focused ${String(focused?.inputFocused)}, in front ${String(inFront)}, fallback ${String(focused?.forced)}, foreground "${windowTitle(foregroundWindow())}"`,
      );
      popup.hide();
      await pause(300);
      continue;
    }
    keyToFrame.push(focused.frameAt - sentAt);
    callbackToFrame.push(focused.frameAt - focused.hotkeyAt);

    await pause(120 + Math.random() * 120);
    const enterAt = epochNow();
    // Safety: only ever type Enter into the popup itself.
    if (foregroundWindow() !== popup.windowHandle) {
      failures.push(
        `#${iteration}: lost the foreground before Enter, to "${windowTitle(foregroundWindow())}"`,
      );
      popup.hide();
      await pause(300);
      continue;
    }
    pressKeys([], VirtualKey.enter);
    const captured = await hooks.waitCaptured(1000);
    if (!captured) {
      failures.push(
        `#${iteration}: Enter not received; foreground "${windowTitle(foregroundWindow())}"`,
      );
      popup.hide();
    } else if (foregroundWindow() !== standInHandle) {
      failures.push(
        `#${iteration}: focus went to "${windowTitle(foregroundWindow())}", not the stand-in`,
      );
    } else {
      enterToReturned.push(captured.returnedAt - enterAt);
    }
    await pause(250 + Math.random() * 250);
  }

  const result = {
    measuredAt: new Date().toISOString(),
    electron: process.versions.electron,
    iterations,
    foregroundFallbackNeeded: fallbackNeeded,
    hotkeyToFocusedFrameMs: summary(keyToFrame),
    callbackToFocusedFrameMs: summary(callbackToFrame),
    enterToHiddenAndFocusReturnedMs: summary(enterToReturned),
    failures,
  };
  const file = join(app.getPath('userData'), 'bench-r1.json');
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`FLINT_BENCH_RESULT ${JSON.stringify(result)}`);
  standIn.destroy();
}
