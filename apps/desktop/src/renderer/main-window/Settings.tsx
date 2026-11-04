import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { SettingChange, SettingsView } from '../../shared/ipc.js';
import { SHORTCUTS } from '../../shared/shortcuts.js';

/**
 * Settings (APP-11, D-100): one scrolling page, its sections as cards, a slim index in the side
 * panel's place (on wide screens) that jumps between them and marks the one in view; a filter
 * at the top (Ctrl+F) finds a setting. Every change applies at once.
 */

export const SETTINGS_SECTIONS = [
  { id: 'general', name: 'General' },
  { id: 'capture', name: 'Capture & hotkeys' },
  { id: 'reminders', name: 'Reminders' },
  { id: 'today', name: 'Today & lists' },
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
}

function Row(props: RowProps): ReactElement | null {
  const { name, note, filter, words = '', children } = props;
  const haystack = `${name} ${typeof note === 'string' ? note : ''} ${words}`.toLowerCase();
  if (filter !== '' && !haystack.includes(filter)) return null;
  return (
    <div className="settings-row">
      <div className="settings-text">
        <span className="settings-name">{name}</span>
        {note && <span className="settings-note">{note}</span>}
      </div>
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

export function SettingsScreen(props: {
  readonly onToast: (text: string) => void;
  readonly onSnapshots: () => void;
  readonly onZoom: (how: 'in' | 'out' | 'reset') => void;
  /** Bumped by Ctrl+F: the filter takes the caret. */
  readonly find: number;
}): ReactElement {
  const { onToast, onSnapshots, onZoom, find } = props;
  const [view, setView] = useState<SettingsView | null>(null);
  const [space, setSpace] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void window.flintMain.settings().then(setView);
    void window.flintMain.snapshotSpace().then(setSpace);
  }, []);
  useEffect(() => {
    if (find > 0) field.current?.focus();
  }, [find]);
  const set = (change: SettingChange): void => {
    void window.flintMain.setSetting(change).then((next) => {
      if (next) setView(next);
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
          words="folder location path files markdown"
        >
          <button
            type="button"
            className="trash-action"
            onClick={() => void window.flintMain.openFolder('flint')}
          >
            Open folder
          </button>
        </Row>
      </Section>

      <Section id="capture" filter={filter}>
        <Row name="Quick capture" filter={filter} words="hotkey shortcut popup">
          <span className="keycap">{view.captureHotkey}</span>
        </Row>
        <Row name="Capture the selected text" filter={filter} words="hotkey shortcut selection">
          <span className="keycap">{view.captureSelectionHotkey}</span>
        </Row>
        <Row
          name="Change the hotkeys"
          note="They work over any app, even in a full-screen call."
          filter={filter}
          words="hotkey rebind"
        >
          <button
            type="button"
            className="trash-action"
            onClick={() => void window.flintMain.showHotkeys()}
          >
            Change…
          </button>
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
        <Row name="Reminder sound" filter={filter} words="chime audio windows sound">
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
        {(filter === '' || 'chime sound'.includes(filter) || 'reminder sound'.includes(filter)) && (
          <div className="settings-info">
            <strong>Why Flint's chime:</strong> it's a distinct sound you learn to recognise, at the
            same volume every time. With it, the reminder notification goes quiet, so you hear one
            sound, and Windows' notification sound settings no longer apply to Flint's reminders.
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
          name="Focus Assist"
          note="Windows lets reminders through Do Not Disturb by default, so Flint's show during calls. In a full-screen app Windows may still hold them back; they wait in Today's Overdue card."
          filter={filter}
          words="do not disturb focus assist full screen"
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
          note="Ctrl+= and Ctrl+− too; kept for each display."
          filter={filter}
          words="zoom size bigger smaller"
        >
          <button type="button" className="trash-action" onClick={() => onZoom('out')}>
            Smaller
          </button>
          <button type="button" className="trash-action" onClick={() => onZoom('reset')}>
            100%
          </button>
          <button type="button" className="trash-action" onClick={() => onZoom('in')}>
            Larger
          </button>
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
        <Row
          name={`Flint ${view.version}`}
          note="Everything stays on this computer: Flint makes no network requests."
          filter={filter}
          words="version about privacy"
        />
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
      // Scrolled to the end: the last section.
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 2) found = 'about';
      setCurrent(found);
    };
    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
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
