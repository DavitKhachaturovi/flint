import { describe, expect, it } from 'vitest';
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
