import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  TODAY_ID,
  type ListSummary,
  type ListView,
  type MiniAlert,
  type MiniTab,
  type TaskRow,
  type TodayReminder,
} from '../../shared/ipc.js';
import { titleHtml } from '../../shared/inline-markdown.js';
import { setBuiltInLinksOff, setLinkPatterns } from '../../shared/link-patterns.js';
import { isTextField, openMenu, textFieldMenu, type MenuEntry } from '../menu/menu.js';
import { NoteEditor } from '../main-window/NoteEditor.js';
import { usePresence } from '../ui/presence.js';
import { BellIcon, CheckIcon, CloseIcon, PinIcon, PlusIcon } from '../main-window/icons.js';

/**
 * MINI-01, D-109 (mockup 05): mini mode, a small always-on-top window beside the main window and
 * in sync with it. Three tabs: **Today** (the open pinned tasks in Today's order, then the tasks
 * with a reminder later today that aren't pinned), **Inbox** (its open tasks) and **Note** (one
 * quick note, a sticky note). A click selects, a double-click or Enter opens the task in the main
 * window (mini stays); the checkbox completes; right-click: Complete, Pin, Open in Flint. The
 * reminder card (REM-06) sits on top of every tab while one waits: Done, Snooze 10m, Open.
 * Single-letter keys act only when no text field has the caret (the main window's rule).
 */

const INBOX_ID = 'inbox';

/** A row in mini: a task (Today's pinned, Inbox's), or a reminder later today (Today). */
interface MiniRow {
  readonly key: string;
  /** The list a change goes through: Today's own, Inbox, or a reminder's home list. */
  readonly listId: string;
  /** Its home list (where Open goes). */
  readonly homeId: string;
  readonly title: string;
  readonly label: string;
  readonly priority: TaskRow['priority'];
  readonly pinned: boolean;
  /** `15:00` for a reminder today. */
  readonly time: string | null;
  readonly reminderRow: boolean;
}

const fromTask = (task: TaskRow, listId: string, homeId: string, time: string | null): MiniRow => ({
  key: task.key,
  listId,
  homeId,
  title: task.title,
  label: task.label,
  priority: task.priority,
  pinned: task.pinned === true,
  time,
  reminderRow: false,
});

/** `YYYY-MM-DDTHH:MM` local, later than now. */
const later = (at: string, now: Date): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!match) return false;
  const when = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  return when.getTime() > now.getTime();
};

/** D-109, Q4: Today's pinned (Today's order), then later reminders today that aren't pinned. */
function todayRows(view: ListView | null, now: Date): MiniRow[] {
  if (!view?.today) return [];
  const high = new Set(view.today.high);
  const reminders = new Map(view.today.reminders.map((each) => [each.key, each]));
  const pinned = view.items
    .flatMap((item) => (item.kind === 'task' ? [item.task] : []))
    .filter((task) => !task.done && !high.has(task.key))
    .map((task) =>
      fromTask(
        task,
        TODAY_ID,
        task.home?.listId ?? INBOX_ID,
        reminders.get(task.key)?.time ?? null,
      ),
    );
  const placed = new Set(pinned.map((row) => row.key));
  const coming = view.today.reminders
    .filter((each: TodayReminder) => !each.done && !placed.has(each.key) && later(each.at, now))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((each): MiniRow => ({
      key: each.key,
      listId: each.listId,
      homeId: each.listId,
      title: each.title,
      label: each.title,
      priority: null,
      pinned: false,
      time: each.time,
      reminderRow: true,
    }));
  return [...pinned, ...coming];
}

function inboxRows(view: ListView | null): MiniRow[] {
  if (!view) return [];
  return view.items
    .flatMap((item) => (item.kind === 'task' ? [item.task] : []))
    .filter((task) => !task.done)
    .map((task) => fromTask(task, INBOX_ID, INBOX_ID, null));
}

const TABS: readonly { readonly id: MiniTab; readonly name: string }[] = [
  { id: 'today', name: 'Today' },
  { id: 'inbox', name: 'Inbox' },
  { id: 'note', name: 'Note' },
];

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function MiniApp(): ReactElement {
  const [tab, setTabState] = useState<MiniTab>('today');
  const [onTop, setOnTop] = useState(true);
  const [lists, setLists] = useState<readonly ListSummary[]>([]);
  const [today, setToday] = useState<ListView | null>(null);
  const [inbox, setInbox] = useState<ListView | null>(null);
  const [alerts, setAlerts] = useState<readonly MiniAlert[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: boolean; id: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  // The Note tab: the quick note shown ('' while none is made yet), its text, and "Kept in Lists".
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteView, setNoteView] = useState<ListView | null>(null);
  const [kept, setKept] = useState(false);
  // Notes made here (the list of lists may not have them yet), and "New quick note" asked for.
  const created = useRef(new Set<string>());
  const [wantNew, setWantNew] = useState(false);
  const [arrived, setArrived] = useState(0);
  const composer = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const noteRef = useRef<string | null>(null);
  noteRef.current = noteId;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const showToast = useCallback((text: string, undo: boolean): void => {
    setToast({ text, undo, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async (): Promise<void> => {
    const mine = ++seq.current;
    const note = noteRef.current;
    const [nextLists, nextToday, nextInbox, nextNote] = await Promise.all([
      window.flintMain.lists(),
      window.flintMain.view(TODAY_ID),
      window.flintMain.view(INBOX_ID),
      note ? window.flintMain.view(note) : Promise.resolve(null),
    ]);
    // D-107: a read that comes back after a newer one is dropped.
    if (mine !== seq.current) return;
    setLists(nextLists);
    setToday(nextToday);
    setInbox(nextInbox);
    setNoteView(nextNote);
    setNow(new Date());
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Once: its state, the link patterns, the reminder cards; then what main says.
  useEffect(() => {
    void window.flintMini.state().then((state) => {
      setTabState(state.tab);
      setOnTop(state.onTop);
      setNoteId(state.noteId);
    });
    void Promise.all([window.flintMain.linkPatterns(), window.flintMain.builtInLinksOff()]).then(
      ([patterns, off]) => {
        setLinkPatterns(patterns);
        setBuiltInLinksOff(off);
      },
    );
    void window.flintMini.alerts().then(setAlerts);
    window.flintMain.onChanged(() => void refreshRef.current());
    window.flintMini.onAlerts(setAlerts);
    window.flintMini.onShown(({ focus }) => {
      setArrived((count) => count + 1);
      void refreshRef.current();
      if (focus && tabRef.current === 'note')
        window.setTimeout(() => body.current?.querySelector<HTMLElement>('.cm-content')?.focus());
    });
    window.flintMini.onHiding(() => leaveNote());
    void refreshRef.current();
    // The clock: reminders later today come and go.
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // D-89: shown, it arrives (a quick rise and fade, never holding input; off under reduce-motion).
  useEffect(() => {
    if (arrived === 0 || reducedMotion()) return;
    root.current?.animate(
      [
        { opacity: 0, transform: 'translateY(4px) scale(0.985)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration:
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--fl-dur-base'),
          ) || 200,
        easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
      },
    );
  }, [arrived]);

  // The note shown follows the tab: the remembered one if it is still a quick note, else the
  // most recent one, else none yet (made on the first keystroke).
  const quickNotes = lists
    .filter((list) => list.quick)
    .sort((a, b) => (b.quick?.at ?? 0) - (a.quick?.at ?? 0));
  useEffect(() => {
    if (tab !== 'note' || lists.length === 0) return;
    if (noteId === '' && wantNew) return;
    if (noteId && (kept || created.current.has(noteId) || lists.some((list) => list.id === noteId)))
      return;
    const next = quickNotes[0]?.id ?? '';
    if (next !== noteId) {
      setNoteId(next);
      window.flintMini.setState({ noteId: next || null });
    }
  }, [tab, lists, noteId, kept, wantNew]);
  useEffect(() => {
    if (noteId) void refreshRef.current();
    else setNoteView(null);
  }, [noteId]);

  /** Leaving the note (another tab, mini hidden, another note): an empty one goes (NOTE-08). */
  const leaveNote = (): void => {
    const id = noteRef.current;
    setKept(false);
    setWantNew(false);
    if (!id) return;
    const list = lists.find((each) => each.id === id);
    if (list && !list.quick) return;
    void window.flintMain.discardQuickNote(id).then(async (removed) => {
      if (!removed) return;
      if (noteRef.current === id) setNoteId(null);
      if (await window.flintMain.tipDue('emptyQuickNote', 3))
        showToast('Empty quick notes are removed when you leave them', false);
    });
  };
  const leaveRef = useRef(leaveNote);
  leaveRef.current = leaveNote;

  const setTab = (next: MiniTab): void => {
    if (next === tab) return;
    if (tab === 'note') leaveRef.current();
    setTabState(next);
    setSelected(null);
    window.flintMini.setState({ tab: next });
  };

  const rows = tab === 'today' ? todayRows(today, now) : tab === 'inbox' ? inboxRows(inbox) : [];
  const shown = usePresence(rows, (row) => row.key);
  const safeSelected = rows.some((row) => row.key === selected) ? selected : null;

  const complete = async (row: MiniRow): Promise<void> => {
    const index = rows.findIndex((each) => each.key === row.key);
    const next = rows[index + 1] ?? rows[index - 1];
    if (safeSelected === row.key) setSelected(next?.key ?? null);
    const label = await window.flintMain.toggle(row.listId, row.key);
    if (label) showToast(label, true);
  };
  const pin = async (row: MiniRow): Promise<void> => {
    const outcome = await window.flintMain.change(row.listId, {
      kind: 'pin',
      key: row.key,
      pinned: !row.pinned,
    });
    if (outcome?.label) showToast(outcome.label, true);
  };
  const open = (row: MiniRow): void => window.flintMini.open({ listId: row.homeId, key: row.key });
  const undo = async (which: 'undo' | 'redo'): Promise<void> => {
    const label = await (which === 'undo' ? window.flintMain.undo() : window.flintMain.redo());
    if (which === 'undo') showToast(label ? `Undid: ${label}` : 'Nothing to undo', false);
    else showToast(label ? `Redid: ${label}` : 'Nothing to redo', false);
  };
  const rowMenu = (row: MiniRow, at: { x: number; y: number }): void => {
    setSelected(row.key);
    const entries: MenuEntry[] = [
      { label: 'Complete', hint: 'Space', action: () => void complete(row) },
      { label: row.pinned ? 'Unpin' : 'Pin', hint: 'P', action: () => void pin(row) },
      'divider',
      { label: 'Open in Flint', hint: 'Enter', action: () => open(row) },
    ];
    openMenu(entries, at);
  };

  const alert = alerts[0] ?? null;
  const act = (action: 'done' | 'snooze' | 'open'): void => {
    if (alert) window.flintMini.alertAction(alert.id, action);
  };

  // Q7: the keys. Single letters only when no text field has the caret.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const typing = isTextField(event.target);
      if (event.ctrlKey && !event.altKey && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        setTab(TABS[Number(event.key) - 1]?.id ?? 'today');
        return;
      }
      if (event.key === 'Escape') {
        if (typing) event.target.blur();
        else setSelected(null);
        event.preventDefault();
        return;
      }
      if (typing) return;
      if (event.ctrlKey && (event.key === 'z' || event.key === 'y')) {
        event.preventDefault();
        void undo(event.key === 'z' ? 'undo' : 'redo');
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const row = rows.find((each) => each.key === safeSelected) ?? null;
      const at = row ? rows.indexOf(row) : -1;
      const key = event.key.toLowerCase();
      if (alert && (key === 'd' || key === 's' || key === 'o')) {
        event.preventDefault();
        act(key === 'd' ? 'done' : key === 's' ? 'snooze' : 'open');
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (rows.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next =
          at < 0
            ? step > 0
              ? 0
              : rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, at + step));
        setSelected(rows[next]?.key ?? null);
      } else if (event.key === ' ' && row) {
        event.preventDefault();
        void complete(row);
      } else if (key === 'p' && row) {
        event.preventDefault();
        void pin(row);
      } else if (event.key === 'Enter' && row) {
        event.preventDefault();
        open(row);
      } else if (key === 'n' && tab !== 'note') {
        event.preventDefault();
        composer.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The selected row stays in view.
  useLayoutEffect(() => {
    if (!safeSelected) return;
    body.current
      ?.querySelector(`.mini-row[data-key="${CSS.escape(safeSelected)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'instant' : 'smooth' });
  }, [safeSelected]);

  const add = async (text: string): Promise<void> => {
    const outcome = await window.flintMain.change(tab === 'today' ? TODAY_ID : INBOX_ID, {
      kind: 'add',
      text,
      where: 'top',
    });
    if (outcome?.label && outcome.listId !== (tab === 'today' ? TODAY_ID : INBOX_ID))
      showToast(outcome.label, true);
  };

  const quick = lists.find((list) => list.id === noteId);
  return (
    <div className="mini" ref={root}>
      <header className="mini-head">
        <div className="mini-tabs" role="tablist" aria-label="Mini mode">
          {TABS.map((each, index) => (
            <button
              key={each.id}
              type="button"
              role="tab"
              aria-selected={tab === each.id}
              className={tab === each.id ? 'mini-tab on' : 'mini-tab'}
              title={`${each.name} (Ctrl+${index + 1})`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTab(each.id)}
            >
              {each.name}
            </button>
          ))}
          <span
            className="mini-tab-glide"
            aria-hidden="true"
            style={{ transform: `translateX(${TABS.findIndex((each) => each.id === tab) * 100}%)` }}
          />
        </div>
        <span className="mini-drag" />
        <button
          type="button"
          className={onTop ? 'mini-tool on' : 'mini-tool'}
          aria-label={onTop ? 'Always on top (on)' : 'Always on top (off)'}
          aria-pressed={onTop}
          title={onTop ? 'Always on top: on' : 'Always on top: off'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void window.flintMini.setOnTop(!onTop).then(setOnTop)}
        >
          <PinIcon size={14} />
        </button>
        <button
          type="button"
          className="mini-tool"
          aria-label="Hide mini mode"
          title="Hide (Ctrl+Alt+Space)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => window.flintMini.hide()}
        >
          <CloseIcon size={14} />
        </button>
      </header>

      {alert && (
        <section className="mini-alert" key={alert.id} aria-label="Reminder" role="alert">
          <div className="mini-alert-top">
            <span className="mini-alert-tile">
              <BellIcon size={14} />
            </span>
            <span className="mini-alert-text">
              <span className="mini-alert-label">
                {alert.label}
                {alerts.length > 1 && ` · 1 of ${alerts.length}`}
              </span>
              <span className="mini-alert-title">{alert.title}</span>
            </span>
          </div>
          <div className="mini-alert-actions">
            <button type="button" className="mini-alert-button strong" onClick={() => act('done')}>
              Done <span className="keycap">D</span>
            </button>
            <button type="button" className="mini-alert-button" onClick={() => act('snooze')}>
              Snooze 10m <span className="keycap">S</span>
            </button>
            <button type="button" className="mini-alert-button" onClick={() => act('open')}>
              Open <span className="keycap">O</span>
            </button>
          </div>
        </section>
      )}

      <div className="mini-body" ref={body} key={tab}>
        {tab !== 'note' && (
          <>
            {rows.length === 0 && shown.entries.length === 0 && (
              <p className="mini-empty">
                {tab === 'today' ? 'Nothing pinned for today.' : 'Inbox is empty.'}
              </p>
            )}
            <div className="mini-rows" role="list">
              {shown.entries.map(({ item: row, key, leaving }) => (
                <div
                  key={key}
                  role="listitem"
                  data-key={key}
                  className={[
                    'mini-row',
                    key === safeSelected ? 'sel' : '',
                    leaving ? 'leaving' : '',
                    row.reminderRow ? 'reminder' : '',
                  ].join(' ')}
                  onAnimationEnd={(event) => {
                    if (leaving && event.target === event.currentTarget) shown.gone(key);
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 0) setSelected(row.key);
                  }}
                  onDoubleClick={() => open(row)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    rowMenu(row, { x: event.clientX, y: event.clientY });
                  }}
                >
                  {row.priority && <span className={`stripe p-${row.priority}`} />}
                  <button
                    type="button"
                    className={leaving ? 'check on' : 'check'}
                    aria-label="Complete task"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => void complete(row)}
                  >
                    {leaving && <CheckIcon />}
                  </button>
                  {row.title === '' ? (
                    <span className="mini-title">{row.label}</span>
                  ) : (
                    <span
                      className="mini-title md"
                      dangerouslySetInnerHTML={{ __html: titleHtml(row.title) }}
                    />
                  )}
                  {row.time && (
                    <span className="mini-when">
                      <BellIcon size={11} />
                      {row.time}
                    </span>
                  )}
                  {row.pinned && tab === 'inbox' && (
                    <span className="mini-pin" aria-label="Pinned">
                      <PinIcon size={11} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {tab === 'note' && (
          <NoteTab
            noteId={noteId}
            view={noteView}
            title={
              quick?.quick
                ? quick.quick.label === quick.name
                  ? quick.name
                  : ''
                : (noteView?.name ?? '')
            }
            quickNotes={quickNotes}
            kept={kept}
            onId={(id) => {
              created.current.add(id);
              setWantNew(false);
              setNoteId(id);
              window.flintMini.setState({ noteId: id });
            }}
            onSwitch={(id) => {
              leaveRef.current();
              setWantNew(id === '');
              setNoteId(id);
              window.flintMini.setState({ noteId: id || null });
            }}
            onKeep={() => {
              if (!noteId) return;
              void window.flintMain.keepQuickNote(noteId).then(() => setKept(true));
            }}
          />
        )}
      </div>

      {tab !== 'note' && (
        <form
          className="mini-composer"
          onSubmit={(event) => {
            event.preventDefault();
            const field = composer.current;
            const text = field?.value.trim() ?? '';
            if (!field || text === '') return;
            field.value = '';
            void add(text);
          }}
        >
          <input
            ref={composer}
            className="mini-composer-input"
            placeholder={tab === 'today' ? 'Add to Today…' : 'Add to Inbox…'}
            aria-label={tab === 'today' ? 'Add to Today' : 'Add to Inbox'}
            spellCheck={false}
            onContextMenu={(event) => {
              event.preventDefault();
              textFieldMenu(event.currentTarget, (command) => window.flintMain.edit(command));
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
          />
          <button type="submit" className="mini-add" aria-label="Add" title="Add (Enter)">
            <PlusIcon size={13} />
          </button>
        </form>
      )}

      {toast && (
        <div className="mini-toast" key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                setToast(null);
                void undo('undo');
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * D-109, Q5: the Note tab: one quick note as a sticky note. Its title ("Add a title", saved on
 * Enter or when left), a ⋯ menu (the other quick notes, New quick note, Keep as a note, Open in
 * Flint) and the compact live-preview editor. With no quick note, an empty editor: the note is made
 * on the first keystroke.
 */
function NoteTab(props: {
  readonly noteId: string | null;
  readonly view: ListView | null;
  readonly title: string;
  readonly quickNotes: readonly ListSummary[];
  readonly kept: boolean;
  readonly onId: (id: string) => void;
  readonly onSwitch: (id: string) => void;
  readonly onKeep: () => void;
}): ReactElement {
  const { noteId, view, quickNotes, kept, onId, onSwitch, onKeep } = props;
  const [title, setTitle] = useState('');
  // The editor stays the same one when its note is made on the first keystroke (a new one only
  // for another note), so nothing typed meanwhile is lost.
  const made = useRef(new Set<string>());
  const [editorKey, setEditorKey] = useState(0);
  const shownId = useRef(noteId);
  useEffect(() => {
    if (noteId !== shownId.current && !(noteId && made.current.has(noteId)))
      setEditorKey((key) => key + 1);
    shownId.current = noteId;
  }, [noteId]);
  useEffect(() => setTitle(props.title), [noteId, props.title]);
  const saveTitle = (): void => {
    const name = title.trim();
    if (!noteId || name === '') return;
    void window.flintMain.listAction({ kind: 'rename', id: noteId, name });
  };
  const menu = (at: { x: number; y: number }): void => {
    const others = quickNotes.filter((list) => list.id !== noteId);
    const entries: MenuEntry[] = [
      ...others.map((list): MenuEntry => ({
        label: list.quick?.label ?? list.name,
        action: () => onSwitch(list.id),
      })),
      ...(others.length > 0 ? (['divider'] as const) : []),
      { label: 'New quick note', action: () => onSwitch('') },
      { label: 'Keep as a note', disabled: !noteId || kept, action: onKeep },
      {
        label: 'Open in Flint',
        disabled: !noteId,
        action: () => noteId && window.flintMini.open({ listId: noteId }),
      },
    ];
    openMenu(entries, at);
  };
  const ready =
    noteId === '' ||
    (noteId !== null && (made.current.has(noteId) || (view !== null && view.id === noteId)));
  return (
    <div className="mini-note">
      <div className="mini-note-head">
        <input
          className="mini-note-title"
          value={title}
          placeholder="Add a title"
          aria-label="Title"
          spellCheck={false}
          disabled={!noteId}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              saveTitle();
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className="mini-tool"
          aria-label="Quick notes"
          title="Quick notes"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            menu({ x: box.right - 4, y: box.bottom + 4 });
          }}
        >
          <span className="mini-more" aria-hidden="true">
            ⋯
          </span>
        </button>
      </div>
      {kept && <p className="mini-kept">Kept in Lists</p>}
      {ready && (
        <NoteEditor
          key={editorKey}
          id={noteId ?? ''}
          text={noteId && view?.id === noteId ? (view.noteText ?? '') : ''}
          readOnly={false}
          mono={null}
          window="mini"
          className="note-editor mini-editor"
          onId={(id) => {
            made.current.add(id);
            onId(id);
          }}
          onImage={() => undefined}
          create={() => window.flintMain.quickNote()}
        />
      )}
    </div>
  );
}
