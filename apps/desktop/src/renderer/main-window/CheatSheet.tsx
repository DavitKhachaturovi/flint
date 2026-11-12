import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { durationMs } from '../ui/motion.js';
import type { HotkeyName, HotkeysView } from '../../shared/ipc.js';
import { displayAccelerator } from '../../shared/accelerator.js';
import { SHORTCUTS, type Shortcut, type ShortcutGroup } from '../../shared/shortcuts.js';
import { HotkeyButton, takenText, useHotkeys } from './Hotkeys.js';

/** A shortcut's keys as shown: a global hotkey's are the ones set now (D-186). */
function keysOf(shortcut: Shortcut, hotkeys: HotkeysView | null): string {
  const state = shortcut.hotkey ? hotkeys?.[shortcut.hotkey] : undefined;
  return state ? displayAccelerator(state.accelerator) : shortcut.keys;
}

/** The groups and shortcuts a filter keeps (a group's name or keywords keep all of it). */
export function filterShortcuts(
  filter: string,
  hotkeys: HotkeysView | null,
): readonly ShortcutGroup[] {
  const text = filter.trim().toLowerCase();
  return SHORTCUTS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.filter(
      (shortcut) =>
        text === '' ||
        `${group.name} ${group.keywords ?? ''}`.toLowerCase().includes(text) ||
        `${keysOf(shortcut, hotkeys)} ${shortcut.keys} ${shortcut.action}`
          .toLowerCase()
          .includes(text),
    ),
  })).filter((group) => group.shortcuts.length > 0);
}

/**
 * NAV-02, D-80, D-106: the `?` sheet: every shortcut on a card like the palette's, in two columns
 * by group; typing narrows it down. `?` (with the field empty) or Esc closes it. D-186: the
 * Anywhere in Windows group is where the global hotkeys change: click a key cap, press the new
 * keys (Esc cancels), with D-102's rules, conflict check and messages under the row. Opened from
 * Settings' search, it starts filtered by that search when the words match something here.
 */
export function CheatSheet(props: {
  readonly onClose: () => void;
  readonly filter?: string;
}): ReactElement {
  const { onClose } = props;
  const hotkeys = useHotkeys();
  const [filter, setFilter] = useState(() =>
    props.filter && filterShortcuts(props.filter, null).length > 0 ? props.filter.trim() : '',
  );
  const [leaving, setLeaving] = useState(false);
  const [recording, setRecording] = useState<HotkeyName | null>(null);
  const [said, setSaid] = useState<Partial<Record<HotkeyName, string>>>({});
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => field.current?.focus(), []);
  // It goes when its way out ends, or a moment later in a window that isn't drawing (hidden).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(
      () => onCloseRef.current(),
      durationMs('--fl-dur-base', 200) + 150,
    );
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const close = (): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose();
    else setLeaving(true);
  };
  const onRecord = useCallback((name: HotkeyName | null): void => {
    setRecording(name);
    if (name) setSaid({});
    // Back to the filter once the keys are pressed (or Esc), so the sheet's keys work again.
    else field.current?.focus({ preventScroll: true });
  }, []);
  const onSaid = useCallback(
    (name: HotkeyName, text: string): void => setSaid((current) => ({ ...current, [name]: text })),
    [],
  );
  const groups = filterShortcuts(filter, hotkeys.view);
  return (
    <div
      className={leaving ? 'palette-layer leaving' : 'palette-layer'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="palette cheat-sheet"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onKeyDown={(event) => {
          // A key cap has the focus after a click: Esc still closes the sheet.
          if (event.key === 'Escape' && event.target !== field.current) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="palette-head">
          <span className="palette-crumb">Keyboard shortcuts</span>
          <input
            ref={field}
            className="palette-field"
            value={filter}
            placeholder="Find a shortcut"
            aria-label="Find a shortcut"
            spellCheck={false}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || (event.key === '?' && filter === '')) {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          />
          <span className="keycap">Esc</span>
        </div>
        <div className="cheat-columns">
          {groups.length === 0 && <p className="palette-empty">No shortcut matches.</p>}
          {groups.map((group) => {
            const editable = group.shortcuts.some((shortcut) => shortcut.hotkey);
            return (
              <section key={group.name} className="cheat-group" aria-label={group.name}>
                <div className="palette-label">
                  {group.name}
                  {editable && <span className="cheat-hint">Click a key to change it</span>}
                </div>
                {group.shortcuts.map((shortcut) =>
                  shortcut.hotkey ? (
                    <HotkeyRow
                      key={shortcut.hotkey}
                      name={shortcut.hotkey}
                      action={shortcut.action}
                      view={hotkeys.view}
                      recording={recording}
                      said={said[shortcut.hotkey] ?? ''}
                      onRecord={onRecord}
                      onSaid={onSaid}
                    />
                  ) : (
                    <div key={shortcut.keys + shortcut.action} className="cheat-row">
                      <span className="cheat-action">{shortcut.action}</span>
                      <span className="keycap">{shortcut.keys}</span>
                    </div>
                  ),
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** D-186: one global hotkey in the sheet, and what its last try said (a line under it). */
function HotkeyRow(props: {
  readonly name: HotkeyName;
  readonly action: string;
  readonly view: HotkeysView | null;
  readonly recording: HotkeyName | null;
  readonly said: string;
  readonly onRecord: (name: HotkeyName | null) => void;
  readonly onSaid: (name: HotkeyName, text: string) => void;
}): ReactElement {
  const { name, action, view, recording, said, onRecord, onSaid } = props;
  const taken = recording === name ? null : takenText(view, name);
  const text = recording === name ? 'Esc cancels.' : said || taken || '';
  const warning =
    taken !== null && text === taken
      ? true
      : /already|Use Ctrl|cannot use/.test(text) && recording !== name;
  return (
    <>
      <div className="cheat-row cheat-hotkey">
        <span className="cheat-action">{action}</span>
        <HotkeyButton
          name={name}
          view={view}
          recording={recording}
          onRecord={onRecord}
          onSaid={onSaid}
        />
      </div>
      {text && (
        // D-89: a new message fades in (keyed by its text).
        <div key={text} className={warning ? 'cheat-said settings-warning' : 'cheat-said'}>
          {text}
        </div>
      )}
    </>
  );
}
