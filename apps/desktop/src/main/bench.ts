import { BrowserWindow, screen } from 'electron';
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
 * R-1 benchmark (docs/06 §1): presses the real global hotkey through Windows (`SendInput`) and
 * measures
 * - key → popup focused and painted (includes Windows delivering the hotkey),
 * - hotkey callback → popup focused and painted,
 * - Enter → popup hidden and focus back on the window in front (D-27 budget).
 * The window in front is either a full-screen stand-in (`stand-in`, development runs) or whatever
 * the user brought to the front, e.g. a full-screen Teams call (`foreground`, the laptop benchmark).
 * Only the hotkey and Enter are ever sent, and Enter only once the popup is confirmed in front, so no
 * keystroke can reach another app; in `foreground` mode the run stops if the window in front changes.
 */

type Focused = FocusSample;
type Captured = PopupSubmit & { readonly hiddenAt: number; readonly returnedAt: number };

export interface BenchHooks {
  waitFocused(timeout: number): Promise<Focused | null>;
  waitCaptured(timeout: number): Promise<Captured | null>;
}

export type BenchTarget = 'stand-in' | 'foreground';

export interface Summary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface BenchResult {
  readonly measuredAt: string;
  readonly electron: string;
  readonly target: BenchTarget;
  readonly iterations: number;
  /** In `foreground` mode: the window in front had "Teams" in its title (the title isn't kept). */
  readonly targetLooksLikeTeams: boolean;
  readonly foregroundFallbackNeeded: number;
  readonly hotkeyToFocusedFrameMs: Summary;
  readonly callbackToFocusedFrameMs: Summary;
  readonly enterToHiddenAndFocusReturnedMs: Summary;
  readonly failures: readonly string[];
  /** Why the run ended early, if it did. */
  readonly stoppedEarly: string | null;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? Number.NaN;
}

function summary(values: readonly number[]): Summary {
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    count: values.length,
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(values.length > 0 ? Math.max(...values) : Number.NaN),
  };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A full-screen window standing in for a full-screen call. */
async function openStandIn(): Promise<{ handle: bigint; close: () => void }> {
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
  const handle = handleValue(standIn.getNativeWindowHandle());
  await pause(500);
  forceForeground(handle);
  await pause(300);
  return { handle, close: () => standIn.destroy() };
}

export async function runBench(
  popup: CapturePopup,
  hooks: BenchHooks,
  hotkey: { readonly modifiers: readonly number[]; readonly key: number },
  iterations: number,
  target: BenchTarget = 'stand-in',
): Promise<BenchResult> {
  const standIn = target === 'stand-in' ? await openStandIn() : null;
  const targetHandle = standIn?.handle ?? foregroundWindow();
  const ownWindows = new Set(
    BrowserWindow.getAllWindows().map((window) => handleValue(window.getNativeWindowHandle())),
  );

  const keyToFrame: number[] = [];
  const callbackToFrame: number[] = [];
  const enterToReturned: number[] = [];
  const failures: string[] = [];
  let fallbackNeeded = 0;
  let stoppedEarly: string | null = null;

  if (target === 'foreground' && (targetHandle === 0n || ownWindows.has(targetHandle))) {
    stoppedEarly = 'no other app was in front when the run started';
  }

  for (let iteration = 0; iteration < iterations && !stoppedEarly; iteration++) {
    if (foregroundWindow() !== targetHandle) {
      if (standIn) {
        forceForeground(targetHandle);
        await pause(200);
      } else {
        // Focus may still be on its way back; never take it from an app the user switched to.
        await pause(300);
        if (foregroundWindow() !== targetHandle) {
          stoppedEarly = `the window in front changed (#${iteration}); stopped so no key reaches another app`;
          break;
        }
      }
    }
    const sentAt = epochNow();
    pressKeys(hotkey.modifiers, hotkey.key);
    const focused = await hooks.waitFocused(1000);
    const inFront = focused?.inFront === true;
    if (focused?.forced) fallbackNeeded++;
    if (!focused || !focused.inputFocused || !inFront) {
      failures.push(
        `#${iteration}: popup ${focused ? 'shown' : 'not shown'}, input focused ${String(focused?.inputFocused)}, in front ${String(inFront)}, fallback ${String(focused?.forced)}`,
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
      failures.push(`#${iteration}: lost the foreground before Enter`);
      popup.hide();
      await pause(300);
      continue;
    }
    pressKeys([], VirtualKey.enter);
    const captured = await hooks.waitCaptured(1000);
    if (!captured) {
      failures.push(`#${iteration}: Enter not received`);
      popup.hide();
    } else if (foregroundWindow() !== targetHandle) {
      failures.push(`#${iteration}: focus did not return to the window in front`);
    } else {
      enterToReturned.push(captured.returnedAt - enterAt);
    }
    await pause(250 + Math.random() * 250);
  }
  standIn?.close();

  return {
    measuredAt: new Date().toISOString(),
    electron: process.versions.electron,
    target,
    iterations,
    targetLooksLikeTeams: target === 'foreground' && /teams/i.test(windowTitle(targetHandle)),
    foregroundFallbackNeeded: fallbackNeeded,
    hotkeyToFocusedFrameMs: summary(keyToFrame),
    callbackToFocusedFrameMs: summary(callbackToFrame),
    enterToHiddenAndFocusReturnedMs: summary(enterToReturned),
    failures,
    stoppedEarly,
  };
}
