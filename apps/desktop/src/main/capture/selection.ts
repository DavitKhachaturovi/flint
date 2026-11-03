import { clipboard, ClipboardItem } from 'electron';
import type { HotkeyKeys } from '../hotkeys.js';
import {
  clipboardSequence,
  foregroundWindow,
  isKeyDown,
  isProcessElevated,
  pressKeys,
  releaseKeys,
  VirtualKey,
  windowProcessId,
} from '../win32.js';

/**
 * Capture-selection (CAP-07, R-2, docs/05 §5): copies what is selected in the app in front with a
 * simulated Ctrl+C, then puts the user's clipboard back. Windows blocks simulated keys into
 * administrator windows when Flint isn't one (UIPI); that case is told apart so the popup can say so.
 */

export type Selection =
  | { readonly kind: 'text'; readonly text: string }
  /** Nothing came back from Ctrl+C: nothing was selected, or the app doesn't copy that way. */
  | { readonly kind: 'empty' }
  /** The app in front runs as administrator; Flint's Ctrl+C can't reach it. */
  | { readonly kind: 'elevated' };

/** The clipboard's items, every format Electron can read, to be written back in one go. */
type SavedClipboard = readonly Record<string, Blob | Electron.ClipboardBookmark>[];

const KEY_C = 0x43;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs: number, stepMs = 10): Promise<boolean> {
  for (let waited = 0; waited <= timeoutMs; waited += stepMs) {
    if (condition()) return true;
    await pause(stepMs);
  }
  return condition();
}

/**
 * The clipboard as it is, to put back afterwards (also the end-to-end tests' save and restore
 * around a step that writes to it, D-93). Null when it can't be read: then nothing is put back
 * (an unread clipboard must never be cleared).
 */
export async function saveClipboard(): Promise<SavedClipboard | null> {
  try {
    const items = await clipboard.read();
    return await Promise.all(
      items.map(async (item) => {
        const entries = await Promise.all(
          // `getType` is typed per MIME type; every type comes back as one of these two.
          item.types.map(async (type) => [type, await item.getType(type as 'text/plain')] as const),
        );
        return Object.fromEntries(entries);
      }),
    );
  } catch {
    return null;
  }
}

export async function restoreClipboard(saved: SavedClipboard | null): Promise<void> {
  if (!saved) return;
  // An item without any format (seen on the build agent's empty clipboard) can't be written back.
  const items = saved.filter((item) => Object.keys(item).length > 0);
  if (items.length === 0) clipboard.clear();
  else await clipboard.write(items.map((item) => new ClipboardItem(item)));
}

export async function captureSelection(hotkey: HotkeyKeys): Promise<Selection> {
  const keys = [...hotkey.modifiers, hotkey.key];
  // Ctrl+C sent while Shift is still held would reach the app as Ctrl+Shift+C (docs/05 §5).
  if (!(await until(() => keys.every((key) => !isKeyDown(key)), 600))) releaseKeys(keys);

  const saved = await saveClipboard();
  const before = clipboardSequence();
  pressKeys([VirtualKey.control], KEY_C);
  const copied = await until(() => clipboardSequence() !== before, 300);
  if (!copied) {
    const processId = windowProcessId(foregroundWindow());
    const blocked =
      processId !== 0 && isProcessElevated(processId) && !isProcessElevated(process.pid);
    return { kind: blocked ? 'elevated' : 'empty' };
  }
  try {
    // Apps put several formats on the clipboard one after another; give them a moment.
    await pause(30);
    const text = await clipboard.readText();
    return text.trim() === '' ? { kind: 'empty' } : { kind: 'text', text };
  } finally {
    await restoreClipboard(saved);
  }
}
