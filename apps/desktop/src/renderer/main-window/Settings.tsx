import { updateStatus, type UpdateView } from '../../shared/updates.js';
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  HotkeyName,
  HotkeysView,
  RebindOutcome,
  SettingChange,
  SettingsView,
  FolderChange,
  FolderChoice,
  ClaudeState,
} from '../../shared/ipc.js';
import { acceleratorFor, displayAccelerator, usesAlt } from '../../shared/accelerator.js';
import { SHORTCUTS } from '../../shared/shortcuts.js';
import { syncedAgo, type SyncMode, type SyncStatusView } from '../../shared/sync.js';
import { CloudIcon } from './icons.js';
import { clipboardChanged } from './ClipboardSection.js';
import {
  compileLinkPatterns,
  fixedPartProblem,
  inferLinkPattern,
  LINK_PRESETS,
  patternFromPreset,
  presetSample,
  shortFormOf,
  suggestShortForm,
  type LinkPattern,
} from '../../shared/link-patterns.js';

/**
 * Settings (APP-11, D-100): one scrolling page, its sections as cards, a slim index in the side
 * panel's place (on wide screens) that jumps between them and marks the one in view; a filter
 * at the top (Ctrl+F) finds a setting. Every change applies at once.
 */

export const SETTINGS_SECTIONS = [
  { id: 'general', name: 'General' },
  { id: 'capture', name: 'Capture & hotkeys' },
  { id: 'reminders', name: 'Reminders' },
  { id: 'mini', name: 'Mini mode' },
  { id: 'today', name: 'Today & lists' },
  { id: 'sync', name: 'Sync' },
  { id: 'links', name: 'Links' },
  { id: 'clipboard', name: 'Clipboard' },
  { id: 'claude', name: 'Claude' },
  { id: 'data', name: 'Data' },
  { id: 'appearance', name: 'Appearance' },
  { id: 'shortcuts', name: 'Keyboard shortcuts' },
  { id: 'about', name: 'About' },
] as const;

type SectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Switch(props: {
  readonly on: boolean;
  readonly label: string;
  readonly onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      className={props.on ? 'switch on' : 'switch'}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

function Choice<T extends string | number | boolean | null>(props: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly label: string;
  readonly onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="trash-tabs settings-choice" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={option.value === props.value ? 'trash-tab on' : 'trash-tab'}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One setting: its name, what it does, its control; hidden while the filter doesn't match. */
interface RowProps {
  readonly name: string;
  readonly note?: ReactNode;
  readonly filter: string;
  /** More words the filter finds it by. */
  readonly words?: string;
  readonly children?: ReactNode;
  /** SYNC-01: a tile before the name (the Google account, the cloud). */
  readonly lead?: ReactNode;
  readonly className?: string;
}

function Row(props: RowProps): ReactElement | null {
  const { name, note, filter, words = '', children, lead } = props;
  const haystack = `${name} ${typeof note === 'string' ? note : ''} ${words}`.toLowerCase();
  if (filter !== '' && !haystack.includes(filter)) return null;
  const text = (
    <div className="settings-text">
      <span className="settings-name">{name}</span>
      {note && <span className="settings-note">{note}</span>}
    </div>
  );
  return (
    <div className={props.className ? `settings-row ${props.className}` : 'settings-row'}>
      {lead ? (
        <div className="settings-lead">
          {lead}
          {text}
        </div>
      ) : (
        text
      )}
      {children && <div className="settings-control">{children}</div>}
    </div>
  );
}

function Section(props: {
  readonly id: SectionId;
  readonly filter: string;
  /** Whether it has anything for the filter, when its rows can't say (the shortcuts). */
  readonly matches?: boolean;
  readonly children: ReactNode;
}): ReactElement | null {
  const name = SETTINGS_SECTIONS.find((section) => section.id === props.id)?.name ?? '';
  const rows = Children.toArray(props.children).filter(
    (child): child is ReactElement<RowProps> =>
      isValidElement<RowProps>(child) && child.type === Row,
  );
  // While filtering, a section shows only if a row of it (or its name) matches.
  const any =
    props.filter === '' ||
    props.matches === true ||
    name.toLowerCase().includes(props.filter) ||
    rows.some((row) => {
      const { name: rowName, note, words = '' } = row.props;
      return `${rowName} ${typeof note === 'string' ? note : ''} ${words}`
        .toLowerCase()
        .includes(props.filter);
    });
  if (!any) return null;
  return (
    <section className="card settings-section" id={`settings-${props.id}`} aria-label={name}>
      <div className="panel-label settings-section-label">{name}</div>
      {name.toLowerCase().includes(props.filter) && props.filter !== ''
        ? withFilter(props.children, '')
        : props.children}
    </section>
  );
}

/** A section found by its own name shows all its rows. */
function withFilter(children: ReactNode, filter: string): ReactNode {
  return Children.map(children, (child) =>
    isValidElement<RowProps>(child) && child.type === Row ? cloneElement(child, { filter }) : child,
  );
}

const CHIME_URL = new URL('./sounds/chime.wav', import.meta.url).href;

const DOES: Record<HotkeyName, string> = {
  capture: 'opens the capture popup',
  selection: 'captures the selected text',
  mini: 'shows or hides mini mode',
  miniSelection: 'adds the selected text to mini mode’s note',
};

/** D-109: each global hotkey's row; D-157: the fourth, into mini mode's note. */
const HOTKEY_ROWS: Readonly<Record<HotkeyName, string>> = {
  capture: 'Quick capture',
  selection: 'Capture the selected text',
  mini: 'Show or hide mini mode',
  miniSelection: 'Capture the selected text into mini mode’s note',
};

/** What each row says at rest. */
const HOTKEY_NOTES: Readonly<Record<HotkeyName, string>> = {
  capture: 'Works over any app, even in a full-screen call. Click to change.',
  selection: 'Works over any app, even in a full-screen call. Click to change.',
  mini: 'Works over any app, even in a full-screen call. Click to change.',
  // D-157: on layouts where AltGr stands for Ctrl+Alt, AltGr+X types a character in some apps.
  miniSelection:
    'Adds it to the end of the Note tab, code as a code block. If AltGr+X types a character on your keyboard layout, choose another combination. Click to change.',
};

function explain(outcome: RebindOutcome, name: HotkeyName, accelerator: string): string {
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

/**
 * APP-08, D-102: a global hotkey, recorded in place: click it, press the new keys. Flint tries
 * them at once; if another app owns them, the old hotkey stays and it says so. While recording,
 * the current hotkeys are off; Esc, a click elsewhere or leaving the window cancels.
 */
function HotkeyButton(props: {
  readonly name: HotkeyName;
  readonly view: HotkeysView | null;
  readonly recording: HotkeyName | null;
  readonly onRecord: (name: HotkeyName | null) => void;
  readonly onSaid: (name: HotkeyName, text: string) => void;
  readonly onChanged: () => void;
}): ReactElement {
  const { name, view, recording, onRecord, onSaid, onChanged } = props;
  const state = view?.[name];
  const active = recording === name;
  useEffect(() => {
    if (!active) return;
    window.flintMain.recordingHotkey(true);
    document.body.dataset['recordingHotkey'] = '1';
    const stop = (): void => {
      window.flintMain.recordingHotkey(false);
      delete document.body.dataset['recordingHotkey'];
    };
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
        onChanged();
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
      stop();
    };
  }, [active, name, onRecord, onSaid, onChanged]);
  return (
    <button
      type="button"
      className={[
        'keycap',
        'hotkey-record',
        active ? 'recording' : '',
        state && !state.registered ? 'taken' : '',
      ].join(' ')}
      title={
        state && !state.registered
          ? 'Another app uses this combination'
          : 'Click, then press the new keys'
      }
      onClick={() => onRecord(active ? null : name)}
    >
      {active ? 'Press the new keys…' : state ? displayAccelerator(state.accelerator) : '…'}
    </button>
  );
}

export function SettingsScreen(props: {
  readonly onToast: (text: string) => void;
  readonly onSnapshots: () => void;
  /** NOTE-07, D-104: link patterns saved in Settings → Links, for the window to use at once. */
  readonly onLinkPatterns: (patterns: readonly LinkPattern[]) => void;
  /** D-105: the built-in recognizers turned off there. */
  readonly onBuiltInLinksOff: (off: readonly string[]) => void;
  /** TASK-18, D-151: the task lists (Settings → Claude names them), and their folders changed. */
  readonly claudeLists: readonly { readonly id: string; readonly name: string }[];
  readonly onClaudeFolders: (folders: Readonly<Record<string, string>>) => void;
  /** D-102: the interface size now, and setting an exact one. */
  readonly zoom: number;
  readonly onZoom: (level: number) => void;
  /** Bumped by Ctrl+F: the filter takes the caret. */
  readonly find: number;
  /** APP-10, D-112: the walkthrough again, from its first step. */
  readonly onReplayTour: () => void;
  /** APP-15, D-117: What's new, every version's. */
  readonly onWhatsNew: () => void;
  /** APP-06, D-136: what the updater is doing (About's status line and button). */
  readonly updates: UpdateView;
  /** SYNC-01, D-161: Google Drive sync (Settings → Sync). */
  readonly sync: SyncStatusView;
  /** "3 lists, 1 note, 1 group" and the chosen items' names. */
  readonly syncSummary: string;
  readonly syncChosen: string;
  /** Needs attention: the problem and its action. */
  readonly syncProblem: ReactNode;
  readonly onSyncChoose: () => void;
  readonly onSyncDisconnect: () => void;
  readonly onSyncMode: (mode: SyncMode) => void;
}): ReactElement {
  const { onToast, onSnapshots, onLinkPatterns, onBuiltInLinksOff, zoom, onZoom, find } = props;
  const { onReplayTour, onWhatsNew, updates } = props;
  const { sync } = props;
  const [syncNow, setSyncNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setSyncNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const syncAct = (action: Parameters<typeof window.flintMain.syncAct>[0]): void =>
    void window.flintMain.syncAct(action);
  /** Settings → Sync's rows for the state sync is in (D-161, mockup 13). */
  const syncRows = (): ReactNode => {
    const words = 'sync google drive cloud account devices backup';
    const cloudTile = (
      <span className="tile sync-settings-tile">
        <CloudIcon size={18} width={1.9} />
      </span>
    );
    if (
      sync.phase === 'unavailable' ||
      sync.phase === 'disconnected' ||
      sync.phase === 'signing-in'
    ) {
      const note =
        sync.phase === 'unavailable'
          ? 'Not set up in this build.'
          : sync.phase === 'signing-in'
            ? 'Waiting for Google… Finish signing in in your browser.'
            : 'Keep chosen lists and notes in step across your devices, through your own Drive.';
      return [
        <Row
          key="connect"
          name="Sync with Google Drive"
          note={note}
          lead={cloudTile}
          filter={filter}
          words={words}
        >
          {sync.phase === 'disconnected' && (
            <button
              type="button"
              className="primary-button"
              onClick={() => syncAct({ kind: 'connect' })}
            >
              Connect Google Drive
            </button>
          )}
          {sync.phase === 'signing-in' && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => syncAct({ kind: 'cancel-connect' })}
            >
              Cancel
            </button>
          )}
        </Row>,
        <Row
          key="privacy"
          name=""
          className="sync-privacy"
          note="Only what you choose to sync goes to your own Google Drive. Nothing else leaves this PC, and Flint has no server of its own."
          filter={filter}
          words={`${words} privacy`}
        />,
      ];
    }
    const letter = (sync.email ?? '?').slice(0, 1).toUpperCase();
    const state =
      sync.phase === 'syncing'
        ? 'syncing…'
        : sync.phase === 'offline'
          ? "offline · changes sync when you're back"
          : sync.phase === 'attention'
            ? `needs attention · ${sync.problem?.message ?? ''}`
            : `last synced ${syncedAgo(sync.lastSync, syncNow)}`;
    return [
      <Row
        key="account"
        name="Google Drive"
        note={`Connected as ${sync.email ?? ''} · ${state}`}
        lead={<span className="sync-account">{letter}</span>}
        filter={filter}
        words={words}
      >
        <span className="settings-buttons">
          <button
            type="button"
            className="secondary-button"
            disabled={sync.phase === 'syncing'}
            onClick={() => syncAct({ kind: 'sync-now' })}
          >
            Sync now
          </button>
          <button type="button" className="quiet-button" onClick={props.onSyncDisconnect}>
            Disconnect
          </button>
        </span>
      </Row>,
      ...(sync.problem
        ? [
            <Row
              key="problem"
              name="Needs attention"
              note={props.syncProblem}
              filter={filter}
              words={words}
            />,
          ]
        : []),
      <Row
        key="what"
        name="What syncs"
        note="Everything, or only the lists, notes and groups you choose. Turn sync on or off for one item from its right-click menu."
        filter={filter}
        words={`${words} everything chosen`}
      >
        <Choice
          label="What syncs"
          value={sync.mode ?? 'chosen'}
          options={[
            { value: 'everything', label: 'Everything' },
            { value: 'chosen', label: 'Chosen items' },
          ]}
          onChange={(mode) => {
            if (mode !== sync.mode) props.onSyncMode(mode);
          }}
        />
      </Row>,
      ...(sync.mode === 'chosen'
        ? [
            <Row
              key="chosen"
              name="Chosen items"
              note={`${props.syncSummary}: ${props.syncChosen}`}
              filter={filter}
              words={`${words} chosen choose`}
            >
              <button type="button" className="secondary-button" onClick={props.onSyncChoose}>
                Choose…
              </button>
            </Row>,
          ]
        : []),
      <Row
        key="folder"
        name="Drive folder"
        note={
          <>
            <span className="sync-folder-path">{sync.folderPath ?? 'My Drive › Flint'}</span>
            <br />
            Plain markdown files. Flint can only see files it created there.
          </>
        }
        filter={filter}
        words={`${words} folder my drive open`}
      >
        <button
          type="button"
          className="secondary-button"
          disabled={sync.folderId === null}
          onClick={() => syncAct({ kind: 'open-drive' })}
        >
          Open in Drive
        </button>
      </Row>,
      <Row
        key="privacy"
        name=""
        className="sync-privacy"
        note="Only what you choose to sync goes to your own Google Drive. Nothing else leaves this PC, and Flint has no server of its own."
        filter={filter}
        words={`${words} privacy`}
      />,
    ];
  };
  // DATA-07, D-104: a folder chosen to become the Flint folder (asked in its row).
  const [folderChoice, setFolderChoice] = useState<(FolderChoice & { at: number }) | null>(null);
  // NOTE-07, D-104: the link-pattern editor open.
  const [addingLink, setAddingLink] = useState(false);
  // D-102: the levels offered (Ctrl+= and Ctrl+− reach the rest, 67–200 %).
  const sizes = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
  const size = sizes.find((level) => Math.abs(level - zoom) < 0.001);
  const [view, setView] = useState<SettingsView | null>(null);
  // D-102: the hotkeys, the one being recorded, and what the last try said.
  const [hotkeys, setHotkeys] = useState<HotkeysView | null>(null);
  const [recording, setRecording] = useState<HotkeyName | null>(null);
  const [said, setSaid] = useState<Partial<Record<HotkeyName, string>>>({});
  const loadHotkeys = useCallback((): void => {
    void window.flintMain.hotkeys().then(setHotkeys);
  }, []);
  const onSaid = useCallback(
    (name: HotkeyName, text: string): void => setSaid((current) => ({ ...current, [name]: text })),
    [],
  );
  const [space, setSpace] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void window.flintMain.settings().then(setView);
    void window.flintMain.snapshotSpace().then(setSpace);
    loadHotkeys();
  }, [loadHotkeys]);
  useEffect(() => {
    if (find > 0) field.current?.focus();
  }, [find]);
  const set = (change: SettingChange, then?: () => void): void => {
    void window.flintMain.setSetting(change).then((next) => {
      if (next) setView(next);
      then?.();
    });
  };
  const filter = query.trim().toLowerCase();
  const megabytes =
    space === null ? '…' : `${(space / 1_048_576).toFixed(space < 10_485_760 ? 1 : 0)} MB`;
  if (!view) return <div className="settings" />;
  const osReduced = reducedMotion();
  return (
    <div className="settings">
      <header className="list-header settings-header">
        <h1>Settings</h1>
        <input
          ref={field}
          className="settings-find"
          value={query}
          placeholder="Find a setting"
          aria-label="Find a setting"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('');
              event.currentTarget.blur();
            }
          }}
        />
      </header>

      <Section id="general" filter={filter}>
        <Row
          name="Start with Windows"
          note="Flint waits in the tray, so your hotkey and reminders work from the moment you sign in."
          filter={filter}
          words="autostart login tray"
        >
          <Switch
            on={view.startWithWindows}
            label="Start with Windows"
            onChange={(on) => set({ key: 'startWithWindows', value: on })}
          />
        </Row>
        <Row
          name="Flint folder"
          note={<span className="settings-path">{view.flintFolder}</span>}
          filter={filter}
          words="folder location path files markdown move change"
        >
          <button
            type="button"
            className="trash-action"
            onClick={() => void window.flintMain.openFolder('flint')}
          >
            Open folder
          </button>
          <button
            type="button"
            className="trash-action"
            onClick={() =>
              void window.flintMain.chooseFolder().then((choice) => {
                if (choice) setFolderChoice({ ...choice, at: Date.now() });
              })
            }
          >
            Change…
          </button>
        </Row>
        {folderChoice && (
          <FolderChangePanel
            key={folderChoice.at}
            choice={folderChoice}
            onChooseAgain={() =>
              void window.flintMain.chooseFolder().then((choice) => {
                if (choice) setFolderChoice({ ...choice, at: Date.now() });
              })
            }
            onCancel={() => setFolderChoice(null)}
          />
        )}
      </Section>

      <Section id="capture" filter={filter}>
        {(['capture', 'selection', 'mini', 'miniSelection'] as const).map((name) => (
          <Row
            key={name}
            name={HOTKEY_ROWS[name]}
            note={(() => {
              const taken = hotkeys !== null && !hotkeys[name].registered;
              const text =
                said[name] ||
                (taken && hotkeys
                  ? `${displayAccelerator(hotkeys[name].accelerator)} is used by another app, so it doesn't work. Choose another.`
                  : recording === name
                    ? 'Esc cancels.'
                    : HOTKEY_NOTES[name]);
              // D-89: a new message fades in (keyed by its text).
              return (
                <span
                  key={text}
                  className={taken ? 'settings-said settings-warning' : 'settings-said'}
                >
                  {text}
                </span>
              );
            })()}
            filter={filter}
            words="hotkey shortcut rebind popup selection mini"
          >
            <HotkeyButton
              name={name}
              view={hotkeys}
              recording={recording}
              onRecord={setRecording}
              onSaid={onSaid}
              onChanged={loadHotkeys}
            />
          </Row>
        ))}
        <Row
          name="Hide the capture popup from screen sharing"
          note="You still see it; a shared screen or a recording doesn't (Windows 10 2004 or later)."
          filter={filter}
          words="screen share teams recording privacy capture popup"
        >
          <Switch
            on={view.popupHideFromSharing}
            label="Hide the capture popup from screen sharing"
            onChange={(on) => set({ key: 'popupHideFromSharing', value: on })}
          />
        </Row>
      </Section>

      <Section id="mini" filter={filter}>
        <Row
          name="Hide from screen sharing"
          note="Mini mode stays on your screen but isn't in a shared screen or a recording (Windows 10 2004 or later)."
          filter={filter}
          words="mini mode screen share teams recording privacy"
        >
          <Switch
            on={view.miniHideFromSharing}
            label="Hide mini mode from screen sharing"
            onChange={(on) => set({ key: 'miniHideFromSharing', value: on })}
          />
        </Row>
        <Row
          name="Show reminders in Flint"
          note="Besides the Windows notification: a card with Done, Snooze and Open in mini mode."
          filter={filter}
          words="mini mode reminders alert card notification"
        >
          <Choice
            label="Show reminders in Flint"
            value={view.miniReminders}
            options={[
              { value: 'when-open', label: "In mini mode when it's open" },
              { value: 'always', label: 'Always, opening mini mode' },
            ]}
            onChange={(value) => set({ key: 'miniReminders', value })}
          />
        </Row>
      </Section>

      <Section id="reminders" filter={filter}>
        <Row
          name="Notifications"
          note="A reminder shows as a Windows notification with Done, Snooze and Open. Off, reminders still wait in Today's Overdue card."
          filter={filter}
          words="toast reminders"
        >
          <Switch
            on={view.notifications}
            label="Notifications"
            onChange={(on) => set({ key: 'notifications', value: on })}
          />
        </Row>
        <Row
          name="Reminder sound"
          note="Flint chime: heard even when Do Not Disturb or Focus silences notifications."
          filter={filter}
          words="chime audio windows sound do not disturb focus"
        >
          <Choice
            label="Reminder sound"
            value={view.reminderSound}
            options={[
              { value: false, label: 'Windows sound' },
              { value: true, label: 'Flint chime' },
            ]}
            onChange={(value) => set({ key: 'reminderSound', value })}
          />
          <button
            type="button"
            className="trash-action"
            onClick={() => {
              const sound = new Audio(CHIME_URL);
              sound.volume = 0.7;
              void sound.play().catch(() => undefined);
            }}
          >
            Play
          </button>
        </Row>
        {(filter === '' ||
          'chime sound'.includes(filter) ||
          'reminder sound'.includes(filter) ||
          'do not disturb'.includes(filter)) && (
          <div className="settings-info">
            <strong>Why Flint's chime:</strong> when Windows' Do Not Disturb or Focus holds
            notifications back, it silences their sound too, so a reminder can pass unheard. Flint
            plays its chime itself, and Windows doesn't silence it, so you still hear the reminder.
            The notification itself then goes quiet, so you never hear two sounds.
          </div>
        )}
        <Row
          name="Hide task text in notifications"
          note="The notification says only “Flint reminder”, so nothing shows while you share your screen."
          filter={filter}
          words="privacy screen share"
        >
          <Switch
            on={view.hideNotificationText}
            label="Hide task text in notifications"
            onChange={(on) => set({ key: 'hideNotificationText', value: on })}
          />
        </Row>
        <Row
          name="Do Not Disturb"
          note="Windows lets reminders through Do Not Disturb by default. When it holds one back (reminders off in its priority list, a full-screen app, a game), the Flint chime still sounds and the reminder waits in Today's Overdue card."
          filter={filter}
          words="do not disturb focus assist full screen game"
        />
      </Section>

      <Section id="today" filter={filter}>
        <Row
          name="Ask about unfinished pins"
          note="On a new day's first look at Today: keep yesterday's unfinished pinned tasks, or unpin them."
          filter={filter}
          words="rollover yesterday pinned"
        >
          <Switch
            on={view.rolloverPrompt}
            label="Ask about unfinished pins"
            onChange={(on) => set({ key: 'rolloverPrompt', value: on })}
          />
        </Row>
        <Row
          name="Archive completed tasks"
          note="Old completed tasks move to the archive (Trash → Archived), where you can bring them back."
          filter={filter}
          words="auto-archive completed days"
        >
          <Choice
            label="Archive completed tasks"
            value={view.autoArchiveDays}
            options={[
              { value: null, label: 'Off' },
              { value: 7, label: '7 days' },
              { value: 14, label: '14 days' },
              { value: 30, label: '30 days' },
            ]}
            onChange={(value) => set({ key: 'autoArchiveDays', value })}
          />
        </Row>
      </Section>

      {/* SYNC-01, D-161 (mockup 13): Google Drive sync. */}
      <Section id="sync" filter={filter}>
        {syncRows()}
      </Section>

      <Section id="links" filter={filter}>
        <Row
          name="Link patterns"
          note="Short forms that become links: type AB#1234 for a work item, and a pasted link shows as AB#1234."
          filter={filter}
          words="link pattern azure devops github jira short form url auto-link"
        >
          {!addingLink && (
            <button type="button" className="trash-action" onClick={() => setAddingLink(true)}>
              Add a link pattern
            </button>
          )}
        </Row>
        <LinkPatternList
          adding={addingLink}
          onAdding={setAddingLink}
          onPatterns={onLinkPatterns}
          onBuiltInLinksOff={onBuiltInLinksOff}
        />
      </Section>

      {/* NAV-08, D-128: Windows' clipboard history in the side panel and its picker. */}
      <Section id="clipboard" filter={filter}>
        <Row
          name="Clipboard history"
          note="Shows Windows' clipboard history (Win+V must be on) in the side panel and in Paste from clipboard history… (Ctrl+Shift+H). Windows only lets Flint read it while Flint's window is in front, so new copies appear when you switch back to Flint. Flint never stores or sends it."
          filter={filter}
          words="clipboard history win+v paste copied"
        >
          <Switch
            on={view.clipboardHistory}
            label="Clipboard history"
            onChange={(on) => {
              set({ key: 'clipboardHistory', value: on }, clipboardChanged);
            }}
          />
        </Row>
      </Section>

      {/* TASK-18, D-151: Give to Claude: each list's folder, and the recent ones. */}
      <Section id="claude" filter={filter}>
        <Row
          name="Give to Claude"
          note="Flint opens Claude Code with the task in its composer. Flint sends nothing itself; you review it and send it from Claude."
          filter={filter}
          words="claude code give ai agent folder project privacy"
        />
        <ClaudeFolders lists={props.claudeLists} onFolders={props.onClaudeFolders} />
      </Section>

      <Section id="data" filter={filter}>
        <Row
          name="Take a snapshot"
          note="A copy of the Flint folder, only when something changed."
          filter={filter}
          words="snapshot backup frequency"
        >
          <Choice
            label="Take a snapshot"
            value={view.snapshotEveryMinutes}
            options={[
              { value: 30, label: '30 min' },
              { value: 60, label: 'Hourly' },
              { value: 120, label: '2 h' },
              { value: 240, label: '4 h' },
            ]}
            onChange={(value) => set({ key: 'snapshotEveryMinutes', value })}
          />
        </Row>
        <Row name="Keep hourly snapshots" filter={filter} words="snapshot retention">
          <Choice
            label="Keep hourly snapshots"
            value={view.keepHourlyHours}
            options={[
              { value: 24, label: '1 day' },
              { value: 48, label: '2 days' },
              { value: 72, label: '3 days' },
              { value: 168, label: '1 week' },
            ]}
            onChange={(value) => set({ key: 'keepHourlyHours', value })}
          />
        </Row>
        <Row name="Keep daily snapshots" filter={filter} words="snapshot retention">
          <Choice
            label="Keep daily snapshots"
            value={view.keepDailyDays}
            options={[
              { value: 14, label: '14 days' },
              { value: 30, label: '30 days' },
              { value: 60, label: '60 days' },
              { value: 90, label: '90 days' },
            ]}
            onChange={(value) => set({ key: 'keepDailyDays', value })}
          />
        </Row>
        <Row
          name="Space snapshots use"
          note={`${megabytes} on this computer.`}
          filter={filter}
          words="snapshot space disk clear"
        >
          {clearing ? (
            <span className="trash-confirm" role="group" aria-label="Clear old snapshots?">
              <span className="trash-confirm-text">Keep only the newest?</span>
              <button
                type="button"
                className="trash-action danger"
                onClick={() => {
                  setClearing(false);
                  void window.flintMain.clearSnapshots().then((count) => {
                    onToast(count === 1 ? 'Cleared 1 snapshot' : `Cleared ${count} snapshots`);
                    void window.flintMain.snapshotSpace().then(setSpace);
                  });
                }}
              >
                Clear
              </button>
              <button type="button" className="trash-action" onClick={() => setClearing(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="trash-action" onClick={() => setClearing(true)}>
              Clear old snapshots
            </button>
          )}
        </Row>
        <Row name="Restore from a snapshot" filter={filter} words="snapshot restore older version">
          <button type="button" className="trash-action" onClick={onSnapshots}>
            Snapshots…
          </button>
        </Row>
        <Row
          name="Export Flint folder"
          note="Everything, as one zip file."
          filter={filter}
          words="export zip backup"
        >
          <button
            type="button"
            className="trash-action"
            onClick={() => void window.flintMain.exportFolder()}
          >
            Export…
          </button>
        </Row>
      </Section>

      <Section id="appearance" filter={filter}>
        <Row
          name="Interface size"
          note={
            size === undefined
              ? `Now ${Math.round(zoom * 100)}% (with Ctrl+= or Ctrl+−); kept for each display.`
              : 'Ctrl+= and Ctrl+− too; kept for each display.'
          }
          filter={filter}
          words="zoom size bigger smaller"
        >
          <Choice
            label="Interface size"
            value={size ?? null}
            options={sizes.map((level) => ({ value: level, label: `${Math.round(level * 100)}%` }))}
            onChange={(level) => {
              if (level !== null) onZoom(level);
            }}
          />
        </Row>
        <Row
          name="Animation speed"
          note={
            osReduced
              ? "Windows' “Show animations” is off, so Flint doesn't animate."
              : 'All of Flint’s motion, slower or quicker.'
          }
          filter={filter}
          words="motion animation speed"
        >
          <Choice
            label="Animation speed"
            value={view.animationSpeed}
            options={[
              { value: 'relaxed', label: 'Relaxed' },
              { value: 'normal', label: 'Normal' },
              { value: 'quick', label: 'Quick' },
            ]}
            onChange={(value) => set({ key: 'animationSpeed', value })}
          />
        </Row>
      </Section>

      <Section
        id="shortcuts"
        filter={filter}
        matches={SHORTCUTS.some((group) =>
          group.shortcuts.some((each) =>
            `${each.keys} ${each.action} ${group.name}`.toLowerCase().includes(filter),
          ),
        )}
      >
        {SHORTCUTS.map((group) => (
          <div key={group.name} className="settings-shortcuts">
            <div className="settings-shortcut-group">{group.name}</div>
            {group.shortcuts
              .filter(
                (each) =>
                  filter === '' ||
                  `${each.keys} ${each.action} ${group.name}`.toLowerCase().includes(filter),
              )
              .map((each) => (
                <div key={each.keys + each.action} className="settings-shortcut">
                  <span className="settings-shortcut-action">{each.action}</span>
                  <span className="keycap">{each.keys}</span>
                </div>
              ))}
          </div>
        ))}
      </Section>

      <Section id="about" filter={filter}>
        {/* APP-09, D-16, D-132, D-136: stated plainly, first in About. */}
        <Row
          name="Privacy"
          note="Your notes stay on this PC unless you sync them: synced lists and notes go only to your own Google Drive, and Flint has no server of its own. Flint sends no telemetry and only contacts GitHub to check for updates, which you can turn off. Give to Claude only hands a task to the Claude app on this computer; nothing leaves your machine unless you send it from Claude."
          filter={filter}
          words="privacy telemetry network data account offline github updates claude"
        />
        {/* APP-06, D-136: the version, what the updater is doing, and its one action. */}
        <Row
          name={`Flint ${view.version}`}
          note={
            <span key={updateStatus(updates, Date.now())} className="update-status">
              {updateStatus(updates, Date.now())}
            </span>
          }
          filter={filter}
          words="version about update check github download restart"
        >
          {updates.phase === 'ready' ? (
            <button
              key="restart"
              type="button"
              className="trash-action update-action"
              onClick={() => void window.flintMain.updatesRestart()}
            >
              Restart now
            </button>
          ) : (
            <button
              key="check"
              type="button"
              className="trash-action update-action"
              disabled={
                updates.phase === 'off' ||
                updates.phase === 'checking' ||
                updates.phase === 'downloading'
              }
              onClick={() => void window.flintMain.updatesCheck()}
            >
              Check for updates
            </button>
          )}
        </Row>
        <Row
          name="Automatic updates"
          note="Checks GitHub when Flint starts and every few hours, downloads a new version in the background and installs it when you restart Flint. Off: Flint checks only when you press Check for updates."
          filter={filter}
          words="update automatic github download background check"
        >
          <Switch
            on={view.checkForUpdates}
            label="Check for updates automatically"
            onChange={(on) => set({ key: 'checkForUpdates', value: on })}
          />
        </Row>
        <Row
          name="What’s new"
          note="What changed in each version, in a few lines."
          filter={filter}
          words="whats new release notes changes update"
        >
          <button type="button" className="trash-action" onClick={onWhatsNew}>
            What’s new
          </button>
        </Row>
        <Row
          name="Walkthrough"
          note="The eight-step tour of Flint, from the start."
          filter={filter}
          words="tour onboarding help guide replay"
        >
          <button type="button" className="trash-action" onClick={onReplayTour}>
            Replay walkthrough
          </button>
        </Row>
        <Row
          name="Tips"
          note="Now and then, a one-line hint about a quicker way to do what you just did."
          filter={filter}
          words="tips hints reset show"
        >
          <button
            type="button"
            className="trash-action"
            onClick={() =>
              void window.flintMain.resetTips().then(() => {
                onToast('Tips reset');
                void window.flintMain.settings().then(setView);
              })
            }
          >
            Reset tips
          </button>
          <Switch
            on={!view.tipsOff}
            label="Show tips"
            onChange={(on) => set({ key: 'tipsOff', value: !on })}
          />
        </Row>
        <Row name="Logs" note="Kept here only, never sent anywhere." filter={filter} words="logs">
          <button
            type="button"
            className="trash-action"
            onClick={() => void window.flintMain.openFolder('logs')}
          >
            Open logs folder
          </button>
        </Row>
      </Section>
    </div>
  );
}

/**
 * D-100: the index in the side panel's place: every section, the one in view marked; a click
 * scrolls to it (at once under reduce-motion).
 */
export function SettingsIndex(props: {
  readonly scroller: React.RefObject<HTMLElement | null>;
}): ReactElement {
  const { scroller } = props;
  const [current, setCurrent] = useState<SectionId>('general');
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onScroll = (): void => {
      const top = element.getBoundingClientRect().top + 96;
      let found: SectionId = 'general';
      for (const section of SETTINGS_SECTIONS) {
        const box = document.getElementById(`settings-${section.id}`)?.getBoundingClientRect();
        if (box && box.top <= top) found = section.id;
      }
      // Scrolled to the end: the last section (only on a page that scrolls: D-104, while Settings
      // was still loading the empty page counted as scrolled to its end, marking About).
      if (
        element.scrollHeight > element.clientHeight + 2 &&
        element.scrollTop + element.clientHeight >= element.scrollHeight - 2
      )
        found = 'about';
      setCurrent(found);
    };
    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    // D-104: and again when the page's content changes size (its sections arriving, a panel).
    const sizes = new ResizeObserver(onScroll);
    if (element.firstElementChild) sizes.observe(element.firstElementChild);
    return () => {
      element.removeEventListener('scroll', onScroll);
      sizes.disconnect();
    };
  }, [scroller]);
  return (
    <nav className="settings-index" aria-label="Settings sections">
      <div className="panel-label">Settings</div>
      {SETTINGS_SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className={section.id === current ? 'settings-index-item on' : 'settings-index-item'}
          onClick={() =>
            document.getElementById(`settings-${section.id}`)?.scrollIntoView({
              block: 'start',
              behavior: reducedMotion() ? 'instant' : 'smooth',
            })
          }
        >
          {section.name}
        </button>
      ))}
    </nav>
  );
}

/**
 * D-133 (UI-10, D-89, D-75): a panel that goes (Cancel, Save): what was asked happens at once, and a
 * copy of the panel fades out where it was (as a menu's does), so the motion never delays it.
 */
function leaveWithFade(panel: Element | null, then: () => void): void {
  if (
    panel instanceof HTMLElement &&
    panel.offsetParent instanceof HTMLElement &&
    !reducedMotion()
  ) {
    const ghost = panel.cloneNode(true) as HTMLElement;
    // Only its look: nothing looks it up as the panel any more.
    ghost.className = 'settings-panel leaving';
    ghost.removeAttribute('role');
    ghost.removeAttribute('aria-label');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: 'absolute',
      top: `${panel.offsetTop}px`,
      left: `${panel.offsetLeft}px`,
      width: `${panel.offsetWidth}px`,
      margin: '0',
    });
    panel.offsetParent.append(ghost);
    ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
    window.setTimeout(() => ghost.remove(), 1000);
  }
  then();
}

/**
 * DATA-07, D-104: a chosen folder becoming the Flint folder, asked in the folder's row: what it
 * holds decides the choices (the likeliest one preselected), and the confirmation says exactly what
 * will happen. Flint restarts on the new folder once it is ready.
 */
export function FolderChangePanel(props: {
  readonly choice: FolderChoice;
  readonly onChooseAgain: () => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { choice, onChooseAgain, onCancel } = props;
  // A folder holding other things: a Flint subfolder inside it, or the folder itself.
  const [where, setWhere] = useState<'sub' | 'here'>('sub');
  const [what, setWhat] = useState<'move' | 'fresh'>('move');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const sub = choice.state === 'other' && where === 'sub';
  const target = sub ? choice.subfolder.path : choice.path;
  const state = sub
    ? choice.subfolder.state === 'missing'
      ? 'empty'
      : choice.subfolder.state
    : choice.state;
  const refused = sub ? choice.subfolder.refused : choice.refused;
  const how: FolderChange = state === 'flint' ? 'open' : what;
  const path = <span className="settings-path">{target}</span>;
  const current = <span className="settings-path">{choice.current}</span>;
  const says =
    how === 'open' ? (
      <>
        Flint opens the lists in {path} and restarts. Your current lists stay in {current}. Merging
        the two isn't possible yet.
      </>
    ) : how === 'move' ? (
      <>
        Flint copies everything in {current} to {path}, checks every file, then restarts on it.{' '}
        {current} stays as it is, as a backup.
      </>
    ) : (
      <>
        Flint starts a new Flint folder in {path} with an empty Inbox, and restarts. Your lists stay
        in {current}.
      </>
    );
  const go = (): void => {
    setBusy(true);
    setProblem(null);
    void window.flintMain.changeFolder(target, how).then((outcome) => {
      setBusy(false);
      if (outcome?.ok) setDone(true);
      else setProblem(outcome?.problem ?? 'Flint could not change its folder.');
    });
  };
  const action = how === 'open' ? 'Open' : how === 'move' ? 'Move' : 'Start';
  return (
    <div className="settings-panel" role="group" aria-label="Change the Flint folder">
      <div className="settings-panel-line">
        <span className="settings-name">Chosen</span>
        <span className="settings-path">{choice.path}</span>
      </div>
      {choice.insideOneDrive && (
        <p className="settings-warning settings-said">
          This folder is in OneDrive, which syncs it. Flint doesn't support synced folders yet:
          edits on two computers can clash. You can still use it.
        </p>
      )}
      {choice.state === 'other' && !choice.refused && (
        <Choice
          label="Where"
          value={where}
          options={[
            { value: 'sub', label: 'Use a Flint subfolder inside it' },
            { value: 'here', label: 'Use this folder directly' },
          ]}
          onChange={(value) => {
            setWhere(value);
            setProblem(null);
          }}
        />
      )}
      {refused ? (
        <p key={refused} className="settings-warning settings-said">
          {refused} Choose another folder.
        </p>
      ) : (
        <>
          {state === 'flint' ? (
            <Choice
              label="What"
              value="open"
              options={[{ value: 'open', label: 'Open these lists' }]}
              onChange={() => undefined}
            />
          ) : (
            <Choice
              label="What"
              value={what}
              options={[
                {
                  value: 'move',
                  label:
                    sub || choice.state !== 'empty' ? 'Move my lists there' : 'Move my lists here',
                },
                {
                  value: 'fresh',
                  label: sub || choice.state !== 'empty' ? 'Start fresh there' : 'Start fresh here',
                },
              ]}
              onChange={(value) => {
                setWhat(value);
                setProblem(null);
              }}
            />
          )}
          <p key={`${how}:${target}`} className="settings-note settings-said">
            {says}
          </p>
        </>
      )}
      {problem && (
        <p key={problem} className="settings-warning settings-said">
          {problem}
        </p>
      )}
      <div className="settings-panel-actions">
        {done ? (
          <span className="settings-note settings-said">Done. Flint restarts…</span>
        ) : (
          <>
            <button type="button" className="trash-action" onClick={onChooseAgain} disabled={busy}>
              Choose another…
            </button>
            <button
              type="button"
              className="trash-action"
              onClick={(event) =>
                leaveWithFade(event.currentTarget.closest('.settings-panel'), onCancel)
              }
              disabled={busy}
            >
              Cancel
            </button>
            {!refused && (
              <button type="button" className="primary-button" onClick={go} disabled={busy}>
                {busy
                  ? how === 'move'
                    ? 'Copying and checking…'
                    : 'Working…'
                  : `${action} and restart`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A template with its placeholders filled (`AB#{id}` + `{ id: '1234' }` → `AB#1234`). */
function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z][a-z0-9]*)\}/gi, (whole, name: string) => values[name] ?? whole);
}

/** How a saved pattern reads: its parts as an example (numbers as 1234, words by their name). */
function sampleOf(pattern: LinkPattern): { short: string; url: string } {
  const values: Record<string, string> = {};
  for (const match of `${pattern.short} ${pattern.url}`.matchAll(/\{([a-z][a-z0-9]*)\}/gi)) {
    const name = match[1] ?? '';
    values[name] = pattern.kinds?.[name] === 'word' ? name : '1234';
  }
  return {
    short: fillTemplate(pattern.short, values),
    url: fillTemplate(pattern.url, values).replace(/^https?:\/\//i, ''),
  };
}

/**
 * NOTE-07, D-84, D-104, D-105: the user's link patterns, each as its short form and where it links,
 * with Edit (the same editor, as it was left) and Delete (asked inline); the editor that makes one
 * from examples; and the built-in recognizers, read-only, each with a switch.
 */
function LinkPatternList(props: {
  readonly adding: boolean;
  readonly onAdding: (adding: boolean) => void;
  readonly onPatterns: (patterns: readonly LinkPattern[]) => void;
  readonly onBuiltInLinksOff: (off: readonly string[]) => void;
}): ReactElement {
  const { adding, onAdding, onPatterns, onBuiltInLinksOff } = props;
  const [patterns, setPatterns] = useState<readonly LinkPattern[] | null>(null);
  const [off, setOff] = useState<readonly string[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => {
    void window.flintMain.linkPatterns().then(setPatterns);
    void window.flintMain.builtInLinksOff().then(setOff);
  }, []);
  const save = (next: readonly LinkPattern[]): void => {
    void window.flintMain.saveLinkPatterns(next).then((kept) => {
      if (!kept) return;
      setPatterns(kept);
      onPatterns(kept);
    });
  };
  const toggle = (id: string, on: boolean): void => {
    const next = on ? off.filter((other) => other !== id) : [...off, id];
    setOff(next);
    void window.flintMain.setBuiltInLinksOff(next).then((kept) => {
      if (kept) onBuiltInLinksOff(kept);
    });
  };
  const editor = (index: number | null): ReactElement | null =>
    patterns ? (
      <LinkPatternEditor
        key={index ?? 'new'}
        initial={index === null ? null : (patterns[index] ?? null)}
        existing={patterns.filter((_, at) => at !== index)}
        onSave={(pattern) => {
          save(
            index === null
              ? [...patterns, pattern]
              : patterns.map((other, at) => (at === index ? pattern : other)),
          );
          if (index === null) onAdding(false);
          else setEditing(null);
        }}
        onCancel={() => (index === null ? onAdding(false) : setEditing(null))}
      />
    ) : null;
  return (
    <>
      {patterns && patterns.length > 0 && (
        <ul className="link-patterns">
          {patterns.map((pattern, index) => {
            const sample = sampleOf(pattern);
            if (editing === index)
              return <li key={`${pattern.short} ${pattern.url}`}>{editor(index)}</li>;
            return (
              <li key={`${pattern.short} ${pattern.url}`} className="link-pattern">
                <span className="keycap">{sample.short}</span>
                <span className="link-pattern-url">→ {sample.url}</span>
                {deleting === index ? (
                  <span className="trash-confirm" role="group" aria-label="Delete this pattern?">
                    <span className="trash-confirm-text">Delete it?</span>
                    <button
                      type="button"
                      className="trash-action danger"
                      onClick={() => {
                        setDeleting(null);
                        save(patterns.filter((_, at) => at !== index));
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="trash-action"
                      onClick={() => setDeleting(null)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="link-pattern-actions">
                    <button
                      type="button"
                      className="trash-action"
                      onClick={() => {
                        onAdding(false);
                        setEditing(index);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="trash-action"
                      onClick={() => setDeleting(index)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && editing === null && editor(null)}
      <span className="settings-name link-builtins-label">Built in</span>
      <span className="settings-note">
        Pasted links of these kinds show short, like PR 42. Turn one off to see its whole link.
      </span>
      <ul className="link-builtins">
        {LINK_PRESETS.map((preset) => (
          <li key={preset.id} className="link-pattern">
            <span className="keycap">{presetSample(preset)}</span>
            <span className="link-pattern-label">{preset.label}</span>
            <Switch
              on={!off.includes(preset.id)}
              label={preset.label}
              onChange={(on) => toggle(preset.id, on)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * TASK-18, D-151: the lists that have a folder for Claude (Change…, Forget), and Clear recent
 * folders. A list gets its folder from its right-click menu, the palette, or Shift+Enter in the
 * card.
 */
function ClaudeFolders(props: {
  readonly lists: readonly { readonly id: string; readonly name: string }[];
  readonly onFolders: (folders: Readonly<Record<string, string>>) => void;
}): ReactElement {
  const { lists, onFolders } = props;
  const [state, setState] = useState<ClaudeState | null>(null);
  useEffect(() => {
    void window.flintMain.claudeState().then(setState);
  }, []);
  const changed = (next: ClaudeState | null): void => {
    if (!next) return;
    setState(next);
    onFolders(next.folders);
  };
  if (!state) return <></>;
  const missing = new Set(state.missing.map((path) => path.toLowerCase()));
  const withFolder = lists.filter((list) => state.folders[list.id] !== undefined);
  return (
    <>
      {withFolder.length === 0 ? (
        <span className="settings-note claude-none">
          No list has a folder yet: choose one from a list's right-click menu (Claude folder).
        </span>
      ) : (
        <ul className="link-patterns claude-folders">
          {withFolder.map((list) => {
            const folder = state.folders[list.id] ?? '';
            return (
              <li key={list.id} className="link-pattern">
                <span className="link-pattern-label">{list.name}</span>
                <span className="claude-folder-path" title={folder}>
                  {missing.has(folder.toLowerCase()) ? `${folder} (not found)` : folder}
                </span>
                <span className="link-pattern-actions">
                  <button
                    type="button"
                    className="trash-action"
                    onClick={() =>
                      void window.flintMain.chooseClaudeFolder(folder).then((path) => {
                        if (path)
                          void window.flintMain.setClaudeFolder(list.id, path).then(changed);
                      })
                    }
                  >
                    Change…
                  </button>
                  <button
                    type="button"
                    className="trash-action"
                    onClick={() =>
                      void window.flintMain.setClaudeFolder(list.id, null).then(changed)
                    }
                  >
                    Forget
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {state.recent.length > 0 && (
        <button
          type="button"
          className="trash-action claude-clear"
          onClick={() => void window.flintMain.clearClaudeRecent().then(changed)}
        >
          Clear recent folders
        </button>
      )}
    </>
  );
}

/** More places than this a pattern would link now, and the editor warns (D-105, Proposed). */
const MANY_MATCHES = 20;

/**
 * NOTE-07, D-84, D-105: a pattern from examples. Paste a link: a known kind (the presets) is
 * recognised and its short form filled in; else type the short form wanted. When one example can't
 * say which part changes, a second one is asked for (and stays while it is typed). A short form
 * needs fixed text around what changes; the preview shows both ways and how many places in the
 * lists and notes it would link now. Advanced shows the pattern made.
 */
function LinkPatternEditor(props: {
  /** Edit: the pattern as it was left (its examples, or one made from it). */
  readonly initial: LinkPattern | null;
  readonly existing: readonly LinkPattern[];
  readonly onSave: (pattern: LinkPattern) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { initial, existing, onSave, onCancel } = props;
  const start = initial
    ? (initial.examples ?? [
        { url: `https://${sampleOf(initial).url}`, short: sampleOf(initial).short },
      ])
    : [];
  const [url, setUrl] = useState(start[0]?.url ?? '');
  const [short, setShort] = useState(start[0]?.short ?? '');
  const [typed, setTyped] = useState(initial !== null);
  const [url2, setUrl2] = useState(start[1]?.url ?? '');
  const [short2, setShort2] = useState(start[1]?.short ?? '');
  // Once asked for, the second example stays while it is typed (it vanished mid-word: D-105).
  const [second, setSecond] = useState(start.length > 1);
  const [advanced, setAdvanced] = useState(false);
  const [matches, setMatches] = useState<number | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const preset = url.trim() === '' ? null : patternFromPreset(url);
  const presetShort = preset
    ? shortFormOf(url.trim(), compileLinkPatterns([preset.pattern]))
    : null;
  const examples = [
    { url: url.trim(), short: short.trim() },
    ...(second && url2.trim() && short2.trim() ? [{ url: url2.trim(), short: short2.trim() }] : []),
  ];
  const inference =
    url.trim() === ''
      ? null
      : preset && presetShort !== null && short.trim() === presetShort
        ? { pattern: preset.pattern, ambiguous: false, problem: undefined }
        : short.trim() === ''
          ? null
          : inferLinkPattern(examples);
  useEffect(() => {
    if (inference?.ambiguous && !second) setSecond(true);
  }, [inference?.ambiguous, second]);
  const found = inference?.pattern ?? null;
  const pattern: LinkPattern | null = found ? { ...found, examples } : null;
  const loose = found ? fixedPartProblem(found) : null;
  const suggestion = loose ? suggestShortForm(url, short) : null;
  const duplicate =
    found !== null && existing.some((other) => other.short === found.short)
      ? `You already have a pattern for ${sampleOf(found).short}.`
      : null;
  const waiting = inference?.ambiguous === true && examples.length < 2;
  const problem = waiting ? null : (inference?.problem ?? loose ?? duplicate);
  const ready = found !== null && !inference?.ambiguous && !problem;
  // D-105: how much it would link now, asked once it is clear (and not while it's typed fast).
  const key = ready ? `${found.short} ${found.url}` : '';
  useEffect(() => {
    setMatches(null);
    if (!ready || !found) return;
    const timer = window.setTimeout(() => {
      void window.flintMain.countLinkMatches(found).then(setMatches);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [key]);
  // The preview: the example with its number one higher, both ways.
  let preview: { short: string; url: string } | null = null;
  if (ready) {
    const compiled = compileLinkPatterns([found]);
    const groups = compiled[0]?.fullUrl.exec(url.trim())?.groups ?? {};
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(groups))
      values[name] = /^\d+$/.test(value) ? String(Number(value) + 1) : value;
    const nextUrl = fillTemplate(found.url, values);
    const nextShort = fillTemplate(found.short, values);
    if (shortFormOf(nextUrl, compiled) === nextShort) preview = { short: nextShort, url: nextUrl };
  }
  return (
    <div
      className="settings-panel link-editor"
      role="group"
      aria-label={initial ? 'Edit the link pattern' : 'Add a link pattern'}
    >
      <label className="settings-field">
        <span className="settings-name">Example link</span>
        <input
          ref={first}
          className="settings-find"
          value={url}
          placeholder="https://dev.azure.com/acme/web/_workitems/edit/1234"
          aria-label="Example link"
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value;
            setUrl(next);
            if (next.trim() === '') setSecond(false);
            // A known kind fills in its short form, until one is typed.
            if (!typed) {
              const known = next.trim() === '' ? null : patternFromPreset(next);
              setShort(
                known ? (shortFormOf(next.trim(), compileLinkPatterns([known.pattern])) ?? '') : '',
              );
            }
          }}
        />
      </label>
      <label className="settings-field">
        <span className="settings-name">Short form</span>
        <input
          className="settings-find"
          value={short}
          placeholder="AB#1234"
          aria-label="Short form"
          spellCheck={false}
          onChange={(event) => {
            setShort(event.target.value);
            setTyped(true);
          }}
        />
      </label>
      {preset && (
        <p key={preset.preset.label} className="settings-note settings-said">
          Recognised: {preset.preset.label}.
        </p>
      )}
      {second && (
        <div className="settings-said">
          <p className="settings-note">
            Another example, so Flint knows which part changes from link to link:
          </p>
          <label className="settings-field">
            <span className="settings-name">Second link</span>
            <input
              className="settings-find"
              value={url2}
              aria-label="Second link"
              spellCheck={false}
              onChange={(event) => setUrl2(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span className="settings-name">Its short form</span>
            <input
              className="settings-find"
              value={short2}
              aria-label="Second short form"
              spellCheck={false}
              onChange={(event) => setShort2(event.target.value)}
            />
          </label>
        </div>
      )}
      {problem && url.trim() !== '' && (
        <p key={problem} className="settings-warning settings-said">
          {problem}
          {suggestion && (
            <>
              {' '}
              Try <span className="keycap">{suggestion}</span>{' '}
              <button
                type="button"
                className="trash-action"
                onClick={() => {
                  // The same fixed text before the second example's short form too.
                  const prefix = suggestion.slice(0, suggestion.length - short.trim().length);
                  setShort(suggestion);
                  if (short2.trim() !== '' && !short2.startsWith(prefix))
                    setShort2(prefix + short2.trim());
                  setTyped(true);
                }}
              >
                Use it
              </button>
            </>
          )}
        </p>
      )}
      {preview && (
        <div key={preview.short} className="settings-info link-preview settings-said">
          <div>
            Typing <span className="keycap">{preview.short}</span> links to{' '}
            <span className="settings-path">{preview.url}</span>
          </div>
          <div>
            Pasting that link shows <span className="keycap">{preview.short}</span>
          </div>
          {matches !== null && (
            <div
              key={matches}
              className={
                matches > MANY_MATCHES ? 'settings-warning settings-said' : 'settings-said'
              }
            >
              {matches === 0
                ? 'Nothing in your lists and notes matches it yet.'
                : `It matches ${matches === 1 ? '1 place' : `${matches} places`} in your lists and notes now.`}
              {matches > MANY_MATCHES &&
                ' That looks like too many: a short form with clearer fixed text links only what you mean.'}
            </div>
          )}
        </div>
      )}
      {advanced && found && (
        <div className="settings-info settings-said">
          <div>
            Short form: <span className="settings-path">{found.short}</span>
          </div>
          <div>
            Link: <span className="settings-path">{found.url}</span>
          </div>
        </div>
      )}
      <div className="settings-panel-actions">
        <button
          type="button"
          className="trash-action"
          aria-pressed={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? 'Hide pattern' : 'Advanced'}
        </button>
        <button
          type="button"
          className="trash-action"
          onClick={(event) =>
            leaveWithFade(event.currentTarget.closest('.settings-panel'), onCancel)
          }
        >
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!ready}
          onClick={(event) => {
            if (pattern && ready)
              leaveWithFade(event.currentTarget.closest('.settings-panel'), () => onSave(pattern));
          }}
        >
          Save pattern
        </button>
      </div>
    </div>
  );
}
