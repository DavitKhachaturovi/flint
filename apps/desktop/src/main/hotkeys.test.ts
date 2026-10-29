import { describe, expect, it } from 'vitest';
import {
  acceleratorFor,
  displayAccelerator,
  hotkeyProblem,
  usesAlt,
} from '../shared/accelerator.js';
import { acceleratorKeys } from './hotkeys.js';

describe('hotkey keys (CAP-07, APP-08)', () => {
  it('maps accelerators to Windows virtual keys', () => {
    expect(acceleratorKeys('Control+Shift+X')).toEqual({ modifiers: [0x11, 0x10], key: 0x58 });
    expect(acceleratorKeys('Control+Shift+Space')).toEqual({ modifiers: [0x11, 0x10], key: 0x20 });
    expect(acceleratorKeys('CmdOrCtrl+Alt+F12')).toEqual({ modifiers: [0x11, 0x12], key: 0x7b });
    expect(acceleratorKeys('Shift+/')).toEqual({ modifiers: [0x10], key: 0xbf });
    expect(acceleratorKeys('Control+7')).toEqual({ modifiers: [0x11], key: 0x37 });
  });

  it('rejects what it cannot map', () => {
    expect(acceleratorKeys('')).toBeNull();
    expect(acceleratorKeys('Hyper+X')).toBeNull();
    expect(acceleratorKeys('Control+MediaPlayPause')).toBeNull();
  });
});

describe('recording a hotkey (APP-08)', () => {
  const press = (
    code: string,
    mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {},
  ) => ({
    code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  });

  it('turns key presses into accelerators that map to Windows keys', () => {
    expect(acceleratorFor(press('KeyK', { ctrl: true, shift: true }))).toBe('Control+Shift+K');
    expect(acceleratorFor(press('Space', { ctrl: true, alt: true }))).toBe('Control+Alt+Space');
    expect(acceleratorFor(press('Slash', { meta: true }))).toBe('Super+/');
    expect(acceleratorFor(press('F13'))).toBe('F13');
    expect(acceleratorFor(press('ShiftLeft', { shift: true }))).toBeNull();
    for (const accelerator of ['Control+Shift+K', 'Control+Alt+Space', 'Super+/']) {
      expect(acceleratorKeys(accelerator)).not.toBeNull();
    }
  });

  it('needs Ctrl, Alt or Win, and two different hotkeys', () => {
    expect(hotkeyProblem('Shift+K', 'Control+Shift+X')).toBe('needs-modifier');
    expect(hotkeyProblem('F13', 'Control+Shift+X')).toBe('needs-modifier');
    expect(hotkeyProblem('Control+Shift+X', 'control+shift+x')).toBe('same-as-other');
    expect(hotkeyProblem('Control+Shift+K', 'Control+Shift+X')).toBeNull();
    expect(usesAlt('Control+Alt+K')).toBe(true);
    expect(displayAccelerator('Control+Super+K')).toBe('Ctrl+Win+K');
  });
});
