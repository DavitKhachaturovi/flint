import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  blockFor,
  classifyPaste,
  escapeInert,
  fencedBlock,
  listToken,
  listTokenAt,
  parseCapture,
  suggestLists,
  type ListInfo,
  type TokenKind,
} from '@flint/core/shorthand';
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
  ListActionOutcome,
  ListChange,
  ListSummary,
  ListItem,
  ListView,
  UpNextItem,
  SidebarAction,
  SidebarItem,
  SidebarOutcome,
  SidebarSort,
  SidebarView,
  TaskRow,
} from '../../shared/ipc.js';
import {
  BackIcon,
  BellIcon,
  BodyIcon,
  CloseIcon,
  CheckIcon,
  ChevronIcon,
  FlagIcon,
  ImageIcon,
  HashIcon,
  InboxIcon,
  ListIcon,
  NoteIcon,
  PanelIcon,
  PinIcon,
  PlusIcon,
  ReminderBellIcon,
  SortIcon,
  SunIcon,
} from './icons.js';
import { ReminderCards, RolloverCard, TodayGreeting } from './Today.js';
import { rawOffset, titleHtml } from '../../shared/inline-markdown.js';
import { isTextField, openMenu, textFieldMenu, type MenuEntry } from '../menu/menu.js';

import { NoteEditor } from './NoteEditor.js';
import {
  ContextPanel,
  type FactKind,
  type PanelHandlers,
  type PanelState,
} from './ContextPanel.js';
import { outline as outlineOf } from '../panel/outline.js';
import { EditorView as CodeEditorView } from '@codemirror/view';
import { openFindIn } from '../editor/find.js';
import { BodyBlock, LiveNotes, type ShowImage } from './Body.js';
import { ListFind } from './ListFind.js';
import { TODAY_ID } from '../../shared/ipc.js';
import { Lightbox } from './Lightbox.js';
import { foldAway, unfold, watchDrag, type DragUnit } from './drag.js';
import { bodyImages, mediaUrl } from '../../shared/body-markdown.js';
import { codeLanguage } from '../../shared/code-language.js';
import { setLinkPatterns } from '../../shared/link-patterns.js';
import { imageMenuItems, relink, showInViewer, type LinkedNotice } from '../media/media.js';
import { highlightLines } from '../highlight/highlight.js';
import { enableAutoPair } from '../auto-pair.js';
import { useInertText } from './inert-text.js';
import { sidebarMotion } from './sidebar-motion.js';

/**
 * The main window (M4, D-48 daily-use slice): the sidebar with the lists, a list's tasks with the
 * non-task content around them (TASK-15), the composer, and the Navigate/Edit model of docs/03 §2:
 * a selected row takes single-key commands, a text cursor types. Completion has an undo toast and
 * the Completed section (TASK-06). Matches docs/design/mockups/01-main-inbox.html.
 */

const INBOX_SUBTITLE = 'Everything you captured, waiting to be sorted.';
/**
 * NAV-07, D-83, D-85: the main area's width each pair needs, 24 px either side: the full pair (820 px
 * column, 28 px gap, 440 px panel; about 1580 px of window) and the compact one (780, 24, 380; a
 * 1536 px window, 1920 px at 125 %). Narrower, no panel.
 */
const PAIR_FULL = 820 + 28 + 440 + 48;
const PAIR_COMPACT = 780 + 24 + 380 + 48;
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
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  /** LIST-05: a new group, at the top of Lists (D-80), with a list to move into it (`Move to group ›`). */
  | { readonly kind: 'newGroup'; readonly list?: string }
  | { readonly kind: 'renameGroup'; readonly id: string; readonly name: string };

type SidebarGroup = Extract<SidebarItem, { kind: 'group' }>;

/** LIST-06: the sidebar's sorts, as the sort menu names them. */
const SORT_LABELS: Readonly<Record<SidebarSort, string>> = {
  manual: 'Manual',
  edited: 'Recently edited',
  created: 'Created',
};

/** The lists as the shorthand and the pickers see them, most recently used ranked (D-25). */
function listInfos(lists: readonly ListSummary[]): ListInfo[] {
  return lists.map((list): ListInfo => ({
    id: list.id,
    name: list.name,
    mode: list.mode,
    ...(list.recentRank === undefined ? {} : { recentRank: list.recentRank }),
  }));
}

let seq = 0;

interface Toast {
  readonly text: string;
  readonly undo: boolean;
  readonly id: number;
  /** TASK-09, D-88: another way out ("Keep as one"), next to Undo. */
  readonly action?: { readonly label: string; readonly run: () => void };
  /** D-77: playing its way out. */
  readonly leaving?: boolean;
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

const NOTHING: ReadonlySet<string> = new Set();

/** `1 task`, `3 tasks`. */
const tasksCount = (count: number): string => (count === 1 ? '1 task' : `${count} tasks`);

/** TASK-06, Q-13: auto-archive's days when turned on from the offer, and when it is offered. */
const ARCHIVE_DAYS = 14;
const ARCHIVE_OFFER_AT = 50;
const ARCHIVE_DISMISSED = 'flint.archive.dismissed';

/** NAV-04, D-88: how far a two-finger swipe goes (in wheel pixels) before it steps. */
const SWIPE_DISTANCE = 240;

/** The new row's key for the editing highlight (D-76): it has no task yet. */
const NEW_ROW = 'new-row';

const newRow = (after: string): NewEditing => ({
  kind: 'new',
  after,
  added: [],
  level: 'same',
  seq: ++seq,
});

/** How a text field was left. */
/** How a text field was left; `notes` is Shift+Enter, which goes on into the task's body (D-78). */
type Leave = 'enter' | 'escape' | 'blur' | 'indent' | 'outdent' | 'notes';

/** A duration token in ms (09 §9), so JS timings follow the motion tokens (and the M8 speed). */
function durationMs(token: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * D-75, D-77: a copy of a row that has just been completed, reopened or removed (deleted, moved to
 * another list, an undone duplicate), playing its animation where the row was, while the task is
 * already in its new place, or gone. Not interactive.
 */
interface Ghost {
  readonly id: number;
  readonly task: TaskRow;
  readonly subtask: boolean;
  readonly direction: 'complete' | 'reopen' | 'remove';
  /** The open tasks, or Completed. */
  readonly section: 'open' | 'done';
  /** The row it follows in its section (the open tasks, or Completed); null: the first. */
  readonly after: string | null;
  /** D-80: it was expanded: its body closes first, then the row plays out. */
  readonly expanded?: boolean;
}

let ghostSeq = 0;

const withSubtasks = (tasks: readonly TaskRow[]): TaskRow[] =>
  tasks.flatMap((task) => [task, ...task.subtasks]);

/**
 * The rows that changed sides, or went away, between two views of a list, by any cause (Space,
 * Delete, undo, redo, a reminder's Done): a ghost where each was, and the keys that now ease in at
 * their new place.
 */
function departed(before: ListView, after: ListView): { ghosts: Ghost[]; moved: string[] } {
  const openTasks = (view: ListView): TaskRow[] =>
    view.items.flatMap((item) => (item.kind === 'task' ? [item.task] : []));
  const nowOpen = new Set(withSubtasks(openTasks(after)).map((row) => row.key));
  const nowDone = new Set(withSubtasks(after.completed).map((row) => row.key));
  const ghosts: Ghost[] = [];
  const moved: string[] = [];
  for (const [tasks, direction, section, there, here] of [
    [openTasks(before), 'complete', 'open', nowDone, nowOpen],
    [before.completed, 'reopen', 'done', nowOpen, nowDone],
  ] as const) {
    const rows = withSubtasks(tasks);
    const gone = (key: string): boolean => !here.has(key) && !there.has(key);
    for (const task of tasks) {
      // The task (its subtasks go with it), or a subtask that moved or went on its own.
      const went: [TaskRow, Ghost['direction']][] =
        there.has(task.key) || gone(task.key)
          ? [[task, there.has(task.key) ? direction : 'remove']]
          : task.subtasks
              .filter((sub) => there.has(sub.key) || gone(sub.key))
              .map((sub) => [sub, there.has(sub.key) ? direction : 'remove']);
      for (const [row, how] of went) {
        const index = rows.indexOf(row);
        const previous = rows
          .slice(0, index)
          .reverse()
          .find((other) => here.has(other.key));
        ghosts.push({
          id: ++ghostSeq,
          task: row,
          subtask: row !== task,
          direction: how,
          section,
          after: previous?.key ?? null,
        });
        if (how !== 'remove')
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
  /** NAV-07, D-85: the task selected there, restored by back and forward. */
  readonly select?: string | null;
  /** NAV-07, D-85: reached from a link in the context panel (its header then has a back arrow). */
  readonly fromPanel?: boolean;
}

/** What decides where the sidebar's rows are: the lists' names and modes, groups, order, folds. */
function sidebarShape(lists: readonly ListSummary[], sidebar: SidebarView | null): string {
  return JSON.stringify([
    lists.map((list) => [list.id, list.name, list.mode]),
    sidebar && { ...sidebar, collapsed: [...sidebar.collapsed].sort() },
  ]);
}

/** NAV-07, D-85: what isn't blank space in the main area (a click there keeps the selection). */
const BLANK_EXCEPT =
  '.row, .context-panel, .composer, .body-card, .inline-body, .completed-head, button, a, input, textarea, [contenteditable], .menu, .picker';

/** D-86: what "In this task" jumps through on a task's page, in order. */
function pageFactTargets(root: HTMLElement, kind: FactKind): HTMLElement[] {
  const selector = {
    open: '.page-subtasks .row:not(.done)',
    code: '.task-page .body-view .code-card',
    images: '.task-page .body-view :is(img, .fl-media)',
    links: '.task-page .body-view a[href^="http"]',
  }[kind];
  return [...root.querySelectorAll<HTMLElement>(selector)];
}

/** D-45, D-88: pasted text as typed text whose `!`, `##` and `@` stay text (inert). */
function pastedText(text: string): string {
  return escapeInert(text, [{ start: 0, end: text.length }]).text;
}

/** D-87: a move that can't happen (the first task's indent, say): the row nudges that way. */
function nudge(key: string, direction: 'left' | 'right' | 'up' | 'down'): void {
  if (reducedMotion()) return;
  const row = document.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`);
  if (!row) return;
  const moves: Record<typeof direction, readonly [number, number]> = {
    left: [-6, 0],
    right: [6, 0],
    up: [0, -4],
    down: [0, 4],
  };
  const [x, y] = moves[direction];
  row.animate(
    [
      { translate: '0 0' },
      { translate: `${x}px ${y}px` },
      { translate: `${-x / 3}px ${-y / 3}px` },
      { translate: '0 0' },
    ],
    { duration: 260, easing: 'ease-out' },
  );
}

/** D-86: the place a jump landed on lights up a moment. */
function flash(element: Element): void {
  element.classList.remove('fl-flash');
  void (element as HTMLElement).offsetWidth;
  element.classList.add('fl-flash');
  window.setTimeout(() => element.classList.remove('fl-flash'), 900);
}

/** D-86, D-87: a copy of the hidden panel, which slides and fades out from where it was. */
function leavingPanel(panel: HTMLElement): HTMLElement {
  const box = panel.getBoundingClientRect();
  const copy = panel.cloneNode(true) as HTMLElement;
  copy.classList.add('panel-leaving');
  copy.setAttribute('aria-hidden', 'true');
  Object.assign(copy.style, {
    position: 'fixed',
    top: `${box.top}px`,
    left: `${box.left}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  document.body.append(copy);
  // Gone after its slide (D-87), or at the latest a second later.
  window.setTimeout(() => copy.remove(), 1000);
  return copy;
}

/** The note's editor, when a note is open (the outline measures and scrolls through it). */
function noteEditorView(root: HTMLElement): CodeEditorView | null {
  const editor = root.querySelector<HTMLElement>('.note-editor .cm-editor');
  return editor ? CodeEditorView.findFromDOM(editor) : null;
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
/** TASK-08, D-72, D-88: a temporary sort of a list's open tasks; the file's order stays. */
type TempSort = 'priority' | 'reminder' | 'added';

const SORT_NAMES: Readonly<Record<TempSort, string>> = {
  priority: 'priority',
  reminder: 'reminder time',
  added: 'date added',
};

/**
 * TASK-08 (D-72, D-88, Proposed): the open tasks in the temporary order, subtasks under their
 * parents, headings and other text left out while sorted. Priority: high first, none last;
 * reminder time: soonest first, without one last; date added: newest first, file order where it is
 * unknown. Ties keep the file's order (a stable sort).
 */
/** D-89: what a row or an open task's card in the task list is, by its task's key. */
function rowKey(element: Element): string | null {
  if (element.matches('.row[data-key]')) return element.getAttribute('data-key');
  if (element.matches('.row-group'))
    return element.querySelector('.row[data-key]')?.getAttribute('data-key') ?? null;
  return null;
}

/** D-89: where the task list's rows (and the selection's highlight) are, before a sort. */
function rowTops(): Map<string, number> {
  const places = new Map<string, number>();
  const card = document.querySelector('section.card.tasks');
  for (const element of card?.children ?? []) {
    const key = element.matches('.sel-glide') ? 'glide' : rowKey(element);
    if (key) places.set(key, element.getBoundingClientRect().top);
  }
  return places;
}

/**
 * D-89 (TASK-08): a temporary sort starting or ending: each row glides from where it was to its new
 * place, the selection's highlight with its row; rows that come back (headings, text) fade in.
 */
function glideRows(before: ReadonlyMap<string, number>, selected: string | null): void {
  if (reducedMotion()) return;
  const card = document.querySelector('section.card.tasks');
  const timing = {
    duration: durationMs('--fl-dur-page', 320),
    easing: 'cubic-bezier(.2, .9, .3, 1)',
  };
  for (const element of card?.children ?? []) {
    const glide = element.matches('.sel-glide');
    const key = glide ? 'glide' : rowKey(element);
    const was = key ? before.get(key) : undefined;
    const at = glide
      ? card?.querySelector(`[data-key="${CSS.escape(selected ?? '')}"]`)?.getBoundingClientRect()
          .top
      : element.getBoundingClientRect().top;
    if (was === undefined || at === undefined) {
      if (!glide)
        element.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: durationMs('--fl-dur-state', 260),
          easing: 'ease-out',
        });
      continue;
    }
    const by = was - at;
    if (Math.abs(by) >= 1)
      element.animate([{ translate: `0 ${by}px` }, { translate: '0 0' }], timing);
  }
}

function sortedItems(items: readonly ListItem[], sort: TempSort): ListItem[] {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const time = (stamp: string | null | undefined): number =>
    stamp ? Date.parse(stamp) || Infinity : Infinity;
  const key = (task: TaskRow): number =>
    sort === 'priority'
      ? (rank[task.priority ?? ''] ?? 3)
      : sort === 'reminder'
        ? time(task.reminderAt)
        : task.createdAt
          ? -time(task.createdAt)
          : Infinity;
  return items
    .filter((item): item is Extract<ListItem, { kind: 'task' }> => item.kind === 'task')
    .sort((a, b) => {
      const x = key(a.task);
      const y = key(b.task);
      return x < y ? -1 : x > y ? 1 : 0;
    });
}

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
  /** LIST-05, LIST-06: the sidebar's groups, order, sort and folded groups. */
  const [sidebarView, setSidebarView] = useState<SidebarView | null>(null);
  /**
   * D-79: the list or group picked in the sidebar while the keyboard is there (Alt+↑/↓ moves it);
   * null when the keyboard is in the task list.
   */
  const [sidebarFocus, setSidebarFocus] = useState<string | null>(null);
  // TODAY-01 (M6, D-89): the main window opens on Today.
  const [listId, setListId] = useState<string>(TODAY_ID);
  const [view, setView] = useState<ListView | null>(null);
  // D-77: nothing is selected when a list opens; the first ↓ selects its first row.
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** TASK-07, D-59: the tasks marked for a bulk action (two or more), around the selected row. */
  const [marked, setMarked] = useState<ReadonlySet<string>>(NOTHING);
  /** Where Shift+↑/↓ and Shift+click ranges start. */
  const anchor = useRef<string | null>(null);
  /** LIST-01, D-59: lists and notes marked in the sidebar (Ctrl/Shift+click). */
  const [markedLists, setMarkedLists] = useState<ReadonlySet<string>>(NOTHING);
  const listAnchor = useRef<string | null>(null);
  /** TASK-05, D-53: the task shown as a page instead of its list. */
  const [page, setPage] = useState<string | null>(null);
  /** Small bodies shown inline under their rows, and the body being edited there (D-49). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const [completedOpen, setCompletedOpen] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  /**
   * MEDIA-03, D-84: large files linked where they are: one notice each, kept until acted on or
   * dismissed (it never fades and never takes focus).
   */
  const [linkedNotices, setLinkedNotices] = useState<readonly (LinkedNotice & { id: number })[]>(
    [],
  );
  useEffect(() => {
    const onLinked = (event: Event): void => {
      const notice = (event as CustomEvent<LinkedNotice>).detail;
      setLinkedNotices((current) => [...current, { ...notice, id: ++seq }]);
    };
    window.addEventListener('flint:linked', onLinked);
    return () => window.removeEventListener('flint:linked', onLinked);
  }, []);
  /** NOTE-07, D-84: the user's link patterns, for titles, bodies and notes. */
  const [, setPatternsLoaded] = useState(0);
  useEffect(() => {
    void window.flintMain.linkPatterns().then((patterns) => {
      setLinkPatterns(patterns);
      setPatternsLoaded((count) => count + 1);
    });
  }, []);
  /** UI-12, D-81: the interface size, shown a moment when it changes. */
  const [zoomShown, setZoomShown] = useState<{ readonly text: string; readonly id: number } | null>(
    null,
  );
  useEffect(() => {
    // Zoom keys the main process didn't take first (it normally does, before the page).
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const how =
        event.key === '=' || event.key === '+' || event.code === 'NumpadAdd'
          ? 'in'
          : event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract'
            ? 'out'
            : event.key === '0' || event.code === 'Numpad0'
              ? 'reset'
              : null;
      if (!how) return;
      event.preventDefault();
      event.stopPropagation();
      void window.flintMain.zoom(how);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    window.flintMain.onZoomed((factor) => {
      window.clearTimeout(timer);
      setZoomShown({ text: `${Math.round(factor * 100)}%`, id: Date.now() });
      timer = window.setTimeout(() => setZoomShown(null), 1500);
    });
  }, []);
  /** D-79: the image lightbox, on one task's images. */
  const [lightbox, setLightbox] = useState<{ images: readonly string[]; start: number } | null>(
    null,
  );
  const showImage: ShowImage = (images, start) => {
    if (images.length > 0) setLightbox({ images, start });
  };
  const toastTimer = useRef<number | undefined>(undefined);
  const composer = useRef<HTMLInputElement>(null);

  /** A list's name being typed in the sidebar: a new list or note, or a rename (LIST-01). */
  const [naming, setNamingState] = useState<Naming | null>(null);
  const [namingProblem, setNamingProblem] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /** The sidebar's highlight glides to the open list like the row selection (UI-04, D-65). */
  const sidebar = useRef<HTMLElement>(null);
  /** D-80: sidebar rows move to their new places (sort, groups, new and deleted items). */
  const motion = useMemo(() => sidebarMotion(() => sidebar.current), []);

  /** D-86: a note just made by Convert to note: its editor takes the cursor when it opens. */
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const sidebarRef = useRef(sidebarView);
  sidebarRef.current = sidebarView;
  /** Reads the lists again; `then` runs in the same render (a name field giving way to its row). */
  const refresh = useCallback(
    async (then?: () => void): Promise<void> => {
      const [nextLists, nextView, nextSidebar] = await Promise.all([
        window.flintMain.lists(),
        window.flintMain.view(listId),
        window.flintMain.sidebar(),
      ]);
      // D-85: only a sidebar that changes moves its rows. A refresh that brings what is already on
      // screen (the echo of a fold, the minute's refresh) must not measure rows mid-animation and
      // play the fold a second time.
      if (
        sidebarShape(nextLists, nextSidebar) !== sidebarShape(listsRef.current, sidebarRef.current)
      )
        motion.capture();
      setLists(nextLists);
      setView(nextView);
      setSidebarView(nextSidebar);
      then?.();
    },
    [listId, motion],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** D-80: a name field opening or closing moves the rows around it smoothly. */
  const setNaming = useCallback(
    (next: Naming | null): void => {
      motion.capture();
      setNamingState(next);
    },
    [motion],
  );
  useLayoutEffect(() => motion.play(), [lists, sidebarView, naming, motion]);

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
    places: [{ list: TODAY_ID, page: null }],
    at: 0,
  });
  /** D-76: pages slide in from the right, and back from the left; lists just fade in. */
  const [heading, setHeading] = useState<'forward' | 'back' | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const show = useCallback((place: Place, select: string | null = null, back = false): void => {
    const pages = place.page !== null || pageRef.current !== null;
    setHeading(!pages ? null : back || !place.page ? 'back' : 'forward');
    setListId(place.list);
    setPage(place.page);
    setMarked(NOTHING);
    setSelected(select);
    setMarkedLists(NOTHING);
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
      // Back from a task's page selects that task in its list; else the place's own selection.
      show(
        to,
        from?.page && !to.page && to.list === from.list ? from.page : (to.select ?? null),
        step < 0,
      );
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
  /**
   * NAV-07, D-85: a task reached from the context panel (Up next, a pin, a capture) is a place of
   * its own, also in the same list, so back (the panel's arrow, Alt+←) returns to what was before.
   */
  const selectedRef = useRef<string | null>(null);
  /**
   * D-87: the next selection came from the keyboard or a panel link: scroll it into view. D-89:
   * 'instant' while ↑/↓ is held, so the list keeps up with the key repeat.
   */
  const followSelection = useRef<false | 'smooth' | 'instant'>(false);
  const followFromPanel = useCallback(
    (list: string, key: string): void => {
      const trail = history.current;
      const here = trail.places[trail.at];
      if (here) trail.places[trail.at] = { ...here, select: selectedRef.current };
      trail.places = [
        ...trail.places.slice(0, trail.at + 1),
        { list, page: null, select: key, fromPanel: true },
      ];
      trail.at = trail.places.length - 1;
      followSelection.current = 'smooth';
      show({ list, page: null }, key);
    },
    [show],
  );
  const openPage = useCallback(
    (key: string): void => go({ list: listId, page: key }, key),
    [go, listId],
  );

  /**
   * NAV-07, D-83: the context panel, when the main area is wide enough for the 820 px column, the
   * 28 px gap and the 440 px panel (with room either side), and it isn't hidden on this display.
   */
  const scroller = useRef<HTMLDivElement>(null);
  const [pairSize, setPairSize] = useState<'full' | 'compact' | null>(null);
  const wide = pairSize !== null;
  const [panelHidden, setPanelHidden] = useState(false);
  useEffect(() => {
    window.flintMain.onPanel(setPanelHidden);
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      setPairSize(width >= PAIR_FULL ? 'full' : width >= PAIR_COMPACT ? 'compact' : null);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const panelShown = wide && !panelHidden && view !== null;
  const panelShownRef = useRef(panelShown);
  panelShownRef.current = panelShown;
  useEffect(() => {
    if (panelShown) setExpanded(new Set());
  }, [panelShown]);
  /**
   * D-86: showing and hiding animate: the panel slides and fades in, or a copy of it slides and
   * fades out, and the column glides to its new place. A window resize switches at once.
   */
  const columnFrom = useRef<number | null>(null);
  const leavingCopy = useRef<HTMLElement | null>(null);
  const togglePanel = useCallback((): void => {
    if (!reducedMotion()) {
      columnFrom.current = content.current?.getBoundingClientRect().left ?? null;
      const shown = document.querySelector<HTMLElement>('.context-panel:not(.panel-leaving)');
      leavingCopy.current = shown ? leavingPanel(shown) : null;
    }
    setPanelHidden((hidden) => {
      window.flintMain.setPanel(!hidden);
      return !hidden;
    });
  }, []);
  // D-87: one choreography: the column and the panel (or, hiding, the panel's copy) move the same
  // distance with the same curve, so the gap between them holds and they never overlap.
  useLayoutEffect(() => {
    const from = columnFrom.current;
    const copy = leavingCopy.current;
    columnFrom.current = null;
    leavingCopy.current = null;
    const column = content.current;
    if (from === null || !column) {
      copy?.remove();
      return;
    }
    const delta = from - column.getBoundingClientRect().left;
    const timing = {
      duration: durationMs('--fl-dur-page', 320),
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    };
    const shift = `translateX(${delta}px)`;
    column.animate([{ transform: shift }, { transform: 'none' }], timing);
    const panel = document.querySelector<HTMLElement>('.context-panel:not(.panel-leaving)');
    if (panelShown && panel)
      panel.animate(
        [
          { transform: shift, opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        timing,
      );
    if (copy) {
      const out = copy.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: `translateX(${-delta}px)`, opacity: 0 },
        ],
        { ...timing, fill: 'forwards' },
      );
      out.id = 'panel-out';
      void out.finished.then(
        () => copy.remove(),
        () => copy.remove(),
      );
    }
  }, [panelShown]);
  /** Inline bodies closing: shown a moment longer, playing their closing animation (D-76). */
  const [closingBodies, setClosingBodies] = useState<ReadonlySet<string>>(new Set());
  /**
   * TASK-05, D-76: the body indicator, a code row or → opens the body inline under its row (a long
   * one cut off, with "Open as page"); shown inline, it closes again.
   */
  const showBody = useCallback(
    (task: TaskRow): void => {
      const without = (keys: ReadonlySet<string>): Set<string> =>
        new Set([...keys].filter((key) => key !== task.key));
      // NAV-07, D-83: with the context panel, the body is read and edited there: select the task.
      // D-89: one open inline anyway closes.
      if (panelShownRef.current && !expanded.has(task.key)) {
        setSelected(task.key);
        return;
      }
      if (!expanded.has(task.key)) {
        setExpanded((current) => new Set([...current, task.key]));
        setClosingBodies(without);
        return;
      }
      setExpanded(without);
      setEditingBody((current) => (current === task.key ? null : current));
      if (reducedMotion()) return;
      setClosingBodies((current) => new Set([...current, task.key]));
      window.setTimeout(() => setClosingBodies(without), durationMs('--fl-dur-base', 200));
    },
    [expanded],
  );

  /** D-89: a task whose notes the context panel's editor takes as soon as it shows them. */
  const panelNotesFor = useRef<string | null>(null);
  /** D-78: a task's body opened inline and in its field, for Shift+Enter and "Add notes". */
  const openNotes = useCallback((key: string): void => {
    // D-89: with the context panel, in the panel's notes editor instead.
    if (panelShownRef.current) {
      panelNotesFor.current = key;
      setEditing(null);
      setSelected(key);
      return;
    }
    setExpanded((current) => new Set([...current, key]));
    setClosingBodies((current) => new Set([...current].filter((other) => other !== key)));
    setEditingBody(key);
    setSelected(key);
  }, []);

  /** TASK-04, D-76: a new row under the task's last subtask (or as its first subtask). */
  const addSubtask = useCallback((task: TaskRow): void => {
    const last = task.subtasks.at(-1);
    setSelected(task.key);
    setEditing(last ? newRow(last.key) : { ...newRow(task.key), level: 'in' });
  }, []);

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

  /** D-77: the toast plays its way out, then goes. */
  const hideToast = useCallback((): void => {
    setToast((current) => current && { ...current, leaving: true });
    window.setTimeout(
      () => setToast((current) => (current?.leaving ? null : current)),
      durationMs('--fl-dur-base', 200),
    );
  }, []);
  const showToast = useCallback(
    (text: string, undo: boolean, action?: Toast['action']): void => {
      window.clearTimeout(toastTimer.current);
      setToast({ text, undo, id: Date.now(), ...(action && { action }) });
      toastTimer.current = window.setTimeout(hideToast, TOAST_MS);
    },
    [hideToast],
  );

  // D-87: pictures shown in the viewer from places without a handler of their own (a chip's menu).
  useEffect(() => {
    const onShow = (event: Event): void => {
      const { images, index } = (event as CustomEvent<{ images: string[]; index: number }>).detail;
      if (images.length > 0) setLightbox({ images, start: index });
    };
    window.addEventListener('flint:image', onShow);
    return () => window.removeEventListener('flint:image', onShow);
  }, []);
  // D-84: short messages from the editor and the media code (a refused program, a failed copy).
  useEffect(() => {
    const onNotice = (event: Event): void =>
      showToast((event as CustomEvent<string>).detail, false);
    window.addEventListener('flint:notice', onNotice);
    return () => window.removeEventListener('flint:notice', onNotice);
  }, [showToast]);

  const change = useCallback(
    (next: ListChange): Promise<ChangeOutcome | null> => window.flintMain.change(listId, next),
    [listId],
  );

  /**
   * TASK-06 (Q-13, D-88, Proposed): auto-archive is off until turned on; a Completed section of 50
   * or more offers it (14 days), once per list ("Not now" is remembered on this machine).
   */
  const [archiveDays, setArchiveDays] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    void window.flintMain.autoArchive().then(setArchiveDays);
  }, []);
  const [archiveDismissed, setArchiveDismissed] = useState<ReadonlySet<string>>(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(ARCHIVE_DISMISSED) ?? '[]');
      return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const dismissArchive = (id: string): void => {
    const next = new Set([...archiveDismissed, id]);
    setArchiveDismissed(next);
    try {
      window.localStorage.setItem(ARCHIVE_DISMISSED, JSON.stringify([...next]));
    } catch {
      // Not remembered; the offer goes for now.
    }
  };
  const archiveOffer =
    archiveDays === null &&
    view?.mode === 'tasks' &&
    !view.readOnly &&
    view.completed.length >= ARCHIVE_OFFER_AT &&
    !archiveDismissed.has(view.id);

  /**
   * NAV-04 (D-79, D-88): a two-finger horizontal swipe on a precision touchpad goes back or
   * forward, as in the browser: the horizontal scroll adds up (never over something that scrolls
   * sideways itself), an arrow grows at the window's edge, and past the threshold the step happens.
   */
  const [swipe, setSwipe] = useState<{ back: boolean; progress: number } | null>(null);
  useEffect(() => {
    let total = 0;
    let done = false;
    let timer = 0;
    const reset = (): void => {
      total = 0;
      done = false;
      setSwipe(null);
    };
    const sideways = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      for (let at: Element | null = target; at && at !== document.body; at = at.parentElement) {
        if (at.scrollWidth <= at.clientWidth + 1) continue;
        const overflow = getComputedStyle(at).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') return true;
      }
      return false;
    };
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return;
      if (sideways(event.target) || document.querySelector('.lightbox')) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(reset, 220);
      if (done) return;
      total += event.deltaX;
      const back = total < 0;
      const trail = history.current;
      if (!trail.places[trail.at + (back ? -1 : 1)]) {
        setSwipe(null);
        return;
      }
      const progress = Math.min(1, Math.abs(total) / SWIPE_DISTANCE);
      if (progress < 1) {
        setSwipe({ back, progress });
        return;
      }
      done = true;
      setSwipe(null);
      travel(back ? -1 : 1);
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.clearTimeout(timer);
    };
  }, [travel]);

  /** NAV-06, D-88: the list's find bar: 0 closed; a new number focuses it again (Ctrl+F). */
  const [finding, setFinding] = useState(0);
  useEffect(() => setFinding(0), [listId]);
  /** TASK-08, D-88: a temporary sort of the open list (a view; the file's order stays). */
  const [tempSort, setTempSort] = useState<TempSort | null>(null);
  /** D-89: a sort's change, with the rows gliding to their new places. */
  const sortFrom = useRef<Map<string, number> | null>(null);
  const sortTo = useCallback((next: TempSort | null): void => {
    sortFrom.current = rowTops();
    setTempSort(next);
  }, []);
  useLayoutEffect(() => {
    const before = sortFrom.current;
    sortFrom.current = null;
    if (before) glideRows(before, selectedRef.current);
  }, [tempSort]);
  /** D-89: the sort's line, kept while it eases out. */
  const [sortLine, setSortLine] = useState<{
    readonly sort: TempSort;
    readonly list: string;
    readonly leaving: boolean;
  } | null>(null);
  useEffect(() => {
    if (tempSort) {
      setSortLine({ sort: tempSort, list: listId, leaving: false });
      return;
    }
    setSortLine((current) => current && { ...current, leaving: true });
    const timer = window.setTimeout(
      () => setSortLine((current) => (current?.leaving ? null : current)),
      durationMs('--fl-dur-state', 260),
    );
    return () => window.clearTimeout(timer);
  }, [tempSort, listId]);
  /** A sort chosen from another list's menu, applied once that list is open. */
  const pendingSort = useRef<TempSort | null>(null);
  useEffect(() => {
    setTempSort(pendingSort.current);
    pendingSort.current = null;
  }, [listId]);
  const shownView = useMemo(
    () => (view && tempSort ? { ...view, items: sortedItems(view.items, tempSort) } : view),
    [view, tempSort],
  );
  const rows = useMemo(() => visibleRows(shownView, completedOpen), [shownView, completedOpen]);

  // A row that went away hands the selection to the row now in its place; a task just added isn't
  // in the rows until the next refresh, so it is waited for.
  const previousRows = useRef<TaskRow[]>([]);
  useEffect(() => {
    const before = previousRows.current;
    previousRows.current = rows;
    if (selected === null || rows.some((row) => row.key === selected)) return;
    const gone = before.findIndex((row) => row.key === selected);
    if (gone >= 0) setSelected(rows[Math.min(gone, rows.length - 1)]?.key ?? null);
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
    // D-80: a deleted expanded task collapses first, then plays its delete animation.
    const open = expandedRef.current;
    const ghostsNow = found.ghosts.map((ghost) =>
      ghost.direction === 'remove' && open.has(ghost.task.key) && hasBody(ghost.task)
        ? { ...ghost, expanded: true }
        : ghost,
    );
    const collapsing = ghostsNow.some((ghost) => ghost.expanded);
    setGhosts((current) => [...current, ...ghostsNow]);
    setMoved((current) => new Set([...current, ...found.moved]));
    const ids = new Set(found.ghosts.map((ghost) => ghost.id));
    window.setTimeout(
      () => {
        setGhosts((current) => current.filter((ghost) => !ids.has(ghost.id)));
        setMoved((current) => new Set([...current].filter((key) => !found.moved.includes(key))));
      },
      durationMs('--fl-dur-complete', 400) + (collapsing ? durationMs('--fl-dur-base', 200) : 0),
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
        // D-78: Esc keeps the task selected; leaving the field by a click on another task (which
        // selected that one on mousedown) keeps that selection.
        if (how === 'escape') setSelected(key);
        else setSelected((current) => current ?? key);
      }
      void change({ kind: 'edit', key, text });
      if (how === 'notes') openNotes(key);
    },
    [change, openNotes],
  );

  /** Tab and Shift+Tab in Edit state (TASK-04): a task moves at once; a new row changes level. */
  const tab = useCallback(
    (how: 'indent' | 'outdent'): void => {
      const current = editingRef.current;
      if (current?.kind === 'task')
        void change({ kind: how, key: current.key }).then((outcome) => {
          if (!outcome) nudge(current.key, how === 'indent' ? 'right' : 'left');
        });
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
      // D-78: Shift+Enter goes on into the new task's notes.
      if (key && how === 'notes') openNotes(key);
    },
    [change, listId, lists, showToast, openNotes],
  );

  const addFromComposer = useCallback(
    async (text: string, chooseNewList: boolean): Promise<void> => {
      const outcome = await change({
        kind: 'add',
        text,
        where: 'top',
        ...(chooseNewList && { chooseNewList }),
      });
      if (!outcome?.key) return;
      if (outcome.listId !== listId) showToast(outcome.label, true);
      else setSelected(outcome.key);
    },
    [change, listId, showToast],
  );

  /**
   * MEDIA-03, D-84: Copy into Flint from a notice: the file copied into attachments/, then the
   * link swapped in the editor that added it, or else in the open note or the task that has it.
   */
  const copyLinkedIn = useCallback(
    async (notice: LinkedNotice & { id: number }): Promise<void> => {
      const outcome = await window.flintMain.copyIntoFlint(notice.link);
      if (!outcome?.ok) {
        if (outcome) showToast(outcome.problem, false);
        return;
      }
      setLinkedNotices((current) => current.filter((other) => other.id !== notice.id));
      let done = notice.relink(outcome.link);
      if (!done && view?.mode === 'note' && view.noteText?.includes(notice.link)) {
        await window.flintMain.saveNote(view.id, relink(view.noteText, notice.link, outcome.link));
        done = true;
      }
      if (!done && view) {
        const row = visibleRows(view, true).find((task) => task.body.includes(notice.link));
        if (row) {
          await change({
            kind: 'body',
            key: row.key,
            body: relink(row.body, notice.link, outcome.link),
          });
          done = true;
        }
      }
      showToast(
        done ? `Copied ${notice.name} into Flint` : 'Copied; the link to update wasn’t found',
        false,
      );
    },
    [view, change, showToast],
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

  /**
   * TASK-07, D-59: a row picked with the mouse. Ctrl+click marks or unmarks it, Shift+click marks
   * the rows from the anchor to it; a plain click selects it alone.
   */
  const selectRow = useCallback(
    (key: string, how?: { readonly ctrl: boolean; readonly shift: boolean }): void => {
      const range = (from: string, to: string): Set<string> => {
        const a = rows.findIndex((row) => row.key === from);
        const b = rows.findIndex((row) => row.key === to);
        if (a < 0 || b < 0) return new Set([to]);
        return new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.key));
      };
      if (how?.shift) {
        setMarked(range(anchor.current ?? selected ?? key, key));
      } else if (how?.ctrl) {
        setMarked((current) => {
          const next = new Set(current.size > 0 ? current : selected ? [selected] : []);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        anchor.current = key;
      } else {
        anchor.current = key;
        setMarked(NOTHING);
      }
      setSelected(key);
    },
    [rows, selected],
  );

  /** TASK-07, D-59: several changes as one step, with one toast and one Undo. */
  const bulk = useCallback(
    async (label: string, changes: ListChange[]): Promise<void> => {
      if (changes.length === 0) return;
      const outcome = await change({ kind: 'many', label, changes });
      if (outcome) showToast(outcome.label, true);
    },
    [change, showToast],
  );
  const markedRows = useMemo(() => rows.filter((row) => marked.has(row.key)), [rows, marked]);
  const bulkComplete = useCallback((): void => {
    const open = markedRows.filter((row) => !row.done);
    const done = open.length > 0;
    const target = done ? open : markedRows;
    void bulk(
      `${done ? 'Completed' : 'Reopened'} ${tasksCount(target.length)}`,
      target.map((row) => ({ kind: 'complete', key: row.key, done })),
    );
  }, [bulk, markedRows]);
  const bulkPriority = useCallback(
    (priority: TaskRow['priority']): void => {
      const open = markedRows.filter((row) => !row.done);
      void bulk(
        `${tasksCount(open.length)}: ${priority ? `priority ${priority}` : 'no priority'}`,
        open.map((row) => ({ kind: 'priority', key: row.key, priority })),
      );
    },
    [bulk, markedRows],
  );
  const bulkDelete = useCallback((): void => {
    void bulk(
      `Deleted ${tasksCount(markedRows.length)}`,
      markedRows.map((row) => ({ kind: 'delete', key: row.key })),
    );
    setMarked(NOTHING);
  }, [bulk, markedRows]);
  const bulkMove = useCallback(
    (anchorBox: DOMRect): void =>
      openListPicker(
        { anchor: anchorBox, returnFocus: null },
        listInfos(lists),
        { exclude: listId, placeholder: 'Move to list…' },
        (pick) => {
          const to = 'newList' in pick ? { newList: pick.newList } : { list: pick.list.id };
          const name = 'newList' in pick ? pick.newList : pick.list.name;
          void bulk(
            `Moved ${tasksCount(markedRows.length)} to ${name}`,
            markedRows.map((row) => ({ kind: 'moveTo', key: row.key, to })),
          );
          setMarked(NOTHING);
        },
      ),
    [bulk, lists, listId, markedRows],
  );
  /** D-77: the visible open tasks; Completed is never swept up (Ctrl+A, then Delete). */
  const selectAll = useCallback((): void => {
    const open = rows.filter((row) => !row.done);
    setMarked(new Set(open.map((row) => row.key)));
    anchor.current = open[0]?.key ?? null;
  }, [rows]);
  // Marks follow the rows: a task that went away is no longer marked.
  useEffect(() => {
    setMarked((current) => {
      const kept = [...current].filter((key) => rows.some((row) => row.key === key));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [rows]);

  /** TODAY-01, D-85: pins or unpins tasks, one undo step (with a toast for several). */
  const pin = useCallback(
    async (tasks: readonly TaskRow[], pinned: boolean): Promise<void> => {
      const targets = tasks.filter((task) => (task.pinned === true) !== pinned);
      if (targets.length === 0) return;
      const label = `${pinned ? 'Pinned' : 'Unpinned'}${targets.length > 1 ? ` ${tasksCount(targets.length)}` : ''}`;
      const outcome = await change({
        kind: 'many',
        label,
        changes: targets.map((task) => ({ kind: 'pin', key: task.key, pinned })),
      });
      if (outcome) showToast(outcome.label, true);
    },
    [change, showToast],
  );

  /** TASK-07, D-59: the right-click menu of a marked row: the actions for all marked tasks. */
  const bulkMenu = useCallback(
    (at: Point): void => {
      const open = markedRows.some((row) => !row.done);
      const count = tasksCount(markedRows.length);
      openMenu(
        [
          // D-86: the menu says what it acts on.
          { label: `${markedRows.length} selected`, disabled: true },
          'divider',
          {
            label: `${open ? 'Complete' : 'Reopen'} ${count}`,
            hint: 'Space',
            action: bulkComplete,
          },
          ...(open
            ? [
                {
                  label: 'Priority',
                  submenu: [
                    { label: 'High', hint: '3', action: () => bulkPriority('high') },
                    { label: 'Medium', hint: '2', action: () => bulkPriority('medium') },
                    { label: 'Low', hint: '1', action: () => bulkPriority('low') },
                    { label: 'None', hint: '0', action: () => bulkPriority(null) },
                  ],
                },
              ]
            : []),
          { label: `Move ${count} to…`, action: () => bulkMove(new DOMRect(at.x, at.y, 0, 0)) },
          // TODAY-01, D-85: pins all, or unpins all when all are pinned.
          markedRows.every((row) => row.pinned)
            ? { label: `Unpin ${count}`, hint: 'P', action: () => void pin(markedRows, false) }
            : { label: `Pin ${count}`, hint: 'P', action: () => void pin(markedRows, true) },
          'divider',
          { label: `Delete ${tasksCount(markedRows.length)}`, hint: 'Del', action: bulkDelete },
        ],
        at,
      );
    },
    [markedRows, bulkComplete, bulkPriority, bulkMove, bulkDelete, pin],
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
    (row: TaskRow, at: Point, keepSelection = false): void => {
      // TASK-07, D-86: inside the marks, the menu acts on all of them; outside, the right-clicked
      // task alone is selected first (Windows Explorer).
      if (!keepSelection && marked.size > 1 && marked.has(row.key)) {
        bulkMenu(at);
        return;
      }
      // D-87: a subtask's menu in the panel leaves the selection (the panel's task) as it is.
      if (!keepSelection) {
        setMarked(NOTHING);
        setSelected(row.key);
      }
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
          ...(open
            ? [
                {
                  label: 'Duplicate',
                  action: () =>
                    void change({ kind: 'duplicate', key: row.key }).then((outcome) => {
                      if (!outcome) return;
                      showToast(outcome.label, true);
                      if (outcome.key) setSelected(outcome.key);
                    }),
                },
              ]
            : []),
          ...(open && view?.items.some((item) => item.kind === 'task' && item.task.key === row.key)
            ? [{ label: 'Add subtask', action: () => addSubtask(row) }]
            : []),
          ...(open ? [{ label: 'Add notes', action: () => openNotes(row.key) }] : []),
          // TODAY-01, D-85.
          {
            label: row.pinned ? 'Unpin' : 'Pin',
            hint: 'P',
            action: () => void pin([row], !row.pinned),
          },
          // D-79: Shift+Tab and Tab, made findable.
          ...(open
            ? [
                view?.items.some((item) => item.kind === 'task' && item.task.key === row.key)
                  ? {
                      label: 'Indent',
                      hint: 'Tab',
                      // D-89: an impossible one nudges the row, as from the keyboard.
                      action: () =>
                        void change({ kind: 'indent', key: row.key }).then((outcome) => {
                          if (!outcome) nudge(row.key, 'right');
                        }),
                    }
                  : {
                      label: 'Outdent',
                      hint: 'Shift+Tab',
                      action: () =>
                        void change({ kind: 'outdent', key: row.key }).then((outcome) => {
                          if (!outcome) nudge(row.key, 'left');
                        }),
                    },
              ]
            : []),
          // D-79: fencing a body's unfenced code or JSON on purpose (never by itself on render).
          ...(open && hasBody(row) && !/^ {0,3}(```|~~~)/m.test(row.body)
            ? [
                {
                  label: 'Format as code',
                  action: () =>
                    void change({
                      kind: 'body',
                      key: row.key,
                      body: fencedBlock(
                        row.body.trim(),
                        classifyPaste(row.body) === 'json' ? 'json' : '',
                      ),
                    }),
                },
              ]
            : []),
          {
            label: open ? 'Complete' : 'Reopen',
            hint: 'Space',
            action: () => void toggle(row.key),
          },
          'divider',
          ...(open
            ? [
                {
                  label: 'Priority',
                  submenu: [
                    priority('High', '3', 'high'),
                    priority('Medium', '2', 'medium'),
                    priority('Low', '1', 'low'),
                    priority('None', '0', null),
                  ],
                },
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
          // TASK-17, D-85.
          {
            label: 'Convert to note',
            action: () =>
              void change({ kind: 'toNote', key: row.key }).then((outcome) => {
                if (!outcome) return;
                showToast(outcome.label, true);
                // D-86: the new note opens, ready to type.
                setFocusNote(outcome.listId);
                go({ list: outcome.listId, page: null });
              }),
          },
          'divider',
          { label: 'Delete', hint: 'Del', action: () => void remove(row.key) },
        ],
        at,
      );
    },
    // D-86: the marks are read here (inside or outside them), so they are a dependency.
    [
      marked,
      bulkMenu,
      view,
      change,
      edit,
      mute,
      remove,
      toggle,
      lists,
      listId,
      moveTask,
      changeReminder,
      pin,
      openPage,
      openNotes,
      addSubtask,
      showToast,
      go,
    ],
  );

  /** LIST-01, D-52: the + next to "Lists", Ctrl+Shift+N and the sidebar's background. */
  const newListMenu = useCallback(
    (at: Point): void => {
      const start = (mode: 'tasks' | 'note'): void => {
        setNamingProblem(null);
        setNaming({ kind: 'new', mode });
      };
      openMenu(
        [
          { label: 'New task list', hint: 'Ctrl+Shift+N', action: () => start('tasks') },
          { label: 'New note', action: () => start('note') },
          'divider',
          {
            label: 'New group',
            action: () => {
              setNamingProblem(null);
              setNaming({ kind: 'newGroup' });
            },
          },
        ],
        at,
      );
    },
    [setNaming],
  );

  /** LIST-05, LIST-06: a change to the sidebar; a problem shows in the toast. */
  const sidebarChange = useCallback(
    async (action: SidebarAction): Promise<SidebarOutcome | null> => {
      const outcome = await window.flintMain.sidebarAction(action);
      if (outcome && !outcome.ok && outcome.problem) showToast(outcome.problem, false);
      return outcome;
    },
    [showToast],
  );

  /** D-73: reordering only happens in the manual order; under a sort, a hint says so. */
  const reorderable = useCallback((): boolean => {
    const sort = sidebarView?.sort ?? 'manual';
    if (sort === 'manual') return true;
    showToast(`Sorted by ${SORT_LABELS[sort]} · switch to Manual to reorder`, false);
    return false;
  }, [sidebarView, showToast]);

  /** LIST-06, D-73: the sort button next to the +. */
  const sortMenu = useCallback(
    (at: Point): void => {
      const current = sidebarView?.sort ?? 'manual';
      openMenu(
        (Object.keys(SORT_LABELS) as SidebarSort[]).map((sort) => ({
          label: SORT_LABELS[sort],
          checked: sort === current,
          action: () => void sidebarChange({ kind: 'sort', sort }),
        })),
        at,
      );
    },
    [sidebarView, sidebarChange],
  );

  /** LIST-05: a group folds away or opens; this machine remembers it. */
  const toggleGroup = useCallback(
    (id: string): void => {
      setSidebarFocus(id);
      const collapsed = !(sidebarView?.collapsed.includes(id) ?? false);
      setSidebarView(
        (current) =>
          current && {
            ...current,
            collapsed: collapsed
              ? [...current.collapsed, id]
              : current.collapsed.filter((other) => other !== id),
          },
      );
      void sidebarChange({ kind: 'collapse', id, collapsed });
    },
    [sidebarView, sidebarChange],
  );

  /** LIST-05: a group's right-click menu. */
  const groupMenu = useCallback(
    (group: SidebarGroup, at: Point): void => {
      setSidebarFocus(group.id);
      openMenu(
        [
          {
            label: 'Rename group',
            action: () => {
              setNamingProblem(null);
              setNaming({ kind: 'renameGroup', id: group.id, name: group.name });
            },
          },
          {
            label: 'New group',
            action: () => {
              setNamingProblem(null);
              setNaming({ kind: 'newGroup' });
            },
          },
          'divider',
          {
            label: 'Delete group',
            action: () =>
              void sidebarChange({ kind: 'deleteGroup', id: group.id }).then((outcome) => {
                if (outcome?.ok) showToast(`${outcome.label} · its lists stay`, true);
              }),
          },
        ],
        at,
      );
    },
    [sidebarChange, showToast, setNaming],
  );

  const submitName = useCallback(
    async (name: string): Promise<void> => {
      if (!naming) return;
      if (naming.kind === 'newGroup' || naming.kind === 'renameGroup') {
        const outcome = await window.flintMain.sidebarAction(
          naming.kind === 'newGroup'
            ? { kind: 'newGroup', name }
            : { kind: 'renameGroup', id: naming.id, name },
        );
        if (!outcome) return;
        if (!outcome.ok) {
          setNamingProblem(outcome.problem);
          return;
        }
        // D-80: the field gives way to the group in one step, in its place.
        await refresh(() => {
          setNamingState(null);
          setNamingProblem(null);
        });
        if (naming.kind === 'newGroup' && naming.list && outcome.id)
          await sidebarChange({
            kind: 'move',
            id: naming.list,
            to: { group: outcome.id, index: 0 },
          });
        return;
      }
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
    [naming, openList, showToast, sidebarChange, refresh, setNaming],
  );

  /** D-55: a list's right-click menu; D-89: Inbox has a short one of its own (LIST-03). */
  const listMenu = useCallback(
    (list: ListSummary, at: Point): void => {
      const done = (outcome: ListActionOutcome | null): void => {
        if (!outcome) return;
        if (!outcome.ok) return showToast(outcome.problem, false);
        if (outcome.label) showToast(outcome.label, true);
      };
      // D-59, D-86: inside the marks, the menu acts on all the marked lists and notes; outside,
      // on the right-clicked one alone, and the marks go (Windows Explorer).
      if (markedLists.size > 1 && markedLists.has(list.id)) {
        const ids = [...markedLists];
        openMenu(
          [
            { label: `${ids.length} selected`, disabled: true },
            'divider',
            {
              label: `Delete ${ids.length} lists and notes`,
              action: () =>
                void window.flintMain.listAction({ kind: 'deleteMany', ids }).then((outcome) => {
                  setMarkedLists(NOTHING);
                  if (ids.includes(listId)) openList('inbox');
                  done(outcome);
                }),
            },
          ],
          at,
        );
        return;
      }
      setMarkedLists(NOTHING);
      const other = list.mode === 'note' ? 'tasks' : 'note';
      // TASK-08, D-88: the list's temporary sorts (it opens first when it isn't open).
      const sorting: MenuEntry[] =
        list.mode === 'tasks'
          ? [
              {
                label: 'Sort tasks by',
                submenu: (['priority', 'reminder', 'added'] as const).map((sort) => ({
                  label: SORT_NAMES[sort][0]?.toUpperCase() + SORT_NAMES[sort].slice(1),
                  checked: list.id === listId && tempSort === sort,
                  action: () => {
                    if (list.id === listId) sortTo(sort);
                    else {
                      pendingSort.current = sort;
                      openList(list.id);
                    }
                  },
                })),
              },
            ]
          : [];
      // M6 (Proposed): Today's menu: its temporary sorts.
      if (list.id === TODAY_ID) {
        openMenu(
          [
            ...sorting,
            ...(listId === TODAY_ID && tempSort
              ? [{ label: 'Back to manual order', action: () => sortTo(null) }]
              : []),
          ],
          at,
        );
        return;
      }
      // D-89 (Proposed): the Inbox's own menu: its sorts and Duplicate; it is never renamed,
      // converted, grouped or deleted.
      if (list.inbox) {
        openMenu(
          [
            ...sorting,
            ...(list.id === listId && tempSort
              ? [{ label: 'Back to manual order', action: () => sortTo(null) }]
              : []),
            'divider',
            {
              label: 'Duplicate',
              action: () =>
                void window.flintMain.listAction({ kind: 'duplicate', id: list.id }).then(done),
            },
          ],
          at,
        );
        return;
      }
      // LIST-05: into a group, or out of one.
      const groups = (sidebarView?.items ?? []).filter(
        (item): item is SidebarGroup => item.kind === 'group',
      );
      const inGroup = groups.find((group) => group.lists.includes(list.id));
      const intoGroup = (to: { group: string | null; index: number }): void => {
        if (reorderable()) void sidebarChange({ kind: 'move', id: list.id, to });
      };
      // LIST-06, D-87: to the top of where it is (its group, or the lists outside groups); only
      // in the manual order, which is what it changes.
      const manual = (sidebarView?.sort ?? 'manual') === 'manual';
      const grouping: MenuEntry[] = [
        {
          label: 'Move to top',
          ...(manual ? {} : { hint: 'Switch to Manual', disabled: true }),
          action: () => intoGroup({ group: inGroup?.id ?? null, index: 0 }),
        },
        {
          label: 'Move to group',
          submenu: [
            ...groups
              .filter((group) => group !== inGroup)
              .map((group) => ({
                label: group.name,
                action: () => intoGroup({ group: group.id, index: group.lists.length }),
              })),
            ...(groups.length > (inGroup ? 1 : 0) ? ['divider' as const] : []),
            {
              label: 'New group',
              action: () => {
                setNamingProblem(null);
                setNaming({ kind: 'newGroup', list: list.id });
              },
            },
          ],
        },
        ...(inGroup
          ? [
              {
                label: 'Remove from group',
                action: () => {
                  // Right below its group, at the top level.
                  const at = (sidebarView?.items ?? []).indexOf(inGroup) + 1;
                  intoGroup({ group: null, index: at });
                },
              },
            ]
          : []),
      ];
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
            label: 'Duplicate',
            action: () =>
              void window.flintMain.listAction({ kind: 'duplicate', id: list.id }).then(done),
          },
          {
            label: other === 'note' ? 'Convert to note' : 'Convert to task list',
            action: () =>
              void window.flintMain
                .listAction({ kind: 'convert', id: list.id, mode: other })
                .then((outcome) => {
                  done(outcome);
                  // D-86: a list that became a note opens, ready to type.
                  if (outcome?.ok && other === 'note') {
                    setFocusNote(outcome.listId);
                    go({ list: outcome.listId, page: null });
                  }
                }),
          },
          'divider',
          ...sorting,
          ...grouping,
          'divider',
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
    [
      listId,
      openList,
      showToast,
      markedLists,
      sidebarView,
      sidebarChange,
      reorderable,
      setNaming,
      go,
      tempSort,
      sortTo,
    ],
  );

  /** The sidebar's lists in the order shown (Inbox first), for Shift+click ranges. */
  const sidebarOrder = useMemo((): string[] => {
    const placed = (sidebarView?.items ?? []).flatMap((item) =>
      item.kind === 'group' ? item.lists : [item.id],
    );
    return placed.length > 0 ? placed : lists.filter((list) => !list.inbox).map((list) => list.id);
  }, [sidebarView, lists]);

  /** LIST-01, D-59: a list in the sidebar; Ctrl/Shift+click marks lists and notes instead. */
  const sidebarSelect = useCallback(
    (id: string, how: { readonly ctrl: boolean; readonly shift: boolean }): void => {
      const order = sidebarOrder;
      setSidebarFocus(id);
      if (how.shift) {
        const from = listAnchor.current ?? listId;
        const a = order.indexOf(from);
        const b = order.indexOf(id);
        setMarkedLists(
          new Set(a < 0 || b < 0 ? [id] : order.slice(Math.min(a, b), Math.max(a, b) + 1)),
        );
        return;
      }
      if (how.ctrl) {
        setMarkedLists((current) => {
          const next = new Set(current.size > 0 ? current : order.includes(listId) ? [listId] : []);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        listAnchor.current = id;
        return;
      }
      listAnchor.current = id;
      setMarkedLists(NOTHING);
      openList(id);
    },
    [sidebarOrder, listId, openList],
  );

  // D-79: the keyboard is in the task list once a task is selected there.
  useEffect(() => {
    if (selected !== null) setSidebarFocus(null);
  }, [selected]);

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
      // NAV-07, D-83: Ctrl+\ hides or shows the context panel, from anywhere.
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === '\\') {
        event.preventDefault();
        if (wide) togglePanel();
        return;
      }
      // Typing in a text field or the note editor (contenteditable) is never a command.
      if (isTextField(event.target)) return;
      // NAV-06, D-88: Ctrl+F in a task list opens its find bar.
      if (
        key === 'f' &&
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        view?.mode === 'tasks' &&
        !page
      ) {
        event.preventDefault();
        setFinding((count) => count + 1);
        return;
      }
      // NAV-06, D-84: Ctrl+F on a note's page finds in the note (the editor has it when focused).
      if (
        key === 'f' &&
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        view?.mode === 'note'
      ) {
        event.preventDefault();
        openFindIn(document);
        return;
      }
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
      // TASK-07: Ctrl+A marks every task in the list.
      if (event.ctrlKey && !event.altKey && !event.shiftKey && key === 'a') {
        event.preventDefault();
        if (view?.mode === 'tasks' && !page) {
          selectAll();
          return;
        }
        // D-89: on a note or a task's page, the text of its notes (never the whole window's, the
        // context panel's included).
        const editor = document.querySelector<HTMLElement>(
          '.content.note-page .note-editor .cm-editor, .content.task-page .page-editor .cm-editor',
        );
        const cm = editor ? CodeEditorView.findFromDOM(editor) : null;
        if (!cm) return;
        cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
        cm.focus();
        return;
      }
      // D-79: Alt+↑/↓ with the keyboard in the sidebar moves the list or group picked there; with
      // it in the task list, the selected task (below); with nothing picked, nothing.
      if (
        sidebarFocus &&
        event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        (key === 'arrowup' || key === 'arrowdown')
      ) {
        event.preventDefault();
        if (reorderable())
          void sidebarChange({
            kind: 'step',
            id: sidebarFocus,
            direction: key === 'arrowdown' ? 1 : -1,
          });
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

      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.altKey) {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
        if (!next) return;
        if (event.shiftKey) {
          // TASK-07: Shift+↑/↓ marks from the anchor to the new row.
          anchor.current ??= selected;
          const from = rows.findIndex((other) => other.key === anchor.current);
          const to = rows.indexOf(next);
          if (from >= 0)
            setMarked(
              new Set(rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.key)),
            );
        } else {
          anchor.current = next.key;
          setMarked(NOTHING);
        }
        followSelection.current = event.repeat ? 'instant' : 'smooth';
        setSelected(next.key);
        return;
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey) {
        event.preventDefault();
        // Alt+↑/↓ reorders (TASK-02); single keys never reach Windows. TASK-08, D-88: while
        // sorted, reordering returns to the manual order first.
        if (tempSort) {
          sortTo(null);
          return;
        }
        if (open)
          void change({
            kind: 'move',
            key: open.key,
            direction: event.key === 'ArrowDown' ? 'down' : 'up',
          }).then((outcome) => {
            // D-87: Alt+↑ on the first task, Alt+↓ on the last: a nudge.
            if (!outcome) nudge(open.key, event.key === 'ArrowDown' ? 'down' : 'up');
          });
        return;
      }
      if (event.altKey) return;
      if (event.key === 'ArrowRight' && row && hasBody(row)) {
        event.preventDefault();
        if (!expanded.has(row.key)) showBody(row);
      } else if (event.key === 'ArrowLeft' && row && expanded.has(row.key)) {
        event.preventDefault();
        showBody(row);
      } else if (event.key === 'Enter' && event.shiftKey && row) {
        // TASK-05, D-53: any task opens as a page.
        event.preventDefault();
        openPage(row.key);
      } else if (event.key === ' ' && marked.size > 1) {
        event.preventDefault();
        bulkComplete();
      } else if (event.key in PRIORITY_KEYS && marked.size > 1) {
        event.preventDefault();
        bulkPriority(PRIORITY_KEYS[event.key] ?? null);
      } else if (event.key === 'Delete' && marked.size > 1) {
        event.preventDefault();
        bulkDelete();
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
      } else if (key === 'p' && !event.shiftKey && (marked.size > 1 || row)) {
        // TODAY-01, D-85: P pins or unpins (all marked, or the selected task).
        event.preventDefault();
        const targets = marked.size > 1 ? rows.filter((other) => marked.has(other.key)) : [row];
        const tasks = targets.filter((task): task is TaskRow => task !== undefined);
        void pin(tasks, !tasks.every((task) => task.pinned));
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        composer.current?.focus();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        // D-87: an impossible indent or outdent nudges the row.
        if (open)
          void change({ kind: event.shiftKey ? 'outdent' : 'indent', key: open.key }).then(
            (outcome) => {
              if (!outcome) nudge(open.key, event.shiftKey ? 'left' : 'right');
            },
          );
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
        // Esc clears the marks first, then the selection (TASK-07). D-89: with the context panel,
        // a body open inline anyway closes first.
        if (marked.size > 0) setMarked(NOTHING);
        else if (row && panelShownRef.current && expanded.has(row.key)) showBody(row);
        else setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    tempSort,
    wide,
    togglePanel,
    sidebarFocus,
    reorderable,
    sidebarChange,
    rows,
    selected,
    marked,
    selectAll,
    bulkComplete,
    bulkPriority,
    bulkDelete,
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
    pin,
  ]);

  /** The task shown as a page, if it is still in the list (else the list shows). */
  const pageTask =
    page && view?.mode === 'tasks' && view.id === listId ? findRow(view, page) : null;
  const taskLists = lists.filter((list) => !list.inbox);
  const inbox = lists.find((list) => list.inbox);
  /** A list in the sidebar: its row, or its name field while it is renamed. */
  const navList = (list: ListSummary): ReactElement =>
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
        marked={markedLists.size > 1 && markedLists.has(list.id)}
        onSelect={(how) => sidebarSelect(list.id, how)}
        onMenu={(at) => listMenu(list, at)}
      />
    );
  const listById = new Map(taskLists.map((list) => [list.id, list]));
  // LIST-05, D-74: groups and ungrouped lists in one order; before the sidebar file is read, the
  // lists as they come.
  const sidebarItems: readonly SidebarItem[] =
    sidebarView?.items ?? taskLists.map((list) => ({ kind: 'list', id: list.id }));
  const groupNameField = (initial: string, key: string): ReactElement => (
    <NameField
      key={key}
      initial={initial}
      placeholder="Group name"
      icon={<ChevronIcon size={12} />}
      group
      problem={namingProblem}
      onSubmit={(name) => void submitName(name)}
      onCancel={() => setNaming(null)}
    />
  );
  // UI-04: rows that appear in the list being looked at ease in; opening a list doesn't animate.
  const known = useRef<{ list: string; keys: ReadonlySet<string> }>({ list: '', keys: new Set() });
  const freshKeys = new Map<string, 'new' | 'return'>();
  if (view && known.current.list === view.id)
    for (const row of rows) if (!known.current.keys.has(row.key)) freshKeys.set(row.key, 'new');
  // D-75, D-76: a task that just completed eases into Completed; a reopened one returns.
  for (const key of moved)
    freshKeys.set(key, rows.find((row) => row.key === key)?.done === false ? 'return' : 'new');
  useEffect(() => {
    if (view) known.current = { list: view.id, keys: new Set(rows.map((row) => row.key)) };
  }, [view, rows]);
  // UI-04: one selection highlight per card glides between rows; a row being edited shows its own.
  const tasksCard = useRef<HTMLElement>(null);
  const pageCard = useRef<HTMLElement>(null);
  const completedCard = useRef<HTMLElement>(null);

  /**
   * TASK-01, D-54, D-78: a task row dragged within its list, among the tasks at its level (with its
   * subtasks); an expanded one folds while it is dragged. Not while anything is edited.
   */
  const startRowDrag = (event: React.MouseEvent, card: HTMLElement | null): void => {
    if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey) return;
    // TASK-08, D-88: reordering happens in the manual order; while sorted, nothing drags.
    if (tempSort) return;
    if (!card || !view || view.readOnly !== null || editing || editingBody) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, .body-block')) return;
    const row = target.closest<HTMLElement>('.row[data-key]');
    if (!row || row.matches('.done, .leaving')) return;
    const units = rowDragUnits(card, row);
    if (!units) return;
    const others = units.peers.filter((peer) => peer !== units.unit);
    // D-80: an expanded task's body and the task's subtasks fold away, animated, while it moves.
    const [own, ...subtasks] = units.unit.elements;
    const folding = [
      ...(own?.classList.contains('row-group')
        ? [...own.children].filter((child): child is HTMLElement => !child.matches('.row'))
        : []),
      ...subtasks,
    ];
    watchDrag(event.nativeEvent, {
      ...units,
      scroller: card.closest<HTMLElement>('.scroller'),
      onLift: () => foldAway(folding),
      onSettle: () => unfold(folding),
      onDrop: async (index) => {
        const next = others[index];
        const last = others.at(-1);
        const where = next
          ? ({ at: 'before', key: next.key } as const)
          : last
            ? ({ at: 'after', key: last.key } as const)
            : null;
        if (!where) return false;
        return (await change({ kind: 'place', key: units.unit.key, where })) !== null;
      },
    });
  };

  /**
   * LIST-05, LIST-06, D-54, D-73: a list dragged in the sidebar, also into and out of groups (a
   * list just below a group's last list joins the group when it is nearer to it, and shows indented),
   * or a whole group among the top-level items. Only in the manual order.
   */
  const startSidebarDrag = (event: React.MouseEvent): void => {
    const aside = sidebar.current;
    if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || !aside) return;
    if (naming) return;
    const target = event.target as HTMLElement;
    const head = target.closest<HTMLElement>('.nav-group-head');
    const nav = head ? null : target.closest<HTMLElement>('.nav[data-key]');
    const items = sidebarView?.items ?? [];
    const topUnits = (): DragUnit[] =>
      [...aside.children].flatMap((element): DragUnit[] => {
        const key = element.matches('.nav-group')
          ? element.querySelector<HTMLElement>('.nav-group-head')?.dataset['key']
          : element.matches('.nav[data-key]')
            ? (element as HTMLElement).dataset['key']
            : undefined;
        // Inbox and Today stay where they are (M6).
        return key && key !== inbox?.id && key !== TODAY_ID
          ? [{ key, elements: [element as HTMLElement] }]
          : [];
      });
    const canStart = (): boolean => reorderable();
    const scroller = aside;
    if (head?.parentElement) {
      const group = head.dataset['key'] ?? '';
      const peers = topUnits();
      const unit = peers.find((peer) => peer.key === group);
      if (!unit) return;
      watchDrag(event.nativeEvent, {
        unit,
        peers,
        scroller,
        canStart,
        onDrop: async (index) =>
          (await sidebarChange({ kind: 'move', id: group, to: { group: null, index } }))?.ok ===
          true,
      });
      return;
    }
    const id = nav?.dataset['key'];
    if (!nav || !id || id === inbox?.id || id === TODAY_ID) return;
    // Every visible list and group header, in order, each moving on its own.
    interface Spot {
      readonly unit: DragUnit;
      readonly kind: 'head' | 'list';
      readonly group: string | null;
      readonly open: boolean;
    }
    const spots: Spot[] = [];
    for (const element of aside.children) {
      if (element.matches('.nav[data-key]')) {
        const key = (element as HTMLElement).dataset['key'] ?? '';
        if (key !== inbox?.id && key !== TODAY_ID)
          spots.push({
            unit: { key, elements: [element as HTMLElement] },
            kind: 'list',
            group: null,
            open: true,
          });
      } else if (element.matches('.nav-group')) {
        const groupHead = element.querySelector<HTMLElement>('.nav-group-head');
        const group = groupHead?.dataset['key'];
        if (!groupHead || !group) continue;
        const open = !(sidebarView?.collapsed.includes(group) ?? false);
        spots.push({ unit: { key: group, elements: [groupHead] }, kind: 'head', group, open });
        if (open)
          for (const list of element.querySelectorAll<HTMLElement>('.group-inner > .nav[data-key]'))
            spots.push({
              unit: { key: list.dataset['key'] ?? '', elements: [list] },
              kind: 'list',
              group,
              open,
            });
      }
    }
    const self = spots.find((spot) => spot.kind === 'list' && spot.unit.key === id);
    if (!self) return;
    const others = spots.filter((spot) => spot !== self);
    const destination = (
      index: number,
      offset: number,
    ): { readonly group: string | null; readonly index: number } => {
      const next = others[index];
      const previous = others[index - 1];
      const listsOf = (group: string): string[] => {
        const found = items.find((item) => item.kind === 'group' && item.id === group);
        return found?.kind === 'group' ? found.lists.filter((list) => list !== id) : [];
      };
      if (next?.kind === 'list' && next.group)
        return { group: next.group, index: listsOf(next.group).indexOf(next.unit.key) };
      if (previous?.kind === 'head' && previous.open) return { group: previous.group, index: 0 };
      if (previous?.kind === 'list' && previous.group && offset < 0.5)
        return { group: previous.group, index: listsOf(previous.group).length };
      const tops = items.filter((item) => item.id !== id);
      const at = next ? tops.findIndex((item) => item.id === next.unit.key) : -1;
      return { group: null, index: at < 0 ? tops.length : at };
    };
    const inGroup = self.group !== null;
    const cardOf = (group: string): HTMLElement | null =>
      aside.querySelector<HTMLElement>(`.nav-group[data-group="${CSS.escape(group)}"]`);
    /**
     * D-80: a group's card follows its rows while a list is dragged: its surface (drawn apart from
     * it, CSS) reaches from its header to its last list or the landing slot, wherever they slide.
     * Positions are the untransformed ones (offsets) plus the shifts the drag gave them.
     */
    const shiftOf = (element: Element): number =>
      Number(/translateY\((-?[\d.]+)px\)/.exec((element as HTMLElement).style.transform)?.[1] ?? 0);
    const within = (element: HTMLElement, card: HTMLElement): number => {
      // Up the offset parents to `card` (a group card, or the sidebar itself).
      let y = 0;
      for (let node: HTMLElement | null = element; node && node !== card;) {
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      return y;
    };
    const stretchCards = (
      to: { readonly group: string | null },
      slot: { readonly top: number; readonly bottom: number },
    ): void => {
      for (const card of aside.querySelectorAll<HTMLElement>('.nav-group:not(.flip-ghost)')) {
        const cardHead = card.querySelector<HTMLElement>(':scope > .nav-group-head');
        if (!cardHead) continue;
        const open = card.querySelector('.group-lists.open') !== null;
        const ends = [within(cardHead, card) + cardHead.offsetHeight + shiftOf(cardHead)];
        if (open)
          for (const list of card.querySelectorAll<HTMLElement>('.group-inner > .nav'))
            if (list !== nav) ends.push(within(list, card) + list.offsetHeight + shiftOf(list));
        if (open && to.group === card.dataset['group'])
          ends.push(slot.bottom - card.getBoundingClientRect().top);
        // The card's padding below its last row: 3 px, and 2 more under an open group's lists.
        const bottom = Math.max(...ends) + (open ? 5 : 3);
        card.style.setProperty('--card-top', `${shiftOf(cardHead)}px`);
        card.style.setProperty('--card-bottom', `${bottom - card.offsetHeight}px`);
      }
    };
    /** A folded group whose header the dragged list is over: it goes into that group. */
    let onto: string | null = null;
    /** Folded headers held in place under the dragged list, with the shift the drag gave them. */
    const held = new Map<HTMLElement, string>();
    const listsCount = (group: string): number => {
      const found = items.find((item) => item.kind === 'group' && item.id === group);
      return found?.kind === 'group' ? found.lists.length : 0;
    };
    let landing: { readonly group: string | null; readonly index: number } | null = null;
    watchDrag(event.nativeEvent, {
      unit: self.unit,
      peers: spots.map((spot) => spot.unit),
      scroller,
      canStart,
      // Cues for where it will land (D-81): the group's card gets its white ring, and the row
      // shows indented in a group or flush at the top level.
      onOver: (index, offset, slot) => {
        // Onto a folded group's header: measured where the header rests, and the header is held
        // there while the list is over it (it would otherwise slide away from under the pointer).
        const box = nav.getBoundingClientRect();
        const middle = (box.top + box.bottom) / 2;
        onto = null;
        for (const spot of spots) {
          const head = spot.unit.elements[0];
          if (spot.kind !== 'head' || spot.open || !spot.group || !head) continue;
          // Layout offsets: a header still sliding (the drag's transition) doesn't move them.
          const top = aside.getBoundingClientRect().top + within(head, aside) - aside.scrollTop;
          if (middle > top + 4 && middle < top + head.offsetHeight - 4) onto = spot.group;
        }
        for (const spot of spots) {
          const head = spot.unit.elements[0];
          if (spot.kind !== 'head' || spot.open || !head) continue;
          if (spot.group === onto) {
            if (head.style.transform !== '') held.set(head, head.style.transform);
            head.style.transform = '';
          } else if (held.has(head)) {
            if (head.style.transform === '') head.style.transform = held.get(head) ?? '';
            held.delete(head);
          }
        }
        landing = onto ? { group: onto, index: listsCount(onto) } : destination(index, offset);
        stretchCards(landing, slot);
        const into = landing.group !== null;
        nav.classList.toggle('drag-indent', into && !inGroup);
        nav.classList.toggle('drag-outdent', !into && inGroup);
        for (const card of aside.querySelectorAll('.nav-group.drop-target'))
          if (card !== cardOf(landing.group ?? '')) card.classList.remove('drop-target');
        if (landing.group) cardOf(landing.group)?.classList.add('drop-target');
      },
      onSettle: () => {
        for (const card of aside.querySelectorAll<HTMLElement>('.nav-group'))
          card.style.removeProperty('--card-top');
        for (const card of aside.querySelectorAll<HTMLElement>('.nav-group'))
          card.style.removeProperty('--card-bottom');
        nav.classList.remove('drag-indent', 'drag-outdent', 'drop-into');
        for (const card of aside.querySelectorAll('.nav-group.drop-target'))
          card.classList.remove('drop-target');
      },
      onDrop: async (index, offset) => {
        const to = landing ?? destination(index, offset);
        const folded = onto;
        if (folded) nav.classList.add('drop-into');
        const done = (await sidebarChange({ kind: 'move', id, to }))?.ok === true;
        // A folded group's header pulses once as the list goes in.
        if (done && folded && !reducedMotion())
          cardOf(folded)?.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
            { duration: durationMs('--fl-dur-base', 200), easing: 'ease-out' },
          );
        return done;
      },
    });
  };
  // D-76: the highlight is also the editing field, gliding between editing rows.
  const glideTarget = editing
    ? editing.kind === 'task'
      ? editing.key
      : NEW_ROW
    : marked.size > 1
      ? null
      : selected;
  // D-77: marked rows next to each other form one highlight: each knows its marked neighbours.
  const markJoins = new Map<string, { readonly up: boolean; readonly down: boolean }>();
  if (marked.size > 1)
    rows.forEach((row, index) => {
      if (!marked.has(row.key)) return;
      // D-78: an expanded task (a card with its body) keeps its own highlight and spacing.
      const joins = (other: TaskRow | undefined): boolean =>
        other !== undefined &&
        marked.has(other.key) &&
        other.done === row.done &&
        !expanded.has(other.key) &&
        !expanded.has(row.key);
      markJoins.set(row.key, { up: joins(rows[index - 1]), down: joins(rows[index + 1]) });
    });
  const glideVersion = [rows, completedOpen];

  const rowProps: RowHandlers = {
    selected,
    editing,
    onSelect: selectRow,
    marked,
    markJoins,
    onToggle: (key) => void toggle(key),
    onEdit: edit,
    onLeaveTask: leaveTask,
    onTab: tab,
    onMenu: (task, at) => taskMenu(task, at),
    onMute: (key, muted) => void mute(key, muted),
    onPin: (task, pinned) => void pin([task], pinned),
    onReminder: (task, anchor) => changeReminder(task, anchor),
    expanded,
    onBody: (task) => showBody(task),
    onImages: (task) => showImage(bodyImages(task.body), 0),
  };
  const saveBody = (key: string, body: string): void => {
    setEditingBody(null);
    void change({ kind: 'body', key, body });
  };
  /** D-80: a code block or an image deleted from a body, with Undo; no confirmation. */
  const removePart = (key: string, body: string, kind: 'code' | 'image'): void => {
    void change({ kind: 'body', key, body }).then((outcome) => {
      if (outcome) showToast(kind === 'code' ? 'Deleted code block' : 'Deleted image', true);
    });
  };
  /** A body shown inline under its row (D-76), rendered or being edited (D-49). */
  const bodyRows = (task: TaskRow, subtask: boolean): ReactElement[] => {
    const open = expanded.has(task.key);
    // An empty body shows while its notes are being written (D-78).
    const writing = open && editingBody === task.key;
    if ((!open && !closingBodies.has(task.key)) || (!hasBody(task) && !writing)) return [];
    const classes = ['row-body'];
    if (subtask) classes.push('subtask');
    if (!open) classes.push('closing');
    return [
      <div key={`body-${task.key}`} className={classes.join(' ')}>
        <BodyBlock
          body={task.body}
          inline
          editing={open && editingBody === task.key}
          editable={!view?.readOnly}
          onEdit={() => setEditingBody(task.key)}
          onDone={(body) => saveBody(task.key, body)}
          // D-87: saved as it is typed, and if the editor goes without being left.
          onSave={(body) => void change({ kind: 'body', key: task.key, body })}
          onOpenPage={() => openPage(task.key)}
          onImage={showImage}
          onRemovePart={(body, kind) => removePart(task.key, body, kind)}
          onRelink={(body) => void change({ kind: 'body', key: task.key, body })}
        />
      </div>,
    ];
  };

  /**
   * D-77: a task whose body shows is one raised card holding its row and its body (mockup 01).
   */
  const withBody = (row: ReactElement, task: TaskRow, subtask: boolean): ReactElement => {
    const body = bodyRows(task, subtask);
    return body.length === 0 ? (
      row
    ) : (
      <div key={`group-${task.key}`} className={subtask ? 'row-group subtask' : 'row-group'}>
        {row}
        {body}
      </div>
    );
  };

  // TASK-05, D-76: the page's subtasks, with a new row where Add subtask or Enter opened one.
  const pageRows: ReactElement[] = [];
  if (pageTask) {
    const fresh = editing?.kind === 'new' ? editing : null;
    const keys = [pageTask.key, ...pageTask.subtasks.map((sub) => sub.key)];
    const anchor = fresh
      ? [fresh.after, ...fresh.added].filter((key) => keys.includes(key)).at(-1)
      : undefined;
    const placeNew = (after: string): void => {
      if (fresh && after === anchor)
        pageRows.push(
          <NewRow key={`new-${fresh.seq}`} subtask={false} onLeave={leaveNew} onTab={tab} />,
        );
    };
    placeNew(pageTask.key);
    for (const sub of pageTask.subtasks) {
      pageRows.push(
        withBody(
          <Row key={sub.key} task={sub} fresh={freshKeys.get(sub.key)} {...rowProps} />,
          sub,
          false,
        ),
      );
      placeNew(sub.key);
    }
  }

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
    cardRows.push(...ghostRows(ghosts, 'open', null, rowProps));
    (shownView ?? view).items.forEach((item, index) => {
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
          withBody(
            <Row
              key={item.task.key}
              task={item.task}
              fresh={freshKeys.get(item.task.key)}
              {...rowProps}
            />,
            item.task,
            false,
          ),
        );
        cardRows.push(...ghostRows(ghosts, 'open', item.task.key, rowProps));
        for (const subtask of item.task.subtasks) {
          cardRows.push(
            withBody(
              <Row
                key={subtask.key}
                task={subtask}
                subtask
                fresh={freshKeys.get(subtask.key)}
                {...rowProps}
              />,
              subtask,
              true,
            ),
          );
          cardRows.push(...ghostRows(ghosts, 'open', subtask.key, rowProps));
          placeNew(subtask.key, true);
        }
        placeNew(item.task.key, false);
      }
    });
  }

  // D-86: the open list or note went away (an undone Convert to note, a file deleted outside
  // Flint): back to the last place whose list is still there, else Inbox.
  const knownLists = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ids = new Set(lists.map((list) => list.id));
    const before = knownLists.current;
    knownLists.current = ids;
    // Only a list that was there and is gone; a new one may not be in the lists yet.
    if (!before.has(listId) || ids.has(listId)) return;
    const trail = history.current;
    for (let at = trail.at - 1; at >= 0; at--) {
      const place = trail.places[at];
      if (place && ids.has(place.list)) {
        trail.at = at;
        show(place, place.select ?? null, true);
        return;
      }
    }
    openList('inbox');
  }, [lists, listId, show, openList]);

  /**
   * D-87 (CAP-06 on a task's page): pasted code, JSON or a stack trace becomes a code block, and a
   * pasted picture an attachment, in the selected subtask's notes, or with none selected in the
   * task's own; one undo step. Other text waits for TASK-09's multi-line paste.
   */
  useEffect(() => {
    if (!pageTask || view?.readOnly) return;
    const onPaste = (event: ClipboardEvent): void => {
      if (isTextField(event.target) || !event.clipboardData) return;
      const target = pageTask.subtasks.find((sub) => sub.key === selected) ?? pageTask;
      const append = (part: string): void =>
        void change({
          kind: 'body',
          key: target.key,
          body: [target.body.trim(), part].filter((piece) => piece !== '').join('\n\n'),
        }).then((outcome) => {
          if (outcome)
            showToast(
              target === pageTask ? 'Added to the notes' : `Added to ${target.label}`,
              true,
            );
        });
      const image = [...event.clipboardData.items]
        .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
        ?.getAsFile();
      if (image) {
        event.preventDefault();
        void image
          .arrayBuffer()
          .then((buffer) => window.flintMain.attach(new Uint8Array(buffer), image.type))
          .then((link) => {
            if (link) append(`![](${link})`);
          });
        return;
      }
      const clipboard = event.clipboardData.getData('text/plain');
      const kind = classifyPaste(clipboard);
      if (kind === 'text') return;
      event.preventDefault();
      append(fencedBlock(blockFor(clipboard).text, kind === 'json' ? 'json' : ''));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pageTask, selected, view?.readOnly, change, showToast]);

  // D-87: a row selected with ↑/↓ (or from a link in the panel) is scrolled into view, smoothly;
  // a click or a right-click never moves the list.
  useEffect(() => {
    const follow = followSelection.current;
    followSelection.current = false;
    if (!selected || !follow) return;
    const row = scroller.current?.querySelector<HTMLElement>(
      `.row[data-key="${CSS.escape(selected)}"]`,
    );
    if (!row) return;
    const area = scroller.current?.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    // Only a row that is out of view (a click or a menu never moves the list).
    if (area && box.top >= area.top && box.bottom <= area.bottom) return;
    row.scrollIntoView({
      block: 'nearest',
      behavior: follow === 'instant' || reducedMotion() ? 'instant' : 'smooth',
    });
  }, [selected]);

  /**
   * TASK-09 (D-88, Proposed): text pasted into a task list (not into a field): each non-empty line
   * becomes a task, below the selected task or at the top, as one undo step, with "Keep as one" in
   * the toast (one task: the first line its title, the rest its notes). Code, JSON or a stack trace
   * (CAP-06) is one untitled task with it as a code block (D-45). List markers and checkboxes at the
   * start of a line go.
   */
  useEffect(() => {
    if (view?.mode !== 'tasks' || page || view.readOnly) return;
    const onPaste = (event: ClipboardEvent): void => {
      if (isTextField(event.target) || !event.clipboardData) return;
      const text = event.clipboardData.getData('text/plain');
      if (text.trim() === '') return;
      event.preventDefault();
      const after = rows.find((row) => row.key === selected && !row.done)?.key;
      const kind = classifyPaste(text);
      // D-89 (CAP-06): code on a selected task whose notes are open inline goes into those notes.
      const open = selected && expanded.has(selected) ? findRow(view, selected) : null;
      if (kind !== 'text' && open && !open.done) {
        const block = fencedBlock(blockFor(text).text, kind === 'json' ? 'json' : '');
        void change({
          kind: 'body',
          key: open.key,
          body: [open.body.trim(), block].filter((piece) => piece !== '').join('\n\n'),
        }).then((outcome) => {
          if (outcome) showToast(`Added to ${open.label}`, true);
        });
        return;
      }
      if (kind !== 'text') {
        void change({
          kind: 'add',
          text: `\n${fencedBlock(blockFor(text).text, kind === 'json' ? 'json' : '')}`,
          where: after ? { after } : 'top',
        }).then((outcome) => {
          if (!outcome) return;
          showToast(outcome.label, true);
          if (outcome.key) setSelected(outcome.key);
        });
        return;
      }
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').trim())
        .filter((line) => line !== '');
      void (async () => {
        const ids = await Promise.all(lines.map(() => window.flintMain.reserveId()));
        if (ids.some((id) => id === null)) return;
        const keys = ids as string[];
        // Each pasted line is typed text: escaped, so its `!`, `##` and `@` stay text (D-45).
        const changes: ListChange[] = lines.map((line, index) => ({
          kind: 'add',
          text: pastedText(line),
          where: index === 0 ? (after ? { after } : 'top') : { after: keys[index - 1] ?? '' },
          id: keys[index] ?? '',
        }));
        const label = lines.length === 1 ? 'Added' : `Added ${tasksCount(lines.length)}`;
        const outcome = await change({ kind: 'many', label, changes });
        if (!outcome) return;
        setSelected(keys.at(-1) ?? null);
        if (lines.length === 1) {
          showToast(outcome.label, true);
          return;
        }
        showToast(outcome.label, true, {
          label: 'Keep as one',
          run: () =>
            void undo().then(() =>
              change({
                kind: 'add',
                text: `${pastedText(lines[0] ?? '')}\n${lines.slice(1).join('\n')}`,
                where: after ? { after } : 'top',
              }).then((one) => {
                if (one?.key) setSelected(one.key);
              }),
            ),
        });
      })();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [view, page, rows, selected, expanded, change, showToast, undo]);

  /** D-86: a subtask added in the panel: below the last subtask, or as the first one. */
  const addSubtaskIn = async (task: TaskRow, text: string): Promise<void> => {
    if (text.trim() === '') return;
    const id = (await window.flintMain.reserveId()) ?? undefined;
    const last = task.subtasks.at(-1);
    await change({
      kind: 'many',
      label: 'Added subtask',
      changes: [
        { kind: 'add', text, where: { after: last?.key ?? task.key }, ...(id ? { id } : {}) },
        ...(last || !id ? [] : [{ kind: 'indent' as const, key: id }]),
      ],
    });
  };
  /**
   * D-86: "In this note" / "In this task": a fact's click jumps to its first item, the next click to
   * the next one (wrapping). A note scrolls its editor; a task's page its rendered body.
   */
  const factAt = useRef<{ kind: string; index: number } | null>(null);
  const jumpToFact = (kind: FactKind, positions: readonly number[]): void => {
    const root = scroller.current;
    if (!root) return;
    const cm = noteEditorView(root);
    const targets = cm ? [] : pageFactTargets(root, kind);
    const count = cm ? positions.length : targets.length;
    if (count === 0) return;
    const index = factAt.current?.kind === kind ? (factAt.current.index + 1) % count : 0;
    factAt.current = { kind, index };
    const behavior = reducedMotion() ? 'auto' : 'smooth';
    if (cm) {
      const from = positions[index] ?? 0;
      const y = cm.documentTop + cm.lineBlockAt(from).top - root.getBoundingClientRect().top;
      root.scrollTo({ top: root.scrollTop + y - root.clientHeight / 3, behavior });
      window.setTimeout(() => {
        const at = cm.domAtPos(from).node;
        const line = (at instanceof Element ? at : at.parentElement)?.closest('.cm-line');
        if (line) flash(line);
      }, 320);
      return;
    }
    const target = targets[index];
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior });
    flash(target);
  };
  useEffect(() => {
    factAt.current = null;
  }, [view?.id, page]);

  /** NAV-07, D-85: "Show panel" / "Hide panel", where a right-click menu has room for it. */
  const panelItem = (): MenuEntry[] =>
    wide && view
      ? [
          {
            label: panelHidden ? 'Show panel' : 'Hide panel',
            hint: 'Ctrl+\\',
            action: togglePanel,
          },
        ]
      : [];
  const panelMenu = (at: Point): void => openMenu(panelItem(), at);
  /** TASK-08, D-88: the open task list's temporary sorts (the page's menu, the list's menu). */
  const sortItems = (): MenuEntry[] =>
    view?.mode === 'tasks' && !pageTask
      ? [
          {
            label: 'Sort tasks by',
            submenu: (['priority', 'reminder', 'added'] as const).map((sort) => ({
              label: SORT_NAMES[sort][0]?.toUpperCase() + SORT_NAMES[sort].slice(1),
              checked: tempSort === sort,
              action: () => sortTo(sort),
            })),
          },
          ...(tempSort ? [{ label: 'Back to manual order', action: () => sortTo(null) }] : []),
        ]
      : [];

  // NAV-07, D-83: what the context panel shows.
  const selectedRow = view && selected && marked.size <= 1 ? findRow(view, selected) : null;
  const panelState: PanelState | null =
    !panelShown || !view
      ? null
      : view.mode === 'note'
        ? { kind: 'note', text: view.noteText ?? '', edited: view.edited, created: view.created }
        : // D-89: on a task's page, a selected subtask shows its own details (its notes too).
          pageTask && (!selectedRow || selectedRow.key === pageTask.key)
          ? { kind: 'page', task: pageTask }
          : selectedRow
            ? {
                kind: 'task',
                task: selectedRow,
                listName: selectedRow.home?.listName ?? view.name,
                readOnly: view.readOnly !== null,
              }
            : { kind: 'upnext' };
  const [upNextItems, setUpNextItems] = useState<readonly UpNextItem[]>([]);
  const wantsUpNext = panelState?.kind === 'upnext' || panelState?.kind === 'page';
  useEffect(() => {
    if (wantsUpNext) void window.flintMain.upNext().then(setUpNextItems);
  }, [wantsUpNext, view]);
  // NAV-07, D-85: the panel's back arrow, for a task reached from a link in the panel.
  selectedRef.current = selected;
  const herePlace = history.current.places[history.current.at];
  const panelBack =
    herePlace?.fromPanel === true && history.current.at > 0 && herePlace.select === selected;
  // The outline's current section (D-85, a scroll-spy): the last heading above a line 96 px below
  // the top of the view; scrolled to the end, the last heading.
  const panelText =
    panelState?.kind === 'note'
      ? panelState.text
      : panelState?.kind === 'page'
        ? panelState.task.body
        : null;
  const panelOutline = useMemo(
    () => (panelText === null ? null : outlineOf(panelText)),
    [panelText],
  );
  const [outlineCurrent, setOutlineCurrent] = useState(0);
  useEffect(() => {
    const element = scroller.current;
    if (!element || !panelOutline || panelOutline.headings.length === 0) return;
    const headingTops = (): number[] => {
      const cm = noteEditorView(element);
      // The editor draws only what is near the view: the height map knows where the rest is.
      if (cm)
        return panelOutline.headings.map(
          (heading) => cm.documentTop + cm.lineBlockAt(heading.from).top,
        );
      return [...element.querySelectorAll('.body-view :is(h1, h2, h3, h4, h5, h6)')].map(
        (heading) => heading.getBoundingClientRect().top,
      );
    };
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const tops = headingTops();
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 2) {
        setOutlineCurrent(tops.length - 1);
        return;
      }
      const line = element.getBoundingClientRect().top + 96;
      let at = 0;
      tops.forEach((value, index) => {
        if (value <= line) at = index;
      });
      setOutlineCurrent(at);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    element.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [panelOutline]);
  /**
   * NAV-07, D-85: the panel's top lines up with the composer's (a task list) or the note card's,
   * and sticks there while the page scrolls (never higher).
   */
  const [panelTop, setPanelTop] = useState(4);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !panelShown) return;
    const measure = (): void => {
      // M6: in Today, its first card (the rollover prompt, the reminders or the composer).
      const anchor = element.querySelector<HTMLElement>(
        '.content > .rollover, .content > .today-reminders, .content > .composer, .content > .note-card',
      );
      const pair = element.querySelector<HTMLElement>('.pair');
      if (!anchor || !pair) {
        setPanelTop(4);
        return;
      }
      // Layout offsets, not boxes: the page's arrival animation moves the boxes for a moment.
      const offset = (element: HTMLElement): number => {
        let top = 0;
        for (let at: HTMLElement | null = element; at; at = at.offsetParent as HTMLElement | null)
          top += at.offsetTop;
        return top;
      };
      setPanelTop(Math.max(4, Math.round(offset(anchor) - offset(pair))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [panelShown, view?.id, view?.mode, pageTask?.key]);
  // D-89: Shift+Enter or "Add notes" with the context panel: its notes editor takes the caret.
  useEffect(() => {
    const key = panelNotesFor.current;
    if (!key || panelState?.kind !== 'task' || panelState.task.key !== key) return;
    panelNotesFor.current = null;
    const editor = document.querySelector<HTMLElement>(
      '.context-panel .panel-state:not(.panel-ghost) .panel-notes .cm-editor',
    );
    const cm = editor ? CodeEditorView.findFromDOM(editor) : null;
    if (!cm) return;
    cm.dispatch({ selection: { anchor: cm.state.doc.length } });
    cm.focus();
  });
  const panelHandlers: PanelHandlers = {
    onHide: togglePanel,
    onBack: panelBack ? () => travel(-1) : null,
    onMenu: (at) => panelMenu(at),
    onOpenPage: openPage,
    onToggle: (key) => void toggle(key),
    onPin: (task, pinned) => void pin([task], pinned),
    onUnpin: (item) =>
      void window.flintMain
        .change(item.listId, { kind: 'pin', key: item.key, pinned: false })
        .then((outcome) => {
          if (outcome) showToast(outcome.label, true);
        }),
    onNewSubtask: (task, text) => void addSubtaskIn(task, text),
    onFact: (kind, positions) => jumpToFact(kind, positions),
    onTaskMenu: (task, at) => taskMenu(task, at, true),
    onSubtask: (task) => followFromPanel(listId, task.key),
    onTitle: (key, text) => void change({ kind: 'edit', key, text }),
    onPriority: (task, anchor) =>
      openPriorityPicker(
        { anchor, returnFocus: null },
        task.priority,
        (priority) => void change({ kind: 'priority', key: task.key, priority }),
      ),
    onList: (task, anchor) =>
      openListPicker(
        { anchor, returnFocus: null },
        listInfos(lists),
        { exclude: listId, placeholder: 'Move to list…' },
        (pick) =>
          void moveTask(
            task.key,
            'newList' in pick ? { newList: pick.newList } : { list: pick.list.id },
          ),
      ),
    onReminder: (task, anchor) => changeReminder(task, anchor),
    onBody: (key, body) => void change({ kind: 'body', key, body }),
    onRemovePart: (key, body, kind) => removePart(key, body, kind),
    onAddSubtask: addSubtask,
    onImage: showImage,
    onGo: (item) => followFromPanel(item.listId, item.key),
    onJump: (kind, index, from) => {
      const root = scroller.current;
      if (!root) return;
      const cm = noteEditorView(root);
      if (cm) {
        // D-85: a smooth scroll to the heading or block (instant under reduce-motion).
        const y = cm.documentTop + cm.lineBlockAt(from).top - root.getBoundingClientRect().top;
        root.scrollTo({
          top: root.scrollTop + y - 24,
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
        return;
      }
      // A task's page: its rendered body's headings and blocks, in order.
      const targets =
        kind === 'heading'
          ? root.querySelectorAll('.body-view :is(h1, h2, h3, h4, h5, h6)')
          : root.querySelectorAll('.body-view :is(.code-card, .body-image)');
      targets[index]?.scrollIntoView({
        block: 'start',
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
    },
  };

  return (
    <div className="app">
      <div className="sidebar-drag" aria-hidden="true" />
      <aside
        ref={sidebar}
        className="sidebar"
        onMouseDown={startSidebarDrag}
        onContextMenu={(event) => {
          event.preventDefault();
          newListMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <Glide
          card={sidebar}
          target={listId}
          version={[lists, naming, sidebarView]}
          className="nav-glide"
        />
        <div className="brand">
          <img src={flintIcon} alt="" />
          <span>Flint</span>
        </div>
        {/* TODAY-01 (M6, D-89): Today first, with its open pinned tasks. */}
        <NavItem
          list={{
            id: TODAY_ID,
            name: 'Today',
            mode: 'tasks',
            open: sidebarView?.today ?? 0,
            inbox: false,
          }}
          active={listId === TODAY_ID}
          icon={<SunIcon />}
          onSelect={() => openList(TODAY_ID)}
          onMenu={(at) =>
            listMenu({ id: TODAY_ID, name: 'Today', mode: 'tasks', open: 0, inbox: false }, at)
          }
        />
        {inbox && (
          <NavItem
            list={inbox}
            active={listId === inbox.id}
            icon={<InboxIcon />}
            onSelect={() => openList(inbox.id)}
            onMenu={(at) => listMenu(inbox, at)}
          />
        )}
        <div className="section-label lists-label">
          <span>Lists</span>
          <button
            type="button"
            className="sort-lists"
            aria-label="Sort lists"
            title={`Sort: ${SORT_LABELS[sidebarView?.sort ?? 'manual']}`}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              sortMenu({ x: box.left, y: box.bottom + 4 });
            }}
          >
            <SortIcon />
          </button>
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
        {/* D-80: a new group starts at the top of Lists, its name field ready (mockup 10). */}
        {naming?.kind === 'newGroup' && (
          <div className="naming-group" data-flip="naming:group">
            {groupNameField('', 'new-group')}
          </div>
        )}
        {sidebarItems.map((item) => {
          if (item.kind === 'list') {
            const list = listById.get(item.id);
            return list ? navList(list) : null;
          }
          const collapsed = sidebarView?.collapsed.includes(item.id) ?? false;
          return (
            <NavGroup
              key={item.id}
              group={item}
              collapsed={collapsed}
              focused={sidebarFocus === item.id}
              header={
                naming?.kind === 'renameGroup' && naming.id === item.id
                  ? groupNameField(item.name, `rename-${item.id}`)
                  : null
              }
              onToggle={() => toggleGroup(item.id)}
              onMenu={(at) => groupMenu(item, at)}
            >
              {item.lists.map((id) => {
                const list = listById.get(id);
                return list ? navList(list) : null;
              })}
            </NavGroup>
          );
        })}
        {naming?.kind === 'new' && (
          <NameField
            flip="naming:list"
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
        <div className="titlebar">
          {/* NAV-07, D-85: shows or hides the panel whenever the window can fit it. */}
          {wide && view && (
            <button
              type="button"
              className={panelHidden ? 'panel-toggle' : 'panel-toggle on'}
              aria-label={panelHidden ? 'Show the panel' : 'Hide the panel'}
              aria-pressed={!panelHidden}
              title={panelHidden ? 'Show the panel (Ctrl+\\)' : 'Hide the panel (Ctrl+\\)'}
              onClick={togglePanel}
            >
              <PanelIcon />
            </button>
          )}
        </div>
        <div
          className="scroller"
          ref={scroller}
          onMouseDown={(event) => {
            // NAV-07, D-85: a click on blank space (not on a row) clears the selection.
            if (event.button !== 0 || view?.mode !== 'tasks' || pageTask) return;
            if ((event.target as Element).closest(BLANK_EXCEPT)) return;
            setSelected(null);
            setMarked(NOTHING);
          }}
          onContextMenu={(event) => {
            if (event.defaultPrevented || (event.target as Element).closest(BLANK_EXCEPT)) return;
            const sorts = sortItems();
            const panel = panelItem();
            const items: MenuEntry[] = [
              ...sorts,
              ...(sorts.length > 0 && panel.length > 0 ? ['divider' as const] : []),
              ...panel,
            ];
            if (items.length === 0) return;
            event.preventDefault();
            openMenu(items, { x: event.clientX, y: event.clientY });
          }}
        >
          {/* NAV-07, D-83, D-85: the column and the context panel, centred together. */}
          <div
            className={panelState ? `pair ${pairSize ?? ''}` : 'pair single'}
            style={{ '--panel-top': `${panelTop}px` } as CSSProperties}
          >
            {/* D-65: a list or page fades in, rising a few pixels, when it opens. */}
            <div
              ref={content}
              className={[
                'content',
                view?.mode === 'note' ? 'note-page' : '',
                pageTask ? 'task-page' : '',
                heading ?? '',
              ].join(' ')}
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
                  onAddSubtask={() => addSubtask(pageTask)}
                  onImage={showImage}
                  onRemovePart={(body, kind) => removePart(pageTask.key, body, kind)}
                >
                  {pageRows.length > 0 && (
                    <section
                      className="card tasks page-subtasks"
                      aria-label="Subtasks"
                      ref={pageCard}
                      onMouseDown={(event) => startRowDrag(event, pageCard.current)}
                    >
                      <Glide
                        card={pageCard}
                        target={glideTarget}
                        version={[pageTask, editing]}
                        editing={editing !== null}
                      />
                      {pageRows}
                    </section>
                  )}
                </TaskPage>
              )}

              {/* NAV-06, D-88, D-89: the find bar, level with the title row, then 16 px below the
              window's top as the list scrolls (where the context panel sticks). */}
              {view?.mode === 'tasks' && !pageTask && finding > 0 && (
                <ListFind
                  key={finding}
                  rows={visibleRows(shownView, true)}
                  root={scroller.current}
                  version={[view, expanded, completedOpen, tempSort]}
                  onJump={(match) => {
                    // A match in a folded place opens it (Completed, a body under its row).
                    if (
                      view.completed.some(
                        (task) =>
                          task.key === match.row.key ||
                          task.subtasks.some((sub) => sub.key === match.row.key),
                      )
                    )
                      setCompletedOpen(true);
                    if (match.where === 'body' && !panelShownRef.current)
                      setExpanded((current) => new Set([...current, match.row.key]));
                    followSelection.current = 'smooth';
                    setMarked(NOTHING);
                    setSelected(match.row.key);
                    // D-89: the match's row lights up a moment as the jump lands.
                    window.requestAnimationFrame(() => {
                      const row = scroller.current?.querySelector(
                        `.row[data-key="${CSS.escape(match.row.key)}"]`,
                      );
                      if (row) flash(row);
                    });
                  }}
                  onClose={() => setFinding(0)}
                />
              )}

              {/* TODAY-01, TODAY-02, TODAY-03 (M6, D-89, mockup 03): the greeting, the rollover
                  prompt and today's reminders, above the composer and Focus. */}
              {view && !pageTask && view.id === TODAY_ID && (
                <>
                  <TodayGreeting open={view.open} reminders={view.today?.reminders.length ?? 0} />
                  <RolloverCard
                    tasks={view.today?.rollover ?? []}
                    onAnswer={(clear) =>
                      void window.flintMain.todayAnswer(clear).then((label) => {
                        if (label) showToast(label, true);
                      })
                    }
                  />
                  <ReminderCards
                    reminders={view.today?.reminders ?? []}
                    onOpen={(reminder) =>
                      view.items.some(
                        (item) => item.kind === 'task' && item.task.key === reminder.key,
                      )
                        ? setSelected(reminder.key)
                        : go({ list: reminder.listId, page: null }, reminder.key)
                    }
                  />
                </>
              )}
              {view && !pageTask && view.mode === 'tasks' && view.id !== TODAY_ID && (
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
                // NOTE-01, D-85: the note's title and text on a card, so it is clear where to type.
                <div className="card note-card">
                  <header className="list-header">
                    <h1>{view.name}</h1>
                    {view.readOnly && (
                      <span className="subtitle">
                        Read-only: Flint can&apos;t change this file ({view.readOnly}).
                      </span>
                    )}
                  </header>
                  <NoteEditor
                    key={view.name}
                    id={view.id}
                    text={view.noteText ?? ''}
                    readOnly={view.readOnly !== null}
                    onId={setListId}
                    onImage={showImage}
                    mono={view.mono === true}
                    focus={focusNote === view.id}
                    onFocused={() => setFocusNote(null)}
                  />
                </div>
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

                  {/* TASK-08, D-88: while sorted, what the order is and the way back. */}
                  {sortLine && sortLine.list === view.id && (
                    <div
                      className={sortLine.leaving ? 'sort-indicator leaving' : 'sort-indicator'}
                      role="status"
                    >
                      <span>Sorted by {SORT_NAMES[sortLine.sort]}</span>
                      <span aria-hidden="true">·</span>
                      <button type="button" onClick={() => sortTo(null)}>
                        Back to manual order
                      </button>
                    </div>
                  )}
                  <section
                    className="card tasks"
                    aria-label="Tasks"
                    ref={tasksCard}
                    onMouseDown={(event) => startRowDrag(event, tasksCard.current)}
                  >
                    <Glide
                      card={tasksCard}
                      target={glideTarget}
                      version={glideVersion}
                      editing={editing !== null}
                    />
                    {view.id === TODAY_ID && (
                      <div className="focus-head">
                        <span className="panel-label">Focus</span>
                        {view.open > 1 && <span className="focus-hint">drag to reorder</span>}
                      </div>
                    )}
                    {view.items.length === 0 && (
                      <p className="empty">
                        {view.id === TODAY_ID
                          ? 'Nothing pinned yet. Press P on a task in any list to bring it here, or add one above.'
                          : 'Nothing here. Press Ctrl+N to add a task, or capture from anywhere with your hotkey.'}
                      </p>
                    )}
                    {cardRows}
                  </section>

                  {(view.completed.length > 0 ||
                    ghosts.some((ghost) => ghost.section === 'done')) && (
                    <section className="card completed" aria-label="Completed" ref={completedCard}>
                      <Glide
                        card={completedCard}
                        target={glideTarget}
                        version={glideVersion}
                        editing={editing !== null}
                      />
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
                      {/* TASK-06, Q-13, D-88: a large Completed section offers auto-archive. */}
                      {archiveOffer && (
                        <div className="archive-offer" role="note">
                          <span>
                            Archive tasks completed more than {ARCHIVE_DAYS} days ago,
                            automatically?
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void window.flintMain.setAutoArchive(ARCHIVE_DAYS).then((count) => {
                                setArchiveDays(ARCHIVE_DAYS);
                                showToast(
                                  count > 0
                                    ? `Auto-archive on · archived ${tasksCount(count)}`
                                    : 'Auto-archive on',
                                  false,
                                );
                              })
                            }
                          >
                            Turn on
                          </button>
                          <button type="button" onClick={() => dismissArchive(view.id)}>
                            Not now
                          </button>
                        </div>
                      )}
                      {/* D-77: Completed folds away (and opens) smoothly; its rows stay rendered. */}
                      <div
                        className={completedOpen ? 'completed-rows open' : 'completed-rows'}
                        inert={!completedOpen}
                      >
                        <div className="completed-inner">
                          {ghostRows(ghosts, 'done', null, rowProps)}
                          {view.completed.flatMap((task) => [
                            withBody(
                              <Row
                                key={task.key}
                                task={task}
                                fresh={freshKeys.get(task.key)}
                                {...rowProps}
                              />,
                              task,
                              false,
                            ),
                            ...ghostRows(ghosts, 'done', task.key, rowProps),
                          ])}
                        </div>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
            {panelState && (
              <ContextPanel
                state={panelState}
                upNext={upNextItems}
                current={outlineCurrent}
                back={panelBack}
                handlers={panelHandlers}
              />
            )}
          </div>
        </div>
      </main>

      {marked.size > 1 && (
        <div className="action-bar" role="toolbar" aria-label="Marked tasks">
          <span className="action-count">{marked.size} selected</span>
          <button type="button" onClick={selectAll}>
            Select all
          </button>
          <button
            type="button"
            data-picker-trigger
            onClick={(event) => bulkMove(event.currentTarget.getBoundingClientRect())}
          >
            Move
          </button>
          <button
            type="button"
            data-picker-trigger
            onClick={(event) =>
              openPriorityPicker(
                {
                  anchor: event.currentTarget.getBoundingClientRect(),
                  returnFocus: null,
                  trigger: event.currentTarget,
                },
                null,
                bulkPriority,
              )
            }
          >
            Priority
          </button>
          {/* TODAY-01, D-85: pins them all, or unpins them when all are pinned. */}
          <button
            type="button"
            onClick={() => void pin(markedRows, !markedRows.every((row) => row.pinned))}
          >
            {markedRows.every((row) => row.pinned) ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" onClick={bulkDelete}>
            Delete
          </button>
          <button
            type="button"
            className="action-clear"
            aria-label="Clear the selection"
            title="Clear the selection (Esc)"
            onClick={() => setMarked(NOTHING)}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {linkedNotices.length > 0 && (
        <div className="linked-notices" role="status">
          {linkedNotices.map((notice) => (
            <div key={notice.id} className="linked-notice">
              <div className="linked-notice-text">
                <span className="linked-notice-title">
                  Large file, linked to its original location
                </span>
                <span className="linked-notice-name">{notice.name}</span>
              </div>
              <span className="linked-notice-why-holder">
                <button
                  type="button"
                  className="linked-notice-copy"
                  onClick={() => void copyLinkedIn(notice)}
                >
                  Copy into Flint instead
                </button>
                <span className="linked-notice-info" aria-hidden="true">
                  i
                </span>
                <span className="linked-notice-why" role="tooltip">
                  Large files are linked by default: copying them makes the Flint folder, snapshots,
                  exports and future sync slow and big. Copying keeps the file safe if the original
                  is moved or deleted.
                </span>
              </span>
              <button
                type="button"
                className="linked-notice-close"
                aria-label="Dismiss"
                onClick={() =>
                  setLinkedNotices((current) => current.filter((other) => other.id !== notice.id))
                }
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* NAV-04, D-79, D-88: the swipe's arrow at the window's edge, growing with the swipe. */}
      {swipe && (
        <div
          className={swipe.back ? 'swipe-arrow back' : 'swipe-arrow forward'}
          style={{ '--swipe': swipe.progress } as CSSProperties}
          aria-hidden="true"
        >
          <ChevronIcon size={18} />
        </div>
      )}

      {zoomShown && (
        <div className="zoom-pill" role="status" key={zoomShown.id}>
          {zoomShown.text}
        </div>
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          start={lightbox.start}
          onClose={() => setLightbox(null)}
        />
      )}

      {toast && (
        <div
          className={['toast', marked.size > 1 ? 'above-bar' : '', toast.leaving ? 'leaving' : '']
            .filter(Boolean)
            .join(' ')}
          role="status"
          key={toast.id}
        >
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                hideToast();
              }}
            >
              {toast.action.label}
            </button>
          )}
          {toast.undo && (
            <button type="button" onClick={() => void undo().then(hideToast)}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * LIST-05, D-73, D-74, D-81: a group in the sidebar: a header in the section-label style that folds
 * it (chevron, name, number of lists) and its lists, indented under it. An expanded group sits on a
 * highlighted card; a list dragged over a group gives the card a white ring (`drop-target`, set by
 * the drag). Folding animates; folded lists stay rendered, inert.
 */
function NavGroup(props: {
  readonly group: SidebarGroup;
  readonly collapsed: boolean;
  /** D-79: picked in the sidebar: Alt+↑/↓ moves it. */
  readonly focused: boolean;
  /** The header's name field while the group is renamed. */
  readonly header: ReactElement | null;
  readonly onToggle: () => void;
  readonly onMenu: (at: Point) => void;
  readonly children: ReactNode;
}): ReactElement {
  const { group, collapsed, focused, header, onToggle, onMenu, children } = props;
  return (
    <div
      className={collapsed ? 'nav-group collapsed' : 'nav-group'}
      data-flip={`group:${group.id}`}
      data-group={group.id}
    >
      {header ?? (
        <button
          type="button"
          data-key={group.id}
          className={focused ? 'nav-group-head focus' : 'nav-group-head'}
          aria-expanded={!collapsed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggle}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <span className={collapsed ? 'group-chevron' : 'group-chevron open'}>
            <ChevronIcon size={12} />
          </span>
          <span className="group-name">
            <MorphText text={group.name} />
          </span>
          <span className="nav-count group-count">
            <MorphText text={String(group.lists.length)} />
          </span>
        </button>
      )}
      <div className={collapsed ? 'group-lists' : 'group-lists open'} inert={collapsed}>
        <div className="group-inner">{children}</div>
      </div>
    </div>
  );
}

/**
 * TASK-01, D-54: the units a row drags among: the top-level tasks of the card (each with its
 * subtasks' rows), or a subtask's siblings. Headings and paragraphs between tasks stay put.
 */
function rowDragUnits(
  card: HTMLElement,
  row: HTMLElement,
): { unit: DragUnit; peers: DragUnit[] } | null {
  const own = row.parentElement?.classList.contains('row-group') ? row.parentElement : row;
  const keyOf = (element: HTMLElement): string | undefined =>
    (element.matches('.row') ? element : element.querySelector<HTMLElement>(':scope > .row'))
      ?.dataset['key'];
  const isTask = (element: Element): element is HTMLElement =>
    element.matches('.row[data-key], .row-group') && !element.matches('.leaving');
  // Top-level units, each with the subtask rows that follow it.
  const tops: { key: string; elements: HTMLElement[]; subtasks: HTMLElement[] }[] = [];
  let current: (typeof tops)[number] | null = null;
  for (const element of card.children) {
    if (!isTask(element)) {
      if (!element.matches('.leaving')) current = null;
      continue;
    }
    const key = keyOf(element);
    if (!key) continue;
    if (element.classList.contains('subtask')) {
      if (current) {
        current.elements.push(element);
        current.subtasks.push(element);
      }
      continue;
    }
    current = { key, elements: [element], subtasks: [] };
    tops.push(current);
  }
  if (!own.classList.contains('subtask')) {
    const peers = tops.map(({ key, elements }) => ({ key, elements }));
    const unit = peers.find((peer) => peer.elements[0] === own);
    return unit ? { unit, peers } : null;
  }
  const parent = tops.find((top) => top.subtasks.includes(own));
  if (!parent) return null;
  const peers = parent.subtasks.flatMap((element) => {
    const key = keyOf(element);
    return key ? [{ key, elements: [element] }] : [];
  });
  const unit = peers.find((peer) => peer.elements[0] === own);
  return unit ? { unit, peers } : null;
}

function NavItem(props: {
  readonly list: ListSummary;
  readonly active: boolean;
  /** D-59: marked with Ctrl/Shift+click for deleting several. */
  readonly marked?: boolean;
  readonly icon: ReactElement;
  readonly onSelect: (how: { readonly ctrl: boolean; readonly shift: boolean }) => void;
  readonly onMenu: (at: Point) => void;
}): ReactElement {
  const { list, active, marked = false, icon, onSelect, onMenu } = props;
  const classes = ['nav'];
  if (active) classes.push('on');
  if (marked) classes.push('marked');
  return (
    <button
      type="button"
      data-key={list.id}
      {...(!list.inbox && { 'data-flip': `list:${list.id}` })}
      className={classes.join(' ')}
      // A click opens the list without taking the keyboard: the keys stay with the task list.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onSelect({ ctrl: event.ctrlKey, shift: event.shiftKey })}
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
  /** `chooseNewList`: the close-match card was flipped to a new list (Tab, D-25). */
  readonly onAdd: (text: string, chooseNewList: boolean) => Promise<void>;
}): ReactElement {
  const { listId, lists, inputRef, onAdd } = props;
  const text = useInertText('', false);
  /** D-78: notes under the title (Shift+Enter, as in the capture popup): the new task's body. */
  const [notes, setNotes] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const focusNotes = useRef(false);
  useEffect(() => {
    if (notes === null || !focusNotes.current) return;
    focusNotes.current = false;
    notesRef.current?.focus();
  }, [notes]);
  /**
   * D-80 (CAP-06 in the composer, as in the popup's selection area): pasted code, JSON or a stack
   * trace is a code card, a pasted image a thumbnail chip (the file is saved to attachments/ at
   * once); on Enter the body is the notes, then the code fenced, then the image links. Pasted
   * markdown and other text is typed as usual (D-79).
   */
  const [pasted, setPasted] = useState<readonly ComposerPaste[]>([]);
  const pasteRules = (event: React.ClipboardEvent): boolean => {
    const image = [...event.clipboardData.items]
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (image) {
      event.preventDefault();
      void image
        .arrayBuffer()
        .then((buffer) => window.flintMain.attach(new Uint8Array(buffer), image.type))
        .then((link) => {
          if (link) setPasted((current) => [...current, { kind: 'image', link, id: ++seq }]);
        });
      return true;
    }
    const clipboard = event.clipboardData.getData('text/plain');
    const kind = classifyPaste(clipboard);
    if (kind === 'text') return false;
    event.preventDefault();
    const block = blockFor(clipboard);
    setPasted((current) => [
      ...current,
      { kind: 'code', text: block.text, lang: kind === 'json' ? 'json' : '', id: ++seq },
    ]);
    return true;
  };
  const submit = (): void => {
    const typed = text.escaped();
    if (typed.trim() === '') return;
    const parts = [
      ...(notes?.trim() ? [notes.replace(/\s+$/, '')] : []),
      ...pasted.flatMap((item) =>
        item.kind === 'code' ? [fencedBlock(item.text, item.lang)] : [],
      ),
      ...pasted.flatMap((item) => (item.kind === 'image' ? [`![](${item.link})`] : [])),
    ];
    const body = parts.length > 0 ? `\n${parts.join('\n\n')}` : '';
    const newList = parsed?.target.kind === 'new' && chooseNewFor !== null;
    text.reset('', false);
    setNotes(null);
    setPasted([]);
    setChooseNewFor(null);
    setCardAcceptedFor(null);
    setMenuAcceptedFor(null);
    inputRef.current?.focus();
    void onAdd(typed + body, newList);
  };
  // UI-09: auto-closing brackets and quotes in the composer.
  useEffect(() => (inputRef.current ? enableAutoPair(inputRef.current) : undefined), [inputRef]);
  const infos = useMemo(() => listInfos(lists), [lists]);
  const { escaped, value } = text;
  /**
   * CAP-05, D-25, D-51, D-87: the popup's `##` menu (search and recent lists) and close-match card,
   * here too. Tab on the card flips between the close match and a new list.
   */
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(-1);
  const [menuAcceptedFor, setMenuAcceptedFor] = useState<string | null>(null);
  const [chooseNewFor, setChooseNewFor] = useState<string | null>(null);
  const [cardAcceptedFor, setCardAcceptedFor] = useState<string | null>(null);
  const { parsed, flippedFrom } = useMemo(() => {
    if (value.trim() === '') return { parsed: null, flippedFrom: null };
    const now = new Date();
    const first = parseCapture(escaped(), { now, lists: infos });
    if (chooseNewFor && first.target.kind === 'close-match' && first.target.name === chooseNewFor)
      return {
        parsed: parseCapture(escaped(), { now, lists: infos, chooseNewList: true }),
        flippedFrom: first.target.list,
      };
    return { parsed: first, flippedFrom: null };
  }, [value, escaped, infos, chooseNewFor]);
  const token = useMemo(() => {
    const at = listTokenAt(value, caret);
    // A pasted `##` is text (D-45): no menu for it.
    if (!at || escaped().includes(`\\${value.slice(at.start, at.end)}`)) return null;
    return { ...at, text: value.slice(at.start, at.end) };
  }, [value, caret, escaped]);
  const suggestions = useMemo(
    () =>
      // D-89: every matching list; the menu scrolls past five.
      token && token.text !== menuAcceptedFor ? suggestLists(token.typed, infos) : [],
    [token, menuAcceptedFor, infos],
  );
  useEffect(() => setHighlight(-1), [suggestions.map((list) => list.id).join()]);
  // D-89: the highlighted list stays in view as ↑/↓ go past the menu's five visible rows.
  const suggestionsBox = useRef<HTMLUListElement>(null);
  useEffect(() => {
    suggestionsBox.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);
  const cardTarget =
    parsed &&
    (parsed.target.kind === 'close-match' || parsed.target.kind === 'new') &&
    parsed.target.name !== cardAcceptedFor
      ? parsed.target
      : null;
  /** Replaces a stretch of the title with the list's own spelling, the caret after it. */
  const spell = (start: number, end: number, list: ListInfo): string => {
    const spelled = `##${listToken(list.name)}`;
    const next = value.slice(0, start) + spelled + value.slice(end);
    text.change(next);
    const at = start + spelled.length;
    setCaret(at);
    window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(at, at));
    return spelled;
  };
  const acceptSuggestion = (list: ListInfo | undefined): void => {
    if (!list || !token) return;
    setMenuAcceptedFor(spell(token.start, token.end, list));
  };
  const acceptCard = (): void => {
    if (!parsed || !cardTarget) return;
    const winner = parsed.tokens.find((item) => item.kind === 'list' && item.role === 'winner');
    if (cardTarget.kind === 'close-match' && winner) {
      const { toOriginal } = text.mapped();
      setMenuAcceptedFor(spell(toOriginal(winner.start), toOriginal(winner.end), cardTarget.list));
    } else setCardAcceptedFor(cardTarget.name);
  };
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
        aria-controls="composer-suggestions"
        onChange={(event) => {
          text.change(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={(event) =>
          setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
        }
        onPaste={(event) => {
          if (!pasteRules(event)) text.paste();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            focusNotes.current = true;
            if (notes === null) setNotes('');
            else notesRef.current?.focus();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            // D-40: with the menu or the card showing, Enter first accepts it; the next saves.
            if (suggestions.length > 0) acceptSuggestion(suggestions[Math.max(0, highlight)]);
            else if (cardTarget) acceptCard();
            else submit();
          } else if (
            (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
            suggestions.length > 0
          ) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setHighlight((at) => (at + step + suggestions.length) % suggestions.length);
          } else if (event.key === 'Tab' && !event.shiftKey && parsed) {
            // D-25: Tab flips the card between the close match and a new list.
            if (parsed.target.kind === 'close-match') {
              event.preventDefault();
              setChooseNewFor(parsed.target.name);
              setCardAcceptedFor(null);
            } else if (parsed.target.kind === 'new' && chooseNewFor) {
              event.preventDefault();
              setChooseNewFor(null);
              setCardAcceptedFor(null);
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {suggestions.length > 0 && (
        <ul
          ref={suggestionsBox}
          id="composer-suggestions"
          className="composer-suggestions"
          role="listbox"
          aria-label="Lists"
        >
          {suggestions.map((list, index) => (
            <li
              key={list.id}
              className="composer-suggestion"
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                acceptSuggestion(list);
                inputRef.current?.focus();
              }}
            >
              <span className="composer-suggestion-tile">
                <HashIcon size={13} />
              </span>
              <span>{list.name}</span>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length === 0 && cardTarget && (
        <div className="composer-choice" aria-live="polite">
          {cardTarget.kind === 'new' && flippedFrom ? (
            <>
              <span className="composer-option selected">
                New list &quot;{cardTarget.name}&quot; <span className="composer-key">Enter</span>
              </span>
              <span className="composer-option">
                {flippedFrom.name} <span className="composer-key">Tab</span>
              </span>
            </>
          ) : cardTarget.kind === 'close-match' ? (
            <>
              <span className="composer-option selected">
                {cardTarget.list.name} <span className="composer-key">Enter</span>
              </span>
              <span className="composer-option">
                New list &quot;{cardTarget.name}&quot; <span className="composer-key">Tab</span>
              </span>
            </>
          ) : (
            <span className="composer-option selected">
              New list &quot;{cardTarget.name}&quot; <span className="composer-key">Enter</span>
            </span>
          )}
        </div>
      )}
      {notes !== null && (
        <textarea
          ref={notesRef}
          className="composer-notes"
          aria-label="Notes"
          placeholder="Notes, code, links…"
          value={notes}
          spellCheck={false}
          onChange={(event) => setNotes(event.target.value)}
          onPaste={(event) => void pasteRules(event)}
          onKeyDown={(event) => {
            const field = event.currentTarget;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            } else if (event.key === 'Backspace' && field.value === '') {
              event.preventDefault();
              setNotes(null);
              inputRef.current?.focus();
            } else if (
              (event.key === 'ArrowUp' && field.selectionStart === 0) ||
              (event.key === 'Tab' && event.shiftKey)
            ) {
              event.preventDefault();
              inputRef.current?.focus();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              field.blur();
            }
          }}
        />
      )}
      {pasted.length > 0 && (
        <ComposerPastes
          items={pasted}
          onRemove={(id) => setPasted((current) => current.filter((item) => item.id !== id))}
        />
      )}
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
            or type <span className="chip">!h ##list @15:00</span> · Shift+Enter for notes
          </span>
        )}
      </div>
    </section>
  );
}

/** D-80: what was pasted into the composer, shown under it until Enter. */
type ComposerPaste =
  | {
      readonly kind: 'code';
      readonly text: string;
      /** The fence's language (json), or none. */
      readonly lang: string;
      readonly id: number;
    }
  | { readonly kind: 'image'; readonly link: string; readonly id: number };

/** Lines a folded code card shows (as in the popup, D-38). */
const PREVIEW_LINES = 4;

/**
 * D-80: pasted code as a card (language, background, the first lines with a chevron to see all, ×
 * to remove; a preview, not edited here) and pasted images as thumbnail chips, as in the capture
 * popup's selection area (CAP-06, D-38). Removing an image keeps its file (MEDIA-04).
 */
function ComposerPastes(props: {
  readonly items: readonly ComposerPaste[];
  readonly onRemove: (id: number) => void;
}): ReactElement {
  const { items, onRemove } = props;
  const images = items.filter((item) => item.kind === 'image');
  return (
    <div className="composer-pastes">
      {items.map((item) =>
        item.kind === 'code' ? (
          <CodePreview key={item.id} item={item} onRemove={() => onRemove(item.id)} />
        ) : null,
      )}
      {images.length > 0 && (
        <div className="composer-images">
          {images.map((item) => (
            <span
              key={item.id}
              className="chip image-chip"
              // MEDIA-02, D-87: the picture's menu.
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const url = mediaUrl(item.link) ?? '';
                openMenu(
                  imageMenuItems(item.link, () => showInViewer([url], 0)),
                  { x: event.clientX, y: event.clientY },
                );
              }}
            >
              <img className="thumb" src={mediaUrl(item.link) ?? ''} alt="" />
              <span>{item.link.split('/').pop()}</span>
              <button
                type="button"
                className="chip-x"
                aria-label="Remove image"
                onClick={() => onRemove(item.id)}
              >
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CodePreview(props: {
  readonly item: Extract<ComposerPaste, { kind: 'code' }>;
  readonly onRemove: () => void;
}): ReactElement {
  const { item, onRemove } = props;
  const [open, setOpen] = useState(false);
  const code = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => item.text.split(/\r\n|\r|\n/), [item.text]);
  useLayoutEffect(() => {
    const kind = item.lang === 'json' ? 'json' : blockFor(item.text).kind;
    code.current?.replaceChildren(
      ...highlightLines(kind, open ? lines : lines.slice(0, PREVIEW_LINES)),
    );
  }, [item, lines, open]);
  return (
    <section className="composer-code">
      <header className="composer-code-head">
        <span className="code-kind">
          {codeLanguage(item.text, item.lang)} · {lines.length}{' '}
          {lines.length === 1 ? 'line' : 'lines'}
        </span>
        {lines.length > PREVIEW_LINES && (
          <button
            type="button"
            className={open ? 'code-toggle open' : 'code-toggle'}
            aria-expanded={open}
            aria-label={open ? 'Show less' : 'Show all'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setOpen(!open)}
          >
            <ChevronIcon size={12} />
          </button>
        )}
        <button type="button" className="chip-x" aria-label="Remove code" onClick={onRemove}>
          <CloseIcon size={10} />
        </button>
      </header>
      <pre ref={code} className={open ? 'composer-code-lines open' : 'composer-code-lines'} />
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
  /** LIST-05: a group's name, in the group header's style. */
  readonly group?: boolean;
  /** D-80: the field's place in the sidebar's motion. */
  readonly flip?: string;
  readonly problem: string | null;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { initial, placeholder, icon, group = false, flip, problem, onSubmit, onCancel } = props;
  const [name, setName] = useState(initial);
  return (
    <div className={group ? 'name-field group' : 'name-field'} {...(flip && { 'data-flip': flip })}>
      <div className="nav on">
        <span className="tile">{icon}</span>
        <input
          className="name-input"
          autoFocus
          value={name}
          placeholder={placeholder}
          spellCheck={false}
          maxLength={group ? 60 : undefined}
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
  /** A row picked with the mouse; Ctrl/Shift+click mark rows for bulk actions (TASK-07). */
  readonly onSelect: (
    key: string,
    how?: { readonly ctrl: boolean; readonly shift: boolean },
  ) => void;
  /** TASK-07, D-59: the tasks marked for a bulk action. */
  readonly marked: ReadonlySet<string>;
  /** D-77: whether a marked row joins the marked row above and below into one highlight. */
  readonly markJoins: ReadonlyMap<string, { readonly up: boolean; readonly down: boolean }>;
  readonly onToggle: (key: string) => void;
  /** Edit state, with the caret at `caret` in the raw title (D-71) or at the end. */
  readonly onEdit: (key: string, caret?: number) => void;
  readonly onLeaveTask: (key: string, text: string, how: Leave) => void;
  readonly onTab: (how: 'indent' | 'outdent') => void;
  /** UI-08: the row's right-click menu. */
  readonly onMenu: (task: TaskRow, at: Point) => void;

  /** REM-12: the bell turns the reminder off or on. */
  readonly onMute: (key: string, muted: boolean) => void;
  /** TODAY-01, D-86: the row's pin unpins. */
  readonly onPin: (task: TaskRow, pinned: boolean) => void;
  /** REM-01, D-68: the time opens the date/time picker for the task. */
  readonly onReminder: (task: TaskRow, anchor: DOMRect) => void;
  /** TASK-05, D-53: bodies shown inline, and the body indicator (inline or the task's page). */
  readonly expanded: ReadonlySet<string>;
  readonly onBody: (task: TaskRow) => void;
  /** D-79: the image indicator opens the lightbox on the task's images. */
  readonly onImages: (task: TaskRow) => void;
}

/**
 * A task's title edited on its page (D-76): it wraps in the title's own type. Enter, Esc and
 * leaving the field save; the title stays one line in the file, so line breaks become spaces.
 */
function TitleField(props: {
  readonly initial: string;
  readonly onLeave: (text: string, empty: boolean) => void;
}): ReactElement {
  const { initial, onLeave } = props;
  const text = useInertText(initial, true);
  const left = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const length = field.current?.value.length ?? 0;
    field.current?.setSelectionRange(length, length);
  }, []);
  const leave = (): void => {
    if (left.current) return;
    left.current = true;
    onLeave(text.escaped(), text.value.trim() === '');
  };
  return (
    <textarea
      ref={field}
      className="page-title-input"
      aria-label="Title"
      autoFocus
      rows={1}
      value={text.value}
      spellCheck={false}
      onChange={(event) => text.change(event.target.value.replace(/\r?\n/g, ' '))}
      onPaste={text.paste}
      onBlur={leave}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        leave();
      }}
    />
  );
}

/**
 * A task as a page (TASK-05, D-53, D-76, 09 §8): it replaces the list, with a back arrow, the title
 * (a click edits it), the body (rendered, with plain editing until the note editor, D-49, M5), and
 * the subtasks with "Add subtask".
 */
function TaskPage(props: {
  readonly task: TaskRow;
  readonly readOnly: boolean;
  readonly onBack: () => void;
  readonly onTitle: (text: string) => void;
  readonly onBody: (body: string) => void;
  readonly onAddSubtask: () => void;
  readonly onImage: ShowImage;
  /** D-80: a code block or an image deleted from the body. */
  readonly onRemovePart: (body: string, kind: 'code' | 'image') => void;
  /** The subtasks' card. */
  readonly children?: ReactElement | false;
}): ReactElement {
  const { task, readOnly, onBack, onTitle, onBody, onAddSubtask, onImage, onRemovePart, children } =
    props;
  const [editingTitle, setEditingTitle] = useState(false);
  const editable = !readOnly && !task.done;
  return (
    <>
      {/* D-86: the title and the notes on the note's card (NOTE-01, D-85). */}
      <div className="card note-card page-card">
        <header className="page-head">
          <button type="button" className="page-back" title="Back (Alt+←)" onClick={onBack}>
            <BackIcon />
          </button>
          {editingTitle ? (
            <TitleField
              initial={task.title}
              onLeave={(text, empty) => {
                setEditingTitle(false);
                if (!empty || hasBody(task)) onTitle(text);
              }}
            />
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
        {editable ? (
          // D-87: the notes look and work exactly like a note's body: always the editor.
          <LiveNotes
            id={task.key}
            body={task.body}
            className="body-editor page-editor"
            onSave={onBody}
            onImage={onImage}
          />
        ) : (
          hasBody(task) && (
            <BodyBlock
              body={task.body}
              inline={false}
              editing={false}
              editable={false}
              onImage={onImage}
              onRemovePart={onRemovePart}
              onEdit={() => undefined}
              onDone={() => undefined}
            />
          )
        )}
      </div>
      {children}
      {editable && (
        <button type="button" className="page-add-body" onClick={onAddSubtask}>
          Add subtask
        </button>
      )}
    </>
  );
}

/** The ghosts of a section that follow row `after` (null: the section's first rows), D-75. */
function ghostRows(
  ghosts: readonly Ghost[],
  section: Ghost['section'],
  after: string | null,
  handlers: RowHandlers,
): ReactElement[] {
  return ghosts
    .filter((ghost) => ghost.section === section && ghost.after === after)
    .flatMap((ghost) => [
      ghost.expanded ? (
        // D-80: an expanded task leaves as its card: the body closes, then the row plays out.
        <div
          key={`ghost-${ghost.id}`}
          className={ghost.subtask ? 'row-group subtask leaving-group' : 'row-group leaving-group'}
          aria-hidden="true"
        >
          <Row task={ghost.task} subtask={ghost.subtask} ghost={ghost.direction} {...handlers} />
          <div className={ghost.subtask ? 'row-body subtask closing' : 'row-body closing'}>
            <BodyBlock
              body={ghost.task.body}
              inline
              editing={false}
              editable={false}
              onEdit={() => undefined}
              onDone={() => undefined}
            />
          </div>
        </div>
      ) : (
        <Row
          key={`ghost-${ghost.id}`}
          task={ghost.task}
          subtask={ghost.subtask}
          ghost={ghost.direction}
          {...handlers}
        />
      ),
      ...(ghost.subtask ? [] : ghost.task.subtasks).map((sub) => (
        <Row
          key={`ghost-${ghost.id}-${sub.key}`}
          task={sub}
          subtask
          ghost={ghost.direction}
          {...handlers}
        />
      )),
    ]);
}

function Row(
  props: RowHandlers & {
    readonly task: TaskRow;
    readonly subtask?: boolean;
    /** Just appeared in the list being looked at, or reopened: it eases in (UI-04, D-76). */
    readonly fresh?: 'new' | 'return' | undefined;
    /** D-75: a ghost playing the completion animation where the task was. */
    readonly ghost?: Ghost['direction'];
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
    fresh,
    ghost,
  } = props;
  const isEditing = !ghost && editing?.kind === 'task' && editing.key === task.key;
  const classes = ['row'];
  if (!ghost && task.key === selected && editing?.kind !== 'new') classes.push('sel');
  if (subtask) classes.push('subtask');
  if (task.done) classes.push('done');
  if (isEditing) classes.push('editing');
  if (fresh) classes.push('enter', fresh);
  /** D-76: a second single click on an already-selected row edits it, like renaming in Explorer. */
  const wasSelected = useRef(false);
  if (ghost) classes.push('leaving', ghost);
  else if (props.marked.size > 1 && props.marked.has(task.key)) {
    classes.push('marked');
    const joins = props.markJoins.get(task.key);
    if (joins?.up) classes.push('mark-up');
    if (joins?.down) classes.push('mark-down');
  }
  const checked = ghost === 'complete' || (task.done && ghost !== 'reopen');
  // D-80: the body icon for any body (images only too), the image icon as well when it has images.
  const hasImages = useMemo(() => bodyImages(task.body).length > 0, [task.body]);
  const hasText = hasBody(task);
  return (
    <div
      data-key={ghost ? undefined : task.key}
      aria-hidden={ghost ? true : undefined}
      className={classes.join(' ')}
      onMouseDown={(event) => {
        // D-86: a right-click doesn't select by itself: its menu keeps a multi-selection it lands
        // in, or selects just this row (Windows Explorer).
        if (event.button !== 0) return;
        // D-89: Ctrl+click on a title's link opens it (on click) and marks nothing.
        if (event.ctrlKey && titleLink(event.target)) {
          event.preventDefault();
          return;
        }
        // Shift+click marks a range of rows (TASK-07), never a text selection across them; an
        // edit in progress ends (leaving the field saves it).
        if (event.shiftKey) {
          event.preventDefault();
          if (isTextField(document.activeElement)) document.activeElement.blur();
        }
        wasSelected.current =
          task.key === selected && !isEditing && !event.ctrlKey && !event.shiftKey;
        onSelect(task.key, { ctrl: event.ctrlKey, shift: event.shiftKey });
      }}
      onClick={(event) => {
        // D-89: a single click only selects, the title's text and links too. A link opens with
        // Ctrl+click, or with a click on an already-selected row.
        const link = titleLink(event.target);
        if (link) {
          event.preventDefault();
          if (event.ctrlKey || (wasSelected.current && event.detail === 1))
            window.flintMain.openLink(link.href);
          return;
        }
        if (event.detail !== 1 || !wasSelected.current || task.done || ghost) return;
        if ((event.target as Element).closest('button, a, input, textarea')) return;
        // D-76, D-89: a second single click on a selected row edits, the caret where it landed.
        onEdit(task.key, titleCaret(task, event));
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // D-86: the menu selects this row unless it is inside a multi-selection (taskMenu).
        props.onMenu(task, { x: event.clientX, y: event.clientY });
      }}
      // D-71, D-89: double-click anywhere edits (the caret where it landed on the title); inside
      // the field it is the field's own (word selection); never on a link.
      onDoubleClick={(event) => {
        if (task.done || isEditing || titleLink(event.target)) return;
        onEdit(task.key, titleCaret(task, event));
      }}
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
        <Title task={task} />
      )}
      <span className="ind">
        {task.pinned && !task.home && (
          // D-86: the pin unpins.
          <button
            type="button"
            className="pin-ind"
            title="Unpin (P)"
            onClick={(event) => {
              event.stopPropagation();
              props.onPin(task, false);
            }}
          >
            <PinIcon />
          </button>
        )}
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
        {!task.code && hasImages && (
          <button
            type="button"
            className="body-toggle image-toggle"
            title="Show the images"
            onClick={(event) => {
              event.stopPropagation();
              props.onImages(task);
            }}
          >
            <ImageIcon />
          </button>
        )}
        {!task.code && hasText && (
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
        {/* TODAY-01 (M6): in Today, the task's home list, subtly, at the end (03 §4). */}
        {task.home && <span className="chip home-list">{task.home.listName}</span>}
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
  /** D-76: the target is being edited: the highlight is the dark editing field. */
  readonly editing?: boolean;
}): ReactElement | null {
  const { card, target, version, className = 'sel-glide', editing = false } = props;
  const [box, setBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    /** D-78: the same target, moved by the layout (a body folding above it): follow at once. */
    follow: boolean;
  } | null>(null);
  const measured = useRef<{ target: string | null; at: number }>({ target: null, at: 0 });
  const node = useRef<HTMLDivElement>(null);
  // D-76: editing that starts on another row appears there (fading in) instead of gliding over;
  // from one editing row to the next it glides.
  const jump = useRef(false);
  const last = useRef({ target, editing });
  if (last.current.target !== target || last.current.editing !== editing) {
    if (editing && !last.current.editing && target !== last.current.target) jump.current = true;
    last.current = { target, editing };
  }
  useLayoutEffect(() => {
    const element = node.current;
    if (!element || !jump.current) return;
    jump.current = false;
    element.style.transition = 'none';
    void element.offsetWidth;
    element.style.transition = '';
    // D-77: a fuller, still subtle, arrival: it fades in and settles from a slightly smaller size.
    if (!reducedMotion()) {
      const at = element.style.transform;
      element.animate(
        [
          { opacity: 0, transform: `${at} scale(0.97)` },
          { opacity: 1, transform: at },
        ],
        { duration: durationMs('--fl-dur-state', 260), easing: 'cubic-bezier(.2, .9, .3, 1)' },
      );
    }
  }, [box]);
  useLayoutEffect(() => {
    const measure = (): void => {
      const found = target
        ? card.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(target)}"]`)
        : null;
      // D-77: an expanded task is one card with its body; the highlight covers all of it.
      const grouped = found?.parentElement?.classList.contains('row-group')
        ? found.parentElement
        : found;
      // LIST-05: a list in a folded group has no highlight.
      const row = grouped?.closest('.group-lists:not(.open)') ? null : grouped;
      // D-79: following the layout at once must never cut short a glide to a new target (that
      // made list switching lose its motion): within a glide's time, keep gliding.
      const now = performance.now();
      const settled = now - measured.current.at > durationMs('--fl-dur-base', 200);
      const follow = measured.current.target === target && settled;
      if (measured.current.target !== target) measured.current = { target, at: now };
      // D-80: a list inside a group card is placed within the card: offsets add up to ours.
      let x = 0;
      let y = 0;
      for (
        let node: HTMLElement | null = row ?? null;
        node && node !== card.current;
        node = node.offsetParent as HTMLElement | null
      ) {
        x += node.offsetLeft;
        y += node.offsetTop;
      }
      setBox(
        row
          ? {
              x,
              y,
              w: row.offsetWidth,
              h: row.offsetHeight,
              follow,
            }
          : null,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    // Rows collapsing or easing in (D-67) move the selected row: follow it.
    const observer = new ResizeObserver(measure);
    if (card.current) observer.observe(card.current);
    // LIST-05: and sidebar groups folding above it.
    for (const group of card.current?.querySelectorAll('.group-inner') ?? [])
      observer.observe(group);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [card, target, version]);
  if (!box) return null;
  return (
    <div
      ref={node}
      className={editing ? `${className} editing` : className}
      aria-hidden="true"
      style={{
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: box.w,
        height: box.h,
        // Following the layout: no lag in place or size; the look (editing ↔ selected) still eases.
        ...(box.follow && {
          transition:
            'background-color var(--fl-dur-state) ease, box-shadow var(--fl-dur-state) ease',
        }),
      }}
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
 * edited. markdown-it escapes everything that isn't markdown, so the HTML is safe. Clicks are the
 * row's (D-89): a single click selects, wherever it lands; links open with Ctrl+click or a click on
 * an already-selected row.
 */
function Title(props: { readonly task: TaskRow }): ReactElement {
  const { task } = props;
  if (task.title === '') return <span className="title">{task.label}</span>;
  return <span className="title md" dangerouslySetInnerHTML={{ __html: titleHtml(task.title) }} />;
}

/** D-89: the link in a row's rendered title under a click, if any. */
function titleLink(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('.title.md a') : null;
}

/**
 * D-71, D-89: where the caret goes when a click starts editing: the matching place in the raw
 * title when the click is on its text, else the end (undefined).
 */
function titleCaret(task: TaskRow, event: React.MouseEvent): number | undefined {
  const span = (event.target as Element).closest<HTMLElement>('.title.md');
  if (!span) return undefined;
  const at = textOffsetAt(span, event.clientX, event.clientY);
  return at === null ? undefined : rawOffset(task.title, span.textContent ?? '', at);
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
    <div className={subtask ? 'row sel editing subtask' : 'row sel editing'} data-key={NEW_ROW}>
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
          // D-78: Shift+Enter goes on into the task's notes (its body).
          leave(event.shiftKey ? 'notes' : 'enter');
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
