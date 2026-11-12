import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { HotkeyName, HotkeysView, RebindOutcome } from '../../shared/ipc.js';
import { acceleratorFor, displayAccelerator, usesAlt } from '../../shared/accelerator.js';

/**
 * APP-08, D-102, D-186: the four global hotkeys, recorded in the `?` sheet (Settings' Capture
 * section only links there and warns while another app holds one).
 */

const DOES: Record<HotkeyName, string> = {
  capture: 'opens the capture popup',
  selection: 'captures the selected text',
  mini: 'shows or hides mini mode',
  miniSelection: 'adds the selected text to mini mode’s note',
};

/** The order the hotkeys are told in (the tray, Capture's warning). */
export const HOTKEY_NAMES: readonly HotkeyName[] = [
  'capture',
  'selection',
  'mini',
  'miniSelection',
];

/** D-102: what a try at new keys said. */
export function explain(outcome: RebindOutcome, name: HotkeyName, accelerator: string): string {
  const keys = displayAccelerator(accelerator);
  switch (outcome) {
    case 'saved':
      return `Saved: ${keys} ${DOES[name]}.${usesAlt(accelerator) ? ' Note: Alt is often a push-to-talk key (Discord).' : ''}`;
    case 'in-use':
      return `${keys} is already used by another app. Try another combination.`;
    case 'needs-modifier':
      return 'Use Ctrl, Alt or Win together with a key.';
    case 'same-as-other':
      return 'That is already another Flint hotkey.';
    case 'invalid':
      return 'Flint cannot use that key. Try another.';
  }
}

/** D-102: a hotkey another app holds, in D-102's words (null: none is taken). */
export function takenText(view: HotkeysView | null, name: HotkeyName): string | null {
  const state = view?.[name];
  if (!state || state.registered) return null;
  return `${displayAccelerator(state.accelerator)} is used by another app, so it doesn't work. Choose another.`;
}

const CHANGED = 'flint:hotkeys-changed';

/** The hotkeys now, loaded once and again whenever the sheet changes one. */
export function useHotkeys(): { readonly view: HotkeysView | null; readonly reload: () => void } {
  const [view, setView] = useState<HotkeysView | null>(null);
  const reload = useCallback((): void => {
    void window.flintMain.hotkeys().then(setView);
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, [reload]);
  return { view, reload };
}

/** Tells every `useHotkeys` in the window that a hotkey changed. */
function hotkeysChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * APP-08, D-102: a global hotkey, recorded in place: click it, press the new keys. Flint tries
 * them at once; if another app owns them, the old hotkey stays and it says so. While recording,
 * the current hotkeys are off; Esc, a click elsewhere or leaving the window cancels.
 */
export function HotkeyButton(props: {
  readonly name: HotkeyName;
  readonly view: HotkeysView | null;
  readonly recording: HotkeyName | null;
  readonly onRecord: (name: HotkeyName | null) => void;
  readonly onSaid: (name: HotkeyName, text: string) => void;
}): ReactElement {
  const { name, view, recording, onRecord, onSaid } = props;
  const state = view?.[name];
  const active = recording === name;
  useEffect(() => {
    if (!active) return;
    window.flintMain.recordingHotkey(true);
    document.body.dataset['recordingHotkey'] = '1';
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        onRecord(null);
        onSaid(name, '');
        return;
      }
      const accelerator = acceleratorFor(event);
      if (!accelerator) return; // only modifiers so far
      void window.flintMain.rebindHotkey(name, accelerator).then((outcome) => {
        onRecord(null);
        if (outcome) onSaid(name, explain(outcome, name, accelerator));
        hotkeysChanged();
      });
    };
    const onBlur = (): void => {
      onRecord(null);
      onSaid(name, '');
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.flintMain.recordingHotkey(false);
      delete document.body.dataset['recordingHotkey'];
    };
  }, [active, name, onRecord, onSaid]);
  const taken = state !== undefined && !state.registered;
  return (
    <button
      type="button"
      className={['keycap', 'hotkey-record', active ? 'recording' : '', taken ? 'taken' : '']
        .filter(Boolean)
        .join(' ')}
      title={taken ? 'Another app uses this combination' : 'Click, then press the new keys'}
      onClick={() => onRecord(active ? null : name)}
    >
      {active ? 'Press the new keys…' : state ? displayAccelerator(state.accelerator) : '…'}
    </button>
  );
}
