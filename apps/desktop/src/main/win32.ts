import koffi from 'koffi';

/**
 * The few Win32 calls Flint needs, through koffi (docs/05 §1: no native addon to rebuild per Electron
 * version). Window handles are passed as integers (HWND values).
 */

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

type Handle = number | bigint;

const getForegroundWindow = user32.func('uintptr_t GetForegroundWindow()') as () => Handle;
const setForegroundWindow = user32.func('bool SetForegroundWindow(uintptr_t hWnd)') as (
  hwnd: Handle,
) => boolean;
const bringWindowToTop = user32.func('bool BringWindowToTop(uintptr_t hWnd)') as (
  hwnd: Handle,
) => boolean;
const getWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(uintptr_t hWnd, void *lpdwProcessId)',
) as (hwnd: Handle, processId: null) => number;
const attachThreadInput = user32.func(
  'bool AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)',
) as (attach: number, attachTo: number, enable: boolean) => boolean;
const getWindowText = user32.func(
  'int GetWindowTextW(uintptr_t hWnd, _Out_ uint16_t *lpString, int nMaxCount)',
) as (hwnd: Handle, buffer: Uint16Array, max: number) => number;
const getCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()') as () => number;

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t',
});
// INPUT is a union in Windows headers; the keyboard variant padded to the union's 40 bytes on x64.
const INPUT = koffi.struct('INPUT', { type: 'uint32', ki: KEYBDINPUT, padding: 'uint64' });
const sendInput = user32.func('uint32 SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)') as (
  count: number,
  inputs: readonly KeyboardInput[],
  size: number,
) => number;

interface KeyboardInput {
  readonly type: number;
  readonly ki: { wVk: number; wScan: number; dwFlags: number; time: number; dwExtraInfo: number };
  readonly padding: number;
}

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;

export const VirtualKey = {
  control: 0x11,
  alt: 0x12,
  shift: 0x10,
  enter: 0x0d,
  escape: 0x1b,
} as const;

/** The window the user is working in, or 0n. */
export function foregroundWindow(): bigint {
  return BigInt(getForegroundWindow());
}

/** The HWND of an Electron window, as returned by `getNativeWindowHandle()`. */
export function handleValue(native: Buffer): bigint {
  return native.length >= 8 ? native.readBigUInt64LE(0) : BigInt(native.readUInt32LE(0));
}

/** Plain `SetForegroundWindow`: allowed while Flint is in front (e.g. handing focus back on hide). */
export function bringToForeground(hwnd: bigint): boolean {
  return setForegroundWindow(hwnd);
}

/**
 * Brings a window to the front even when Windows' foreground lock refuses a plain
 * `SetForegroundWindow`: attaches to the input queue of the window currently in front, which makes
 * the request come "from" that thread, then detaches. Returns whether the window is now in front.
 */
export function forceForeground(hwnd: bigint): boolean {
  const current = getForegroundWindow();
  if (BigInt(current) === hwnd) return true;
  const ours = getCurrentThreadId();
  const theirs = BigInt(current) === 0n ? 0 : getWindowThreadProcessId(current, null);
  const attached = theirs !== 0 && theirs !== ours && attachThreadInput(ours, theirs, true);
  try {
    bringWindowToTop(hwnd);
    setForegroundWindow(hwnd);
  } finally {
    if (attached) attachThreadInput(ours, theirs, false);
  }
  return foregroundWindow() === hwnd;
}

function key(virtualKey: number, up: boolean): KeyboardInput {
  return {
    type: INPUT_KEYBOARD,
    ki: { wVk: virtualKey, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 },
    padding: 0,
  };
}

/**
 * Presses and releases a key combination as if typed (modifiers down, key down, key up, modifiers up).
 * Used only by the R-1 benchmark. Returns whether Windows accepted every event.
 */
export function pressKeys(modifiers: readonly number[], keyCode: number): boolean {
  const inputs = [
    ...modifiers.map((modifier) => key(modifier, false)),
    key(keyCode, false),
    key(keyCode, true),
    ...[...modifiers].reverse().map((modifier) => key(modifier, true)),
  ];
  return sendInput(inputs.length, inputs, koffi.sizeof(INPUT)) === inputs.length;
}

/** A window's title, for diagnostics (which window holds the foreground). */
export function windowTitle(hwnd: bigint): string {
  if (hwnd === 0n) return '(none)';
  const buffer = new Uint16Array(256);
  const length = getWindowText(hwnd, buffer, buffer.length);
  return String.fromCharCode(...buffer.subarray(0, Math.max(0, length)));
}
