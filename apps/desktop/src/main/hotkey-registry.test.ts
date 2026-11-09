import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Windows' hotkey table, as Electron's globalShortcut sees it: some combinations other apps own. */
const owned = new Set<string>();
const registered = new Map<string, () => void>();
vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, handler: () => void): boolean => {
      if (owned.has(accelerator) || registered.has(accelerator)) return false;
      registered.set(accelerator, handler);
      return true;
    },
    unregister: (accelerator: string): void => {
      registered.delete(accelerator);
    },
  },
}));

const { HotkeyRegistry } = await import('./hotkey-registry.js');

beforeEach(() => {
  owned.clear();
  registered.clear();
});

const create = () =>
  new HotkeyRegistry(
    {
      capture: 'Control+Shift+Space',
      selection: 'Control+Shift+X',
      mini: 'Control+Alt+Space',
      miniSelection: 'Control+Alt+X',
    },
    {
      capture: () => undefined,
      selection: () => undefined,
      mini: () => undefined,
      miniSelection: () => undefined,
    },
  );

describe('rebindable hotkeys with conflict detection (APP-08)', () => {
  it('registers both, and reports one another app owns', () => {
    owned.add('Control+Shift+X');
    const hotkeys = create();
    expect(hotkeys.get('capture')).toEqual({
      accelerator: 'Control+Shift+Space',
      registered: true,
    });
    expect(hotkeys.get('selection')).toEqual({ accelerator: 'Control+Shift+X', registered: false });
  });

  it('keeps the old hotkey when the new one is taken', () => {
    owned.add('Control+Alt+K');
    const hotkeys = create();
    expect(hotkeys.rebind('capture', 'Control+Alt+K')).toEqual({ kind: 'in-use' });
    expect(hotkeys.get('capture')).toEqual({
      accelerator: 'Control+Shift+Space',
      registered: true,
    });
    expect([...registered.keys()].sort()).toEqual([
      'Control+Alt+Space',
      'Control+Alt+X',
      'Control+Shift+Space',
      'Control+Shift+X',
    ]);
  });

  it('switches to a free one and lets the old one go', () => {
    const hotkeys = create();
    expect(hotkeys.rebind('capture', 'Control+Shift+K')).toEqual({ kind: 'saved' });
    expect([...registered.keys()].sort()).toEqual([
      'Control+Alt+Space',
      'Control+Alt+X',
      'Control+Shift+K',
      'Control+Shift+X',
    ]);
  });

  it('refuses Shift-only, unknown keys and the other hotkey', () => {
    const hotkeys = create();
    expect(hotkeys.rebind('capture', 'Shift+K')).toEqual({ kind: 'needs-modifier' });
    expect(hotkeys.rebind('capture', 'Control+Shift+X')).toEqual({ kind: 'same-as-other' });
    expect(hotkeys.rebind('capture', 'Control+MediaPlayPause')).toEqual({ kind: 'invalid' });
    expect(hotkeys.get('capture').accelerator).toBe('Control+Shift+Space');
  });

  it("D-109: mini mode's hotkey, Ctrl+Alt+Space by default, differs from both others", () => {
    const hotkeys = create();
    expect(hotkeys.get('mini')).toEqual({ accelerator: 'Control+Alt+Space', registered: true });
    expect(hotkeys.rebind('mini', 'Control+Shift+Space')).toEqual({ kind: 'same-as-other' });
    expect(hotkeys.rebind('mini', 'Control+Shift+X')).toEqual({ kind: 'same-as-other' });
    expect(hotkeys.rebind('capture', 'Control+Alt+Space')).toEqual({ kind: 'same-as-other' });
    expect(hotkeys.rebind('mini', 'Control+Alt+M')).toEqual({ kind: 'saved' });
  });

  it("D-157: the hotkey into mini mode's note, Ctrl+Alt+X by default, differs from the other three", () => {
    const hotkeys = create();
    expect(hotkeys.get('miniSelection')).toEqual({
      accelerator: 'Control+Alt+X',
      registered: true,
    });
    expect(hotkeys.rebind('miniSelection', 'Control+Alt+Space')).toEqual({
      kind: 'same-as-other',
    });
    expect(hotkeys.rebind('selection', 'Control+Alt+X')).toEqual({ kind: 'same-as-other' });
    expect(hotkeys.rebind('miniSelection', 'Control+Alt+J')).toEqual({ kind: 'saved' });
    expect(registered.has('Control+Alt+X')).toBe(false);
  });

  it('while recording, nothing fires, yet a taken combination is still found', () => {
    owned.add('Control+Alt+K');
    const hotkeys = create();
    hotkeys.pause();
    expect(registered.size).toBe(0);
    expect(hotkeys.rebind('selection', 'Control+Alt+K')).toEqual({ kind: 'in-use' });
    expect(hotkeys.rebind('selection', 'Control+Alt+J')).toEqual({ kind: 'saved' });
    expect(registered.size).toBe(0);
    hotkeys.resume();
    expect([...registered.keys()].sort()).toEqual([
      'Control+Alt+J',
      'Control+Alt+Space',
      'Control+Alt+X',
      'Control+Shift+Space',
    ]);
  });
});
