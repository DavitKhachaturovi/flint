/**
 * Global hotkeys as Electron accelerators (`Control+Shift+X`) and the Windows virtual-key codes behind
 * them: capture-selection waits until the user has let go of them before its Ctrl+C (CAP-07), and
 * rebinding checks them (APP-08).
 */

const MODIFIERS: Readonly<Record<string, number>> = {
  control: 0x11,
  ctrl: 0x11,
  commandorcontrol: 0x11,
  cmdorctrl: 0x11,
  shift: 0x10,
  alt: 0x12,
  option: 0x12,
  super: 0x5b,
  meta: 0x5b,
};

const NAMED: Readonly<Record<string, number>> = {
  space: 0x20,
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  backspace: 0x08,
  delete: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  ';': 0xba,
  "'": 0xde,
  '[': 0xdb,
  ']': 0xdd,
  '\\': 0xdc,
  '-': 0xbd,
  '=': 0xbb,
  '`': 0xc0,
};

export interface HotkeyKeys {
  readonly modifiers: readonly number[];
  readonly key: number;
}

/** The keys of an accelerator, or null if Flint can't map it (then it isn't offered, APP-08). */
export function acceleratorKeys(accelerator: string): HotkeyKeys | null {
  const parts = accelerator.split('+').map((part) => part.trim());
  const last = parts.pop();
  if (!last) return null;
  const modifiers: number[] = [];
  for (const part of parts) {
    const code = MODIFIERS[part.toLowerCase()];
    if (code === undefined) return null;
    if (!modifiers.includes(code)) modifiers.push(code);
  }
  const name = last.toLowerCase();
  let key = NAMED[name];
  if (key === undefined && /^[a-z0-9]$/.test(name)) key = name.toUpperCase().charCodeAt(0);
  const fKey = /^f([1-9]|1\d|2[0-4])$/.exec(name);
  if (key === undefined && fKey) key = 0x6f + Number(fKey[1]);
  return key === undefined ? null : { modifiers, key };
}
