import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { parseCapture, type ListInfo, type TokenKind } from '@flint/core/shorthand';
import { parseLocalDateTime } from '@flint/core/time';
import { listShorthand, PRIORITY_TOKENS, timeShorthand } from '../../shared/tokens.js';
import {
  openListPicker,
  openPriorityPicker,
  openTimePicker,
  type PickerHost,
} from '../pickers/pickers.js';
import flintIcon from '../../../../../assets/icon/flint-icon-512.svg';
import type {
  ChangeOutcome,
  ListChange,
  ListSummary,
  ListView,
  TaskRow,
} from '../../shared/ipc.js';
import {
  BackIcon,
  BellIcon,
  BodyIcon,
  CheckIcon,
  ChevronIcon,
  FlagIcon,
  HashIcon,
  InboxIcon,
  ListIcon,
  NoteIcon,
  PlusIcon,
  ReminderBellIcon,
} from './icons.js';
import { rawOffset, titleHtml } from '../../shared/inline-markdown.js';
import { isTextField, openMenu, textFieldMenu, type MenuEntry } from '../menu/menu.js';

import { NoteEditor } from './NoteEditor.js';
import { BodyEditor, BodyView, bodyFits } from './Body.js';
import { enableAutoPair } from '../auto-pair.js';
import { useInertText } from './inert-text.js';

/**
 * The main window (M4, D-48 daily-use slice): the sidebar with the lists, a list's tasks with the
 * non-task content around them (TASK-15), the composer, and the Navigate/Edit model of docs/03 §2:
 * a selected row takes single-key commands, a text cursor types. Completion has an undo toast and
 * the Completed section (TASK-06). Matches docs/design/mockups/01-main-inbox.html.
 */

const INBOX_SUBTITLE = 'Everything you captured, waiting to be sorted.';
const TOAST_MS = 5000;

/** Navigate state: 1 / 2 / 3 / 0 set low / medium / high / none (TASK-03). */
const PRIORITY_KEYS: Readonly<Record<string, TaskRow['priority']>> = {
  '1': 'low',
  '2': 'medium',
  '3': 'high',
  '0': null,
};
const PRIORITY_NAMES = { high: 'High', medium: 'Medium', low: 'Low' } as const;
interface Point {
  readonly x: number;
  readonly y: number;
}

/** A list's name being typed in the sidebar (LIST-01). */
type Naming =
  | { readonly kind: 'new'; readonly mode: 'tasks' | 'note' }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string };

/** The lists as the shorthand and the pickers see them, most recently used ranked (D-25). */
function listInfos(lists: readonly ListSummary[]): ListInfo[] {
  return lists.map((list): ListInfo => ({
    id: list.id,
    name: list.name,
    mode: list.mode,
    ...(list.recentRank === undefined ? {} : { recentRank: list.recentRank }),
  }));
}

/** Before a list's rows arrive: select its first row once they do. */
const FIRST_ROW = '';

let seq = 0;

interface Toast {
  readonly text: string;
  readonly undo: boolean;
  readonly id: number;
}

/**
 * Edit state (docs/03 §2): a task's title, or a new row below a task (Edit-state Enter). `level`:
 * Tab and Shift+Tab on an empty new row nest it under the task above or lift it out. `seq` starts
 * a fresh text field each time.
 *
 * A new row stays one text field while Enter adds task after task: `added` are the tasks it has
 * added so far, newest last, and the row sits below the newest one already shown. Nothing typed
 * while a save is in flight is lost, and the field is never moved (moving it would drop focus).
 */
type Editing =
  | {
      readonly kind: 'task';
      readonly key: string;
      readonly seq: number;
      /** D-71: where the caret starts, in the raw title; the end when not given. */
      readonly caret?: number;
    }
  | {
      readonly kind: 'new';
      readonly after: string;
      readonly added: readonly string[];
      readonly level: 'same' | 'in' | 'out';
      readonly seq: number;
    };

type NewEditing = Extract<Editing, { kind: 'new' }>;

const newRow = (after: string): NewEditing => ({
  kind: 'new',
  after,
  added: [],
  level: 'same',
  seq: ++seq,
});

/** How a text field was left. */
type Leave = 'enter' | 'escape' | 'blur' | 'indent' | 'outdent';

/** A duration token in ms (09 §9), so JS timings follow the motion tokens (and the M8 speed). */
function durationMs(token: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * D-75: a copy of a row that has just been completed or reopened, playing the completion animation
 * where the row was, while the task itself is already in its new place. Not interactive.
 */
interface Ghost {
  readonly id: number;
  readonly task: TaskRow;
  readonly subtask: boolean;
  readonly direction: 'complete' | 'reopen';
  /** The row it follows in its section (the open tasks, or Completed); null: the first. */
  readonly after: string | null;
}

let ghostSeq = 0;

const withSubtasks = (tasks: readonly TaskRow[]): TaskRow[] =>
  tasks.flatMap((task) => [task, ...task.subtasks]);

/**
 * The rows that changed sides between two views of a list, by any cause (Space, undo, redo, a
 * reminder's Done): a ghost where each was, and the keys that now ease in at their new place.
 */
function departed(before: ListView, after: ListView): { ghosts: Ghost[]; moved: string[] } {
  const openTasks = (view: ListView): TaskRow[] =>
    view.items.flatMap((item) => (item.kind === 'task' ? [item.task] : []));
  const nowOpen = new Set(withSubtasks(openTasks(after)).map((row) => row.key));
  const nowDone = new Set(withSubtasks(after.completed).map((row) => row.key));
  const ghosts: Ghost[] = [];
  const moved: string[] = [];
  for (const [tasks, direction, there, here] of [
    [openTasks(before), 'complete', nowDone, nowOpen],
    [before.completed, 'reopen', nowOpen, nowDone],
  ] as const) {
    const rows = withSubtasks(tasks);
    for (const task of tasks) {
      // The task (its subtasks go with it), or a subtask that moved on its own.
      const went = there.has(task.key) ? [task] : task.subtasks.filter((sub) => there.has(sub.key));
      for (const row of went) {
        const index = rows.indexOf(row);
        const previous = rows
          .slice(0, index)
          .reverse()
          .find((other) => here.has(other.key));
        ghosts.push({
          id: ++ghostSeq,
          task: row,
          subtask: row !== task,
          direction,
          after: previous?.key ?? null,
        });
        moved.push(row.key, ...(row === task ? task.subtasks.map((sub) => sub.key) : []));
      }
    }
  }
  return { ghosts, moved };
}

/** NAV-04: where the main window is: a list, or one of its tasks as a page (TASK-05). */
interface Place {
  readonly list: string;
  readonly page: string | null;
}

/** The task with this key in a list's view, subtasks and completed tasks included. */
function findRow(view: ListView, key: string): TaskRow | null {
  const tasks = [
    ...view.items.flatMap((item) => (item.kind === 'task' ? [item.task] : [])),
    ...view.completed,
  ];
  return withSubtasks(tasks).find((row) => row.key === key) ?? null;
}

const hasBody = (task: TaskRow): boolean => task.body.trim() !== '';

/** The rows the keyboard moves through, top to bottom (Navigate state, docs/03 §2). */
function visibleRows(view: ListView | null, completedOpen: boolean): TaskRow[] {
  if (!view) return [];
  const rows: TaskRow[] = [];
  for (const item of view.items) {
    if (item.kind !== 'task') continue;
    rows.push(item.task, ...item.task.subtasks);
  }
  if (completedOpen) for (const task of view.completed) rows.push(task, ...task.subtasks);
  return rows;
}

export function App(): ReactElement {
  const [lists, setLists] = useState<readonly ListSummary[]>([]);
  const [listId, setListId] = useState('inbox');
  const [view, setView] = useState<ListView | null>(null);
  const [selected, setSelected] = useState<string | null>(FIRST_ROW);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** TASK-05, D-53: the task shown as a page instead of its list. */
  const [page, setPage] = useState<string | null>(null);
  /** Small bodies shown inline under their rows, and the body being edited there (D-49). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const [completedOpen, setCompletedOpen] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const composer = useRef<HTMLInputElement>(null);

  /** A list's name being typed in the sidebar: a new list or note, or a rename (LIST-01). */
  const [naming, setNaming] = useState<Naming | null>(null);
  const [namingProblem, setNamingProblem] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /** The sidebar's highlight glides to the open list like the row selection (UI-04, D-65). */
  const sidebar = useRef<HTMLElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [nextLists, nextView] = await Promise.all([
      window.flintMain.lists(),
      window.flintMain.view(listId),
    ]);
    setLists(nextLists);
    setView(nextView);
  }, [listId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // REM-11: a reminder turns overdue on its own when its time passes.
  useEffect(() => {
    const timer = window.setInterval(() => void refreshRef.current(), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    window.flintMain.onChanged(() => void refreshRef.current());
    // A reminder's Open: its list, with the task selected once the rows are there.
    window.flintMain.onReveal(({ listId: id, key }) => {
      goRef.current({ list: id, page: null }, key);
    });
  }, []);

  /**
   * NAV-04: the views shown this session, for back and forward (Alt+← / Alt+→, the mouse's side
   * buttons). Going somewhere new drops the forward part, as in a browser.
   */
  const history = useRef<{ places: Place[]; at: number }>({
    places: [{ list: 'inbox', page: null }],
    at: 0,
  });
  const show = useCallback((place: Place, select: string | null = null): void => {
    setListId(place.list);
    setPage(place.page);
    setSelected(select ?? FIRST_ROW);
    setEditing(null);
    setEditingBody(null);
  }, []);
  const go = useCallback(
    (place: Place, select: string | null = null): void => {
      const trail = history.current;
      const here = trail.places[trail.at];
      if (here?.list !== place.list || here.page !== place.page) {
        trail.places = [...trail.places.slice(0, trail.at + 1), place];
        trail.at = trail.places.length - 1;
      }
      show(place, select);
    },
    [show],
  );
  const goRef = useRef(go);
  goRef.current = go;
  const travel = useCallback(
    (step: -1 | 1): void => {
      const trail = history.current;
      const from = trail.places[trail.at];
      const to = trail.places[trail.at + step];
      if (!to) return;
      trail.at += step;
      // Back from a task's page selects that task in its list.
      show(to, from?.page && !to.page && to.list === from.list ? from.page : null);
    },
    [show],
  );
  /** A page's back arrow and Esc: back, or to the page's list when there is no history. */
  const leavePage = useCallback((): void => {
    const trail = history.current;
    const previous = trail.places[trail.at - 1];
    if (previous && previous.list === listId && !previous.page) travel(-1);
    else go({ list: listId, page: null }, page);
  }, [go, travel, listId, page]);

  const openList = useCallback((id: string): void => go({ list: id, page: null }), [go]);
  const openPage = useCallback(
    (key: string): void => go({ list: listId, page: key }, key),
    [go, listId],
  );

  /**
   * TASK-05, D-53: the body indicator, a code row or →: a small body opens inline under its row, a
   * larger one as the task's page (its only view); shown inline, it closes again.
   */
  const showBody = useCallback(
    async (task: TaskRow): Promise<void> => {
      if (expanded.has(task.key)) {
        setExpanded((current) => new Set([...current].filter((key) => key !== task.key)));
        return;
      }
      const column = content.current;
      if (column && (await bodyFits(task.body, column)))
        setExpanded((current) => new Set([...current, task.key]));
      else openPage(task.key);
    },
    [expanded, openPage],
  );

  // NAV-04: the mouse's back and forward buttons.
  useEffect(() => {
    const onButton = (event: MouseEvent): void => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      travel(event.button === 3 ? -1 : 1);
    };
    window.addEventListener('mouseup', onButton);
    return () => window.removeEventListener('mouseup', onButton);
  }, [travel]);

  const showToast = useCallback((text: string, undo: boolean): void => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const change = useCallback(
    (next: ListChange): Promise<ChangeOutcome | null> => window.flintMain.change(listId, next),
    [listId],
  );

  const rows = useMemo(() => visibleRows(view, completedOpen), [view, completedOpen]);

  // A fresh list selects its first row. A row that went away hands the selection to the row now
  // in its place; a task just added isn't in the rows until the next refresh, so it is waited for.
  const previousRows = useRef<TaskRow[]>([]);
  useEffect(() => {
    const before = previousRows.current;
    previousRows.current = rows;
    if (selected === null || rows.some((row) => row.key === selected)) return;
    if (selected === FIRST_ROW) {
      if (rows[0]) setSelected(rows[0].key);
      return;
    }
    const gone = before.findIndex((row) => row.key === selected);
    if (gone >= 0) setSelected(rows[Math.min(gone, rows.length - 1)]?.key ?? FIRST_ROW);
  }, [rows, selected]);

  /**
   * TASK-06, D-75: a completed or reopened task moves at once, by whatever means (Space, undo,
   * redo, a reminder's Done); a ghost of its row plays the completion animation where it was, and
   * the task eases in at its new place. Nothing waits for the animation. Instant with reduce-motion.
   */
  const [ghosts, setGhosts] = useState<readonly Ghost[]>([]);
  const [moved, setMoved] = useState<ReadonlySet<string>>(new Set());
  const lastView = useRef<ListView | null>(null);
  useLayoutEffect(() => {
    const before = lastView.current;
    lastView.current = view;
    if (!before || !view || before.id !== view.id) {
      setGhosts([]);
      setMoved(new Set());
      return;
    }
    if (view.mode !== 'tasks' || reducedMotion()) return;
    const found = departed(before, view);
    if (found.ghosts.length === 0) return;
    setGhosts((current) => [...current, ...found.ghosts]);
    setMoved((current) => new Set([...current, ...found.moved]));
    const ids = new Set(found.ghosts.map((ghost) => ghost.id));
    window.setTimeout(
      () => {
        setGhosts((current) => current.filter((ghost) => !ids.has(ghost.id)));
        setMoved((current) => new Set([...current].filter((key) => !found.moved.includes(key))));
      },
      durationMs('--fl-dur-complete', 400),
    );
  }, [view]);

  const toggle = useCallback(
    async (key: string): Promise<void> => {
      const index = rows.findIndex((row) => row.key === key);
      const row = rows[index];
      if (row && !row.done) {
        // Completing moves the row away: the selection stays in the open tasks, on the next one.
        const open = (other: TaskRow): boolean =>
          !other.done && other.key !== key && !row.subtasks.some((sub) => sub.key === other.key);
        const next = rows.slice(index + 1).find(open) ?? rows.slice(0, index).reverse().find(open);
        if (next) setSelected(next.key);
      }
      const done = await window.flintMain.toggle(listId, key);
      if (done) showToast(done, true);
    },
    [listId, rows, showToast],
  );

  /** Undo or redo (DATA-03); a task it completes or reopens animates like Space (D-69, D-75). */
  const step = useCallback(
    async (which: 'undo' | 'redo'): Promise<void> => {
      const label = await (which === 'undo' ? window.flintMain.undo() : window.flintMain.redo());
      if (which === 'undo') showToast(label ? `Undid: ${label}` : 'Nothing to undo', false);
      else showToast(label ? `Redid: ${label}` : 'Nothing to redo', false);
    },
    [showToast],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  const edit = useCallback((key: string, caret?: number): void => {
    setSelected(key);
    setEditing({ kind: 'task', key, seq: ++seq, ...(caret !== undefined && { caret }) });
  }, []);

  // The new row reads the latest Edit state when a key arrives, before React has re-rendered.
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const leaveTask = useCallback(
    (key: string, text: string, how: Leave): void => {
      // Switch first, save after: what is typed next lands in the new row, not in a closed field.
      if (how === 'enter') setEditing(newRow(key));
      else {
        setEditing((current) => (current?.kind === 'task' && current.key === key ? null : current));
        setSelected(key);
      }
      void change({ kind: 'edit', key, text });
    },
    [change],
  );

  /** Tab and Shift+Tab in Edit state (TASK-04): a task moves at once; a new row changes level. */
  const tab = useCallback(
    (how: 'indent' | 'outdent'): void => {
      const current = editingRef.current;
      if (current?.kind === 'task') void change({ kind: how, key: current.key });
      if (current?.kind === 'new') {
        const level = how === 'indent' ? 'in' : 'out';
        setEditing({ ...current, level: current.level === 'same' ? level : 'same' });
      }
    },
    [change],
  );

  const leaveNew = useCallback(
    (text: string, empty: boolean, how: Leave, id: string | null): void => {
      const current = editingRef.current;
      if (current?.kind !== 'new') return;
      if (empty) {
        // Back to Navigate on the last task the row added (or the one it started below).
        setEditing(null);
        setSelected(current.added.at(-1) ?? current.after);
        return;
      }
      // `##list` sends the task elsewhere (D-25): the row stays below the same task here.
      const infos = lists.map((list): ListInfo => ({
        id: list.id,
        name: list.name,
        mode: list.mode,
      }));
      const target = parseCapture(text, { now: new Date(), lists: infos }).target;
      const here =
        target.kind === 'inbox' ||
        target.kind === 'note' ||
        target.kind === 'invalid-name' ||
        ((target.kind === 'existing' || target.kind === 'close-match') &&
          target.list.id === listId);
      const anchor = current.added.at(-1) ?? current.after;
      void change({ kind: 'add', text, where: { after: anchor }, ...(id ? { id } : {}) }).then(
        (outcome) => {
          if (outcome && outcome.listId !== listId) showToast(outcome.label, true);
        },
      );
      const key = here ? id : null;
      if (key && current.level !== 'same')
        void change({ kind: current.level === 'in' ? 'indent' : 'outdent', key });
      if (how === 'enter') {
        setEditing({
          ...current,
          added: key ? [...current.added, key] : current.added,
          level: 'same',
        });
        return;
      }
      setEditing(null);
      if (key) setSelected(key);
    },
    [change, listId, lists, showToast],
  );

  const addFromComposer = useCallback(
    async (text: string): Promise<void> => {
      const outcome = await change({ kind: 'add', text, where: 'top' });
      if (!outcome?.key) return;
      if (outcome.listId !== listId) showToast(outcome.label, true);
      else setSelected(outcome.key);
    },
    [change, listId, showToast],
  );

  /** TASK-12, D-50: to Trash storage, with Undo. */
  const remove = useCallback(
    async (key: string): Promise<void> => {
      const outcome = await change({ kind: 'delete', key });
      if (outcome) showToast(outcome.label, true);
    },
    [change, showToast],
  );

  /** TASK-11: to the top of another list, or a new one, with Undo. */
  const moveTask = useCallback(
    async (key: string, to: Extract<ListChange, { kind: 'moveTo' }>['to']): Promise<void> => {
      const outcome = await change({ kind: 'moveTo', key, to });
      if (outcome) showToast(outcome.label, true);
    },
    [change, showToast],
  );

  /** REM-12, D-66: turns a reminder off (kept, never fired) or on, with Undo. */
  const mute = useCallback(
    async (key: string, muted: boolean): Promise<void> => {
      const outcome = await change({ kind: 'mute', key, muted });
      if (outcome) showToast(outcome.label, true);
    },
    [change, showToast],
  );

  /** REM-01, D-68: a new time for a task's reminder, also one that already fired; with Undo. */
  const changeReminder = useCallback(
    (row: TaskRow, anchor: DOMRect): void => {
      const current = row.reminderAt ? (parseLocalDateTime(row.reminderAt)?.value ?? null) : null;
      openTimePicker(
        { anchor, returnFocus: null },
        new Date(),
        current,
        (at) =>
          void change({ kind: 'reminder', key: row.key, at }).then((outcome) => {
            if (outcome) showToast(outcome.label, true);
          }),
      );
    },
    [change, showToast],
  );

  /** UI-08, D-55: a task's right-click menu (also Shift+F10 and the Menu key). */
  const taskMenu = useCallback(
    (row: TaskRow, at: Point): void => {
      const open = !row.done;
      const priority = (label: string, hint: string, value: TaskRow['priority']): MenuEntry => ({
        label,
        hint,
        action: () => void change({ kind: 'priority', key: row.key, priority: value }),
      });
      openMenu(
        [
          ...(open ? [{ label: 'Edit', hint: 'Enter', action: () => edit(row.key) }] : []),
          { label: 'Open as page', hint: 'Shift+Enter', action: () => openPage(row.key) },
          {
            label: open ? 'Complete' : 'Reopen',
            hint: 'Space',
            action: () => void toggle(row.key),
          },
          'divider',
          ...(open
            ? [
                priority('Priority high', '3', 'high'),
                priority('Priority medium', '2', 'medium'),
                priority('Priority low', '1', 'low'),
                priority('No priority', '0', null),
                'divider' as const,
              ]
            : []),
          ...(open
            ? [
                {
                  label: row.reminder ? 'Change reminder…' : 'Set reminder…',
                  action: () => changeReminder(row, new DOMRect(at.x, at.y, 0, 0)),
                },
              ]
            : []),
          ...(open && row.reminder
            ? [
                {
                  label: row.reminderState === 'muted' ? 'Turn reminder on' : 'Turn reminder off',
                  action: () => void mute(row.key, row.reminderState !== 'muted'),
                },
              ]
            : []),
          {
            label: 'Move to…',
            action: () =>
              openListPicker(
                {
                  anchor: new DOMRect(at.x, at.y, 0, 0),
                  returnFocus: null,
                },
                listInfos(lists),
                { exclude: listId, placeholder: 'Move to list…' },
                (pick) =>
                  void moveTask(
                    row.key,
                    'newList' in pick ? { newList: pick.newList } : { list: pick.list.id },
                  ),
              ),
          },
          'divider',
          { label: 'Delete', hint: 'Del', action: () => void remove(row.key) },
        ],
        at,
      );
    },
    [change, edit, mute, remove, toggle, lists, listId, moveTask, changeReminder],
  );

  /** LIST-01, D-52: the + next to "Lists", Ctrl+Shift+N and the sidebar's background. */
  const newListMenu = useCallback((at: Point): void => {
    const start = (mode: 'tasks' | 'note'): void => {
      setNamingProblem(null);
      setNaming({ kind: 'new', mode });
    };
    openMenu(
      [
        { label: 'New task list', hint: 'Ctrl+Shift+N', action: () => start('tasks') },
        { label: 'New note', action: () => start('note') },
      ],
      at,
    );
  }, []);

  const submitName = useCallback(
    async (name: string): Promise<void> => {
      if (!naming) return;
      const outcome = await window.flintMain.listAction(
        naming.kind === 'new'
          ? { kind: 'new', name, mode: naming.mode }
          : { kind: 'rename', id: naming.id, name },
      );
      if (!outcome) return;
      if (!outcome.ok) {
        setNamingProblem(outcome.problem);
        return;
      }
      setNaming(null);
      setNamingProblem(null);
      if (naming.kind === 'new') openList(outcome.listId);
      if (outcome.label) showToast(outcome.label, true);
    },
    [naming, openList, showToast],
  );

  /** D-55: a list's right-click menu; Inbox has none (LIST-03). */
  const listMenu = useCallback(
    (list: ListSummary, at: Point): void => {
      openMenu(
        [
          {
            label: 'Rename',
            action: () => {
              setNamingProblem(null);
              setNaming({ kind: 'rename', id: list.id, name: list.name });
            },
          },
          {
            label: list.mode === 'note' ? 'Delete note' : 'Delete list',
            action: () =>
              void window.flintMain.listAction({ kind: 'delete', id: list.id }).then((outcome) => {
                if (!outcome) return;
                if (!outcome.ok) return showToast(outcome.problem, false);
                if (listId === list.id) openList('inbox');
                showToast(outcome.label, true);
              }),
          },
        ],
        at,
      );
    },
    [listId, openList, showToast],
  );

  // UI-08: every text field keeps Cut / Copy / Paste / Select all; elsewhere Electron shows nothing.
  useEffect(() => {
    const onMenu = (event: MouseEvent): void => {
      event.preventDefault();
      if (isTextField(event.target))
        openMenu(
          textFieldMenu(event.target, (command) => window.flintMain.edit(command)),
          { x: event.clientX, y: event.clientY },
        );
    };
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      // Ctrl+Shift+N works anywhere in the window (LIST-01, D-52).
      if (key === 'n' && event.ctrlKey && event.shiftKey && !event.altKey) {
        event.preventDefault();
        const box = addButton.current?.getBoundingClientRect();
        newListMenu(box ? { x: box.left, y: box.bottom + 4 } : { x: 24, y: 120 });
        return;
      }
      // Ctrl+N works anywhere in the window (docs/03 §2, Q-08 default).
      if (key === 'n' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        composer.current?.focus();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      // NAV-04: back and forward, anywhere in the window.
      if (event.altKey && !event.ctrlKey && (key === 'arrowleft' || key === 'arrowright')) {
        event.preventDefault();
        travel(key === 'arrowleft' ? -1 : 1);
        return;
      }
      if (event.ctrlKey && !event.altKey && (key === 'z' || key === 'y')) {
        event.preventDefault();
        void (key === 'z' && !event.shiftKey ? undo() : redo());
        return;
      }
      if (event.ctrlKey || event.metaKey || view?.mode !== 'tasks') return;
      // A task's page: Esc goes back to its list (D-53).
      if (page) {
        if (event.key === 'Escape') {
          event.preventDefault();
          leavePage();
        }
        return;
      }
      const index = rows.findIndex((row) => row.key === selected);
      const row = rows[index];
      const open = row && !row.done ? row : undefined;

      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey) {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 'down' : 'up';
        if (event.altKey) {
          // Alt+↑/↓ reorders (TASK-02); single keys never reach Windows.
          if (open) void change({ kind: 'move', key: open.key, direction });
          return;
        }
        const step = direction === 'down' ? 1 : -1;
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
        if (next) setSelected(next.key);
        return;
      }
      if (event.altKey) return;
      if (event.key === 'ArrowRight' && row && hasBody(row)) {
        event.preventDefault();
        if (!expanded.has(row.key)) void showBody(row);
      } else if (event.key === 'ArrowLeft' && row && expanded.has(row.key)) {
        event.preventDefault();
        void showBody(row);
      } else if (event.key === 'Enter' && event.shiftKey && row) {
        // TASK-05, D-53: any task opens as a page.
        event.preventDefault();
        openPage(row.key);
      } else if (event.key === ' ' && row) {
        event.preventDefault();
        void toggle(row.key);
      } else if (event.key in PRIORITY_KEYS && open) {
        event.preventDefault();
        void change({
          kind: 'priority',
          key: open.key,
          priority: PRIORITY_KEYS[event.key] ?? null,
        });
      } else if (event.key === 'Enter' && open) {
        event.preventDefault();
        edit(open.key);
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        composer.current?.focus();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        if (open) void change({ kind: event.shiftKey ? 'outdent' : 'indent', key: open.key });
      } else if (event.key === 'Delete' && row) {
        event.preventDefault();
        void remove(row.key);
      } else if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && row) {
        event.preventDefault();
        const box = document
          .querySelector(`[data-key="${CSS.escape(row.key)}"]`)
          ?.getBoundingClientRect();
        taskMenu(row, box ? { x: box.left + 48, y: box.bottom } : { x: 300, y: 200 });
      } else if (event.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    rows,
    selected,
    view,
    page,
    expanded,
    change,
    edit,
    toggle,
    undo,
    redo,
    remove,
    taskMenu,
    newListMenu,
    travel,
    leavePage,
    showBody,
    openPage,
  ]);

  /** The task shown as a page, if it is still in the list (else the list shows). */
  const pageTask =
    page && view?.mode === 'tasks' && view.id === listId ? findRow(view, page) : null;
  const taskLists = lists.filter((list) => !list.inbox);
  const inbox = lists.find((list) => list.inbox);
  // UI-04: rows that appear in the list being looked at ease in; opening a list doesn't animate.
  const known = useRef<{ list: string; keys: ReadonlySet<string> }>({ list: '', keys: new Set() });
  const freshKeys = new Set<string>();
  if (view && known.current.list === view.id)
    for (const row of rows) if (!known.current.keys.has(row.key)) freshKeys.add(row.key);
  // D-75: a task that just completed or reopened eases in at its new place.
  for (const key of moved) freshKeys.add(key);
  useEffect(() => {
    if (view) known.current = { list: view.id, keys: new Set(rows.map((row) => row.key)) };
  }, [view, rows]);
  // UI-04: one selection highlight per card glides between rows; a row being edited shows its own.
  const tasksCard = useRef<HTMLElement>(null);
  const completedCard = useRef<HTMLElement>(null);
  const glideTarget = editing ? null : selected;
  const glideVersion = [rows, completedOpen];

  const rowProps: RowHandlers = {
    selected,
    editing,
    onSelect: setSelected,
    onToggle: (key) => void toggle(key),
    onEdit: edit,
    onLeaveTask: leaveTask,
    onTab: tab,
    onMenu: (task, at) => taskMenu(task, at),
    onMute: (key, muted) => void mute(key, muted),
    onReminder: (task, anchor) => changeReminder(task, anchor),
    expanded,
    onBody: (task) => void showBody(task),
  };
  const saveBody = (key: string, body: string): void => {
    setEditingBody(null);
    void change({ kind: 'body', key, body });
  };
  /** A small body shown inline under its row (D-53), rendered or being edited (D-49). */
  const bodyRows = (task: TaskRow, subtask: boolean): ReactElement[] =>
    expanded.has(task.key) && hasBody(task)
      ? [
          <div key={`body-${task.key}`} className={subtask ? 'row-body subtask' : 'row-body'}>
            {editingBody === task.key ? (
              <BodyEditor initial={task.body} onDone={(body) => saveBody(task.key, body)} />
            ) : (
              <BodyView
                body={task.body}
                onEdit={() => !view?.readOnly && setEditingBody(task.key)}
              />
            )}
          </div>,
        ]
      : [];

  // The task card as one flat run of rows, so a new row keeps its place (and its focus) while
  // the tasks it adds appear above it. It sits below the newest of its tasks already shown.
  const cardRows: ReactElement[] = [];
  if (view?.mode === 'tasks') {
    const fresh = editing?.kind === 'new' ? editing : null;
    const shown = new Set(rows.map((row) => row.key));
    const anchor = fresh
      ? [fresh.after, ...fresh.added].filter((key) => shown.has(key)).at(-1)
      : undefined;
    const placeNew = (after: string, subtask: boolean): void => {
      if (!fresh || after !== anchor) return;
      const nested = fresh.level === 'in' || (subtask && fresh.level !== 'out');
      cardRows.push(
        <NewRow key={`new-${fresh.seq}`} subtask={nested} onLeave={leaveNew} onTab={tab} />,
      );
    };
    cardRows.push(...ghostRows(ghosts, 'complete', null, rowProps));
    view.items.forEach((item, index) => {
      if (item.kind === 'heading')
        cardRows.push(
          <h2 key={`heading-${index}`} className="read-heading">
            {item.text}
          </h2>,
        );
      else if (item.kind === 'text')
        cardRows.push(
          <p key={`text-${index}`} className="read-text">
            {item.text}
          </p>,
        );
      else {
        cardRows.push(
          <Row
            key={item.task.key}
            task={item.task}
            fresh={freshKeys.has(item.task.key)}
            {...rowProps}
          />,
          ...bodyRows(item.task, false),
        );
        cardRows.push(...ghostRows(ghosts, 'complete', item.task.key, rowProps));
        for (const subtask of item.task.subtasks) {
          cardRows.push(
            <Row
              key={subtask.key}
              task={subtask}
              subtask
              fresh={freshKeys.has(subtask.key)}
              {...rowProps}
            />,
            ...bodyRows(subtask, true),
          );
          cardRows.push(...ghostRows(ghosts, 'complete', subtask.key, rowProps));
          placeNew(subtask.key, true);
        }
        placeNew(item.task.key, false);
      }
    });
  }

  return (
    <div className="app">
      <div className="sidebar-drag" aria-hidden="true" />
      <aside
        ref={sidebar}
        className="sidebar"
        onContextMenu={(event) => {
          event.preventDefault();
          newListMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <Glide card={sidebar} target={listId} version={[lists, naming]} className="nav-glide" />
        <div className="brand">
          <img src={flintIcon} alt="" />
          <span>Flint</span>
        </div>
        {inbox && (
          <NavItem
            list={inbox}
            active={listId === inbox.id}
            icon={<InboxIcon />}
            onSelect={() => openList(inbox.id)}
            onMenu={() => undefined}
          />
        )}
        <div className="section-label lists-label">
          <span>Lists</span>
          <button
            ref={addButton}
            type="button"
            className="add-list"
            aria-label="New list or note"
            title="New list or note (Ctrl+Shift+N)"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              newListMenu({ x: box.left, y: box.bottom + 4 });
            }}
          >
            <PlusIcon />
          </button>
        </div>
        {taskLists.map((list) =>
          naming?.kind === 'rename' && naming.id === list.id ? (
            <NameField
              key={list.id}
              initial={list.name}
              icon={list.mode === 'note' ? <NoteIcon /> : <ListIcon />}
              problem={namingProblem}
              onSubmit={(name) => void submitName(name)}
              onCancel={() => setNaming(null)}
            />
          ) : (
            <NavItem
              key={list.id}
              list={list}
              active={listId === list.id}
              icon={list.mode === 'note' ? <NoteIcon /> : <ListIcon />}
              onSelect={() => openList(list.id)}
              onMenu={(at) => listMenu(list, at)}
            />
          ),
        )}
        {naming?.kind === 'new' && (
          <NameField
            key={`new-${naming.mode}`}
            initial=""
            placeholder={naming.mode === 'note' ? 'Note name' : 'List name'}
            icon={naming.mode === 'note' ? <NoteIcon /> : <ListIcon />}
            problem={namingProblem}
            onSubmit={(name) => void submitName(name)}
            onCancel={() => setNaming(null)}
          />
        )}
        {/* Settings returns with the Settings screen (APP-11, M8, D-52). */}
      </aside>

      <main className="main">
        <div className="titlebar" />
        <div className="scroller">
          {/* D-65: a list or page fades in, rising a few pixels, when it opens. */}
          <div
            ref={content}
            className={view?.mode === 'note' ? 'content note-page' : 'content'}
            key={`${view?.id ?? 'none'}/${pageTask?.key ?? ''}`}
          >
            {view && pageTask && (
              <TaskPage
                key={pageTask.key}
                task={pageTask}
                readOnly={view.readOnly !== null}
                onBack={leavePage}
                onTitle={(text) => void change({ kind: 'edit', key: pageTask.key, text })}
                onBody={(body) => void change({ kind: 'body', key: pageTask.key, body })}
              />
            )}

            {view && !pageTask && (
              <header className="list-header">
                <h1>
                  {view.name}
                  {view.mode === 'tasks' && <span className="count"> · {view.open} open</span>}
                </h1>
                {lists.find((list) => list.id === view.id)?.inbox && (
                  <span className="subtitle">{INBOX_SUBTITLE}</span>
                )}
                {view.readOnly && (
                  <span className="subtitle">
                    Read-only: Flint can&apos;t change this file ({view.readOnly}).
                  </span>
                )}
              </header>
            )}

            {view?.mode === 'note' && (
              <NoteEditor
                key={view.name}
                id={view.id}
                text={view.noteText ?? ''}
                readOnly={view.readOnly !== null}
                onId={setListId}
              />
            )}

            {view?.mode === 'tasks' && !pageTask && (
              <>
                {!view.readOnly && (
                  <Composer
                    key={view.id}
                    listId={view.id}
                    lists={lists}
                    inputRef={composer}
                    onAdd={addFromComposer}
                  />
                )}

                <section className="card tasks" aria-label="Tasks" ref={tasksCard}>
                  <Glide card={tasksCard} target={glideTarget} version={glideVersion} />
                  {view.items.length === 0 && (
                    <p className="empty">
                      Nothing here. Press Ctrl+N to add a task, or capture from anywhere with your
                      hotkey.
                    </p>
                  )}
                  {cardRows}
                </section>

                {(view.completed.length > 0 ||
                  ghosts.some((ghost) => ghost.direction === 'reopen')) && (
                  <section className="card completed" aria-label="Completed" ref={completedCard}>
                    <Glide card={completedCard} target={glideTarget} version={glideVersion} />
                    <button
                      type="button"
                      className="completed-head"
                      aria-expanded={completedOpen}
                      onClick={() => setCompletedOpen(!completedOpen)}
                    >
                      <span className={completedOpen ? 'chev open' : 'chev'}>
                        <ChevronIcon />
                      </span>
                      <span>Completed</span>
                      <span className="chip">{view.completed.length}</span>
                    </button>
                    {completedOpen && ghostRows(ghosts, 'reopen', null, rowProps)}
                    {completedOpen &&
                      view.completed.flatMap((task) => [
                        <Row
                          key={task.key}
                          task={task}
                          fresh={freshKeys.has(task.key)}
                          {...rowProps}
                        />,
                        ...bodyRows(task, false),
                        ...ghostRows(ghosts, 'reopen', task.key, rowProps),
                      ])}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={() => void undo().then(() => setToast(null))}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NavItem(props: {
  readonly list: ListSummary;
  readonly active: boolean;
  readonly icon: ReactElement;
  readonly onSelect: () => void;
  readonly onMenu: (at: Point) => void;
}): ReactElement {
  const { list, active, icon, onSelect, onMenu } = props;
  return (
    <button
      type="button"
      data-key={list.id}
      className={active ? 'nav on' : 'nav'}
      // A click opens the list without taking the keyboard: the keys stay with the task list.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <span className={active ? 'tile strong' : 'tile'}>{icon}</span>
      <span className="nav-name">{list.name}</span>
      {list.mode === 'tasks' && <span className="nav-count">{list.open}</span>}
    </button>
  );
}

/**
 * The composer (mockup 01, TASK-02): adds to the top of this list with the capture shorthand;
 * `##list` sends the task elsewhere (D-25). Chips show what the shorthand will do.
 */
function Composer(props: {
  readonly listId: string;
  readonly lists: readonly ListSummary[];
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onAdd: (text: string) => Promise<void>;
}): ReactElement {
  const { listId, lists, inputRef, onAdd } = props;
  const text = useInertText('', false);
  // UI-09: auto-closing brackets and quotes in the composer.
  useEffect(() => (inputRef.current ? enableAutoPair(inputRef.current) : undefined), [inputRef]);
  const infos = useMemo(() => listInfos(lists), [lists]);
  const { escaped, value } = text;
  const parsed = useMemo(
    () => (value.trim() === '' ? null : parseCapture(escaped(), { now: new Date(), lists: infos })),
    [value, escaped, infos],
  );
  const chips: string[] = [];
  if (parsed?.priority) chips.push(PRIORITY_NAMES[parsed.priority]);
  const target = parsed?.target;
  if ((target?.kind === 'existing' || target?.kind === 'close-match') && target.list.id !== listId)
    chips.push(`→ ${target.list.name}`);
  if (target?.kind === 'new') chips.push(`New list ${target.name}`);

  /**
   * CAP-11, D-57: a picker's choice becomes the same shorthand typing would give. The token of
   * that kind already in the text is replaced (never left behind as text, D-25); null removes it.
   */
  const replaceToken = (kind: TokenKind, token: string | null): void => {
    for (let guard = 0; guard < 10; guard++) {
      const { text: parsedText, toOriginal } = text.mapped();
      const found = parseCapture(parsedText, { now: new Date(), lists: infos }).tokens.find(
        (item) => item.kind === kind,
      );
      if (!found) break;
      const current = text.current();
      let start = toOriginal(found.start);
      let end = toOriginal(found.end);
      if (current[end] === ' ') end++;
      else if (start > 0 && current[start - 1] === ' ') start--;
      text.change(current.slice(0, start) + current.slice(end));
    }
    if (token) text.insertLive(token);
    inputRef.current?.focus();
  };
  const host = (button: HTMLElement): PickerHost => ({
    anchor: button.getBoundingClientRect(),
    returnFocus: inputRef.current,
    trigger: button,
  });

  return (
    <section
      className="card composer"
      aria-label="Add a task"
      // UI-01, D-65: the whole card is the text box's target (one cursor, no flicker around it).
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target === inputRef.current || target.closest('button')) return;
        event.preventDefault();
        inputRef.current?.focus();
      }}
    >
      <input
        ref={inputRef}
        className="composer-input"
        placeholder="Add a task…"
        value={value}
        spellCheck={false}
        onChange={(event) => text.change(event.target.value)}
        onPaste={text.paste}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            const typed = text.escaped();
            if (typed.trim() === '') return;
            text.reset('', false);
            void onAdd(typed);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <div className="composer-bar">
        <div className="tools">
          <button
            type="button"
            className="tool"
            data-picker-trigger
            aria-label="Set priority"
            onClick={(event) =>
              openPriorityPicker(host(event.currentTarget), parsed?.priority ?? null, (priority) =>
                replaceToken('priority', priority ? PRIORITY_TOKENS[priority] : null),
              )
            }
          >
            <FlagIcon />
          </button>
          <button
            type="button"
            className="tool"
            data-picker-trigger
            aria-label="Choose list"
            onClick={(event) =>
              openListPicker(
                host(event.currentTarget),
                infos,
                { placeholder: 'Add to list…' },
                (pick) =>
                  replaceToken(
                    'list',
                    'newList' in pick
                      ? listShorthand(pick.newList)
                      : // The list the composer is in needs no token.
                        pick.list.id === listId
                        ? null
                        : listShorthand(pick.list.name),
                  ),
              )
            }
          >
            <HashIcon />
          </button>
          <button
            type="button"
            className="tool"
            data-picker-trigger
            aria-label="Set reminder"
            onClick={(event) =>
              openTimePicker(
                host(event.currentTarget),
                new Date(),
                parsed?.reminder ?? null,
                (at) => replaceToken('reminder', timeShorthand(at)),
              )
            }
          >
            <BellIcon size={15} />
          </button>
        </div>
        {chips.length > 0 || parsed?.reminderLabel ? (
          <span className="composer-chips">
            {chips.map((chip) => (
              <span key={chip} className="chip">
                {chip}
              </span>
            ))}
            {parsed?.reminderLabel && (
              <span className="chip">
                <BellIcon />
                {parsed.reminderLabel}
              </span>
            )}
          </span>
        ) : (
          <span className="hint">
            or type <span className="chip">!h ##list @15:00</span>
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * A list's name typed in the sidebar (LIST-01): Enter saves, Esc or leaving the field cancels; a
 * problem (a name Windows can't use, one already taken) shows under it.
 */
function NameField(props: {
  readonly initial: string;
  readonly placeholder?: string;
  readonly icon: ReactElement;
  readonly problem: string | null;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { initial, placeholder, icon, problem, onSubmit, onCancel } = props;
  const [name, setName] = useState(initial);
  return (
    <div className="name-field">
      <div className="nav on">
        <span className="tile">{icon}</span>
        <input
          className="name-input"
          autoFocus
          value={name}
          placeholder={placeholder}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
          onBlur={onCancel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit(name);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </div>
      {problem && <p className="name-problem">{problem}</p>}
    </div>
  );
}

interface RowHandlers {
  readonly selected: string | null;
  readonly editing: Editing | null;
  readonly onSelect: (key: string) => void;
  readonly onToggle: (key: string) => void;
  /** Edit state, with the caret at `caret` in the raw title (D-71) or at the end. */
  readonly onEdit: (key: string, caret?: number) => void;
  readonly onLeaveTask: (key: string, text: string, how: Leave) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
  /** UI-08: the row's right-click menu. */
  readonly onMenu: (task: TaskRow, at: Point) => void;

  /** REM-12: the bell turns the reminder off or on. */
  readonly onMute: (key: string, muted: boolean) => void;
  /** REM-01, D-68: the time opens the date/time picker for the task. */
  readonly onReminder: (task: TaskRow, anchor: DOMRect) => void;
  /** TASK-05, D-53: bodies shown inline, and the body indicator (inline or the task's page). */
  readonly expanded: ReadonlySet<string>;
  readonly onBody: (task: TaskRow) => void;
}

/**
 * A task as a page (TASK-05, D-53, 09 §8): it replaces the list, with a back arrow, the title (a
 * click edits it) and the body, rendered, with plain editing until the note editor (D-49, M5).
 */
function TaskPage(props: {
  readonly task: TaskRow;
  readonly readOnly: boolean;
  readonly onBack: () => void;
  readonly onTitle: (text: string) => void;
  readonly onBody: (body: string) => void;
}): ReactElement {
  const { task, readOnly, onBack, onTitle, onBody } = props;
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const editable = !readOnly && !task.done;
  return (
    <>
      <header className="page-head">
        <button type="button" className="page-back" title="Back (Alt+←)" onClick={onBack}>
          <BackIcon />
        </button>
        {editingTitle ? (
          <div className="page-title-edit">
            <EditField
              initial={task.title}
              inert
              onLeave={(text, empty) => {
                setEditingTitle(false);
                if (!empty || hasBody(task)) onTitle(text);
              }}
              onTab={() => undefined}
            />
          </div>
        ) : (
          <h1
            className="page-title"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('a')) {
                event.preventDefault();
                const link = (event.target as HTMLElement).closest('a');
                if (link) window.flintMain.openLink(link.href);
              } else if (editable) setEditingTitle(true);
            }}
          >
            {task.title === '' ? (
              task.label
            ) : (
              <span dangerouslySetInnerHTML={{ __html: titleHtml(task.title) }} />
            )}
          </h1>
        )}
      </header>
      {editingBody ? (
        <BodyEditor
          initial={task.body}
          placeholder="Notes, code, links…"
          onDone={(body) => {
            setEditingBody(false);
            onBody(body);
          }}
        />
      ) : hasBody(task) ? (
        <BodyView body={task.body} onEdit={() => editable && setEditingBody(true)} />
      ) : (
        editable && (
          <button type="button" className="page-add-body" onClick={() => setEditingBody(true)}>
            Add notes, code or links
          </button>
        )
      )}
    </>
  );
}

/** The ghosts of a section that follow row `after` (null: the section's first rows), D-75. */
function ghostRows(
  ghosts: readonly Ghost[],
  direction: Ghost['direction'],
  after: string | null,
  handlers: RowHandlers,
): ReactElement[] {
  return ghosts
    .filter((ghost) => ghost.direction === direction && ghost.after === after)
    .flatMap((ghost) => [
      <Row
        key={`ghost-${ghost.id}`}
        task={ghost.task}
        subtask={ghost.subtask}
        ghost={direction}
        {...handlers}
      />,
      ...(ghost.subtask ? [] : ghost.task.subtasks).map((sub) => (
        <Row
          key={`ghost-${ghost.id}-${sub.key}`}
          task={sub}
          subtask
          ghost={direction}
          {...handlers}
        />
      )),
    ]);
}

function Row(
  props: RowHandlers & {
    readonly task: TaskRow;
    readonly subtask?: boolean;
    /** Just appeared in the list being looked at: it eases in (UI-04). */
    readonly fresh?: boolean;
    /** D-75: a ghost playing the completion animation where the task was. */
    readonly ghost?: 'complete' | 'reopen';
  },
): ReactElement {
  const {
    task,
    subtask = false,
    selected,
    editing,
    onSelect,
    onToggle,
    onEdit,
    onLeaveTask,
    onTab,
    fresh = false,
    ghost,
  } = props;
  const isEditing = !ghost && editing?.kind === 'task' && editing.key === task.key;
  const classes = ['row'];
  if (!ghost && task.key === selected && editing?.kind !== 'new') classes.push('sel');
  if (subtask) classes.push('subtask');
  if (task.done) classes.push('done');
  if (isEditing) classes.push('editing');
  if (fresh) classes.push('enter');
  if (ghost) classes.push('leaving', ghost);
  const checked = ghost === 'complete' || (task.done && ghost !== 'reopen');
  return (
    <div
      data-key={ghost ? undefined : task.key}
      aria-hidden={ghost ? true : undefined}
      className={classes.join(' ')}
      onMouseDown={() => onSelect(task.key)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect(task.key);
        props.onMenu(task, { x: event.clientX, y: event.clientY });
      }}
      // D-71: double-click anywhere edits; inside the field it is the field's own (word selection).
      onDoubleClick={() => !task.done && !isEditing && onEdit(task.key)}
    >
      {!task.done && <div className={`stripe p-${task.priority ?? 'none'}`} />}
      <button
        type="button"
        className={checked ? 'check on' : 'check'}
        aria-label={task.done ? 'Reopen task' : 'Complete task'}
        onClick={() => !ghost && onToggle(task.key)}
      >
        {checked && <CheckIcon />}
      </button>
      {isEditing ? (
        <EditField
          key={editing.seq}
          initial={task.title}
          {...(editing.caret !== undefined && { caret: editing.caret })}
          inert
          onLeave={(text, _empty, how) => onLeaveTask(task.key, text, how)}
          onTab={onTab}
        />
      ) : task.code ? (
        <span className="title code-row" onClick={() => props.onBody(task)}>
          <span className="code-kind">
            {task.code.kind} · {task.code.lines} {task.code.lines === 1 ? 'line' : 'lines'}
          </span>
          {task.code.peek && <span className="code-peek">{task.code.peek}</span>}
        </span>
      ) : (
        <Title
          task={task}
          {...(!task.done && { onEditAt: (caret: number) => onEdit(task.key, caret) })}
        />
      )}
      <span className="ind">
        {task.reminder && !task.done && (
          // REM-11, REM-12, D-68: the bell never moves; it is the off/on toggle, carries the
          // overdue dot, and the time next to it opens the date/time picker (REM-01).
          <span className={`reminder ${task.reminderState ?? 'on'}`}>
            <button
              type="button"
              className="reminder-bell"
              title={
                task.reminderState === 'muted' ? 'Turn the reminder on' : 'Turn the reminder off'
              }
              aria-pressed={task.reminderState === 'muted'}
              onClick={(event) => {
                event.stopPropagation();
                props.onMute(task.key, task.reminderState !== 'muted');
              }}
            >
              <ReminderBellIcon />
              <span className="overdue-dot" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="reminder-time"
              title="Change the reminder"
              onClick={(event) => {
                event.stopPropagation();
                props.onReminder(task, event.currentTarget.getBoundingClientRect());
              }}
            >
              <MorphText text={task.reminder} />
            </button>
          </span>
        )}
        {task.done && task.completed && <span>{task.completed}</span>}
        {!task.code && hasBody(task) && (
          <button
            type="button"
            className={props.expanded.has(task.key) ? 'body-toggle open' : 'body-toggle'}
            title={props.expanded.has(task.key) ? 'Hide the body (←)' : 'Show the body (→)'}
            aria-expanded={props.expanded.has(task.key)}
            onClick={(event) => {
              event.stopPropagation();
              props.onBody(task);
            }}
          >
            <BodyIcon />
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The selection highlight (UI-04, D-56): one element per card that moves to the selected row with
 * the spring curve, instead of the highlight jumping from row to row. Off with reduce-motion, like
 * all motion (the move is then instant).
 */
function Glide(props: {
  readonly card: RefObject<HTMLElement | null>;
  readonly target: string | null;
  /** Re-measure when the rows change. */
  readonly version: unknown;
  /** `sel-glide` for rows, `nav-glide` for the sidebar (D-65). */
  readonly className?: string;
}): ReactElement | null {
  const { card, target, version, className = 'sel-glide' } = props;
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = (): void => {
      const row = target
        ? card.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(target)}"]`)
        : null;
      setBox(
        row
          ? { x: row.offsetLeft, y: row.offsetTop, w: row.offsetWidth, h: row.offsetHeight }
          : null,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    // Rows collapsing or easing in (D-67) move the selected row: follow it.
    const observer = new ResizeObserver(measure);
    if (card.current) observer.observe(card.current);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [card, target, version]);
  if (!box) return null;
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
    />
  );
}

/**
 * Text that changes in place, like a reminder time (D-69, 09 §9): the old text fades out over the
 * new one while the box's width eases from the old width to the new, in --fl-dur-state. Instant
 * with reduce-motion.
 */
function MorphText(props: { readonly text: string }): ReactElement {
  const { text } = props;
  const box = useRef<HTMLSpanElement>(null);
  const last = useRef({ text, width: 0 });
  const [old, setOld] = useState<string | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const width = element.getBoundingClientRect().width;
    const before = last.current;
    last.current = { text, width };
    if (before.text === text || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    setOld(before.text);
    const duration = parseFloat(
      getComputedStyle(element).getPropertyValue('--fl-dur-state') || '260',
    );
    element.animate([{ width: `${before.width}px` }, { width: `${width}px` }], {
      duration,
      easing: 'ease',
    });
  }, [text]);
  return (
    <span className="morph" ref={box}>
      {old !== null && (
        <span className="morph-old" aria-hidden="true" onAnimationEnd={() => setOld(null)}>
          {old}
        </span>
      )}
      <span key={text} className={old !== null ? 'morph-new in' : 'morph-new'}>
        {text}
      </span>
    </span>
  );
}

/**
 * A task's title with its inline markdown rendered (LIST-02, D-52); the raw text shows while it is
 * edited. markdown-it escapes everything that isn't markdown, so the HTML is safe. A click on a
 * link opens it in the browser and does nothing else; a click on the text edits the task with the
 * caret there (D-71); a click beside the text only selects the row.
 */
function Title(props: {
  readonly task: TaskRow;
  /** D-71: editing starts with the caret at this offset in the raw title. */
  readonly onEditAt?: (caret: number) => void;
}): ReactElement {
  const { task, onEditAt } = props;
  if (task.title === '') return <span className="title">{task.label}</span>;
  const onLink = (event: React.MouseEvent): HTMLAnchorElement | null =>
    (event.target as HTMLElement).closest('a');
  return (
    <span
      className="title md"
      dangerouslySetInnerHTML={{ __html: titleHtml(task.title) }}
      onMouseDown={(event) => {
        if (onLink(event)) event.stopPropagation();
        // D-74: a press on the text doesn't select first, so the click goes straight into
        // editing that row, without the selection gliding there on the way.
        else if (
          onEditAt &&
          event.button === 0 &&
          !event.ctrlKey &&
          !event.shiftKey &&
          textOffsetAt(event.currentTarget, event.clientX, event.clientY) !== null
        )
          event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        if (onLink(event)) event.stopPropagation();
      }}
      onClick={(event) => {
        const link = onLink(event);
        if (link) {
          event.preventDefault();
          window.flintMain.openLink(link.href);
          return;
        }
        // Ctrl/Shift+click select (TASK-07); the second click of a double-click is the field's.
        if (!onEditAt || event.ctrlKey || event.shiftKey || event.detail > 1) return;
        const span = event.currentTarget;
        const at = textOffsetAt(span, event.clientX, event.clientY);
        if (at !== null) onEditAt(rawOffset(task.title, span.textContent ?? '', at));
      }}
    />
  );
}

/** D-71: the offset in `element`'s text under a point, or null when the point is beside the text. */
function textOffsetAt(element: HTMLElement, x: number, y: number): number | null {
  const text = document.createRange();
  text.selectNodeContents(element);
  const onText = [...text.getClientRects()].some(
    (rect) => x >= rect.left && x <= rect.right + 2 && y >= rect.top && y <= rect.bottom,
  );
  const position = onText ? document.caretPositionFromPoint(x, y) : null;
  if (!position || !element.contains(position.offsetNode)) return null;
  const before = document.createRange();
  before.setStart(element, 0);
  before.setEnd(position.offsetNode, position.offset);
  return before.toString().length;
}

/**
 * Edit-state Enter: a new row below the task (docs/03 §2). Enter adds what was typed and keeps the
 * field for the next task; its ID is fetched ahead, so the next one can go below it at once.
 */
function NewRow(props: {
  readonly subtask: boolean;
  readonly onLeave: (text: string, empty: boolean, how: Leave, id: string | null) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
}): ReactElement {
  const { subtask, onLeave, onTab } = props;
  const nextId = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    nextId.current = window.flintMain.reserveId();
  }, []);
  const leave = (text: string, empty: boolean, how: Leave): void => {
    const id = nextId.current ?? Promise.resolve(null);
    if (!empty) nextId.current = window.flintMain.reserveId();
    // Already there in practice (fetched when the row opened): a microtask, before the next key.
    void id.then((value) => onLeave(text, empty, how, value));
  };
  return (
    <div className={subtask ? 'row sel editing subtask' : 'row sel editing'}>
      <span className="check" aria-hidden="true" />
      <EditField
        initial=""
        inert={false}
        placeholder="New task"
        repeat
        onLeave={leave}
        onTab={onTab}
      />
    </div>
  );
}

/**
 * The text cursor of Edit state. Enter, Esc and leaving the field all keep what was typed; the
 * existing title is inert, so only typed shorthand applies (D-45). With `repeat` (a new row),
 * Enter hands the text over and the field stays, empty, for the next task.
 */
function EditField(props: {
  readonly initial: string;
  /** D-71: the caret's starting place; the end when not given. */
  readonly caret?: number;
  readonly inert: boolean;
  readonly placeholder?: string;
  readonly repeat?: boolean;
  readonly onLeave: (text: string, empty: boolean, how: Leave) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
}): ReactElement {
  const { initial, inert, placeholder, repeat = false, onLeave, onTab } = props;
  const text = useInertText(initial, inert);
  const left = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // UI-09: auto-closing brackets and quotes while editing a task.
  useEffect(() => (field.current ? enableAutoPair(field.current) : undefined), []);
  useEffect(() => {
    if (props.caret !== undefined) field.current?.setSelectionRange(props.caret, props.caret);
    // Only where editing starts.
  }, []);
  const leave = (how: Leave): void => {
    if (left.current) return;
    const empty = text.value.trim() === '';
    if (repeat && how === 'enter' && !empty) {
      onLeave(text.escaped(), false, how);
      text.reset('', false);
      return;
    }
    left.current = true;
    onLeave(text.escaped(), empty, how);
  };
  return (
    <input
      ref={field}
      className="title-input"
      autoFocus
      value={text.value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => text.change(event.target.value)}
      onPaste={text.paste}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={() => leave('blur')}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          leave('enter');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          leave('escape');
        } else if (event.key === 'Tab') {
          event.preventDefault();
          onTab(event.shiftKey ? 'outdent' : 'indent');
        }
      }}
    />
  );
}
