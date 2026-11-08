import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  TODAY_ID,
  type ListSummary,
  type ListView,
  type MiniAlert,
  type MiniAlertAction,
  type MiniTab,
  type TaskRow,
  type TodayReminder,
} from '../../shared/ipc.js';
import { setBuiltInLinksOff, setLinkPatterns } from '../../shared/link-patterns.js';
import { isTextField, openMenu, type MenuEntry } from '../menu/menu.js';
import { CloseIcon, PinIcon, ResetSizeIcon } from '../main-window/icons.js';
import { Composer } from '../ui/Composer.js';
import { applySpeed, durationMs, nudge, reducedMotion } from '../ui/motion.js';
import { parseAt } from '../ui/presence.js';
import { showQuestion, showUndoNotice, ToastView, useToast } from '../ui/Toast.js';
import type { ConfirmNotice, UndoNotice } from '../media/media.js';
import { MiniList } from './MiniList.js';
import { MiniReminder } from './MiniReminder.js';
import { NoteTab } from './NoteTab.js';
import { useShowMotion, useStage } from './stage.js';

/**
 * MINI-01, D-109, D-110 (mockup 05): mini mode, a small always-on-top card beside the main window and
 * in sync with it, built from the main window's own parts (D-110): its task rows in their compact
 * size, the gliding selection, the completion animation, the drag, the composer with the capture
 * shorthand, the toast, the segmented tabs, the quick-note title and editor, the scrollbars.
 * Three tabs: **Today** (the open pinned tasks in Today's order, then the tasks with a reminder later
 * today that aren't pinned), **Inbox** (its open top-level tasks) and **Note** (one quick note, a
 * sticky note). A click selects, a double-click or Enter opens the task in the main window (mini
 * stays). The reminder card (REM-06): Today's next reminder, turning into the alert when one fires
 * (on any tab). Single-letter keys act only when no text field has the caret (the main window's
 * rule). The card sits on a transparent stage (`stage.ts`) and hangs from its corner.
 */

const INBOX_ID = 'inbox';
const TOAST_MS = 5000;

const TABS: readonly { readonly id: MiniTab; readonly name: string }[] = [
  { id: 'today', name: 'Today' },
  { id: 'inbox', name: 'Inbox' },
  { id: 'note', name: 'Note' },
];

/** Where a row's changes go (Today's own view, Inbox, a reminder's home list) and its home. */
interface Route {
  readonly listId: string;
  readonly homeId: string;
}

/** D-110: in mini every time is today's, so a row shows `15:00`, not `Today 15:00`. */
const todayTime = (task: TaskRow): TaskRow =>
  task.reminder?.startsWith('Today ') ? { ...task, reminder: task.reminder.slice(6) } : task;

const openTasks = (view: ListView | null): TaskRow[] =>
  (view?.items ?? []).flatMap((item) =>
    item.kind === 'task' && !item.task.done ? [item.task] : [],
  );

/** `YYYY-MM-DDTHH:MM`, later than now. */
const isLater = (at: string, now: Date): boolean => (parseAt(at)?.getTime() ?? 0) > now.getTime();

/** D-109, Q4: Today's pinned (Today's order), then later reminders today that aren't pinned. */
function todayRows(
  view: ListView | null,
  now: Date,
): { rows: TaskRow[]; routes: Map<string, Route> } {
  const routes = new Map<string, Route>();
  if (!view?.today) return { rows: [], routes };
  const high = new Set(view.today.high);
  const pinned = openTasks(view)
    .filter((task) => !high.has(task.key))
    .map((task) => {
      routes.set(task.key, { listId: TODAY_ID, homeId: task.home?.listId ?? INBOX_ID });
      return todayTime(task);
    });
  const placed = new Set(pinned.map((row) => row.key));
  // D-111: with today's reminders turned off too (struck), so the bell turns them back on.
  const muted = new Set((view.today.muted ?? []).map((each) => each.key));
  const coming = [...view.today.reminders, ...(view.today.muted ?? [])]
    .filter((each) => !each.done && !placed.has(each.key) && isLater(each.at, now))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((each): TaskRow => {
      routes.set(each.key, { listId: each.listId, homeId: each.listId });
      return {
        key: each.key,
        title: each.title,
        label: each.title,
        code: null,
        priority: null,
        reminder: each.time,
        reminderAt: each.at,
        reminderState: muted.has(each.key) ? 'muted' : 'on',
        done: false,
        completed: null,
        body: '',
        subtasks: [],
      };
    });
  return { rows: [...pinned, ...coming], routes };
}

function inboxRows(view: ListView | null): { rows: TaskRow[]; routes: Map<string, Route> } {
  const routes = new Map<string, Route>();
  const rows = openTasks(view).map((task) => {
    routes.set(task.key, { listId: INBOX_ID, homeId: INBOX_ID });
    return todayTime(task);
  });
  return { rows, routes };
}

export function MiniApp(): ReactElement {
  const [tab, setTabState] = useState<MiniTab>('today');
  const [onTop, setOnTop] = useState(true);
  const [lists, setLists] = useState<readonly ListSummary[]>([]);
  const [today, setToday] = useState<ListView | null>(null);
  const [inbox, setInbox] = useState<ListView | null>(null);
  const [alerts, setAlerts] = useState<readonly MiniAlert[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const { toast, showToast, hideToast } = useToast(TOAST_MS);
  // NOTE-10: the Note tab's editor changes with their own Undo (a table's row deleted).
  useEffect(() => {
    const onUndoNotice = (event: Event): void =>
      showUndoNotice(showToast, hideToast, (event as CustomEvent<UndoNotice>).detail);
    // D-144: an editor's question (a table's edge drag taking away text): Delete / Cancel.
    const onConfirmNotice = (event: Event): void =>
      showQuestion(showToast, hideToast, (event as CustomEvent<ConfirmNotice>).detail);
    window.addEventListener('flint:notice-undo', onUndoNotice);
    window.addEventListener('flint:notice-confirm', onConfirmNotice);
    return () => {
      window.removeEventListener('flint:notice-undo', onUndoNotice);
      window.removeEventListener('flint:notice-confirm', onConfirmNotice);
    };
  }, [showToast, hideToast]);
  // The Note tab: the note shown ('' a new one, not made yet; null: to be chosen), its view.
  const [noteId, setNoteId] = useState<string | null>(null);
  // D-131: a quick note shown here isn't removed for having been left empty in the main window.
  useEffect(() => {
    if (noteId) window.flintMain.quickNoteOpened(noteId);
  }, [noteId]);
  const [noteView, setNoteView] = useState<ListView | null>(null);
  const [kept, setKept] = useState(false);
  // Notes made here (the lists may not have them yet), and notes removed (the lists may still).
  const made = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  const composer = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // D-114: while another tab rises in (8 px, `view-in`), the body never shows a scrollbar for it;
  // the Note tab fills the card, so the rise alone would overflow it for a moment.
  const shownTab = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = body.current;
    const before = shownTab.current;
    shownTab.current = tab;
    if (!element || before === null || before === tab || reducedMotion()) return;
    element.classList.add('switching');
    const timer = setTimeout(
      () => element.classList.remove('switching'),
      durationMs('--fl-dur-page', 320) + 40,
    );
    return () => {
      clearTimeout(timer);
      element.classList.remove('switching');
    };
  }, [tab]);
  const seq = useRef(0);
  const noteRef = useRef<string | null>(null);
  noteRef.current = noteId;
  const tabRef = useRef(tab);
  tabRef.current = tab;

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
    setNow(new Date());
    // D-110: a note that is gone (an empty one removed when it was left) is never shown again.
    if (note && !nextNote && !made.current.has(note)) {
      removed.current.add(note);
      if (noteRef.current === note) setNoteId(null);
    }
    setNoteView(nextNote);
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
    // APP-11, D-110: the animation speed, as in the main window.
    void window.flintMain.settings().then((settings) => {
      if (settings) applySpeed(settings.animationSpeed);
    });
    window.flintMain.onAppearance((appearance) => applySpeed(appearance.animationSpeed));
    void window.flintMini.alerts().then(setAlerts);
    window.flintMain.onChanged(() => void refreshRef.current());
    window.flintMini.onAlerts(setAlerts);
    window.flintMini.onShown(({ focus }) => {
      void refreshRef.current();
      if (focus && tabRef.current === 'note')
        window.setTimeout(() => body.current?.querySelector<HTMLElement>('.cm-content')?.focus());
    });
    window.flintMini.onHiding(() => leaveRef.current());
    void refreshRef.current();
    // The clock: reminders later today come and go.
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // The note shown: the remembered one while it is a quick note, else the most recent one, else a
  // new one (made on the first keystroke). Never one that was removed (D-110).
  const quickNotes = lists
    .filter((list) => list.quick && !removed.current.has(list.id))
    .sort((a, b) => (b.quick?.at ?? 0) - (a.quick?.at ?? 0));
  /** D-122: every note, for Open a note… (the note opened here stays while it exists). */
  const notes = lists.filter((list) => list.mode === 'note' && !removed.current.has(list.id));
  useEffect(() => {
    if (tab !== 'note' || lists.length === 0) return;
    if (noteId === '') return;
    if (
      noteId &&
      !removed.current.has(noteId) &&
      (kept || made.current.has(noteId) || lists.some((list) => list.id === noteId))
    )
      return;
    const next = quickNotes[0]?.id ?? '';
    setNoteId(next);
    window.flintMini.setState({ noteId: next || null });
  }, [tab, lists, noteId, kept]);
  useEffect(() => {
    if (noteId) void refreshRef.current();
    else setNoteView(null);
  }, [noteId]);

  /** Leaving the note (another tab, mini hidden, another note): an empty one goes (NOTE-08). */
  const leaveNote = (): void => {
    const id = noteRef.current;
    setKept(false);
    if (!id) return;
    const list = lists.find((each) => each.id === id);
    if (list && !list.quick) return;
    void window.flintMain.discardQuickNote(id).then(async (gone) => {
      if (!gone) return;
      removed.current.add(id);
      made.current.delete(id);
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

  const { rows, routes } =
    tab === 'today'
      ? todayRows(today, now)
      : tab === 'inbox'
        ? inboxRows(inbox)
        : { rows: [], routes: new Map<string, Route>() };
  const safeSelected = rows.some((row) => row.key === selected) ? selected : null;
  const routeOf = (key: string): Route =>
    routes.get(key) ?? { listId: tab === 'today' ? TODAY_ID : INBOX_ID, homeId: INBOX_ID };
  // Done: in Completed, or (Today's pinned, D-92) still among the items, faded.
  const doneIn = (view: ListView | null): string[] => [
    ...(view?.completed ?? []).map((task) => task.key),
    ...(view?.items ?? []).flatMap((item) =>
      item.kind === 'task' && item.task.done ? [item.task.key] : [],
    ),
  ];
  const doneKeys = new Set([
    ...doneIn(today),
    ...doneIn(inbox),
    ...(today?.today?.reminders ?? []).filter((each) => each.done).map((each) => each.key),
  ]);

  const complete = async (key: string): Promise<void> => {
    const index = rows.findIndex((each) => each.key === key);
    if (safeSelected === key) setSelected(rows[index + 1]?.key ?? rows[index - 1]?.key ?? null);
    const label = await window.flintMain.toggle(routeOf(key).listId, key);
    if (label) showToast(label, true);
  };
  /** REM-12, D-111: the bell turns the reminder off and on. */
  const mute = async (key: string, off: boolean): Promise<void> => {
    const outcome = await window.flintMain.change(routeOf(key).listId, {
      kind: 'mute',
      key,
      muted: off,
    });
    if (outcome?.label) showToast(outcome.label, true);
  };
  const pin = async (task: TaskRow, pinned: boolean): Promise<void> => {
    const outcome = await window.flintMain.change(routeOf(task.key).listId, {
      kind: 'pin',
      key: task.key,
      pinned,
    });
    if (outcome?.label) showToast(outcome.label, true);
  };
  const open = (key: string): void => window.flintMini.open({ listId: routeOf(key).homeId, key });
  const undo = async (which: 'undo' | 'redo'): Promise<void> => {
    const label = await (which === 'undo' ? window.flintMain.undo() : window.flintMain.redo());
    if (which === 'undo') showToast(label ? `Undid: ${label}` : 'Nothing to undo', false);
    else showToast(label ? `Redid: ${label}` : 'Nothing to redo', false);
  };
  const rowMenu = (task: TaskRow, at: { x: number; y: number }): void => {
    setSelected(task.key);
    const entries: MenuEntry[] = [
      { label: 'Complete', hint: 'Space', action: () => void complete(task.key) },
      {
        label: task.pinned ? 'Unpin' : 'Pin',
        hint: 'P',
        action: () => void pin(task, !task.pinned),
      },
      'divider',
      { label: 'Open in Flint', hint: 'Enter', action: () => open(task.key) },
    ];
    openMenu(entries, at);
  };
  /** Today's pinned rows and Inbox's rows reorder; Today's reminders keep their time order. */
  const movable = (key: string): boolean =>
    tab === 'inbox' || (tab === 'today' && routeOf(key).listId === TODAY_ID);
  const place = async (
    key: string,
    where: { readonly at: 'before' | 'after'; readonly key: string },
  ): Promise<boolean> =>
    (await window.flintMain.change(routeOf(key).listId, { kind: 'place', key, where })) !== null;
  const move = (key: string, direction: 'up' | 'down'): void => {
    if (!movable(key)) {
      nudge(key, direction);
      return;
    }
    void window.flintMain
      .change(routeOf(key).listId, { kind: 'move', key, direction })
      .then((outcome) => {
        // D-87: Alt+↑ on the first task, Alt+↓ on the last: a nudge.
        if (!outcome) nudge(key, direction);
      });
  };

  const alert = alerts[0] ?? null;
  const act = (action: MiniAlertAction): void => {
    if (alert) window.flintMini.alertAction(alert.id, action);
  };
  const upcoming =
    tab === 'today'
      ? ((today?.today?.reminders ?? [])
          .filter((each) => !each.done && isLater(each.at, now))
          .sort((a, b) => a.at.localeCompare(b.at))[0] ?? null)
      : null;

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
      const row = rows.find((each) => each.key === safeSelected) ?? null;
      // TASK-02, D-110: Alt+↑/↓ moves the selected task, as in the main window.
      if (
        event.altKey &&
        !event.ctrlKey &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        if (row) move(row.key, event.key === 'ArrowDown' ? 'down' : 'up');
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
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
        void complete(row.key);
      } else if (key === 'p' && row) {
        event.preventDefault();
        void pin(row, !row.pinned);
      } else if (event.key === 'Enter' && row) {
        event.preventDefault();
        open(row.key);
      } else if (key === 'n' && tab !== 'note') {
        event.preventDefault();
        composer.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The selected row stays in view.
  useEffect(() => {
    if (!safeSelected) return;
    body.current
      ?.querySelector(`.row[data-key="${CSS.escape(safeSelected)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'instant' : 'smooth' });
  }, [safeSelected]);

  const listId = tab === 'today' ? TODAY_ID : INBOX_ID;
  const add = async (text: string, chooseNewList: boolean): Promise<void> => {
    const outcome = await window.flintMain.change(listId, {
      kind: 'add',
      text,
      where: 'top',
      ...(chooseNewList && { chooseNewList }),
    });
    if (!outcome?.key) return;
    // Today's tasks are made in Inbox, pinned: that is no other place to tell about.
    if (outcome.listId === listId || (listId === TODAY_ID && outcome.listId === INBOX_ID)) return;
    // D-147: the way to it, as Open does: the main window at that list, the task flashed there.
    const { key, listId: target, listName } = outcome;
    showToast(outcome.label, true, {
      label: `Go to ${listName}`,
      run: () => window.flintMini.open({ listId: target, key }),
    });
  };

  const quick = lists.find((list) => list.id === noteId) ?? null;
  const stage = useStage({
    card: cardRef,
    version: `${tab}:${noteId ?? ''}`,
    full: tab === 'note',
  });
  useShowMotion(cardRef);
  const selectReminder = (reminder: TodayReminder): void => setSelected(reminder.key);

  return (
    <div className="mini-stage">
      <div className={stage.className} ref={cardRef} style={stage.style} data-corner={stage.corner}>
        <span className="mini-grip" aria-hidden="true" />
        <header className="mini-head">
          <div className="trash-tabs mini-tabs" role="tablist" aria-label="Mini mode">
            {TABS.map((each, index) => (
              <button
                key={each.id}
                type="button"
                role="tab"
                aria-selected={tab === each.id}
                className={tab === each.id ? 'trash-tab on' : 'trash-tab'}
                title={`${each.name} (Ctrl+${index + 1})`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTab(each.id)}
              >
                {each.name}
              </button>
            ))}
          </div>
          <span className="mini-head-space" />
          {/* D-111: back to the default size, while the size differs from it. */}
          <button
            type="button"
            className={stage.resized ? 'tool mini-reset on' : 'tool mini-reset'}
            aria-label="Reset size"
            title="Reset size"
            tabIndex={stage.resized ? 0 : -1}
            aria-hidden={!stage.resized}
            onMouseDown={(event) => event.preventDefault()}
            onClick={stage.reset}
          >
            <ResetSizeIcon size={13} />
          </button>
          <button
            type="button"
            className={onTop ? 'tool mini-pin on' : 'tool mini-pin'}
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
            className="tool"
            aria-label="Hide mini mode"
            title="Hide (Ctrl+Alt+Space)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => window.flintMini.hide()}
          >
            <CloseIcon size={13} />
          </button>
        </header>

        <MiniReminder
          alert={alert}
          waiting={alerts.length}
          upcoming={upcoming}
          onAct={act}
          onSelect={selectReminder}
          onOpen={(reminder) =>
            window.flintMini.open({ listId: reminder.listId, key: reminder.key })
          }
        />

        <div className="mini-body" ref={body}>
          <div className={tab === 'note' ? 'mini-view note' : 'mini-view'} key={tab}>
            {tab !== 'note' && rows.length === 0 && (
              <p className="empty">
                {tab === 'today' ? 'Nothing pinned for today.' : 'Inbox is empty.'}
              </p>
            )}
            {tab !== 'note' && (
              <MiniList
                rows={rows}
                scope={`${tab}:${(tab === 'today' ? today : inbox) ? 'ready' : 'loading'}`}
                selected={safeSelected}
                draggable={movable}
                isDone={(key) => doneKeys.has(key)}
                onSelect={setSelected}
                onToggle={(key) => void complete(key)}
                onPin={(task, pinned) => void pin(task, pinned)}
                onMute={(key, off) => void mute(key, off)}
                onMenu={rowMenu}
                onOpen={(task) => open(task.key)}
                onPlace={place}
              />
            )}
            {tab === 'note' && noteId !== null && (
              <NoteTab
                noteId={noteId}
                view={noteView}
                quick={quick}
                quickNotes={quickNotes}
                notes={notes}
                kept={kept}
                onMade={(id) => {
                  made.current.add(id);
                  setNoteId(id);
                  window.flintMini.setState({ noteId: id });
                }}
                onSwitch={(id) => {
                  leaveRef.current();
                  setNoteId(id);
                  window.flintMini.setState({ noteId: id || null });
                }}
                onKeep={() => {
                  if (!noteId) return;
                  void window.flintMain.keepQuickNote(noteId).then(() => setKept(true));
                }}
                onToast={showToast}
              />
            )}
          </div>
        </div>

        {tab !== 'note' && (
          <Composer
            key={tab}
            compact
            listId={listId}
            lists={lists}
            inputRef={composer}
            placeholder={tab === 'today' ? 'Add to Today…' : 'Add to Inbox…'}
            onAdd={add}
          />
        )}

        {toast && (
          <ToastView
            key={toast.id}
            toast={toast}
            onHide={hideToast}
            onUndo={() => {
              hideToast();
              void undo('undo');
            }}
          />
        )}

        {stage.handles.map((handle) => (
          <span
            key={handle.id}
            className={handle.className}
            aria-hidden="true"
            onPointerDown={(event) => stage.startResize(handle, event)}
          />
        ))}
      </div>
    </div>
  );
}
