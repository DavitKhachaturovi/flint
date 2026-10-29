/**
 * Recording a global hotkey (APP-08): a key press as an Electron accelerator, and the rules a
 * hotkey must meet. Pure, shared by the hotkeys window and the main process.
 */

export interface KeyPress {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

const PUNCTUATION: Readonly<Record<string, string>> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

const NAMED = new Set([
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** The key part of an accelerator for a `KeyboardEvent.code`, or null for modifiers and the rest. */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1] ?? null;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (NAMED.has(code)) return code;
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (arrow) return arrow[1] ?? null;
  return PUNCTUATION[code] ?? null;
}

/** `Control+Shift+X` for a key press, or null while only modifiers are held. */
export function acceleratorFor(press: KeyPress): string | null {
  const key = keyName(press.code);
  if (!key) return null;
  return [
    press.ctrlKey ? 'Control' : '',
    press.altKey ? 'Alt' : '',
    press.shiftKey ? 'Shift' : '',
    press.metaKey ? 'Super' : '',
    key,
  ]
    .filter((part) => part !== '')
    .join('+');
}

export type HotkeyProblem = 'needs-modifier' | 'same-as-other';

/**
 * A global hotkey needs Ctrl, Alt or Win: with Shift alone it would swallow capital letters in
 * every app. The two hotkeys must differ.
 */
export function hotkeyProblem(accelerator: string, other: string): HotkeyProblem | null {
  const parts = accelerator.split('+');
  if (!parts.some((part) => ['Control', 'Alt', 'Super'].includes(part))) return 'needs-modifier';
  if (accelerator.toLowerCase() === other.toLowerCase()) return 'same-as-other';
  return null;
}

/** Alt is a common push-to-talk key (Discord): a hotkey with it would key the microphone (Q-03). */
export function usesAlt(accelerator: string): boolean {
  return accelerator.split('+').includes('Alt');
}

/** How a hotkey reads in Flint: `Ctrl+Shift+Space`, `Win+K`. */
export function displayAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => (part === 'Control' ? 'Ctrl' : part === 'Super' ? 'Win' : part))
    .join('+');
}
