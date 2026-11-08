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
} from 'react';
import {
  blockFor,
  classifyPaste,
  escapeInert,
  fencedBlock,
  parseCapture,
  type ListInfo,
} from '@flint/core/shorthand';
import { parseLocalDateTime, type LocalDateTime } from '@flint/core/time';
import {
  openClipboardPicker,
  openListPicker,
  openPriorityPicker,
  openTimePicker,
} from '../pickers/pickers.js';
import { clipAge, clipPreview } from '../../shared/clipboard.js';
import { ClipboardSection, clipboardChanged, clipboardNote } from './ClipboardSection.js';
import { currentField, pasteInto, trackFields } from './clipboard-paste.js';
import flintIcon from '../../../../../assets/icon/flint-icon-512.svg';
import type {
  ChangeOutcome,
  ListActionOutcome,
  ListChange,
  ListSummary,
  ListItem,
  ListView,
  SearchHit,
  UpNextItem,
  SidebarAction,
  SidebarItem,
  SidebarOutcome,
  SidebarSort,
  SidebarView,
  TaskRow,
  TodayReminder,
} from '../../shared/ipc.js';
import {
  BackIcon,
  CloseIcon,
  ChevronIcon,
  InboxIcon,
  ListIcon,
  NoteIcon,
  PanelIcon,
  PlusIcon,
  SettingsIcon,
  SortIcon,
  SunIcon,
  TrashIcon,
  MiniIcon,
} from './icons.js';
import { OverdueCard, ReminderCards, RolloverCard, TodayColumn, TodayGreeting } from './Today.js';
import { titleHtml } from '../../shared/inline-markdown.js';
import { isTextField, openMenu, textFieldMenu, type MenuEntry } from '../menu/menu.js';

import { NoteEditor } from './NoteEditor.js';
import { NoteTitle } from './NoteTitle.js';
import { Triage, type TriageMemory } from './Triage.js';
import {
  ContextPanel,
  type FactKind,
  type PanelHandlers,
  type PanelState,
} from './ContextPanel.js';
import { outline as outlineOf } from '../panel/outline.js';
import { EditorView as CodeEditorView } from '@codemirror/view';
import { openFindIn } from '../editor/find.js';
import { tablePaletteCommands } from '../editor/table-view.js';
import { flashMatches, matchRanges, type LineMatch } from '../editor/match-flash.js';
import { BodyBlock, LiveNotes, type ShowImage } from './Body.js';
import { ListFind } from './ListFind.js';
import {
  SETTINGS_ID,
  SNAPSHOTS_ID,
  TODAY_ID,
  TRASH_ID,
  type RestoredItem,
  type SnapshotDiff,
  type ClipboardItemView,
  type TrashPreview,
  type TrashView,
} from '../../shared/ipc.js';
import { TrashPreviewView, TrashScreen } from './Trash.js';
import { SnapshotDiffView, SnapshotsScreen } from './Snapshots.js';
import { SETTINGS_SECTIONS, SettingsIndex, SettingsScreen } from './Settings.js';
import { onboardingOnce, Walkthrough, WhatsNew, type TourEnd } from './Onboarding.js';
import { TipLayer, tipHappened, useFrontAdds } from './Tips.js';
import { Palette, PaletteButton, type PaletteItem, type PaletteSources } from './Palette.js';
import { CheatSheet } from './CheatSheet.js';
import { Lightbox } from './Lightbox.js';
import { foldAway, unfold, watchDrag, type DragUnit } from '../ui/drag.js';
import { bodyImages } from '../../shared/body-markdown.js';
import { setBuiltInLinksOff, setLinkPatterns } from '../../shared/link-patterns.js';
import { relink, type ConfirmNotice, type LinkedNotice, type UndoNotice } from '../media/media.js';
import { useInertText } from './inert-text.js';
import { sidebarMotion } from './sidebar-motion.js';
import { useScrollsWhenTaller } from '../ui/scrolls.js';
import { applySpeed, durationMs, nudge, reducedMotion } from '../ui/motion.js';
import {
  EditField,
  hasBody,
  MorphText,
  Row,
  type Editing,
  type Leave,
  type Point,
  type RowHandlers,
} from '../ui/Row.js';
import { departed, ghostRows, withSubtasks, type Ghost } from '../ui/ghosts.js';
import { rowDragUnits } from '../ui/row-drag.js';
import { Composer, listInfos } from '../ui/Composer.js';
import { QuickTitle } from '../ui/QuickTitle.js';
import { Glide } from '../ui/Glide.js';
import { showQuestion, showUndoNotice, ToastView, useToast } from '../ui/Toast.js';
import { UPDATE_VIEW_OFF, type UpdateView } from '../../shared/updates.js';

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
/** APP-06, D-136: "Update ready" stays a little longer than an undo toast; gone, it counts as Later. */
const UPDATE_TOAST_MS = 12000;

/** Navigate state: 1 / 2 / 3 / 0 set low / medium / high / none (TASK-03). */
const PRIORITY_KEYS: Readonly<Record<string, TaskRow['priority']>> = {
  '1': 'low',
  '2': 'medium',
  '3': 'high',
  '0': null,
};

/** A list's name being typed in the sidebar (LIST-01). */
type Naming =
  /** D-98: `group`: made inside that group (its right-click menu), the field among its lists. */
  | { readonly kind: 'new'; readonly mode: 'tasks' | 'note'; readonly group?: string }
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

let seq = 0;

type NewEditing = Extract<Editing, { kind: 'new' }>;

const NOTHING: ReadonlySet<string> = new Set();

/** `1 task`, `3 tasks`. */
const tasksCount = (count: number): string => (count === 1 ? '1 task' : `${count} tasks`);

/** TASK-06, Q-13: auto-archive's days when turned on from the offer, and when it is offered. */
const ARCHIVE_DAYS = 14;
const ARCHIVE_OFFER_AT = 50;
const ARCHIVE_DISMISSED = 'flint.archive.dismissed';
/** D-92: Focus shows the first five high-priority tasks that aren't pinned, then "Show all N". */
const HIGH_SHOWN = 5;

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
/** REM-06, D-94: Flint's own reminder sound (`scripts/make-chime.mjs`), bundled, never fetched. */
const CHIME_URL = new URL('./sounds/chime.wav', import.meta.url).href;

/** D-67, D-100: every duration token scaled by the animation speed (this window). */
/** D-99: a slow second click (renaming in the sidebar): longer than a double-click's gap. */
const RENAME_DELAY_MS = 450;

/** D-98: how far down a page is scrolled before "back to top" shows. */
const TO_TOP_AFTER = 320;

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

/** D-86: the place a jump landed on lights up a moment. */
/** D-91: a place's key in the scroll memory. */
function placeKey(list: string, page: string | null): string {
  return page === null ? list : `${list}/${page}`;
}

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
  /**
   * D-92, D-93: on wide screens Today's column shows Timeline, Done and Captured, and the selected
   * task's details instead; back, Esc or the notes icon return to Today's sections for that task
   * (`todayDismissed`), until another one is selected.
   */
  const [todayDismissed, setTodayDismissed] = useState<string | null>(null);
  const todayDetailsRef = useRef<string | null>(null);
  const todayWideRef = useRef(false);
  /** D-92: "Show all N" of Focus's high-priority group, for the session. */
  const [highAll, setHighAll] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const [completedOpen, setCompletedOpen] = useState(true);
  const { toast, showToast, hideToast } = useToast(TOAST_MS);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  // APP-06, D-136: what the updater is doing; "Update ready" once a session, with the window on
  // screen (it waits for the window to be opened when Flint sits in the tray).
  const [updates, setUpdates] = useState<UpdateView>(UPDATE_VIEW_OFF);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    void window.flintMain.updates().then(setUpdates);
    window.flintMain.onUpdatesChanged(setUpdates);
    void onboardingOnce().then((state) => setOnScreen(state?.visible ?? true));
    window.flintMain.onShown(() => setOnScreen(true));
    window.flintMain.onHidden(() => setOnScreen(false));
  }, []);
  useEffect(() => {
    if (updates.phase !== 'ready' || updates.toastSeen || !onScreen) return;
    void window.flintMain.updatesToastSeen();
    showToast(
      `Update ready · Flint ${updates.version ?? ''}`.trim(),
      false,
      { label: 'Restart now', run: () => void window.flintMain.updatesRestart() },
      { dismiss: { label: 'Later' }, ms: UPDATE_TOAST_MS },
    );
  }, [updates, onScreen, showToast]);
  /** APP-14, D-113: the capture tip's pattern (a task added right after coming to the front). */
  const frontAdd = useFrontAdds();
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
    void Promise.all([window.flintMain.linkPatterns(), window.flintMain.builtInLinksOff()]).then(
      ([patterns, off]) => {
        setLinkPatterns(patterns);
        setBuiltInLinksOff(off);
        setPatternsLoaded((count) => count + 1);
      },
    );
  }, []);
  /** UI-12, D-81: the interface size, shown a moment when it changes. */
  const [zoomShown, setZoomShown] = useState<{ readonly text: string; readonly id: number } | null>(
    null,
  );
  useEffect(() => {
    // Zoom keys the main process didn't take first (it normally does, before the page).
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      // D-102: a hotkey being recorded in Settings takes every key.
      if (document.body.dataset['recordingHotkey']) return;
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
  /** D-102: the interface size now (Settings shows it). */
  const [zoomFactor, setZoomFactor] = useState(1);
  useEffect(() => {
    let timer: number | undefined;
    void window.flintMain.zoomLevel().then(setZoomFactor);
    window.flintMain.onZoomed((factor) => {
      setZoomFactor(factor);
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
  // D-107: a caret asked for a note that was left before it arrived is forgotten.
  useEffect(() => {
    if (focusNote !== null && focusNote !== listId) setFocusNote(null);
  }, [listId, focusNote]);
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const sidebarRef = useRef(sidebarView);
  sidebarRef.current = sidebarView;
  /**
   * D-107: reads overlap (a file written outside Flint, a change, the minute's refresh); one that
   * comes back after a newer one is dropped. Applied last, its older lists made a list that had just
   * appeared look deleted, and the window went back to the place before (D-86).
   */
  const refreshSeq = useRef(0);
  const refreshThens = useRef<(() => void)[]>([]);
  /** Reads the lists again; `then` runs in the same render (a name field giving way to its row). */
  const refresh = useCallback(
    async (then?: () => void): Promise<void> => {
      const seq = ++refreshSeq.current;
      if (then) refreshThens.current.push(then);
      const [nextLists, nextView, nextSidebar, nextTrash] = await Promise.all([
        window.flintMain.lists(),
        window.flintMain.view(listId),
        window.flintMain.sidebar(),
        window.flintMain.trash(),
      ]);
      if (seq !== refreshSeq.current) return;
      const thens = refreshThens.current;
      refreshThens.current = [];
      setTrash(nextTrash);
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
      for (const each of thens) each();
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
    // A reminder's Open (D-91): its list, the task scrolled into view, selected and flashed once
    // the rows are there; the panel shows it on wide screens, the body stays closed.
    // D-109: from mini mode a note (no task) opens as a place.
    window.flintMain.onReveal(({ listId: id, key }) => {
      if (key) revealRef.current(id, key);
      else goRef.current({ list: id, page: null });
    });
    // APP-11, D-100: the tray's Settings; D-67: the animation speed, now and when it changes.
    window.flintMain.onShowSettings((section) => {
      goRef.current({ list: SETTINGS_ID, page: null });
      // D-102: a section asked for (the tray's taken-hotkey warning): brought into view.
      if (section)
        window.setTimeout(
          () =>
            document
              .getElementById(`settings-${section}`)
              ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
          200,
        );
    });
    void window.flintMain.settings().then((settings) => {
      if (!settings) return;
      applySpeed(settings.animationSpeed);
    });
    window.flintMain.onAppearance((appearance) => applySpeed(appearance.animationSpeed));
    // DATA-04, D-97: the tray's Restore from a snapshot…: the Snapshots view.
    window.flintMain.onShowSnapshots(() => goRef.current({ list: SNAPSHOTS_ID, page: null }));
    // REM-07, D-94: "N reminders you missed": Today, its Overdue card open and in view.
    window.flintMain.onShowOverdue(() => {
      goRef.current({ list: TODAY_ID, page: null });
      setOverdueCalled(true);
    });
    // REM-06, D-94: Flint's own sound, when it is turned on (main decides).
    window.flintMain.onChime(() => {
      const sound = new Audio(CHIME_URL);
      sound.volume = 0.7;
      void sound.play().catch(() => undefined);
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
  const listIdRef = useRef(listId);
  listIdRef.current = listId;
  /**
   * D-91: each list's, note's and page's scroll position for the session, restored at once when it
   * is shown again (back, or its sidebar row).
   */
  const scrollMemory = useRef(new Map<string, number>());
  /** D-107: a note's line to open at (from the palette), and what was found in it (D-143). */
  const [lineTarget, setLineTarget] = useState<{
    readonly list: string;
    readonly line: number;
    readonly at: number;
    readonly match: LineMatch;
  } | null>(null);
  const show = useCallback((place: Place, select: string | null = null, back = false): void => {
    const root = scroller.current;
    if (root)
      scrollMemory.current.set(placeKey(listIdRef.current, pageRef.current), root.scrollTop);
    const pages = place.page !== null || pageRef.current !== null;
    setHeading(!pages ? null : back || !place.page ? 'back' : 'forward');
    // D-103: Trash, Settings and Snapshots have no list of their own: the list open before them
    // goes at once, not when the next read arrives (its header showed under theirs for a moment).
    if (place.list === TRASH_ID || place.list === SETTINGS_ID || place.list === SNAPSHOTS_ID)
      setView(null);
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
  /** D-116: the walkthrough's steps 3 to 6 are on Inbox. */
  const tourInbox = useCallback((): void => {
    const id = listsRef.current.find((list) => list.inbox)?.id;
    if (id && (listIdRef.current !== id || pageRef.current !== null)) openList(id);
  }, [openList]);
  /** TASK-14, D-113: Inbox opened in triage. */
  const startTriage = useCallback(
    (inboxId: string): void => {
      if (listIdRef.current !== inboxId) openList(inboxId);
      setTriage(inboxId);
    },
    [openList],
  );
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
  /** D-91: a selection to bring into view (and flash) once its row is on screen. */
  const arriving = useRef<{
    readonly key: string;
    readonly mode: 'smooth' | 'instant';
    readonly flash: boolean;
    /** D-96: the list it arrives in: the same task's row in Today (still on screen) isn't it. */
    readonly list?: string;
    /** D-98: restored from the Trash to be edited: its title's field opens once it is there. */
    readonly edit?: boolean;
  } | null>(null);
  /** D-93: a new arrival, also of the task that is already selected. */
  const [arrival, setArrival] = useState(0);
  /** DATA-02, D-97: the Trash view's contents (its count is in the sidebar). */
  const [trash, setTrash] = useState<TrashView | null>(null);
  /** D-98: the trash item opened read-only (a page, or the side panel on wide screens). */
  const [trashOpen, setTrashOpen] = useState<TrashPreview | null>(null);
  /** D-99: a snapshot's list or note opened against now (the side panel, or a page). */
  const [snapshotOpen, setSnapshotOpen] = useState<{
    readonly id: string;
    readonly path: string;
    readonly when: string;
    readonly diff: SnapshotDiff;
  } | null>(null);
  /** D-100: Ctrl+F in Settings: its filter takes the caret. */
  const [settingsFind, setSettingsFind] = useState(0);
  /** D-98: scrolled down far enough for the "back to top" button. */
  const [toTop, setToTop] = useState(false);
  /** D-94: "N reminders you missed" was opened: the Overdue card opens and comes into view. */
  const [overdueCalled, setOverdueCalled] = useState(false);
  /**
   * D-91: a reminder's Open, and Today's timeline: the task in its list, centred and flashed. D-93:
   * at once (never a long smooth scroll, which flashed the row before it was in view).
   */
  const reveal = useCallback(
    (list: string, key: string, edit = false): void => {
      arriving.current = { key, mode: 'instant', flash: true, list, edit };
      setArrival((count) => count + 1);
      go({ list, page: null }, key);
    },
    [go],
  );
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  /**
   * D-92: a task opened from Today (a reminder card, the timeline, Done, Captured): selected and
   * flashed where it is in Today, or else in its own list (as a reminder's Open).
   */
  const openFromToday = useCallback(
    (key: string, list: string): void => {
      const row = scroller.current?.querySelector(
        `.card.tasks .row[data-key="${CSS.escape(key)}"]`,
      );
      if (!row) {
        reveal(list, key);
        return;
      }
      setMarked(NOTHING);
      if (selectedRef.current === key) {
        flash(row);
        return;
      }
      arriving.current = { key, mode: 'instant', flash: true };
      setSelected(key);
    },
    [reveal],
  );
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
  // APP-14, D-113: patterns the window sees itself: a note opened (the first), Inbox with 20 or
  // more open tasks, the window wide enough for the side panel (the first time).
  const tipView = view && { id: view.id, mode: view.mode, open: view.open };
  const noteOpened = tipView?.mode === 'note' ? tipView.id : null;
  useEffect(() => {
    if (noteOpened) tipHappened('slash');
  }, [noteOpened]);
  const fullInbox =
    tipView !== null && tipView.id === lists.find((list) => list.inbox)?.id && tipView.open >= 20;
  useEffect(() => {
    if (fullInbox) tipHappened('triage');
  }, [fullInbox]);
  useEffect(() => {
    if (wide) tipHappened('panel');
  }, [wide]);
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
  /** D-98: the Trash view on a wide screen: an opened item shows in the panel's place. */
  const trashWide = wide && !panelHidden && listId === TRASH_ID;
  const trashPanel = trashWide && trashOpen !== null;
  /** D-99: the Snapshots view on a wide screen: a comparison opens in the panel's place. */
  const snapshotWide = wide && !panelHidden && listId === SNAPSHOTS_ID;
  const snapshotPanel = snapshotWide && snapshotOpen !== null;
  /** D-100: Settings on a wide screen: its index in the panel's place. */
  const settingsPanel = wide && !panelHidden && listId === SETTINGS_ID;
  useEffect(() => {
    if (listId !== SNAPSHOTS_ID) setSnapshotOpen(null);
  }, [listId]);
  useLayoutEffect(() => {
    if (!snapshotOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSnapshotOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snapshotOpen]);
  // D-98: "back to top" shows once the page is scrolled down a little (and goes near the top).
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onScroll = (): void => setToTop(element.scrollTop > TO_TOP_AFTER);
    onScroll();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);
  // D-98: the opened item goes when Trash is left, or when it is no longer in the trash.
  useEffect(() => {
    if (!trashOpen) return;
    if (listId !== TRASH_ID || !trash?.deleted.some((item) => item.id === trashOpen.id))
      setTrashOpen(null);
  }, [listId, trash, trashOpen]);
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
      // D-92, D-93: in Today on a wide screen, the column shows the task's details, or Today's
      // sections again when they are showing.
      if (todayWideRef.current && !expanded.has(task.key)) {
        const showing = todayDetailsRef.current === task.key;
        setSelected(task.key);
        setTodayDismissed(showing ? task.key : null);
        return;
      }
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
    // D-89: with the context panel, in the panel's notes editor instead (D-92: Today's column).
    if (panelShownRef.current) {
      if (todayWideRef.current) setTodayDismissed(null);
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
    // NOTE-10: an editor's change with its own Undo (the note's history, not the app's).
    const onUndoNotice = (event: Event): void =>
      showUndoNotice(showToast, hideToast, (event as CustomEvent<UndoNotice>).detail);
    window.addEventListener('flint:notice-undo', onUndoNotice);
    // D-144: an editor's question (a table's edge drag taking away text): Delete / Cancel.
    const onConfirmNotice = (event: Event): void =>
      showQuestion(showToast, hideToast, (event as CustomEvent<ConfirmNotice>).detail);
    window.addEventListener('flint:notice-confirm', onConfirmNotice);
    return () => {
      window.removeEventListener('flint:notice', onNotice);
      window.removeEventListener('flint:notice-undo', onUndoNotice);
      window.removeEventListener('flint:notice-confirm', onConfirmNotice);
    };
  }, [showToast, hideToast]);

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

  /** NAV-01, NAV-02, D-106: the Ctrl+K palette and the `?` cheat sheet. */
  const [palette, setPalette] = useState(false);
  /**
   * APP-10, APP-15 (D-113, D-115 to D-120): the walkthrough (a fresh install, a replay, or going
   * on after step 1's folder change) and What's new (an update; or asked for), once the window is
   * on screen.
   */
  const [tourRun, setTourRun] = useState<{ readonly from: number; readonly run: number } | null>(
    null,
  );
  const [whatsNew, setWhatsNew] = useState<{ readonly since: string | null | undefined } | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState('');
  const [tourFolder, setTourFolder] = useState('');
  const startTour = useCallback((from: number): void => {
    setWhatsNew(null);
    void window.flintMain.settings().then((settings) => {
      if (settings) {
        setTourFolder(settings.flintFolder);
        setAppVersion(settings.version);
      }
      setTourRun({ from, run: Date.now() });
    });
  }, []);
  const startTourRef = useRef(startTour);
  startTourRef.current = startTour;
  // NAV-08, D-128, D-129: Windows' clipboard history: an item into the field that has the keyboard
  // (or had it before the palette or the picker took it), captured as a task, copied again (as
  // Win+V's pick), deleted (Undo adds it back as the newest), or all of it cleared.
  useEffect(() => trackFields(), []);
  const insertClipboard = useCallback(
    (item: ClipboardItemView, field: HTMLElement | null): void => {
      if (!field) {
        showToastRef.current('Click where it should go, then pick it again', false);
        return;
      }
      if (item.kind !== 'image') {
        pasteInto(field, item.text);
        return;
      }
      // D-129: a picture goes in as a pasted one: a note or the composer saves it to attachments/.
      void window.flintMain.clipboardImage(item.id).then((png) => {
        if (!png) {
          showToastRef.current('That picture is no longer in Win+V', false);
          return;
        }
        const file = new File([new Uint8Array(png)], 'clipboard.png', { type: 'image/png' });
        if (!pasteInto(field, file))
          showToastRef.current('A picture goes into a note or the composer', false);
      });
    },
    [],
  );
  const captureClipboard = useCallback((item: ClipboardItemView): void => {
    void window.flintMain.clipboardCapture(item.id);
  }, []);
  const copyClipboard = useCallback((item: ClipboardItemView): void => {
    void window.flintMain.clipboardCopy(item.id).then((done) => {
      showToastRef.current(
        done === 'ok'
          ? 'Copied'
          : done === 'gone'
            ? 'That item is no longer in Win+V'
            : 'Couldn’t copy it (the log says why)',
        false,
      );
      clipboardChanged();
    });
  }, []);
  const deleteClipboard = useCallback((item: ClipboardItemView): void => {
    void window.flintMain.clipboardDelete(item.id).then((token) => {
      clipboardChanged();
      if (!token) {
        showToastRef.current('That item is no longer in Win+V', false);
        return;
      }
      // D-129: Windows can't put it back in place: Undo adds it back as the newest.
      showToastRef.current(
        'Deleted, also from Win+V (pinned or not). Undo adds it back as the newest',
        false,
        {
          label: 'Undo',
          run: () =>
            void window.flintMain.clipboardRestore(token).then((done) => {
              clipboardChanged();
              if (!done) showToastRef.current('Too late to undo that', false);
            }),
        },
      );
    });
  }, []);
  const clearClipboard = useCallback(
    (): Promise<void> =>
      window.flintMain.clipboardClear().then((done) => {
        clipboardChanged();
        if (!done) showToastRef.current('Clipboard history couldn’t be cleared', false);
      }),
    [],
  );
  const clipboardMenu = useCallback(
    (item: ClipboardItemView, at: { x: number; y: number }): void => {
      // The menu keeps the keyboard where it is: Insert goes there.
      const field = currentField();
      openMenu(
        [
          { label: 'Insert', action: () => insertClipboard(item, field) },
          { label: 'Capture as task', action: () => captureClipboard(item) },
          { label: 'Copy', action: () => copyClipboard(item) },
          'divider',
          { label: 'Delete (also from Win+V)', action: () => deleteClipboard(item) },
        ],
        at,
      );
    },
    [insertClipboard, captureClipboard, copyClipboard, deleteClipboard],
  );
  /** D-128 Q3: Always show contents; turned on, it says once that a screen share shows them. */
  const showClipboardContents = useCallback((show: boolean): void => {
    void window.flintMain.setSetting({ key: 'clipboardShowContents', value: show }).then(() => {
      clipboardChanged();
      if (!show) return;
      void window.flintMain.tipDue('clipboardContentsShown', 1).then((due) => {
        if (due)
          showToastRef.current(
            'Clipboard contents will be visible when you share your screen',
            false,
          );
      });
    });
  }, []);
  /**
   * D-128 Q6: Paste from clipboard history… (Ctrl+Shift+H): the picker, with the items' text and
   * pictures (it was opened on purpose); the keyboard goes back to `field` before an item goes in.
   */
  const pasteFromHistory = useCallback(
    (field: HTMLElement | null): void => {
      void window.flintMain.clipboard().then((view) => {
        if (!view) return;
        const byId = new Map(view.items.map((item) => [item.id, item]));
        const note =
          view.state === 'disabled'
            ? {
                text: 'Clipboard history is off in Flint.',
                action: {
                  label: 'Turn on',
                  run: () =>
                    void window.flintMain
                      .setSetting({ key: 'clipboardHistory', value: true })
                      .then(() => clipboardChanged()),
                },
              }
            : (() => {
                const said = clipboardNote(view);
                if (!said) return null;
                return {
                  text: said.text,
                  action:
                    said.action === 'settings'
                      ? {
                          label: 'Open clipboard settings',
                          run: () => void window.flintMain.clipboardSettings(),
                        }
                      : said.action === 'retry'
                        ? {
                            label: 'Try again',
                            run: () =>
                              void window.flintMain.clipboard(true).then(() => clipboardChanged()),
                          }
                        : null,
                };
              })();
        const width = Math.min(460, window.innerWidth - 32);
        const on = (act: (item: ClipboardItemView) => void) => (id: string) => {
          const item = byId.get(id);
          if (item) act(item);
        };
        openClipboardPicker(
          {
            anchor: new DOMRect((window.innerWidth - width) / 2, 72, width, 0),
            returnFocus: field,
            width,
          },
          view.items.map((item) => ({
            id: item.id,
            label: item.kind === 'image' ? 'Picture' : clipPreview(item.text),
            hint: clipAge(item.at, Date.now()),
            ...(item.thumb !== undefined && { thumb: item.thumb }),
          })),
          note,
          {
            insert: on((item) => insertClipboard(item, field)),
            capture: on(captureClipboard),
            copy: on(copyClipboard),
          },
        );
      });
    },
    [insertClipboard, captureClipboard, copyClipboard],
  );
  const pasteFromHistoryRef = useRef(pasteFromHistory);
  pasteFromHistoryRef.current = pasteFromHistory;
  useEffect(() => {
    let begun = false;
    void onboardingOnce().then((state) => {
      if (!state) return;
      setAppVersion(state.version);
      const begin = (): void => {
        if (begun) return;
        begun = true;
        if (state.tourFrom !== null) startTourRef.current(state.tourFrom);
        else if (state.whatsNew) {
          setWhatsNew({ since: state.whatsNew.since });
          void window.flintMain.whatsNewSeen();
        }
        // D-119: a tour cut short by a quit or crash, said once.
        if (state.interrupted)
          showToastRef.current('The walkthrough was interrupted', false, {
            label: 'Replay',
            run: () => startTourRef.current(0),
          });
      };
      if (state.visible) begin();
      else window.flintMain.onShown(begin);
    });
  }, []);
  const endTour = useCallback((how: TourEnd): void => {
    setTourRun(null);
    if (how === 'remove')
      void window.flintMain.tour({ kind: 'remove' }).then((label) => {
        showToastRef.current(label ?? 'The tour made nothing to remove', label !== null);
      });
    else {
      void window.flintMain.tour({ kind: 'end' });
      // D-115: Skip all and Esc say where it comes back from.
      if (how === 'skipped') showToastRef.current('Replay it any time from Settings', false);
    }
  }, []);
  /** TASK-14, D-113: Inbox triage, open on this list (Inbox's ID); null when not triaging. */
  const [triage, setTriageState] = useState<string | null>(null);
  const triageRef = useRef<string | null>(null);
  triageRef.current = triage && triage === listId ? triage : null;
  /** D-114: where triage was, for the session (it opens there again). */
  const triageMemory = useRef<TriageMemory | null>(null);
  /**
   * D-114: in and out of triage as a page goes (it slides in, and back out to Inbox); starting it
   * clears the selection, so the side panel shows a task only once the card's notes are clicked.
   */
  const setTriage = useCallback((id: string | null): void => {
    setHeading(id ? 'forward' : 'back');
    if (id) setSelected(null);
    setTriageState(id);
  }, []);
  // D-114: another list or page leaves triage (its place is kept).
  useEffect(() => {
    if (triage !== null && triage !== listId) setTriageState(null);
  }, [listId, triage]);
  /**
   * D-115: the note editor stays the same one while it is the same note: renamed (a quick note's
   * title: the caret goes on into it) or given its ID by its first save; another note, a new one.
   * D-143: only for that step (the editor's own note, from the ID it had to the new one), once:
   * remembering every such ID let a note opened again later take over the other note's editor,
   * whose undo history could then bring the other note's text into it.
   */
  const noteEditor = useRef({ id: '', key: 0 });
  const noteIdHandover = useRef<{ from: string; to: string } | null>(null);
  const noteEditorKey = (id: string): string => {
    if (id !== noteEditor.current.id) {
      const handover = noteIdHandover.current;
      const same = handover?.to === id && handover.from === noteEditor.current.id;
      noteIdHandover.current = null;
      noteEditor.current = { id, key: same ? noteEditor.current.key : noteEditor.current.key + 1 };
    }
    return `note-${noteEditor.current.key}`;
  };
  const triageDetails = useCallback((key: string | null): void => setSelected(key), []);
  const [cheatSheet, setCheatSheet] = useState(false);
  /** D-106: Trash's tab asked for (an archived task found with Ctrl+K). */
  const [trashTab, setTrashTab] = useState<{
    readonly tab: 'deleted' | 'archived';
    readonly at: number;
  } | null>(null);
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
    // Gone at its fade's end (onAnimationEnd); the timer only for a fade that never ends.
    const timer = window.setTimeout(
      () => setSortLine((current) => (current?.leaving ? null : current)),
      2 * durationMs('--fl-dur-state', 260),
    );
    return () => window.clearTimeout(timer);
  }, [tempSort, listId]);
  /** A sort chosen from another list's menu, applied once that list is open. */
  const pendingSort = useRef<TempSort | null>(null);
  useEffect(() => {
    setTempSort(pendingSort.current);
    pendingSort.current = null;
  }, [listId]);
  const shownView = useMemo((): ListView | null => {
    if (!view) return view;
    const high = new Set(view.today?.high ?? []);
    const isHigh = (item: ListView['items'][number]): boolean =>
      item.kind === 'task' && high.has(item.task.key);
    let pinned = view.items.filter((item) => !isHigh(item));
    let rest = view.items.filter(isHigh);
    if (tempSort) {
      pinned = sortedItems(pinned, tempSort);
      rest = sortedItems(rest, tempSort);
    }
    if (!highAll) rest = rest.slice(0, HIGH_SHOWN);
    const items = [...pinned, ...rest];
    return items.length === view.items.length && items.every((item, at) => item === view.items[at])
      ? view
      : { ...view, items };
  }, [view, tempSort, highAll]);
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

  /**
   * D-147: a task `##list` sent to another list: its toast offers the way to it, as Restore's does
   * (D-98): that list opened, the task selected, scrolled into view and flashed.
   */
  const toastAddedElsewhere = useCallback(
    (outcome: ChangeOutcome): void => {
      const { key, listId: target, listName } = outcome;
      showToast(
        outcome.label,
        true,
        key ? { label: `Go to ${listName}`, run: () => reveal(target, key) } : undefined,
      );
    },
    [showToast, reveal],
  );

  /**
   * D-111: an empty new row that is left plays the remove animation where it was (in the list and
   * on a task's page), instead of vanishing. `shownNewRow` is where the row was drawn last.
   */
  const shownNewRow = useRef<{ seq: number; anchor: string; nested: boolean } | null>(null);
  const [newLeaving, setNewLeaving] = useState<{
    seq: number;
    anchor: string;
    nested: boolean;
  } | null>(null);
  const leaveNew = useCallback(
    (text: string, empty: boolean, how: Leave, id: string | null): void => {
      const current = editingRef.current;
      if (current?.kind !== 'new') return;
      if (empty) {
        const shown = shownNewRow.current;
        if (shown && shown.seq === current.seq && !reducedMotion()) {
          setNewLeaving(shown);
          window.setTimeout(
            () => setNewLeaving((now) => (now?.seq === shown.seq ? null : now)),
            durationMs('--fl-dur-complete', 360),
          );
        }
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
          if (outcome && outcome.listId !== listId) toastAddedElsewhere(outcome);
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
    [change, listId, lists, toastAddedElsewhere, openNotes],
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
      frontAdd();
      if (outcome.listId !== listId) toastAddedElsewhere(outcome);
      else setSelected(outcome.key);
    },
    [change, listId, toastAddedElsewhere, frontAdd],
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
      if (outcome) {
        showToast(outcome.label, true);
        tipHappened('trash');
      }
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
    tipHappened('trash');
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

  /**
   * D-93: a reminder dragged on Today's timeline: the same day at its new time, in the task's own
   * list; one undo step, as from the picker.
   */
  const moveReminder = useCallback(
    (reminder: TodayReminder, minutes: number): void => {
      const day = parseLocalDateTime(reminder.at)?.value;
      if (!day) return;
      const at = {
        year: day.year,
        month: day.month,
        day: day.day,
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
        second: 0,
      };
      void window.flintMain
        .change(reminder.listId, { kind: 'reminder', key: reminder.key, at })
        .then((outcome) => {
          if (outcome) showToast(outcome.label, true);
        });
    },
    [showToast],
  );

  /** NOTE-08, D-99: the untitled quick notes, newest first; the one open, if it is one. */
  const quickNotes = useMemo(
    () =>
      lists.filter((list) => list.quick).sort((a, b) => (b.quick?.at ?? 0) - (a.quick?.at ?? 0)),
    [lists],
  );
  const quickHere = lists.find((list) => list.id === listId)?.quick ?? null;
  /** NOTE-08, D-99: a new quick note, opened with its editor taking the caret. */
  const newQuickNote = useCallback((): void => {
    void window.flintMain.quickNote().then((id) => {
      if (!id) return;
      openList(id);
      setFocusNote(id);
    });
  }, [openList]);
  const newQuickNoteRef = useRef(newQuickNote);
  newQuickNoteRef.current = newQuickNote;
  // NOTE-08, D-99: a quick note left empty goes (main checks it is still empty a moment later).
  // D-107: the first three times, a toast says why it went.
  const lastPlace = useRef(listId);
  useEffect(() => {
    const before = lastPlace.current;
    lastPlace.current = listId;
    // D-131: back in a quick note before its removal: it stays (the next leave waits anew).
    if (before !== listId && lists.find((list) => list.id === listId)?.quick)
      window.flintMain.quickNoteOpened(listId);
    if (before !== listId && lists.find((list) => list.id === before)?.quick)
      void window.flintMain.discardQuickNote(before).then(async (removed) => {
        if (removed && (await window.flintMain.tipDue('emptyQuickNote', 3)))
          showToast('Empty quick notes are removed when you leave them', false);
      });
  }, [listId, lists, showToast]);
  /** NOTE-08, D-99: a quick note's right-click menu: a title, keep it, a group, delete. */
  const quickMenu = useCallback(
    (list: ListSummary, at: Point): void => {
      const groups = (sidebarView?.items ?? []).filter(
        (item): item is SidebarGroup => item.kind === 'group',
      );
      const keep = (group: string | null): void =>
        void window.flintMain.keepQuickNote(list.id).then(async (outcome) => {
          if (!outcome?.ok) return;
          if (group)
            await window.flintMain.sidebarAction({
              kind: 'move',
              id: list.id,
              to: { group, index: Number.MAX_SAFE_INTEGER },
            });
          showToast(outcome.label, true);
        });
      openMenu(
        [
          {
            label: 'Add a title…',
            action: () => {
              setNamingProblem(null);
              setNaming({ kind: 'rename', id: list.id, name: list.name });
            },
          },
          { label: 'Keep as a note', action: () => keep(null) },
          ...(groups.length > 0
            ? [
                {
                  label: 'Move to group',
                  submenu: groups.map((group) => ({
                    label: group.name,
                    action: () => keep(group.id),
                  })),
                },
              ]
            : []),
          'divider',
          {
            label: 'Delete',
            action: () =>
              void window.flintMain.listAction({ kind: 'delete', id: list.id }).then((outcome) => {
                tipHappened('trash');
                if (outcome?.ok) showToast(outcome.label, true);
              }),
          },
        ],
        at,
      );
    },
    [sidebarView, showToast],
  );

  /** D-99: the opened comparison, in the panel or as a page. */
  const snapshotDiffView = (page: boolean): ReactElement | null => {
    if (!snapshotOpen) return null;
    const { id, path, when, diff } = snapshotOpen;
    const done = (label: string | null): void => {
      if (!label) return;
      setSnapshotOpen(null);
      showToast(label, true);
    };
    return (
      <SnapshotDiffView
        key={`${id}/${path}`}
        diff={diff}
        when={when}
        page={page}
        onRestoreTasks={(keys) =>
          void window.flintMain.restoreSnapshotTasks(id, path, keys).then(done)
        }
        onRestoreAll={() => void window.flintMain.restoreSnapshot(id, path).then(done)}
        onClose={() => setSnapshotOpen(null)}
      />
    );
  };
  /** D-98: a restored item where it now is: a task selected and flashed in its list, a list opened. */
  const goToRestored = useCallback(
    (restored: RestoredItem, edit = false): void => {
      if (restored.key) reveal(restored.listId, restored.key, edit);
      else {
        openList(restored.listId);
        if (edit) setFocusNote(restored.listId);
      }
    },
    [reveal, openList],
  );
  /** D-98: "Restore to edit": restored, then opened where it is now, ready to edit. */
  const restoreToEdit = useCallback(
    (id: string): void => {
      void window.flintMain.restoreFromTrash(id).then((restored) => {
        if (!restored) return;
        setTrashOpen(null);
        showToast(restored.label, true);
        goToRestored(restored, true);
      });
    },
    [goToRestored, showToast],
  );

  /** REM-07, D-94: an overdue reminder's Done: its task completed in its own list, with Undo. */
  const completeOverdue = useCallback(
    (reminder: TodayReminder): void => {
      void window.flintMain.toggle(reminder.listId, reminder.key).then((label) => {
        if (label) showToast(label, true);
      });
    },
    [showToast],
  );
  /**
   * REM-04, REM-07, D-94: an overdue reminder's Snooze ▸: in an hour, tomorrow at 10:00 (D-69's
   * default time), or a time from the picker; the reminder is on again, with Undo.
   */
  const snoozeOverdue = useCallback(
    (reminder: TodayReminder, anchor: DOMRect): void => {
      const set = (at: Date | LocalDateTime): void => {
        const value =
          at instanceof Date
            ? {
                year: at.getFullYear(),
                month: at.getMonth() + 1,
                day: at.getDate(),
                hour: at.getHours(),
                minute: at.getMinutes(),
                second: 0,
              }
            : at;
        void window.flintMain
          .change(reminder.listId, { kind: 'reminder', key: reminder.key, at: value })
          .then((outcome) => {
            if (outcome) showToast('Snoozed', true);
          });
      };
      const now = new Date();
      // Whole minutes, rounded up (D-69).
      const inHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 60_000) * 60_000);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10);
      openMenu(
        [
          { label: 'In 1 hour', action: () => set(inHour) },
          { label: 'Tomorrow 10:00', action: () => set(tomorrow) },
          'divider',
          {
            label: 'Pick a time…',
            action: () => openTimePicker({ anchor, returnFocus: null }, new Date(), null, set),
          },
        ],
        { x: anchor.left, y: anchor.bottom + 4 },
      );
    },
    [showToast],
  );

  /** UI-08, D-55, D-106: a task's actions: its right-click menu, and the Ctrl+K palette's. */
  const taskEntries = useCallback(
    (row: TaskRow, at: Point): MenuEntry[] => {
      const open = !row.done;
      const priority = (label: string, hint: string, value: TaskRow['priority']): MenuEntry => ({
        label,
        hint,
        action: () => void change({ kind: 'priority', key: row.key, priority: value }),
      });
      const topLevel = view?.items.some(
        (item) => item.kind === 'task' && item.task.key === row.key,
      );
      // D-79: fencing a body's unfenced code or JSON on purpose (never by itself on render).
      const unfenced = open && hasBody(row) && !/^ {0,3}(```|~~~)/m.test(row.body);
      const add: MenuEntry[] = open
        ? [
            ...(topLevel ? [{ label: 'Subtask', action: () => addSubtask(row) }] : []),
            { label: 'Notes', action: () => openNotes(row.key) },
          ]
        : [];
      // D-91: the menu in groups: the task, its properties, additions, moves, the rest, deleting.
      return [
        {
          label: open ? 'Complete' : 'Reopen',
          hint: 'Space',
          action: () => void toggle(row.key),
        },
        ...(open ? [{ label: 'Edit', hint: 'Enter', action: () => edit(row.key) }] : []),
        { label: 'Open as page', hint: 'Shift+Enter', action: () => openPage(row.key) },
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
              {
                label: 'Reminder',
                submenu: [
                  {
                    label: row.reminder ? 'Change…' : 'Set…',
                    hint: 'R',
                    action: () => changeReminder(row, new DOMRect(at.x, at.y, 0, 0)),
                  },
                  // REM-12, D-66.
                  ...(row.reminder
                    ? [
                        {
                          label: row.reminderState === 'muted' ? 'Turn on' : 'Turn off',
                          action: () => void mute(row.key, row.reminderState !== 'muted'),
                        },
                      ]
                    : []),
                ],
              },
            ]
          : []),
        // TODAY-01, D-85.
        {
          label: row.pinned ? 'Unpin' : 'Pin',
          hint: 'P',
          action: () => void pin([row], !row.pinned),
        },
        ...(add.length > 0 ? ['divider' as const, { label: 'Add', submenu: add }] : []),
        'divider',
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
        'divider',
        {
          label: 'More',
          submenu: [
            // D-79: Tab and Shift+Tab, made findable; D-89: an impossible one nudges the row.
            ...(open
              ? [
                  {
                    label: 'Indent',
                    hint: 'Tab',
                    action: () =>
                      void change({ kind: 'indent', key: row.key }).then((outcome) => {
                        if (!outcome) nudge(row.key, 'right');
                      }),
                  },
                  {
                    label: 'Outdent',
                    hint: 'Shift+Tab',
                    action: () =>
                      void change({ kind: 'outdent', key: row.key }).then((outcome) => {
                        if (!outcome) nudge(row.key, 'left');
                      }),
                  },
                ]
              : []),
            ...(unfenced
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
          ],
        },
        'divider',
        { label: 'Delete', hint: 'Del', action: () => void remove(row.key) },
      ];
    },
    [
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
      openMenu(taskEntries(row, at), at);
    },
    // D-86: the marks are read here (inside or outside them), so they are a dependency.
    [marked, bulkMenu, taskEntries],
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
      // D-98: a new list or note made right inside the group (opened if it was folded).
      const newIn = (mode: 'tasks' | 'note'): void => {
        if (sidebarView?.collapsed.includes(group.id)) toggleGroup(group.id);
        setNamingProblem(null);
        setNaming({ kind: 'new', mode, group: group.id });
      };
      openMenu(
        [
          { label: 'New task list', action: () => newIn('tasks') },
          { label: 'New note', action: () => newIn('note') },
          'divider',
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
    [sidebarChange, showToast, setNaming, sidebarView, toggleGroup],
  );

  const namingBusy = useRef(false);
  /**
   * The sidebar's name field: Enter saves, and (D-107) so does leaving it, like a task's title; only
   * Esc cancels. Left empty or unchanged, it just closes; a name that can't be used, when it is left,
   * closes it with the reason as a toast (on Enter the reason shows under the field).
   */
  const submitName = useCallback(
    async (name: string, left = false): Promise<void> => {
      if (!naming || namingBusy.current) return;
      const close = (): void => {
        setNaming(null);
        setNamingProblem(null);
      };
      const unchanged =
        (naming.kind === 'rename' || naming.kind === 'renameGroup') &&
        name.trim() === naming.name.trim();
      if (left && (name.trim() === '' || unchanged)) return close();
      const refuse = (problem: string): void => {
        if (!left) return setNamingProblem(problem);
        close();
        showToast(problem, false);
      };
      namingBusy.current = true;
      try {
        if (naming.kind === 'newGroup' || naming.kind === 'renameGroup') {
          const outcome = await window.flintMain.sidebarAction(
            naming.kind === 'newGroup'
              ? { kind: 'newGroup', name }
              : { kind: 'renameGroup', id: naming.id, name },
          );
          if (!outcome) return;
          if (!outcome.ok) return refuse(outcome.problem);
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
            ? { kind: 'new', name, mode: naming.mode, ...(naming.group && { group: naming.group }) }
            : { kind: 'rename', id: naming.id, name },
        );
        if (!outcome) return;
        if (!outcome.ok) return refuse(outcome.problem);
        // D-107: a rename gives way to its row in place, in the render that brings the new name
        // (closing first showed the old name, then the row "arriving" again).
        if (naming.kind === 'rename')
          await refresh(() => {
            setNamingState(null);
            setNamingProblem(null);
          });
        else close();
        if (naming.kind === 'new') openList(outcome.listId);
        if (outcome.label) showToast(outcome.label, true);
      } finally {
        namingBusy.current = false;
      }
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
                  tipHappened('trash');
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
        // D-114, D-115: in a group, both: the top of the group, and out of it to the top of Lists
        // (said so); outside groups, the top of Lists.
        ...(inGroup
          ? [
              {
                label: 'Move to top of group',
                ...(manual ? {} : { hint: 'Switch to Manual', disabled: true }),
                action: () => intoGroup({ group: inGroup.id, index: 0 }),
              },
            ]
          : []),
        {
          label: inGroup ? 'Move out to top of Lists' : 'Move to top',
          ...(manual ? {} : { hint: 'Switch to Manual', disabled: true }),
          action: () => intoGroup({ group: null, index: 0 }),
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
                tipHappened('trash');
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
      // NOTE-08, D-99: Ctrl+Shift+J makes a quick note, anywhere in the window.
      if (key === 'j' && event.ctrlKey && event.shiftKey && !event.altKey) {
        event.preventDefault();
        newQuickNoteRef.current();
        return;
      }
      // NAV-01, D-106: Ctrl+K opens the palette anywhere (in an editor with text selected, it
      // makes that text a link instead: the editor has it).
      if (key === 'k' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        // The editor made the selected text a link already.
        if (event.defaultPrevented) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest('.cm-editor') && (window.getSelection()?.toString() ?? '') !== '')
          return;
        event.preventDefault();
        setCheatSheet(false);
        setPalette(true);
        return;
      }
      // NAV-08, D-128: Ctrl+Shift+H: Paste from clipboard history… (in the main window).
      if (key === 'h' && event.ctrlKey && event.shiftKey && !event.altKey) {
        event.preventDefault();
        pasteFromHistoryRef.current(currentField());
        return;
      }
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
      // NAV-02, D-106: `?` shows every shortcut.
      if (event.key === '?' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        setCheatSheet(true);
        return;
      }
      // TASK-14, D-113: triage has the keys while it is open.
      if (triageRef.current) return;
      // TASK-14, D-113: T in Inbox starts triage.
      if (
        key === 't' &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !page &&
        view?.mode === 'tasks' &&
        lists.find((list) => list.id === view.id)?.inbox
      ) {
        event.preventDefault();
        setTriage(view.id);
        return;
      }
      // D-100: Ctrl+F in Settings finds a setting.
      if (key === 'f' && event.ctrlKey && !event.altKey && listIdRef.current === SETTINGS_ID) {
        event.preventDefault();
        setSettingsFind((count) => count + 1);
        return;
      }
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
      } else if (key === 'r' && !event.shiftKey && marked.size <= 1 && open) {
        // REM-01, D-94: R sets or changes the selected task's reminder, in any list and in Today.
        event.preventDefault();
        const element = document.querySelector(`.row[data-key="${CSS.escape(open.key)}"]`);
        const anchor =
          element?.querySelector('.reminder-time')?.getBoundingClientRect() ??
          element?.querySelector('.title')?.getBoundingClientRect() ??
          new DOMRect(300, 200, 0, 0);
        changeReminder(open, anchor);
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
        else if (todayDetailsRef.current !== null) setTodayDismissed(todayDetailsRef.current);
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
        flip={`list:${list.id}`}
        initial={list.name}
        icon={list.mode === 'note' ? <NoteIcon /> : <ListIcon />}
        problem={namingProblem}
        onSubmit={(name) => void submitName(name)}
        onLeave={(name) => void submitName(name, true)}
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
        // D-99: not while its task's page is open (the click goes back to the list).
        {...(!(pageTask && listId === list.id) && {
          onRename: () => {
            setNamingProblem(null);
            setNaming({ kind: 'rename', id: list.id, name: list.name });
          },
        })}
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
      onLeave={(name) => void submitName(name, true)}
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
        return key && key !== inbox?.id && key !== TODAY_ID && key !== TRASH_ID
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
    if (!nav || !id || id === inbox?.id || id === TODAY_ID || id === TRASH_ID) return;
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
        if (key !== inbox?.id && key !== TODAY_ID && key !== TRASH_ID)
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

  // D-111: the shorthand typed into a row being edited shows on it (lists for `##`).
  const shorthandLists = useMemo(() => listInfos(lists), [lists]);
  const rowProps: RowHandlers = {
    lists: shorthandLists,
    ...(listId && { listId }),
    selected,
    editing,
    onSelect: (key, how) => {
      // D-93: a click on a task in Today shows its details in the column, again too.
      if (todayWideRef.current) setTodayDismissed(null);
      selectRow(key, how);
    },
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
    onHome: (task) => {
      if (task.home) reveal(task.home.listId, task.key);
    },
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
      if (fresh && after === anchor) {
        shownNewRow.current = { seq: fresh.seq, anchor: after, nested: false };
        pageRows.push(
          <NewRow key={`new-${fresh.seq}`} subtask={false} onLeave={leaveNew} onTab={tab} />,
        );
      } else if (!fresh && newLeaving?.anchor === after)
        pageRows.push(<LeavingNewRow key={`new-gone-${newLeaving.seq}`} nested={false} />);
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
      if (!fresh && newLeaving?.anchor === after) {
        cardRows.push(
          <LeavingNewRow key={`new-gone-${newLeaving.seq}`} nested={newLeaving.nested} />,
        );
        return;
      }
      if (!fresh || after !== anchor) return;
      const nested = fresh.level === 'in' || (subtask && fresh.level !== 'out');
      shownNewRow.current = { seq: fresh.seq, anchor: after, nested };
      cardRows.push(
        <NewRow key={`new-${fresh.seq}`} subtask={nested} onLeave={leaveNew} onTab={tab} />,
      );
    };
    cardRows.push(...ghostRows(ghosts, 'open', null, rowProps));
    const highKeys = new Set(view.today?.high ?? []);
    let firstHigh: string | null = null;
    for (const item of (shownView ?? view).items)
      if (item.kind === 'task' && highKeys.has(item.task.key)) {
        firstHigh = item.task.key;
        break;
      }
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
        // D-92: Today's high-priority tasks that aren't pinned, a quieter group after the pins.
        if (item.task.key === firstHigh && view.today) {
          const count = view.today.high.length;
          cardRows.push(
            <div key="focus-high" className="focus-head focus-high">
              <span className="panel-label">High priority · not pinned</span>
              {count > HIGH_SHOWN && (
                <button
                  type="button"
                  className="focus-hint focus-more"
                  onClick={() => setHighAll(!highAll)}
                >
                  {highAll ? 'Show fewer' : `Show all ${count}`}
                </button>
              )}
            </div>,
          );
        }
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
    // D-134: not gone, only named at last: a list opened while its file was still empty (another
    // program saving it in two steps) went by its file name (`file:<name>`); once its text, and so
    // its id, arrives, the same list stays open under its id (in place: no step back).
    if (listId.startsWith('file:')) {
      const name = listId.slice('file:'.length);
      const same = lists.find((list) => list.name === name);
      if (same) {
        const trail = history.current;
        const here = trail.places[trail.at];
        if (here?.list === listId) trail.places[trail.at] = { ...here, list: same.id };
        setListId(same.id);
        return;
      }
    }
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
  // D-91: also in another list, once its rows are there (`view`).
  useEffect(() => {
    const follow = followSelection.current;
    followSelection.current = false;
    if (follow && selected) arriving.current = { key: selected, mode: follow, flash: false };
    const target = arriving.current;
    if (!target || target.key !== selected) {
      arriving.current = null;
      return;
    }
    // D-96: its list's rows aren't there yet (the view still shows the list it came from).
    if (target.list !== undefined && view?.id !== target.list) return;
    const row = scroller.current?.querySelector<HTMLElement>(
      `.row[data-key="${CSS.escape(target.key)}"]`,
    );
    if (!row) return;
    arriving.current = null;
    const area = scroller.current?.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    // Only a row that is out of view (a click or a menu never moves the list).
    if (!area || box.top < area.top || box.bottom > area.bottom)
      row.scrollIntoView({
        block: target.flash ? 'center' : 'nearest',
        behavior: target.mode === 'instant' || reducedMotion() ? 'instant' : 'smooth',
      });
    if (target.edit) edit(target.key);
    // D-93: the flash where the row landed; a window that isn't showing yet flashes when it shows.
    if (!target.flash) return;
    flash(row);
    if (document.visibilityState !== 'visible')
      document.addEventListener('visibilitychange', () => flash(row), { once: true });
  }, [selected, view, arrival]);

  // D-91: a place shown again is where it was left, at once (no smooth scroll); a new one at the top.
  const restored = useRef<string | null>(null);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root || view?.id !== listId) return;
    const key = placeKey(listId, page);
    if (restored.current === key) return;
    restored.current = key;
    const want = scrollMemory.current.get(key) ?? 0;
    root.scrollTo({ top: want, behavior: 'instant' });
    if (Math.round(root.scrollTop) >= want - 1) return;
    // D-130: the place isn't tall enough yet (its rows still arriving on a slow machine, CI run
    // 39853): it follows the page as it grows, until it gets there, 1.5 s pass, another place is
    // shown, or the user scrolls, types or clicks.
    const until = performance.now() + 1500;
    let stopped = false;
    const stop = (): void => {
      stopped = true;
    };
    const events = ['wheel', 'keydown', 'pointerdown'] as const;
    for (const name of events) window.addEventListener(name, stop, { capture: true, once: true });
    const done = (): void => {
      for (const name of events) window.removeEventListener(name, stop, { capture: true });
    };
    const follow = (): void => {
      if (stopped || restored.current !== key || performance.now() > until) return done();
      root.scrollTo({ top: want, behavior: 'instant' });
      if (Math.round(root.scrollTop) >= want - 1) return done();
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }, [view, listId, page]);

  // D-107: a note's line chosen in the palette: the note opens scrolled to it. D-143: what was
  // searched for in it lights up as find's current match does, then fades (match-flash.ts).
  useEffect(() => {
    const target = lineTarget;
    if (!target || view?.id !== target.list || view.mode !== 'note' || page) return;
    const root = scroller.current;
    const cm = root ? noteEditorView(root) : null;
    if (!root || !cm) return;
    setLineTarget(null);
    const line = cm.state.doc.line(Math.min(target.line + 1, cm.state.doc.lines));
    // The editor scrolls it there itself: it measures the lines (an estimate fell short).
    cm.dispatch({
      effects: CodeEditorView.scrollIntoView(line.from, {
        y: 'start',
        yMargin: Math.round(root.clientHeight / 3),
      }),
    });
    flashMatches(
      cm,
      matchRanges(line.text, target.match).map(([from, to]) => ({
        from: line.from + from,
        to: line.from + to,
      })),
    );
  }, [view, page, lineTarget]);

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

  /** NAV-01, D-106: a place's name for the palette. */
  const placeName = (id: string): string =>
    id === TODAY_ID
      ? 'Today'
      : id === SETTINGS_ID
        ? 'Settings'
        : id === TRASH_ID
          ? 'Trash'
          : id === SNAPSHOTS_ID
            ? 'Snapshots'
            : (lists.find((list) => list.id === id)?.name ?? '');
  /** D-106: Settings, at a section. */
  const openSettings = (section?: string): void => {
    openList(SETTINGS_ID);
    if (section)
      window.setTimeout(
        () =>
          document
            .getElementById(`settings-${section}`)
            ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
        200,
      );
  };
  /** D-106: a right-click menu's entries as palette items (a submenu is a second step). */
  const fromMenu = (entries: readonly MenuEntry[], prefix: string): PaletteItem[] =>
    entries.flatMap((entry): PaletteItem[] => {
      if (entry === 'divider' || entry.disabled) return [];
      const id = `${prefix}:${entry.label}`;
      const submenu = entry.submenu;
      return submenu
        ? [
            {
              id,
              label: entry.label,
              step: () => ({ title: entry.label, items: fromMenu(submenu, id) }),
            },
          ]
        : [
            {
              id,
              label: entry.label,
              hint: entry.hint,
              ...(entry.action && { run: entry.action }),
            },
          ];
    });
  /** D-106: what the palette offers now (built when it opens). */
  const paletteSources = (): PaletteSources => {
    const go =
      (id: string): (() => void) =>
      () =>
        openList(id);
    const groups = (sidebarView?.items ?? []).filter(
      (item): item is Extract<SidebarItem, { kind: 'group' }> => item.kind === 'group',
    );
    const named: PaletteItem[] = [
      ...lists.map((list) => ({
        id: `go:${list.id}`,
        label: list.name,
        detail: list.mode === 'note' ? 'Note' : undefined,
        run: go(list.id),
      })),
      ...groups.map((group) => ({
        id: `go:group:${group.id}`,
        label: group.name,
        detail: 'Group',
        run: () => {
          if (sidebarView?.collapsed.includes(group.id)) toggleGroup(group.id);
          const first = group.lists[0];
          if (first) openList(first);
        },
      })),
    ];
    // D-107: "Go to" is the fixed places; lists, notes and groups come after the tasks.
    const places: PaletteItem[] = [
      { id: 'go:today', label: 'Today', hint: undefined, run: go(TODAY_ID) },
      { id: 'go:settings', label: 'Settings', run: () => openSettings() },
      ...SETTINGS_SECTIONS.map((section) => ({
        id: `go:settings:${section.id}`,
        label: `Settings: ${section.name}`,
        run: () => openSettings(section.id),
      })),
      { id: 'go:trash', label: 'Trash', run: go(TRASH_ID) },
      { id: 'go:snapshots', label: 'Snapshots', run: go(SNAPSHOTS_ID) },
    ];
    // Recent: the places gone through this session, newest first, not the one shown.
    const seen = new Set<string>([listId]);
    const recent: PaletteItem[] = [];
    for (const place of [...history.current.places].reverse()) {
      if (seen.has(place.list)) continue;
      seen.add(place.list);
      const name = placeName(place.list);
      if (name) recent.push({ id: `recent:${place.list}`, label: name, run: go(place.list) });
    }
    // The selected task's actions (its right-click menu); Move to… lists the lists.
    let task: PaletteItem[] = [];
    if (selectedRow) {
      const row = selectedRow;
      const box = document
        .querySelector(`.row[data-key="${CSS.escape(row.key)}"]`)
        ?.getBoundingClientRect();
      const at = box ? { x: box.left + 48, y: box.bottom } : { x: 240, y: 160 };
      const home = view?.id === TODAY_ID ? (row.home?.listId ?? listId) : listId;
      task = fromMenu(taskEntries(row, at), 'task').map((item) =>
        item.label === 'Move to…'
          ? {
              id: 'task:move',
              label: 'Move to…',
              step: () => ({
                title: 'Move to',
                items: lists
                  .filter((list) => list.mode === 'tasks' && list.id !== home)
                  .map((list) => ({
                    id: `move:${list.id}`,
                    label: list.name,
                    run: () => void moveTask(row.key, { list: list.id }),
                  })),
              }),
            }
          : item,
      );
    }
    const zoomLevels = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
    const commands: PaletteItem[] = [
      {
        id: 'new:list',
        label: 'New task list',
        hint: 'Ctrl+Shift+N',
        run: () => setNaming({ kind: 'new', mode: 'tasks' }),
      },
      { id: 'new:note', label: 'New note', run: () => setNaming({ kind: 'new', mode: 'note' }) },
      { id: 'new:group', label: 'New group', run: () => setNaming({ kind: 'newGroup' }) },
      { id: 'new:quick', label: 'Quick note', hint: 'Ctrl+Shift+J', run: () => newQuickNote() },
      ...(view?.mode === 'tasks' && !pageTask && view.id !== TODAY_ID
        ? [
            {
              id: 'list:find',
              label: 'Find in list',
              hint: 'Ctrl+F',
              run: () => setFinding((count) => count + 1),
            },
          ]
        : []),
      ...fromMenu(sortItems(), 'sort'),
      // NOTE-09, D-141: Source mode for the open note; NOTE-06's Monospace beside it (D-106).
      ...(view?.mode === 'note' && view.readOnly === null
        ? [
            {
              id: 'note:source',
              label: view.source === true ? 'Source mode off' : 'Source mode',
              hint: 'Ctrl+Shift+E',
              run: () => void window.flintMain.noteSource(view.id, view.source !== true),
            },
            {
              id: 'note:monospace',
              label: view.mono === true ? 'Monospace off' : 'Monospace',
              hint: 'Ctrl+Shift+M',
              run: () => void window.flintMain.noteMono(view.id, view.mono !== true),
            },
          ]
        : []),
      // NOTE-10, D-141 Q11: the table's commands while the caret is in one (a note or a body).
      ...tablePaletteCommands()
        .filter((command) => !command.disabled)
        .map((command) => ({ id: command.id, label: command.label, run: command.run })),
      ...(view && !lists.find((list) => list.id === view.id)?.inbox && view.id !== TODAY_ID
        ? [
            {
              id: 'list:rename',
              label: `Rename ${view.mode === 'note' ? 'note' : 'list'}`,
              run: () => setNaming({ kind: 'rename', id: view.id, name: view.name }),
            },
          ]
        : []),
      // LIST-06, D-114: the open list to the top of Lists, or of its group (the manual order).
      ...(view &&
      (sidebarView?.sort ?? 'manual') === 'manual' &&
      sidebarView?.items.some(
        (item) =>
          (item.kind === 'list' && item.id === view.id) ||
          (item.kind === 'group' && item.lists.includes(view.id)),
      )
        ? [
            {
              id: 'list:top',
              label: groups.some((group) => group.lists.includes(view.id))
                ? `Move ${view.mode === 'note' ? 'note' : 'list'} out to top of Lists`
                : `Move ${view.mode === 'note' ? 'note' : 'list'} to top`,
              run: () => {
                if (reorderable())
                  void sidebarChange({ kind: 'move', id: view.id, to: { group: null, index: 0 } });
              },
            },
            ...groups
              .filter((group) => group.lists.includes(view.id))
              .map((group) => ({
                id: 'list:top-of-group',
                label: `Move ${view.mode === 'note' ? 'note' : 'list'} to top of group`,
                run: () => {
                  if (reorderable())
                    void sidebarChange({
                      kind: 'move',
                      id: view.id,
                      to: { group: group.id, index: 0 },
                    });
                },
              })),
          ]
        : []),
      ...fromMenu(panelItem(), 'panel'),
      {
        id: 'app:size',
        label: 'Interface size',
        keywords: 'zoom bigger smaller',
        hint: 'Ctrl+= / Ctrl+−',
        step: () => ({
          title: 'Interface size',
          items: zoomLevels.map((level) => ({
            id: `size:${level}`,
            label: `${Math.round(level * 100)}%`,
            run: () => void window.flintMain.zoom(level),
          })),
        }),
      },
      {
        id: 'app:folder',
        label: 'Open Flint folder',
        run: () => void window.flintMain.openFolder('flint'),
      },
      {
        id: 'app:export',
        label: 'Export Flint folder…',
        keywords: 'zip backup',
        run: () => void window.flintMain.exportFolder(),
      },
      {
        id: 'app:snapshot',
        label: 'Restore from a snapshot…',
        keywords: 'older version',
        run: go(SNAPSHOTS_ID),
      },
      {
        id: 'app:triage',
        label: 'Triage Inbox',
        keywords: 'sort inbox one at a time',
        hint: 'T',
        run: () => startTriage(lists.find((list) => list.inbox)?.id ?? 'inbox'),
      },
      {
        id: 'app:mini',
        label: 'Mini mode',
        keywords: 'small window always on top call sticky note',
        hint: 'Ctrl+Alt+Space',
        run: () => window.flintMain.toggleMini(),
      },
      // APP-10, APP-15, D-112, D-117: the walkthrough again, and What's new.
      {
        id: 'app:tour',
        label: 'Replay walkthrough',
        keywords: 'tour onboarding help start guide',
        run: () => startTour(0),
      },
      {
        id: 'app:reset-tips',
        label: 'Reset tips',
        keywords: 'tips hints show again',
        run: () => void window.flintMain.resetTips().then(() => showToast('Tips reset', false)),
      },
      // NAV-08, D-128: Windows' clipboard history.
      {
        id: 'app:clipboard-paste',
        label: 'Paste from clipboard history…',
        keywords: 'clipboard history win+v paste copied insert',
        hint: 'Ctrl+Shift+H',
        run: () => pasteFromHistory(currentField()),
      },
      {
        id: 'app:clipboard-show',
        label: 'Show clipboard contents',
        keywords: 'clipboard history always show contents reveal screen sharing',
        run: () => showClipboardContents(true),
      },
      {
        id: 'app:clipboard-hide',
        label: 'Hide clipboard contents',
        keywords: 'clipboard history hide contents private screen sharing',
        run: () => showClipboardContents(false),
      },
      // APP-06, D-136: the check shows its progress in Settings → About (errors never as a toast).
      {
        id: 'app:check-updates',
        label: 'Check for updates',
        keywords: 'update upgrade new version github release download',
        run: () => {
          openSettings('about');
          void window.flintMain.updatesCheck();
        },
      },
      ...(updates.phase === 'ready'
        ? [
            {
              id: 'app:restart-update',
              label: `Restart to update (Flint ${updates.version ?? ''})`.replace(' ()', ''),
              keywords: 'update install restart new version',
              run: () => void window.flintMain.updatesRestart(),
            },
          ]
        : []),
      {
        id: 'app:whats-new',
        label: 'What’s new',
        keywords: 'whats new release notes changes update version',
        run: () => setWhatsNew({ since: undefined }),
      },
      {
        id: 'app:shortcuts',
        label: 'Keyboard shortcuts',
        hint: '?',
        run: () => setCheatSheet(true),
      },
      {
        id: 'app:quit',
        label: 'Quit Flint',
        keywords: 'exit close',
        run: () => window.flintMain.quit(),
      },
    ];
    return { recent, task, places, lists: named, commands };
  };
  /** D-106: the lists and notes searched in the main process. */
  const paletteSearch = useCallback(
    (query: string, scope: 'live' | 'trash') => window.flintMain.search(query, scope),
    [],
  );
  /** D-106: a search result, opening where it is. */
  const hitItem = useCallback(
    (hit: SearchHit): PaletteItem => {
      if (hit.kind === 'task')
        return {
          id: `task:${hit.listId}:${hit.key ?? ''}`,
          label: hit.text,
          detail: hit.detail ? `${hit.listName} · ${hit.detail}` : hit.listName,
          indices: hit.indices,
          quiet: hit.done === true,
          run: () => {
            if (hit.key) reveal(hit.listId, hit.key);
          },
        };
      if (hit.kind === 'line')
        return {
          id: `line:${hit.listId}:${hit.line ?? 0}`,
          label: hit.text,
          detail: hit.listName,
          indices: hit.indices,
          run: () => {
            setLineTarget({
              list: hit.listId,
              line: hit.line ?? 0,
              at: Date.now(),
              match: { text: hit.text, indices: hit.indices, loose: hit.loose === true },
            });
            openList(hit.listId);
          },
        };
      if (hit.kind === 'deleted')
        return {
          id: `deleted:${hit.trashId ?? ''}`,
          label: hit.text,
          detail: `Deleted · from ${hit.listName}`,
          indices: hit.indices,
          quiet: true,
          run: () => {
            openList(TRASH_ID);
            setTrashTab({ tab: 'deleted', at: Date.now() });
            if (hit.trashId)
              void window.flintMain
                .trashPreview(hit.trashId)
                .then((preview) => setTrashOpen(preview));
          },
        };
      return {
        id: `archived:${hit.listId}:${hit.key ?? ''}`,
        label: hit.text,
        detail: `Archived · ${hit.listName}`,
        indices: hit.indices,
        quiet: true,
        run: () => {
          openList(TRASH_ID);
          setTrashTab({ tab: 'archived', at: Date.now() });
        },
      };
    },
    [reveal, openList],
  );
  // D-92, D-93: Today has its own column; the selected task's details take its place.
  const todayWide = panelShown && view?.id === TODAY_ID && !pageTask;
  todayWideRef.current = todayWide;
  const todayDetailsRow =
    todayWide && selectedRow && selectedRow.key !== todayDismissed ? selectedRow : null;
  todayDetailsRef.current = todayDetailsRow?.key ?? null;
  useEffect(() => {
    if (todayDismissed !== null && selected !== todayDismissed) setTodayDismissed(null);
  }, [selected, todayDismissed]);
  const todayColumn = todayWide && !todayDetailsRow;
  const panelState: PanelState | null =
    !panelShown || !view || todayColumn
      ? null
      : todayDetailsRow
        ? {
            kind: 'task',
            task: todayDetailsRow,
            listName: todayDetailsRow.home?.listName ?? view.name,
            readOnly: view.readOnly !== null,
          }
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
    todayDetailsRow !== null ||
    (herePlace?.fromPanel === true && history.current.at > 0 && herePlace.select === selected);
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
  // D-103: how far the page is scrolled, for the context panel's height (it rests lower than it
  // sticks, and its bottom must stay in the window): only while that changes anything.
  const panelTopNow = useRef(0);
  panelTopNow.current = panelTop;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let last = -1;
    const update = (): void => {
      const at = Math.min(Math.round(element.scrollTop), Math.max(0, panelTopNow.current));
      if (at === last) return;
      last = at;
      element.style.setProperty('--page-scroll', `${at}px`);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !(panelShown || trashPanel || settingsPanel)) return;
    const measure = (): void => {
      // M6: in Today, its first card (the rollover prompt, the reminders or the composer).
      const anchor = element.querySelector<HTMLElement>(
        '.content > .rollover, .content > .overdue, .content > .today-reminders-wrap, .content > .composer, .content > .note-card, .content > .trash-bar, .content > .settings > .card',
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
  }, [panelShown, trashPanel, settingsPanel, view?.id, view?.mode, pageTask?.key]);
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
    onBack: todayDetailsRow
      ? () => setTodayDismissed(todayDetailsRow.key)
      : panelBack
        ? () => travel(-1)
        : null,
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
          target={listId === TRASH_ID || listId === SETTINGS_ID ? null : listId}
          version={[lists, naming, sidebarView]}
          className="nav-glide"
        />
        <div className="brand">
          <img src={flintIcon} alt="" />
          <span>Flint</span>
          {/* NAV-01, D-107: the palette from the mouse (Ctrl+K from the keyboard). */}
          <PaletteButton onOpen={() => setPalette(true)} />
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
        {/* NOTE-08, D-99: a quick note in one click; the untitled ones listed below it. */}
        <button
          type="button"
          className="nav quick-new"
          title="Quick note (Ctrl+Shift+J)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => newQuickNoteRef.current()}
        >
          <span className="tile">
            <PlusIcon />
          </span>
          <span className="nav-name">Quick note</span>
          <span className="nav-hint">Ctrl+Shift+J</span>
        </button>
        {quickNotes.length > 0 && (
          <div className="quick-notes" aria-label="Quick notes">
            <div className="section-label quick-label">
              <span>Quick notes</span>
            </div>
            {quickNotes.map((list) =>
              naming?.kind === 'rename' && naming.id === list.id ? (
                <NameField
                  key={list.id}
                  flip={`list:${list.id}`}
                  initial=""
                  placeholder="Title"
                  icon={<NoteIcon />}
                  problem={namingProblem}
                  onSubmit={(name) => void submitName(name)}
                  onLeave={(name) => void submitName(name, true)}
                  onCancel={() => setNaming(null)}
                />
              ) : (
                <NavItem
                  key={list.id}
                  list={{ ...list, name: list.quick?.label ?? list.name }}
                  active={listId === list.id}
                  icon={<NoteIcon />}
                  onSelect={() => openList(list.id)}
                  onMenu={(at) => quickMenu(list, at)}
                  onRename={() => {
                    setNamingProblem(null);
                    setNaming({ kind: 'rename', id: list.id, name: list.name });
                  }}
                />
              ),
            )}
          </div>
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
              onRename={() => {
                setNamingProblem(null);
                setNaming({ kind: 'renameGroup', id: item.id, name: item.name });
              }}
            >
              {item.lists.map((id) => {
                const list = listById.get(id);
                return list ? navList(list) : null;
              })}
              {/* D-98: a new list or note named right where it will be, at the end of the group. */}
              {naming?.kind === 'new' && naming.group === item.id && (
                <NameField
                  flip="naming:list"
                  key={`new-${naming.mode}-${item.id}`}
                  initial=""
                  placeholder={naming.mode === 'note' ? 'Note name' : 'List name'}
                  icon={naming.mode === 'note' ? <NoteIcon /> : <ListIcon />}
                  problem={namingProblem}
                  onSubmit={(name) => void submitName(name)}
                  onLeave={(name) => void submitName(name, true)}
                  onCancel={() => setNaming(null)}
                />
              )}
            </NavGroup>
          );
        })}
        {naming?.kind === 'new' && !naming.group && (
          <NameField
            flip="naming:list"
            key={`new-${naming.mode}`}
            initial=""
            placeholder={naming.mode === 'note' ? 'Note name' : 'List name'}
            icon={naming.mode === 'note' ? <NoteIcon /> : <ListIcon />}
            problem={namingProblem}
            onSubmit={(name) => void submitName(name)}
            onLeave={(name) => void submitName(name, true)}
            onCancel={() => setNaming(null)}
          />
        )}
        {/* DATA-02, D-97: Trash, quiet, at the bottom, with what is in it. */}
        {/* D-103: room for the fade above the foot, so the last list isn't dimmed at the end. */}
        <div className="sidebar-foot-space" aria-hidden="true" />
        <div className="sidebar-foot">
          {/* APP-11, D-100, D-103: Settings and Trash, side by side. */}
          <FootButton
            id={SETTINGS_ID}
            name="Settings"
            active={listId === SETTINGS_ID}
            icon={<SettingsIcon />}
            onSelect={() => openList(SETTINGS_ID)}
          />
          <FootButton
            id={TRASH_ID}
            name="Trash"
            active={listId === TRASH_ID}
            icon={<TrashIcon />}
            onSelect={() => openList(TRASH_ID)}
          />
        </div>
        {/* Settings returns with the Settings screen (APP-11, M8, D-52). */}
      </aside>

      <main className="main">
        <div className="titlebar">
          {/* NAV-07, D-85: shows or hides the panel whenever the window can fit it. */}
          {/* MINI-01, D-109: mini mode, beside the main window (left of the panel toggle). */}
          <button
            type="button"
            className="mini-toggle"
            aria-label="Mini mode"
            title="Mini mode (Ctrl+Alt+Space)"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => window.flintMain.toggleMini()}
          >
            <MiniIcon />
          </button>
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
            className={
              panelState || todayColumn || trashPanel || snapshotPanel || settingsPanel
                ? `pair ${pairSize ?? ''}`
                : 'pair single'
            }
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
              // D-114: triage is a page of Inbox's: in and out of it slide as pages do.
              key={`${view?.id ?? 'none'}/${pageTask?.key ?? ''}/${view && triage === view.id ? 'triage' : ''}`}
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

              {/* APP-11, D-100: Settings. */}
              {listId === SETTINGS_ID && !pageTask && (
                <SettingsScreen
                  find={settingsFind}
                  onToast={(text) => showToast(text, false)}
                  onSnapshots={() => openList(SNAPSHOTS_ID)}
                  onReplayTour={() => startTour(0)}
                  onWhatsNew={() => setWhatsNew({ since: undefined })}
                  updates={updates}
                  onLinkPatterns={(patterns) => {
                    setLinkPatterns(patterns);
                    setPatternsLoaded((count) => count + 1);
                  }}
                  onBuiltInLinksOff={(off) => {
                    setBuiltInLinksOff(off);
                    setPatternsLoaded((count) => count + 1);
                  }}
                  zoom={zoomFactor}
                  onZoom={(level) => void window.flintMain.zoom(level)}
                />
              )}
              {/* DATA-04, D-97: the Snapshots view. */}
              {listId === SNAPSHOTS_ID && !pageTask && (
                <SnapshotsScreen
                  version={lists}
                  onRestored={(label) => showToast(label, true)}
                  openFile={snapshotOpen}
                  page={snapshotOpen && !snapshotWide ? snapshotDiffView(true) : null}
                  onOpenFile={(id, path, when) =>
                    void window.flintMain.snapshotDiff(id, path).then((diff) => {
                      if (diff) setSnapshotOpen({ id, path, when, diff });
                    })
                  }
                />
              )}
              {/* DATA-02, TASK-06, D-97: the Trash view. */}
              {listId === TRASH_ID && !pageTask && (
                <TrashScreen
                  view={trash}
                  open={trashOpen}
                  asPage={!trashWide}
                  onOpen={(id) =>
                    void window.flintMain.trashPreview(id).then((preview) => setTrashOpen(preview))
                  }
                  onClose={() => setTrashOpen(null)}
                  onRestoreToEdit={restoreToEdit}
                  onSnapshots={() => openList(SNAPSHOTS_ID)}
                  onExport={() => void window.flintMain.exportFolder()}
                  tabRequest={trashTab}
                  onRestore={(id) =>
                    void window.flintMain.restoreFromTrash(id).then((restored) => {
                      // D-98: it stays in Trash; the toast offers the way to it.
                      if (restored)
                        showToast(restored.label, true, {
                          label: `Go to ${restored.listName}`,
                          run: () => goToRestored(restored),
                        });
                    })
                  }
                  onDelete={(id) =>
                    void window.flintMain.deleteFromTrash(id).then((done) => {
                      if (done) showToast('Deleted for good', false);
                    })
                  }
                  onEmpty={() =>
                    void window.flintMain.emptyTrash().then((count) => {
                      if (count > 0) showToast('Trash emptied', false);
                    })
                  }
                  onRestoreArchived={(id, key) =>
                    void window.flintMain.restoreArchived(id, key).then((label) => {
                      if (label) showToast(label, true);
                    })
                  }
                />
              )}
              {/* TODAY-01, TODAY-02, TODAY-03 (M6, D-89, mockup 03): the greeting, the rollover
                  prompt and today's reminders, above the composer and Focus. */}
              {view && !pageTask && view.id === TODAY_ID && (
                <>
                  <TodayGreeting
                    open={view.open}
                    reminders={view.today?.reminders ?? []}
                    progress={view.today?.progress}
                  />
                  <RolloverCard
                    tasks={view.today?.rollover ?? []}
                    onAnswer={(clear) =>
                      void window.flintMain.todayAnswer(clear).then((label) => {
                        if (label) showToast(label, true);
                      })
                    }
                  />
                  <OverdueCard
                    overdue={view.today?.overdue ?? []}
                    reminders={view.today?.reminders ?? []}
                    called={overdueCalled}
                    onCalled={() => setOverdueCalled(false)}
                    onOpen={(reminder) => openFromToday(reminder.key, reminder.listId)}
                    onDone={completeOverdue}
                    onSnooze={snoozeOverdue}
                  />
                  <ReminderCards
                    reminders={view.today?.reminders ?? []}
                    onOpen={(reminder) => openFromToday(reminder.key, reminder.listId)}
                  />
                </>
              )}
              {view && triage === view.id && !pageTask && (
                <Triage
                  key={view.id}
                  view={view}
                  lists={lists}
                  change={change}
                  undo={undo}
                  onImage={showImage}
                  onExit={() => setTriage(null)}
                  memory={triageMemory}
                  details={panelShown ? 'panel' : 'card'}
                  onDetails={triageDetails}
                />
              )}
              {view &&
                triage !== view.id &&
                !pageTask &&
                view.mode === 'tasks' &&
                view.id !== TODAY_ID && (
                  <header className="list-header">
                    <h1>
                      {view.name}
                      {view.mode === 'tasks' && <span className="count"> · {view.open} open</span>}
                    </h1>
                    {lists.find((list) => list.id === view.id)?.inbox && (
                      <span className="subtitle">
                        {INBOX_SUBTITLE}
                        {view.open > 0 && (
                          <>
                            {' · '}
                            {/* TASK-14, D-113 (D-115: back from D-114's pill): one task at a
                                time, by keyboard. */}
                            <button
                              type="button"
                              className="subtitle-link"
                              title="Sort Inbox one task at a time (T)"
                              onClick={() => setTriage(view.id)}
                            >
                              Triage · {view.open}
                            </button>
                          </>
                        )}
                      </span>
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
                    {quickHere ? (
                      <QuickTitle
                        key={view.id}
                        at={quickHere.at}
                        title={quickHere.label === view.name ? view.name : ''}
                        onTitle={(title) =>
                          void window.flintMain
                            .listAction({ kind: 'rename', id: view.id, name: title })
                            .then((outcome) => {
                              if (outcome?.ok && outcome.label) showToast(outcome.label, true);
                              else if (outcome && !outcome.ok) showToast(outcome.problem, false);
                            })
                        }
                      />
                    ) : (
                      <NoteTitle
                        key={view.id}
                        name={view.name}
                        readOnly={view.readOnly !== null}
                        onRename={async (name) => {
                          const outcome = await window.flintMain.listAction({
                            kind: 'rename',
                            id: view.id,
                            name,
                          });
                          if (outcome?.ok) {
                            await refresh();
                            if (outcome.label) showToast(outcome.label, true);
                          }
                          return outcome;
                        }}
                        onProblem={(problem) => showToast(problem, false)}
                      />
                    )}
                    {view.readOnly && (
                      <span className="subtitle">
                        Read-only: Flint can&apos;t change this file ({view.readOnly}).
                      </span>
                    )}
                  </header>
                  <NoteEditor
                    key={noteEditorKey(view.id)}
                    id={view.id}
                    text={view.noteText ?? ''}
                    readOnly={view.readOnly !== null}
                    onId={(id, from) => {
                      noteIdHandover.current = { from, to: id };
                      setListId(id);
                    }}
                    onImage={showImage}
                    mono={view.mono === true}
                    source={view.source === true}
                    focus={focusNote === view.id}
                    onFocused={() => setFocusNote(null)}
                  />
                </div>
              )}

              {view?.mode === 'tasks' && !pageTask && triage !== view.id && (
                <>
                  {!view.readOnly && (
                    <Composer
                      key={view.id}
                      listId={view.id}
                      lists={lists}
                      inputRef={composer}
                      onAdd={addFromComposer}
                      {...(view.id === TODAY_ID && { placeholder: 'Add a task to today…' })}
                    />
                  )}

                  {/* TASK-08, D-88: while sorted, what the order is and the way back. */}
                  {sortLine && sortLine.list === view.id && (
                    <div
                      className={sortLine.leaving ? 'sort-indicator leaving' : 'sort-indicator'}
                      role="status"
                      onAnimationEnd={(event) => {
                        if (sortLine.leaving && event.target === event.currentTarget)
                          setSortLine(null);
                      }}
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
                        <span className="panel-label">Focus · pinned</span>
                        {view.open > 1 && <span className="focus-hint">drag to reorder</span>}
                      </div>
                    )}
                    {view.id === TODAY_ID &&
                      view.items.length > 0 &&
                      view.items.length === (view.today?.high.length ?? 0) && (
                        <p className="empty focus-empty">
                          Nothing pinned yet. Press P on a task to bring it here.
                        </p>
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
                  {view.id === TODAY_ID && !panelShown && view.today && (
                    <TodayColumn
                      extras={view.today}
                      stacked
                      onOpen={openFromToday}
                      onMoveReminder={moveReminder}
                      onSortInbox={() => startTriage(view.today?.inbox.id ?? 'inbox')}
                    />
                  )}

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
              {/* D-98: back to the top, at the bottom right of the column (never over the panel). */}
              <div className="to-top-dock">
                <button
                  type="button"
                  className={toTop ? 'to-top shown' : 'to-top'}
                  tabIndex={toTop ? 0 : -1}
                  aria-hidden={!toTop}
                  aria-label="Back to top"
                  title="Back to top"
                  onClick={() =>
                    scroller.current?.scrollTo({
                      top: 0,
                      behavior: reducedMotion() ? 'instant' : 'smooth',
                    })
                  }
                >
                  <ChevronIcon size={14} />
                </button>
              </div>
            </div>
            {/* D-100: Settings' index, in the panel's place. */}
            {settingsPanel && (
              <PanelAside label="Settings sections">
                <SettingsIndex scroller={scroller} />
              </PanelAside>
            )}
            {/* D-99: a snapshot's list or note against now, in the panel's place. */}
            {snapshotPanel && <PanelAside label="Changes">{snapshotDiffView(false)}</PanelAside>}
            {/* D-98: on wide screens a trash item opens read-only in the panel's place. */}
            {trashPanel && trashOpen && (
              <PanelAside label="Deleted item">
                <TrashPreviewView
                  key={trashOpen.id}
                  preview={trashOpen}
                  onRestore={() => restoreToEdit(trashOpen.id)}
                  onClose={() => setTrashOpen(null)}
                />
              </PanelAside>
            )}
            {panelState && (
              <ContextPanel
                state={panelState}
                upNext={upNextItems}
                current={outlineCurrent}
                back={panelBack}
                handlers={panelHandlers}
                foot={
                  <ClipboardSection
                    onInsert={(item) => insertClipboard(item, currentField())}
                    onMenu={clipboardMenu}
                    onSettings={() => void window.flintMain.clipboardSettings()}
                    onShowContents={showClipboardContents}
                    onClear={clearClipboard}
                  />
                }
              />
            )}
            {todayColumn && view?.today && (
              <TodayColumn
                extras={view.today}
                stacked={false}
                onOpen={openFromToday}
                onMoveReminder={moveReminder}
                onSortInbox={() => startTriage(view.today?.inbox.id ?? 'inbox')}
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

      {/* APP-10, APP-13, D-115 to D-120: the walkthrough's spotlight. */}
      {tourRun && (
        <Walkthrough
          key={tourRun.run}
          from={tourRun.from}
          folder={tourFolder}
          paletteOpen={palette}
          onInbox={tourInbox}
          onEnd={endTour}
        />
      )}
      {/* APP-15, D-117: What's new. */}
      {whatsNew && !tourRun && appVersion !== '' && (
        <WhatsNew version={appVersion} since={whatsNew.since} onClose={() => setWhatsNew(null)} />
      )}
      {/* APP-14, D-118: a tip, bottom right, never during the walkthrough, triage or What's new. */}
      <TipLayer
        blocked={tourRun !== null || whatsNew !== null || triage !== null}
        onOff={() => void window.flintMain.setSetting({ key: 'tipsOff', value: true })}
      />
      {/* NAV-01, D-106: the Ctrl+K palette. */}
      {palette && (
        <Palette
          sources={paletteSources()}
          search={paletteSearch}
          hitItem={hitItem}
          onClose={() => setPalette(false)}
        />
      )}
      {/* NAV-02, D-106: the `?` cheat sheet. */}
      {cheatSheet && <CheatSheet onClose={() => setCheatSheet(false)} />}
      {lightbox && (
        <Lightbox
          images={lightbox.images}
          start={lightbox.start}
          onClose={() => setLightbox(null)}
        />
      )}

      {toast && (
        <ToastView
          key={toast.id}
          toast={toast}
          className={marked.size > 1 ? 'above-bar' : ''}
          onHide={hideToast}
          onUndo={() => void undo().then(hideToast)}
        />
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
  /**
   * D-99: a double-click renames it. (Not a slow second click: a click on a group folds or opens
   * it, and folding and unfolding again is two clicks on the same name.)
   */
  readonly onRename: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const { group, collapsed, focused, header, onToggle, onMenu, onRename, children } = props;

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
          onClick={(event) => {
            // The second click of a double-click doesn't fold it back: it renames (below).
            if (event.detail > 1) return;
            onToggle();
          }}
          onDoubleClick={onRename}
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

function NavItem(props: {
  readonly list: ListSummary;
  readonly active: boolean;
  /** D-59: marked with Ctrl/Shift+click for deleting several. */
  readonly marked?: boolean;
  readonly icon: ReactElement;
  readonly onSelect: (how: { readonly ctrl: boolean; readonly shift: boolean }) => void;
  readonly onMenu: (at: Point) => void;
  /**
   * D-99: the name edited in place, like a task's title: a double-click, or a slow second click
   * on the open list. Absent for Today, Inbox and Trash.
   */
  readonly onRename?: () => void;
}): ReactElement {
  const { list, active, marked = false, icon, onSelect, onMenu, onRename } = props;
  const wasActive = useRef(false);
  const slow = useRef(0);
  useEffect(() => () => window.clearTimeout(slow.current), []);
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
      onMouseDown={(event) => {
        event.preventDefault();
        wasActive.current = active;
      }}
      onClick={(event) => {
        onSelect({ ctrl: event.ctrlKey, shift: event.shiftKey });
        // D-99: a slow second click on the open list (as in Explorer) edits its name.
        window.clearTimeout(slow.current);
        if (
          onRename &&
          wasActive.current &&
          event.detail === 1 &&
          !event.ctrlKey &&
          !event.shiftKey
        )
          slow.current = window.setTimeout(onRename, RENAME_DELAY_MS);
      }}
      onDoubleClick={(event) => {
        if (!onRename || event.ctrlKey || event.shiftKey) return;
        window.clearTimeout(slow.current);
        onRename();
      }}
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
 * D-98, D-100, D-103, D-105: Settings or Trash at the sidebar's foot, two buttons of one size side
 * by side, each its icon and name (Trash's count is in Trash).
 */
function FootButton(props: {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly icon: ReactElement;
  readonly onSelect: () => void;
}): ReactElement {
  const { id, name, active, icon, onSelect } = props;
  return (
    <button
      type="button"
      data-key={id}
      className={active ? 'nav on' : 'nav'}
      // As a list in the sidebar: a click opens it without taking the keyboard.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <span className={active ? 'tile strong' : 'tile'}>{icon}</span>
      <span className="nav-name">{name}</span>
    </button>
  );
}

/**
 * A list's name typed in the sidebar (LIST-01): Enter and (D-107) leaving the field save, Esc
 * cancels; a problem (a name Windows can't use, one already taken) shows under it.
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
  /** Clicking or tabbing away. */
  readonly onLeave: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const {
    initial,
    placeholder,
    icon,
    group = false,
    flip,
    problem,
    onSubmit,
    onLeave,
    onCancel,
  } = props;
  const [name, setName] = useState(initial);
  // Saved with Enter: the blur Chromium fires as the field goes away isn't a second save.
  const sent = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const leave = useRef(() => {});
  leave.current = () => {
    if (sent.current) return;
    sent.current = true;
    onLeave(name);
  };
  // D-107: a press anywhere else leaves it too, also where the focus stays put (a sidebar row
  // keeps the focus on mouse down, so the field never blurs).
  useEffect(() => {
    const down = (event: PointerEvent): void => {
      const target = event.target as Element;
      // The field's own right-click menu (Cut, Copy, Paste) isn't leaving it.
      if (target.closest?.('.fl-menu')) return;
      if (box.current && !box.current.contains(target)) leave.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  // D-114: a new list, note or group named outside the sidebar's visible part scrolls into view
  // (clear of Settings and Trash at the bottom and their fade). Measured by layout, not by what
  // the sidebar's motion shows mid-glide, once that motion is over (a folded group it goes into
  // opens first: until then the sidebar can't scroll that far).
  useEffect(() => {
    const field = box.current;
    const sidebar = field?.closest<HTMLElement>('.sidebar');
    if (!field || !sidebar) return;
    const ensure = (): void => {
      let top = 0;
      for (
        let at: HTMLElement | null = field;
        at && at !== sidebar;
        at = at.offsetParent as HTMLElement | null
      )
        top += at.offsetTop;
      const foot = sidebar.querySelector<HTMLElement>('.sidebar-foot');
      const room = sidebar.clientHeight - (foot ? foot.offsetHeight + 32 : 0);
      const from = sidebar.scrollTop;
      const margin = 12;
      let to = from;
      if (top - margin < from) to = top - margin;
      else if (top + field.offsetHeight + margin > from + room)
        to = top + field.offsetHeight + margin - room;
      if (Math.abs(to - from) >= 1)
        sidebar.scrollTo({ top: to, behavior: reducedMotion() ? 'auto' : 'smooth' });
    };
    // Once the sidebar's own motion is over (a group opening, the rows making room): one scroll.
    const started = performance.now();
    let frame = 0;
    const tick = (): void => {
      const busy = sidebar
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === 'running');
      if (busy && performance.now() - started < 1500) frame = requestAnimationFrame(tick);
      else ensure();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={box}
      className={group ? 'name-field group' : 'name-field'}
      {...(flip && { 'data-flip': flip })}
    >
      <div className="nav on">
        <span className="tile">{icon}</span>
        <input
          className="name-input"
          autoFocus
          value={name}
          placeholder={placeholder}
          spellCheck={false}
          maxLength={group ? 60 : undefined}
          onFocus={(event) => {
            sent.current = false;
            event.currentTarget.select();
          }}
          onChange={(event) => {
            sent.current = false;
            setName(event.target.value);
          }}
          onBlur={() => leave.current()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              sent.current = true;
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

/** D-111: an empty new row that was left, playing the remove animation where it was. */
function LeavingNewRow(props: { readonly nested: boolean }): ReactElement {
  return (
    <div
      className={props.nested ? 'row leaving remove subtask' : 'row leaving remove'}
      aria-hidden="true"
    >
      <span className="check" />
      <span className="title" />
    </div>
  );
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
 * D-98, D-99, D-100, D-102: something in the context panel's place (Settings' index, a snapshot
 * comparison, a trash item). Like the panel it scrolls while its content is taller (D-93).
 */
function PanelAside(props: { readonly label: string; readonly children: ReactNode }): ReactElement {
  const ref = useRef<HTMLElement>(null);
  useScrollsWhenTaller(ref);
  return (
    <aside ref={ref} className="context-panel card trash-panel" aria-label={props.label}>
      <div className="panel-inner">{props.children}</div>
    </aside>
  );
}
