import { AsyncLocalStorage } from 'node:async_hooks';
import { statSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  addTask,
  applyOp,
  allTasks,
  bulk,
  completeTask,
  convertToNote,
  convertToTasks,
  deleteTask,
  documentMode,
  duplicateDocument,
  duplicateTask,
  editTitle,
  findTask,
  generateId,
  getBody,
  indentTask,
  moveDown,
  moveTasksToList,
  moveUp,
  placeTask,
  outdentTask,
  parseDocument,
  serializeDocument,
  setBody,
  setPriority,
  setMuted,
  setPinned,
  setReminder,
  taskAsNoteText,
  uncompleteTask,
  type Applied,
  type Op,
  type TaskNode,
  type Where,
} from '@flint/core';
import {
  isValidListName,
  normalizeListName,
  parseCapture,
  taskLabel,
  type CaptureParse,
  type ListInfo,
} from '@flint/core/shorthand';
import { atDefaultTime, formatLocalDateTime, fromDate, toDate } from '@flint/core/time';
import { opKeys, planInverse, planText, taskFingerprint } from '@flint/core/agents';
import type {
  ChangeOutcome,
  SidebarAction,
  SidebarOutcome,
  SidebarSort,
  SidebarView,
  ListActionOutcome,
  ListChange,
  ListSummary,
  ListView,
  TaskRow,
  TodayEntry,
  TodayReminder,
  RestoredItem,
  SnapshotDiff,
  SnapshotFile,
  SnapshotSummary,
  SnapshotTaskDiff,
  TrashItem,
  TrashPreview,
  TrashView,
} from '../../shared/ipc.js';
import { TODAY_ID } from '../../shared/ipc.js';
import { FOCUS_ID, type FocusAction } from '../../shared/focus.js';
import {
  addToSprint,
  countSession,
  inSprint,
  moveToTop,
  orderSprint,
  removeFromSprint,
  resetCounts,
  setEstimate,
  type Sprint,
} from '@flint/core/focus';
import { FocusFile } from '../focus-file.js';
import { dayStamp, TodayFile } from '../today-file.js';
import { writeFileAtomic } from '../storage/atomic.js';
import type { SnapshotStore } from '../storage/snapshots.js';

/**
 * D-99: what differs between a task then and now: its title, priority, reminder, notes, subtasks
 * (any of them, by their text), completion.
 */
function taskChanges(
  then: TaskNode,
  now: TaskNode,
  thenDocument: Parameters<typeof serializeDocument>[0],
  nowDocument: Parameters<typeof serializeDocument>[0],
): string[] {
  const changes: string[] = [];
  if (then.line.title.trim() !== now.line.title.trim()) changes.push('title');
  if ((then.line.fields.priority?.value ?? null) !== (now.line.fields.priority?.value ?? null))
    changes.push('priority');
  const reminder = (task: TaskNode): string =>
    task.line.fields.reminder ? formatLocalDateTime(task.line.fields.reminder.value.value) : '';
  if (reminder(then) !== reminder(now) || !!then.line.fields.muted !== !!now.line.fields.muted)
    changes.push('reminder');
  if (getBody(then).trim() !== getBody(now).trim()) changes.push('notes');
  const subtasks = (task: TaskNode, document: Parameters<typeof serializeDocument>[0]): string =>
    [...allTasks({ ...document, blocks: [task] })]
      .filter(({ parent }) => parent !== null)
      .map(({ task: sub }) => `${sub.line.status}${sub.line.title}`)
      .join('\n');
  if (subtasks(then, thenDocument) !== subtasks(now, nowDocument)) changes.push('subtasks');
  if ((then.line.status !== ' ') !== (now.line.status !== ' ')) changes.push('completion');
  return changes;
}

/**
 * D-99: a note's lines then and now: kept, added since, or removed since (a longest common run;
 * a changed line reads as the old one removed, then the new one added).
 */
function lineDiff(
  before: readonly string[],
  after: readonly string[],
): { kind: 'same' | 'added' | 'removed'; text: string }[] {
  const rows = before.length;
  const cols = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i--)
    for (let j = cols - 1; j >= 0; j--)
      (table[i] as number[])[j] =
        before[i] === after[j]
          ? ((table[i + 1] as number[])[j + 1] ?? 0) + 1
          : Math.max((table[i + 1] as number[])[j] ?? 0, (table[i] as number[])[j + 1] ?? 0);
  const lines: { kind: 'same' | 'added' | 'removed'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i] ?? '' });
      i++;
      j++;
    } else if (
      j < cols &&
      (i >= rows || ((table[i] as number[])[j + 1] ?? 0) > ((table[i + 1] as number[])[j] ?? 0))
    ) {
      lines.push({ kind: 'added', text: after[j] ?? '' });
      j++;
    } else {
      lines.push({ kind: 'removed', text: before[i] ?? '' });
      i++;
    }
  }
  return lines;
}

/** NOTE-08, D-99, D-102: a quick note's flag line in its header (`quick: true` or a day). */
const QUICK_LINE = /^(---\r?\n[\s\S]*?)^quick:\s*(?:true|\d{4}-\d{2}-\d{2})\s*\r?\n/m;

/** DATA-04, D-97: a list or a note in a snapshot (a markdown file at the folder's top level). */
const isListPath = (path: string): boolean =>
  !path.includes('/') && path.toLowerCase().endsWith('.md');
import { IMAGE_TYPES } from './drafts.js';
import {
  EMPTY_SIDEBAR,
  addGroup,
  arrange,
  deleteGroup,
  fromItems,
  moveStep,
  moveTo as moveInSidebar,
  readSidebar,
  renameGroup,
  writeSidebar,
  type SidebarFile,
  type SidebarList,
} from '../sidebar.js';
import { titlePlain } from '../../shared/inline-markdown.js';
import type { ReminderTask } from '../reminders.js';
import { listView, taskRow } from '../views.js';
import { agoLabel, dayLabel, localStamp, parseStamp, TaskMetaFile } from '../task-meta.js';
import { RECENT_CAPTURES, type PanelTask } from '../up-next.js';
import { discoverLists, INBOX_ID, type ListEntry } from '../storage/flint-folder.js';
import { ListFile, tempDirectoryFor } from '../storage/list-file.js';
import {
  cleanOrphanAttachments,
  ensureTrashFolder,
  expireTrash,
  readTrash,
  removeFromTrash,
  stamp,
  trashedIds,
  trashedListName,
  trashedTaskText,
  trashFolder,
  trashPath,
} from '../storage/trash.js';

/**
 * The lists in the Flint folder as the capture popup uses them (CAP-02, CAP-03, CAP-05, D-25,
 * D-27): every list is loaded so new IDs are unique in the whole folder (D-21), a capture goes to
 * the top of Inbox or to its `##` list, and an unmatched `##name` creates that list.
 */

export interface CaptureRequest {
  readonly text: string;
  /** Tab on the close-match card: create the typed list instead (D-25). */
  readonly chooseNewList: boolean;
  /** Pasted images waiting in app data (CAP-06), saved into `attachments/` with the task. */
  readonly attachments?: readonly { readonly file: string; readonly extension: string }[];
}

/** A list created by a capture, so `Created list <name> · Undo` can undo it (CAP-05). */
export interface CreatedList {
  readonly path: string;
  readonly name: string;
  readonly taskId: string;
}

export type CaptureOutcome =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'saved';
      readonly listName: string;
      readonly taskId: string;
      readonly createdList: CreatedList | null;
    };

interface Loaded {
  /** Re-read when the file changes outside Flint (its name, id or mode can change). */
  entry: ListEntry;
  /** Replaced when the list is renamed (its file moves). */
  file: ListFile;
}

/** Snooze 10m on a reminder toast (REM-05). */
const SNOOZE_MS = 10 * 60_000;

/**
 * One undo or redo step (DATA-03): doing it returns the step that reverts it again, or null when
 * it no longer applies (its list is gone). Changes to lists' content and to their files alike.
 */
interface UndoEntry {
  readonly label: string;
  readonly run: (now: Date) => Promise<UndoEntry | null>;
}

/** What an operation step also does to files: a created list, a deleted task's trash file. */
interface StepFiles {
  /** Undoing removes this list again if it is still exactly as created (CAP-05). */
  readonly createdList?: string;
  /** Undoing removes this trash file, redoing writes it again (TASK-12, D-50). */
  readonly trash?: { readonly path: string; readonly text: string };
  /** D-97: a task restored from the trash: undoing writes its trash file again, redoing removes it. */
  readonly restored?: { readonly path: string; readonly text: string };
}

export type ListMode = 'tasks' | 'note';

/**
 * AGENT-07 (D-185 Q5): one step of an AI agent's change, as plain data, so it can be undone out of
 * order and after a restart, never over a later change (`@flint/core/agents`' undo planning).
 */
export type AgentStep =
  /** Operations on tasks: their inverse, and how each task looked right after the change. */
  | {
      readonly kind: 'ops';
      readonly path: string;
      readonly inverse: Op;
      readonly after: Readonly<Record<string, string | null>>;
    }
  /** A whole text (a note's, a converted list's): undone by a three-way merge. */
  | {
      readonly kind: 'text';
      readonly path: string;
      readonly before: string;
      readonly after: string;
    }
  /** A list or note made: to Trash on undo, only while still exactly as made. */
  | { readonly kind: 'created'; readonly listId: string; readonly text: string }
  /** A list or note deleted to Trash: restored on undo. */
  | { readonly kind: 'deletedList'; readonly trash: string }
  | {
      readonly kind: 'renamed';
      readonly listId: string;
      readonly from: string;
      readonly to: string;
    }
  /** The sidebar's groups and order: put back only while unchanged since. */
  | { readonly kind: 'sidebar'; readonly before: string; readonly after: string }
  /** A deleted task's Trash file: removed once the task is back. */
  | { readonly kind: 'taskTrash'; readonly trash: string };

/** What an agent run did (AGENT-01). */
export interface AgentRunOutcome<T> {
  readonly result?: T;
  readonly error?: unknown;
  readonly steps: readonly AgentStep[];
  /** Task keys and lists changed, for the windows' flash (AGENT-07, D-185 Q12). */
  readonly keys: readonly string[];
  readonly lists: readonly string[];
}

/** An exclusive run: an agent's request, or the user undoing one (`agent` null). */
interface Exclusive {
  readonly agent: string | null;
  readonly applied: { readonly path: string; readonly op: Op; readonly inverse: Op }[];
  /** AGENT-06: the lists an agent may see; shorthand's ##list never reaches a hidden one. */
  readonly visible?: (listId: string) => boolean;
}

interface AgentSnapshot {
  readonly lists: ReadonlyMap<
    string,
    { readonly name: string; readonly path: string; readonly text: string }
  >;
  readonly sidebar: string;
  readonly trash: ReadonlySet<string>;
}

/** What a list action did, or why it couldn't (shown next to the name being typed). */
export type ListOutcome = ListActionOutcome;

/** Pasted images bigger than this aren't attached (MEDIA-03 warns about large files later). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const NEW_LIST_HEADER = (id: string, mode: ListMode = 'tasks'): string =>
  `---\nflint: 1\nid: ${id}\nmode: ${mode}\n---\n`;

/** TASK-17, D-85: a note's name made from a task's title: what Windows allows in a file name. */
function noteName(title: string): string {
  const name = [...title]
    .map((char) => (char < ' ' ? ' ' : char))
    .join('')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return isValidListName(name) ? name : 'Note';
}

/** A list's name, as typed in the sidebar (LIST-01): Windows file-name rules (D-25). */
function listNameProblem(name: string): string | null {
  if (name.trim() === '') return 'A list needs a name';
  if (!isValidListName(name.trim())) return 'Windows can’t use that as a file name';
  return null;
}

export class Workspace {
  readonly folder: string;
  private readonly lists: Loaded[];
  private readonly uiStatePath: string;
  private uiState: Record<string, unknown>;

  /** IDs in the trash stay taken (D-29). */
  private readonly trashed: Set<string>;
  /** docs/04 §3, NAV-07: when each task was first seen and last changed (`.flint/meta.json`). */
  readonly meta: TaskMetaFile;
  /** TODAY-01, TODAY-02 (M6): Today's order and the rollover prompt's memory (`.flint/today.json`). */
  readonly today: TodayFile;
  /** FOCUS-02, FOCUS-03 (D-170): Focus's sprint (`.flint/focus.json`). */
  readonly focus: FocusFile;
  /** FOCUS-02: done tasks below the open ones in Focus (Check to bottom, from the settings). */
  focusCheckToBottom = true;

  private constructor(
    folder: string,
    lists: Loaded[],
    uiStatePath: string,
    uiState: Record<string, unknown>,
    trashed: Set<string>,
  ) {
    this.folder = folder;
    this.lists = lists;
    this.uiStatePath = uiStatePath;
    this.uiState = uiState;
    this.trashed = trashed;
    this.meta = new TaskMetaFile(folder);
    this.today = new TodayFile(folder);
    this.focus = new FocusFile(folder);
  }

  /** Every task ID of the lists, for the bookkeeping's first sight. */
  private taskIds(): string[] {
    return this.lists.flatMap(({ file }) =>
      [...allTasks(file.document)].map(({ task }) => task.key),
    );
  }

  /** Loads every list in the folder; `uiStatePath` keeps the most recently used lists (D-25). */
  static async open(folder: string, uiStatePath: string): Promise<Workspace> {
    const entries = await discoverLists(folder);
    const lists = await Promise.all(
      entries.map(async (entry) => ({ entry, file: await ListFile.open(entry.path) })),
    );
    let uiState: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(uiStatePath, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null)
        uiState = parsed as Record<string, unknown>;
    } catch {
      uiState = {};
    }
    const workspace = new Workspace(folder, lists, uiStatePath, uiState, await trashedIds(folder));
    workspace.sidebarFile = readSidebar(
      await readFile(workspace.sidebarPath, 'utf8').catch(() => null),
    );
    await workspace.meta.load();
    await workspace.today.load();
    await workspace.focus.load();
    workspace.meta.seen(workspace.taskIds(), new Date());
    return workspace;
  }

  /**
   * D-79: an image pasted into the main window (the composer), saved to `attachments/` (MEDIA-02);
   * resolves to its relative link, or null for a type Flint doesn't attach.
   */
  /** D-130: the Flint folder's temporary folder (`.flint/tmp`), for files in its subfolders too. */
  private get folderTemp(): string {
    return tempDirectoryFor(join(this.folder, 'x.md'));
  }

  async saveImage(bytes: Uint8Array, type: string, now: Date): Promise<string | null> {
    const extension = IMAGE_TYPES[type];
    if (!extension || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    await mkdir(join(this.folder, 'attachments'), { recursive: true });
    const name = `${stamp(now)}-${generateId(this.isTaken)}.${extension}`;
    const path = join(this.folder, 'attachments', name);
    // D-130: the Flint folder's own temporary folder, never one inside attachments/.
    await writeFileAtomic(path, bytes, { tempDirectory: this.folderTemp });
    return `attachments/${name}`;
  }

  /** LIST-05, D-73: the sidebar's groups and manual order, from `.flint/sidebar.json`. */
  private sidebarFile: SidebarFile = EMPTY_SIDEBAR;

  private get sidebarPath(): string {
    return join(this.folder, '.flint', 'sidebar.json');
  }

  private get sidebarSort(): SidebarSort {
    const sort = this.uiState.sidebarSort;
    return sort === 'edited' || sort === 'created' ? sort : 'manual';
  }

  /** NOTE-06, D-84: the notes shown in monospace on this machine (ui-state.json). */
  private get monoNotes(): string[] {
    const value = this.uiState.monoNotes;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  }

  /** NOTE-06, D-84: a note in monospace or not; this machine only, the file unchanged. */
  async setMono(id: string, on: boolean): Promise<void> {
    const others = this.monoNotes.filter((other) => other !== id);
    await this.saveUiState({ monoNotes: on ? [...others, id] : others });
  }

  /** NOTE-09, D-141: the notes in Source mode on this machine (ui-state.json). */
  private get sourceNotes(): string[] {
    const value = this.uiState.sourceNotes;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  }

  /** NOTE-09, D-141: a note in Source mode or not; this machine only, the file unchanged. */
  async setSource(id: string, on: boolean): Promise<void> {
    const others = this.sourceNotes.filter((other) => other !== id);
    await this.saveUiState({ sourceNotes: on ? [...others, id] : others });
  }

  private get collapsedGroups(): string[] {
    const value = this.uiState.collapsedGroups;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  }

  /** The lists the sidebar places (Inbox stays pinned above it), with their file times. */
  private sidebarLists(): SidebarList[] {
    return (
      this.lists
        // NOTE-08, D-99: quick notes have their own section under Inbox until they get a title.
        .filter((loaded) => loaded.entry.id !== INBOX_ID && !this.isQuick(loaded))
        .map(({ entry }) => {
          let edited = entry.created;
          try {
            edited = statSync(entry.path).mtimeMs;
          } catch {
            // Gone meanwhile: the watcher will drop it.
          }
          return { id: this.listId(entry), edited, created: entry.created };
        })
    );
  }

  /** LIST-05, LIST-06, D-73, D-74: the sidebar as shown: groups, order, sort, folded groups. */
  sidebar(): SidebarView {
    return {
      sort: this.sidebarSort,
      collapsed: this.collapsedGroups,
      items: arrange(this.sidebarFile, this.sidebarLists(), this.sidebarSort),
      today: this.todayView(new Date()).open,
    };
  }

  /** AGENT-01: the sidebar in its manual order (what agents' positions are about). */
  sidebarManual(): SidebarView['items'] {
    return arrange(this.sidebarFile, this.sidebarLists(), 'manual');
  }

  /**
   * LIST-05, LIST-06: a change to the sidebar's groups or order. Groups and order are undoable
   * (the file before and after); the sort and folded groups are this machine's (ui-state.json).
   */
  sidebarAction(
    action: SidebarAction,
    now: Date,
    /** AGENT-01: an agent reorders the manual order under any sort (it shows once sorted manually). */
    anySort = false,
  ): Promise<SidebarOutcome> {
    return this.serial(async () => {
      void now;
      if (action.kind === 'sort') {
        await this.saveUiState({ sidebarSort: action.sort });
        this.notify();
        return { ok: true, label: '' };
      }
      if (action.kind === 'collapse') {
        const others = this.collapsedGroups.filter((id) => id !== action.id);
        await this.saveUiState({
          collapsedGroups: action.collapsed ? [...others, action.id] : others,
        });
        this.notify();
        return { ok: true, label: '' };
      }
      // Reordering follows the manual order; under a sort it would be invisible (D-73).
      if (
        (action.kind === 'move' || action.kind === 'step') &&
        this.sidebarSort !== 'manual' &&
        !anySort
      )
        return { ok: false, problem: 'Switch the sort to Manual to reorder' };
      const items = arrange(this.sidebarFile, this.sidebarLists(), 'manual');
      const groups = items.filter((item) => item.kind === 'group');
      const nameProblem = (name: string, id?: string): string | null => {
        const trimmed = name.trim();
        if (trimmed === '') return 'A group needs a name';
        if (trimmed.length > 60) return 'That name is too long';
        const taken = groups.some(
          (group) => group.id !== id && group.name.toLowerCase() === trimmed.toLowerCase(),
        );
        return taken ? 'A group with that name exists' : null;
      };
      let next: typeof items | null = null;
      let label = '';
      let id: string | undefined;
      switch (action.kind) {
        case 'newGroup': {
          const problem = nameProblem(action.name);
          if (problem) return { ok: false, problem };
          id = `g-${generateId((candidate) => groups.some((group) => group.id === `g-${candidate}`))}`;
          next = addGroup(items, id, action.name.trim());
          label = `Created group ${action.name.trim()}`;
          break;
        }
        case 'renameGroup': {
          const problem = nameProblem(action.name, action.id);
          if (problem) return { ok: false, problem };
          next = renameGroup(items, action.id, action.name.trim());
          label = `Renamed to ${action.name.trim()}`;
          break;
        }
        case 'deleteGroup': {
          const group = groups.find((item) => item.id === action.id);
          if (!group) return { ok: false, problem: 'That group is gone' };
          next = deleteGroup(items, action.id);
          label = `Deleted group ${group.name}`;
          break;
        }
        case 'move':
          next = moveInSidebar(items, action.id, action.to);
          label = 'Moved';
          break;
        case 'step':
          next = moveStep(items, action.id, action.direction);
          label = 'Moved';
          break;
      }
      if (!next) return { ok: false, problem: '' };
      const before = this.sidebarFile;
      const after = fromItems(next, before.extra);
      await this.saveSidebar(after);
      this.remember(this.sidebarStep(label, before, after));
      return { ok: true, label, ...(id ? { id } : {}) };
    });
  }

  /** Undo and redo of a sidebar change: the file as it was, and back. */
  private sidebarStep(label: string, from: SidebarFile, to: SidebarFile): UndoEntry {
    return {
      label,
      run: async () => {
        await this.saveSidebar(from);
        return this.sidebarStep(label, to, from);
      },
    };
  }

  private async saveSidebar(file: SidebarFile): Promise<void> {
    this.sidebarFile = file;
    await mkdir(join(this.folder, '.flint'), { recursive: true });
    await writeFileAtomic(this.sidebarPath, writeSidebar(file), {
      tempDirectory: tempDirectoryFor(this.sidebarPath),
    });
    this.notify();
  }

  /** D-74: a new list (a duplicate) right below another, in its group if it has one. */
  private async placeAfter(id: string, after: string): Promise<void> {
    const items = arrange(this.sidebarFile, this.sidebarLists(), 'manual');
    const group = items.find((item) => item.kind === 'group' && item.lists.includes(after));
    const index =
      group?.kind === 'group'
        ? group.lists.indexOf(after) + 1
        : items.findIndex((item) => item.id === after) + 1;
    if (!group && index === 0) return;
    await this.saveSidebar(
      fromItems(
        moveInSidebar(items, id, { group: group?.id ?? null, index }),
        this.sidebarFile.extra,
      ),
    );
  }

  /**
   * A file in the folder changed (DATA-06, from the watcher): lists added, removed or edited by
   * another program are picked up; Flint's own writes come back unchanged (`ListFile.reload`).
   */
  fileChanged(path: string): Promise<void> {
    // docs/04 §3: tasks added outside Flint are first seen now.
    void Promise.resolve().then(() => this.meta.seen(this.taskIds(), new Date()));
    return this.serial(() => this.refresh(path));
  }

  /**
   * D-138: resolves once every queued change is written, and the pins and Today's order that wait
   * a moment before they are written are too (a quit waits for it).
   */
  async settled(): Promise<void> {
    await this.queue.catch(() => undefined);
    await Promise.allSettled([this.meta.settled(), this.today.settled(), this.focus.settled()]);
  }

  /** Changes run one at a time: watcher refreshes, captures and undos never interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * AGENT-01: an exclusive run (an agent's request, or undoing one) holds the queue from start to
   * end; the calls it makes run at once, and everything else waits until it is done, so the user's
   * own changes never land in the middle of an agent's (or get attributed to it).
   */
  private readonly exclusive = new AsyncLocalStorage<Exclusive>();
  private serial<T>(
    work: () => Promise<T>,
    /** D-183: whether it changed anything (by default it did); nothing changed tells no one. */
    changed: (result: T) => boolean = () => true,
  ): Promise<T> {
    if (this.exclusive.getStore()) return work();
    const run = this.queue.catch(() => undefined).then(work);
    this.queue = run;
    // Whatever changed, the main window shows it (M4).
    void run.then(
      (result) => {
        if (changed(result)) this.notify();
      },
      () => this.notify(),
    );
    return run;
  }

  private readonly listeners = new Set<() => void>();

  /** Called after every change: a capture, an edit, an undo, a file changed by another program. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** The sidebar (M4, LIST-01): Inbox first, then the lists in folder order. */
  summaries(now: Date): ListSummary[] {
    return this.listInfos().map((info) => {
      const loaded = this.find(info.id);
      const open =
        loaded && info.mode === 'tasks'
          ? listView(loaded.file.document, { ...info, readOnly: null }, now).open
          : 0;
      const quick = loaded && this.isQuick(loaded) ? this.quickLabel(loaded, now) : null;
      return {
        id: info.id,
        name: info.name,
        mode: info.mode,
        open,
        inbox: info.id === INBOX_ID,
        ...(info.recentRank === undefined ? {} : { recentRank: info.recentRank }),
        ...(quick && { quick }),
        ...(info.mode === 'note' && loaded && { made: this.madeAt(loaded) }),
      };
    });
  }

  /** D-115, D-122: when a note was made: when Flint first saw it, else the file's own time. */
  private madeAt(list: Loaded): number {
    const seen = this.meta.get(this.listId(list.entry))?.created;
    return ((seen ? parseStamp(seen) : null) ?? new Date(list.entry.created)).getTime();
  }

  /**
   * NOTE-08, D-99, D-102: a quick note: `quick: true` in its header (untitled), or
   * `quick: 2026-11-04` (given a title that day; it becomes a normal note at the next day change).
   */
  private quickFlag(list: Loaded): string | null {
    if (list.entry.mode !== 'note') return null;
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(serializeDocument(list.file.document))?.[1];
    return header ? (/^quick:\s*(true|\d{4}-\d{2}-\d{2})\s*$/m.exec(header)?.[1] ?? null) : null;
  }

  private isQuick(list: Loaded): boolean {
    return this.quickFlag(list) !== null;
  }

  /** D-102: a quick note still under its time-based name (no title given). */
  private isUntitledQuick(list: Loaded): boolean {
    return /^Quick note \d{4}-\d{2}-\d{2} \d{4}( \(\d+\))?$/.test(list.entry.name);
  }

  /** NOTE-08, D-99: a quick note's label: its first line, or when it was made. */
  private quickLabel(list: Loaded, now: Date): { label: string; at: number } {
    const body = serializeDocument(list.file.document).replace(
      /^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
      '',
    );
    const first = body
      .split(/\r?\n/)
      .map((line) =>
        titlePlain(line.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[.\]\s+)?|\d+\.\s+|>\s*)/, '')).trim(),
      )
      .find((line) => line !== '' && !line.startsWith('!['));
    // When it was made: its name says (`Quick note 2026-11-04 1530`); titled, when Flint first saw
    // it (D-115: never the file's time, which a rename makes "now"); else the file's time.
    const named = /^Quick note (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})/.exec(list.entry.name);
    const seen = this.meta.get(this.listId(list.entry))?.created;
    const made = named
      ? new Date(
          Number(named[1]),
          Number(named[2]) - 1,
          Number(named[3]),
          Number(named[4]),
          Number(named[5]),
        )
      : ((seen ? parseStamp(seen) : null) ?? new Date(list.entry.created));
    const at = made.getTime();
    const two = (value: number): string => String(value).padStart(2, '0');
    const clock = `${two(made.getHours())}:${two(made.getMinutes())}`;
    const sameDay = made.toDateString() === now.toDateString();
    const when = sameDay
      ? `Quick note · ${clock}`
      : `Quick note · ${made.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][made.getMonth()] ?? ''} ${clock}`;
    // D-102: a titled one shows its title.
    if (!this.isUntitledQuick(list)) return { label: list.entry.name, at };
    return { label: first ? first.slice(0, 60) : when, at };
  }

  /**
   * NOTE-08, D-99: a new quick note: an untitled note file at the folder's top level, named after
   * when it was made (`Quick note 2026-11-04 1530.md`), `quick: true` in its header. Not an undo
   * step (an empty one goes by itself). Its ID.
   */
  newQuickNote(now: Date): Promise<string | null> {
    return this.serial(async () => {
      const two = (value: number): string => String(value).padStart(2, '0');
      const base = `Quick note ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}`;
      let name = base;
      for (let count = 2; this.sameName(name); count++) name = `${base} (${count})`;
      const id = generateId(this.isTaken);
      const path = join(this.folder, `${name}.md`);
      await writeFileAtomic(path, `---\nflint: 1\nid: ${id}\nmode: note\nquick: true\n---\n`, {
        tempDirectory: tempDirectoryFor(path),
      });
      // D-115: when it was made, kept through a title (the file's own time changes with it).
      this.meta.seen([id], now);
      await this.refresh(path);
      return this.find(id) ? id : null;
    });
  }

  /** D-131: the latest leave of each quick note (an earlier wait gives way to it). */
  private readonly discards = new Map<string, number>();

  /** D-131: a quick note opened again: the removal waiting since it was left is called off. */
  quickNoteOpened(id: string): void {
    if (this.discards.has(id)) this.discards.set(id, (this.discards.get(id) ?? 0) + 1);
  }

  /**
   * NOTE-08, D-99: a quick note left empty goes (for good: nothing was in it). Checked after a
   * moment, so an edit still being saved as the note was left keeps it. D-131: not if it was opened
   * again meanwhile (`stillLeft` says, when the moment is over), and each leave starts the moment
   * anew (returning and leaving again doesn't inherit the first one's).
   */
  async discardQuickNote(id: string, stillLeft: () => boolean = () => true): Promise<boolean> {
    const leave = (this.discards.get(id) ?? 0) + 1;
    this.discards.set(id, leave);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (this.discards.get(id) !== leave) return false;
    this.discards.delete(id);
    if (!stillLeft()) return false;
    return this.serial(async () => {
      const list = this.find(id);
      // D-102: only an untitled one (a title is something to keep).
      if (!list || !this.isQuick(list) || !this.isUntitledQuick(list)) return false;
      const body = serializeDocument(list.file.document).replace(
        /^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
        '',
      );
      if (body.trim() !== '') return false;
      await unlink(list.entry.path).catch(() => undefined);
      await this.refresh(list.entry.path);
      return true;
    });
  }

  /**
   * NOTE-08, D-102: a title for a quick note: the file takes it, and the note stays under Quick
   * notes (`quick: <today>`) until Keep as a note, a group, or the next day change. One undo step.
   */
  async titleQuickNote(id: string, name: string, now: Date): Promise<ListOutcome> {
    const start = this.undoStack.length;
    const flagged = await this.serial(async () => {
      const list = this.find(id);
      if (!list || !this.isQuick(list)) return false;
      const text = serializeDocument(list.file.document).replace(
        QUICK_LINE,
        `$1quick: ${dayStamp(now)}\n`,
      );
      await this.record(list, { type: 'setText', list: list.file.path, text }, 'Titled', now);
      return true;
    });
    if (!flagged) return this.renameList(id, name, now);
    const outcome = await this.renameList(id, name, now);
    if (!outcome.ok || outcome.label === '') {
      await this.undoLast(now);
      return outcome;
    }
    await this.serial(() => {
      this.mergeSince(start, outcome.label);
      return Promise.resolve();
    });
    return outcome;
  }

  /**
   * NOTE-08, D-102: at the day change (and at start-up), quick notes titled on an earlier day
   * become normal notes (not an undo step); untitled ones stay. How many.
   */
  settleQuickNotes(now: Date): Promise<number> {
    return this.serial(async () => {
      const today = dayStamp(now);
      let count = 0;
      for (const list of [...this.lists]) {
        const flag = this.quickFlag(list);
        if (!flag || flag === 'true' || flag >= today || list.file.readOnly) continue;
        const text = serializeDocument(list.file.document).replace(QUICK_LINE, '$1');
        await this.applyAndSave(list, { type: 'setText', list: list.file.path, text }, now);
        count++;
      }
      return count;
    });
  }

  /**
   * NOTE-08, D-99: a quick note made a normal note: its `quick` flag goes, and with a title
   * (`name`) its file takes that name; one undo step. Without a name it keeps its time-based one.
   */
  async keepQuickNote(id: string, name: string | null, now: Date): Promise<ListOutcome> {
    const start = this.undoStack.length;
    const flagged = await this.serial(async () => {
      const list = this.find(id);
      if (!list || !this.isQuick(list)) return false;
      const text = serializeDocument(list.file.document).replace(QUICK_LINE, '$1');
      await this.record(
        list,
        { type: 'setText', list: list.file.path, text },
        'Kept as a note',
        now,
      );
      return true;
    });
    if (!flagged) return { ok: false, problem: 'Not a quick note' };
    const outcome =
      name === null
        ? { ok: true as const, listId: id, label: 'Kept as a note' }
        : await this.renameList(id, name, now);
    if (!outcome.ok) {
      await this.undoLast(now);
      return outcome;
    }
    await this.serial(() => {
      this.mergeSince(start, outcome.label || 'Kept as a note');
      return Promise.resolve();
    });
    return outcome;
  }

  /** One list as the main window shows it (M4). */
  view(id: string, now: Date): ListView | null {
    if (id === TODAY_ID) return this.todayView(now);
    if (id === FOCUS_ID) return this.focusView(now);
    const loaded = this.find(id);
    if (!loaded) return null;
    const info = this.listInfos().find((list) => list.id === id);
    const view = listView(
      loaded.file.document,
      {
        id,
        name: info?.name ?? loaded.entry.name,
        mode: info?.mode ?? 'tasks',
        readOnly: loaded.file.readOnly,
      },
      now,
      (key) => this.meta.get(key),
    );
    let edited: string | undefined;
    try {
      edited = agoLabel(localStamp(statSync(loaded.file.path).mtime), now);
    } catch {
      edited = undefined;
    }
    // NAV-07, D-85: a note's created date is its first sighting.
    if (loaded.entry.mode === 'note') this.meta.seen([id], now);
    const noteMeta = loaded.entry.mode === 'note' ? this.meta.get(id) : undefined;
    const created = noteMeta?.created;
    return {
      ...view,
      ...(this.monoNotes.includes(id) && { mono: true }),
      ...(this.sourceNotes.includes(id) && { source: true }),
      ...(edited !== undefined && { edited }),
      ...(created !== undefined && { created: dayLabel(created, now) }),
      ...(noteMeta?.createdBy !== undefined && { createdBy: noteMeta.createdBy }),
      ...(noteMeta?.touchedBy !== undefined && { touchedBy: noteMeta.touchedBy }),
    };
  }

  /**
   * Undo and redo for the main window (DATA-03): its own changes, newest first. Running an entry
   * yields the entry that goes on the other stack, so undo and redo are the same step.
   */
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  /** TASK-06: where a completed task stood, to put it back on un-check (`completedAfter`). */
  private readonly completedAfter = new Map<string, string | null>();

  private async record(
    list: Loaded,
    op: Op,
    label: string,
    now: Date,
    files: StepFiles = {},
  ): Promise<string> {
    const applied = await this.applyAndSave(list, op, now);
    this.remember(
      this.opsStep(label, [{ path: list.entry.path, inverse: applied.inverse }], true, files),
    );
    return label;
  }

  /** The undo steps recorded since `start` become one, labelled `label`; false if there were none. */
  private mergeSince(start: number, label: string): boolean {
    const entries = this.undoStack.splice(start);
    if (entries.length === 0) return false;
    this.undoStack.push(this.together(label, entries));
    return true;
  }

  /** Steps run as one: newest first, and the steps they return the same way again. */
  private together(label: string, entries: readonly UndoEntry[]): UndoEntry {
    return {
      label,
      run: async (now) => {
        const opposite: UndoEntry[] = [];
        for (const entry of [...entries].reverse()) {
          const back = await entry.run(now);
          if (back) opposite.push(back);
        }
        return opposite.length > 0 ? this.together(label, opposite) : null;
      },
    };
  }

  private remember(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Applies the inverses in order; the step it returns applies their inverses in reverse order. */
  private opsStep(
    label: string,
    parts: readonly { readonly path: string; readonly inverse: Op }[],
    undoing: boolean,
    files: StepFiles,
  ): UndoEntry {
    return {
      label,
      run: async (now) => {
        const next: { path: string; inverse: Op }[] = [];
        for (const part of parts) {
          const list = this.lists.find(({ entry }) => entry.path === part.path);
          if (!list) return null;
          const applied = await this.applyAndSave(list, part.inverse, now);
          next.unshift({ path: part.path, inverse: applied.inverse });
        }
        if (files.trash) {
          if (undoing) await unlink(files.trash.path).catch(() => undefined);
          else await this.writeTrash(files.trash.path, files.trash.text);
        }
        if (files.restored) {
          if (undoing) await this.writeTrash(files.restored.path, files.restored.text);
          else await unlink(files.restored.path).catch(() => undefined);
        }
        const created = files.createdList;
        const list = created ? this.lists.find(({ entry }) => entry.path === created) : undefined;
        if (undoing && list) await this.dropIfEmpty(list);
        return this.opsStep(label, next, !undoing, files);
      },
    };
  }

  /**
   * The Navigate/Edit keys and the composer (M4, TASK-02, TASK-03, TASK-04, docs/03 §2): one change
   * to list `id`, undoable. Null when it changes nothing (Alt+↑ on the first task, an unchanged
   * title). Text arrives with selected or pasted stretches already escaped (D-45).
   */
  change(id: string, change: ListChange, now: Date): Promise<ChangeOutcome | null> {
    return this.serial(() => this.changeNow(id, change, now));
  }

  private async changeNow(
    id: string,
    change: ListChange,
    now: Date,
  ): Promise<ChangeOutcome | null> {
    // FOCUS-02: sending to Focus, Focus on this and estimates change the sprint, from any list.
    if (change.kind === 'focus' || change.kind === 'focusTop' || change.kind === 'estimate')
      return this.sprintChange(change);
    if (id === TODAY_ID) return this.todayChange(change, now);
    if (id === FOCUS_ID) return this.focusChange(change, now);
    const list = this.find(id);
    if (!list || list.entry.mode === 'note') return null;
    const document = list.file.document;
    const path = list.file.path;
    const outcome = (label: string, key: string | null, target = list): ChangeOutcome => ({
      label,
      key,
      listId: this.listId(target.entry),
      listName: target.entry.id === INBOX_ID ? 'Inbox' : target.entry.name,
    });
    switch (change.kind) {
      case 'add':
        return this.add(list, change, now);
      case 'many': {
        // TASK-07, D-59: each change as usual, then their undo steps as one.
        const start = this.undoStack.length;
        let last: ChangeOutcome | null = null;
        for (const each of change.changes)
          if (each.kind !== 'many') last = (await this.changeNow(id, each, now)) ?? last;
        if (!this.mergeSince(start, change.label)) return null;
        return last && { ...last, label: change.label };
      }
      case 'duplicate': {
        const op = duplicateTask(document, path, change.key, () => generateId(this.isTaken));
        const key = op?.type === 'insert' ? op.task.key : null;
        return op ? outcome(await this.record(list, op, 'Duplicated', now), key) : null;
      }
      case 'complete': {
        const found = findTask(document, change.key);
        if (!found || (found.task.line.status !== ' ') === change.done) return null;
        const label = await this.toggleNow(id, change.key, now);
        return label ? outcome(label, change.key) : null;
      }
      case 'edit': {
        const found = findTask(document, change.key);
        if (!found) return null;
        const parsed = parseCapture(change.text, { now, lists: this.shorthandLists() });
        const ops: Op[] = [];
        // D-45: an empty task line is fine with a body; without one, emptying it changes nothing.
        const title = parsed.title.trim();
        const hasBody = getBody(found.task).trim() !== '';
        if (title !== found.task.line.title.trim() && (title !== '' || hasBody))
          ops.push(editTitle(path, change.key, parsed.title));
        if (parsed.priority) ops.push(setPriority(path, change.key, parsed.priority));
        if (parsed.reminder) ops.push(setReminder(path, change.key, parsed.reminder));
        const op = bulk(ops);
        return op ? outcome(await this.record(list, op, 'Edited', now), change.key) : null;
      }
      case 'body': {
        // TASK-05, D-49: the body as typed; a `- [ ]` line in it becomes a subtask (04 §3).
        const found = findTask(document, change.key);
        if (!found || change.body.trim() === getBody(found.task).trim()) return null;
        const op = setBody(path, change.key, change.body.trim());
        return outcome(await this.record(list, op, 'Edited', now), change.key);
      }
      case 'priority': {
        const op = setPriority(path, change.key, change.priority);
        const label = change.priority ? `Priority ${change.priority}` : 'No priority';
        return outcome(await this.record(list, op, label, now), change.key);
      }
      case 'move': {
        const op = (change.direction === 'up' ? moveUp : moveDown)(document, path, change.key);
        return op ? outcome(await this.record(list, op, 'Moved', now), change.key) : null;
      }
      case 'place': {
        const op = placeTask(document, path, change.key, change.where);
        return op ? outcome(await this.record(list, op, 'Moved', now), change.key) : null;
      }
      case 'reminder': {
        if (!findTask(document, change.key)) return null;
        return outcome(
          await this.record(
            list,
            setReminder(path, change.key, change.at),
            change.at ? 'Reminder set' : 'Reminder removed',
            now,
          ),
          change.key,
        );
      }
      case 'mute': {
        const found = findTask(document, change.key);
        if (!found?.task.line.fields.reminder) return null;
        const label = change.muted ? 'Reminder off' : 'Reminder on';
        return outcome(
          await this.record(list, setMuted(path, change.key, change.muted), label, now),
          change.key,
        );
      }
      case 'pin': {
        // TODAY-01, D-85.
        const found = findTask(document, change.key);
        if (!found || (found.task.line.fields.pinned !== undefined) === change.pinned) return null;
        const label = change.pinned ? 'Pinned' : 'Unpinned';
        const done = outcome(
          await this.record(list, setPinned(path, change.key, change.pinned), label, now),
          change.key,
        );
        // M6: a task pinned now goes to the top of Today, pinned today.
        if (change.pinned) this.today.pinnedNow(change.key, now);
        return done;
      }
      case 'toNote':
        return this.taskToNote(list, change.key, now);
      case 'delete': {
        // TASK-12, D-50: the task goes to Trash storage first, so it is never only in memory.
        const found = findTask(document, change.key);
        if (!found) return null;
        const name = list.entry.id === INBOX_ID ? 'Inbox' : list.entry.name;
        const trash = {
          path: join(trashFolder(this.folder), `${stamp(now)}-task-${change.key}.md`),
          text: trashedTaskText(found.task, { id: this.listId(list.entry), name }, now),
        };
        await this.writeTrash(trash.path, trash.text);
        for (const { task } of allTasks({ ...document, blocks: [found.task] }))
          this.trashed.add(task.key);
        const label = await this.record(list, deleteTask(path, change.key), 'Deleted', now, {
          trash,
        });
        return outcome(label, change.key);
      }
      case 'moveTo':
        return this.moveTo(list, change.key, change.to, now);
      case 'indent':
      case 'outdent': {
        const op = (change.kind === 'indent' ? indentTask : outdentTask)(
          document,
          path,
          change.key,
        );
        const label = change.kind === 'indent' ? 'Indented' : 'Outdented';
        return op ? outcome(await this.record(list, op, label, now), change.key) : null;
      }
    }
  }

  /**
   * The composer adds to the top of the list it sits in, Edit-state Enter below the task being
   * edited (docs/03 §2); `##list` sends the task elsewhere, to the top, like a capture (D-25).
   */
  /**
   * TASK-11, D-29: a task (with its subtasks) to the top of another list, or of a new one. The
   * target is written first: a crash between the two writes leaves a copy, never a loss.
   */
  private async moveTo(
    list: Loaded,
    key: string,
    to: Extract<ListChange, { kind: 'moveTo' }>['to'],
    now: Date,
  ): Promise<ChangeOutcome | null> {
    let target: Loaded | undefined;
    let created = false;
    if ('newList' in to) {
      const name = to.newList.trim();
      // In a bulk move (TASK-07) the first task makes the list; the others follow it there.
      const wanted = normalizeListName(name);
      const made = this.lists.find(({ entry }) => normalizeListName(entry.name) === wanted);
      if (made) target = made;
      else {
        if (listNameProblem(name)) return null;
        target = await this.createList(name);
        created = true;
      }
    } else target = this.find(to.list);
    if (!target || target === list || target.entry.mode === 'note' || target.file.readOnly)
      return null;
    const op = moveTasksToList(
      new Map([
        [list.file.path, list.file.document],
        [target.file.path, target.file.document],
      ]),
      list.file.path,
      [key],
      target.file.path,
    );
    if (op?.type !== 'batch') return null;
    const onto = (path: string): Op | null =>
      bulk(op.ops.filter((part) => 'list' in part && part.list === path));
    const inserted = onto(target.file.path);
    const removed = onto(list.file.path);
    if (!inserted || !removed) return null;
    const added = await this.applyAndSave(target, inserted, now);
    const taken = await this.applyAndSave(list, removed, now);
    const name = target.entry.id === INBOX_ID ? 'Inbox' : target.entry.name;
    const label = `Moved to ${name}`;
    this.remember(
      this.opsStep(
        label,
        [
          { path: list.entry.path, inverse: taken.inverse },
          { path: target.entry.path, inverse: added.inverse },
        ],
        true,
        created ? { createdList: target.entry.path } : {},
      ),
    );
    await this.markRecent(this.listId(target.entry));
    return { label, key, listId: this.listId(target.entry), listName: name };
  }

  /**
   * TASK-17, D-85: the task becomes a note named after it (its body, its subtasks as a checklist)
   * and leaves its list; one undo step takes the task back and the note away while it is unchanged.
   * The note is written first: a crash between the two writes leaves a copy, never a loss.
   */
  private async taskToNote(list: Loaded, key: string, now: Date): Promise<ChangeOutcome | null> {
    const found = findTask(list.file.document, key);
    if (!found) return null;
    const task = found.task;
    const base = noteName(taskLabel(titlePlain(task.line.title.trim()), getBody(task)));
    let name = base;
    for (let count = 2; this.sameName(name); count++) name = `${base} ${count}`;
    if (listNameProblem(name)) return null;
    const noteId = generateId(this.isTaken);
    const body = taskAsNoteText(task);
    const text = NEW_LIST_HEADER(noteId, 'note') + (body === '' ? '' : `${body}\n`);
    await this.createList(name, 'note', noteId, text);
    const label = `Converted to note ${name}`;
    const start = this.undoStack.length;
    const created = (): UndoEntry => ({
      label,
      run: async () => {
        const note = this.find(noteId);
        if (!note) return null;
        await this.dropIfUnchanged(note, text);
        if (this.find(noteId)) return null;
        return {
          label,
          run: async () => {
            if (this.find(noteId) || this.sameName(name)) return null;
            await this.createList(name, 'note', noteId, text);
            return created();
          },
        };
      },
    });
    this.remember(created());
    await this.record(list, deleteTask(list.file.path, key), label, now);
    this.mergeSince(start, label);
    return { label, key: null, listId: noteId, listName: name };
  }

  /** Another list already has this name, ignoring case, spaces and hyphens (D-25). */
  private sameName(name: string, except?: Loaded): boolean {
    const wanted = normalizeListName(name);
    return this.lists.some(
      (loaded) =>
        loaded !== except &&
        normalizeListName(loaded.entry.id === INBOX_ID ? 'Inbox' : loaded.entry.name) === wanted,
    );
  }

  private async writeTrash(path: string, text: string): Promise<void> {
    await ensureTrashFolder(this.folder);
    await writeFileAtomic(path, text, {
      tempDirectory: tempDirectoryFor(join(this.folder, 'x.md')),
    });
  }

  /**
   * LIST-05, D-98: a new task list or note from a group's right-click menu, at the end of that
   * group (also under a sort: the group is where it belongs, not an order); one undo step.
   */
  async newListInGroup(
    name: string,
    mode: ListMode,
    group: string,
    now: Date,
  ): Promise<ListOutcome> {
    const start = this.undoStack.length;
    const outcome = await this.newList(name, mode, now);
    if (!outcome.ok) return outcome;
    await this.serial(async () => {
      const items = arrange(this.sidebarFile, this.sidebarLists(), 'manual');
      const target = items.find((item) => item.kind === 'group' && item.id === group);
      if (target?.kind !== 'group') return;
      const before = this.sidebarFile;
      const after = fromItems(
        moveInSidebar(items, outcome.listId, { group, index: target.lists.length }),
        before.extra,
      );
      await this.saveSidebar(after);
      this.remember(this.sidebarStep('Moved', before, after));
      this.mergeSince(start, outcome.label);
    });
    return outcome;
  }

  /** LIST-01, D-52: a new task list or note from the sidebar's + or Ctrl+Shift+N; undoable. */
  newList(name: string, mode: ListMode, now: Date): Promise<ListOutcome> {
    return this.serial(async () => {
      const trimmed = name.trim();
      const problem =
        listNameProblem(trimmed) ??
        (this.sameName(trimmed) ? 'A list with that name exists' : null);
      if (problem) return { ok: false, problem };
      const loaded = await this.createList(trimmed, mode);
      const id = loaded.entry.id ?? '';
      const label = mode === 'note' ? `Created note ${trimmed}` : `Created list ${trimmed}`;
      const created = (): UndoEntry => ({
        label,
        run: async () => {
          const list = this.find(id);
          if (!list) return null;
          await this.dropIfEmpty(list);
          if (this.find(id)) return null;
          return {
            label,
            run: async () => {
              if (this.find(id) || this.sameName(trimmed)) return null;
              await this.createList(trimmed, mode, id);
              return created();
            },
          };
        },
      });
      this.remember(created());
      void now;
      return { ok: true, listId: id, label };
    });
  }

  /** LIST-01: renames the list's file; its ID, and so its references, stay (docs/04 §2). */
  renameList(id: string, name: string, now: Date): Promise<ListOutcome> {
    return this.serial(async () => {
      const list = this.find(id);
      const trimmed = name.trim();
      if (!list || list.entry.id === INBOX_ID)
        return { ok: false, problem: 'Inbox keeps its name' };
      if (trimmed === list.entry.name) return { ok: true, listId: id, label: '' };
      const problem =
        listNameProblem(trimmed) ??
        (this.sameName(trimmed, list) ? 'A list with that name exists' : null);
      if (problem) return { ok: false, problem };
      const label = `Renamed to ${trimmed}`;
      const previous = list.entry.name;
      await this.moveListFile(list, trimmed);
      const step = (from: string, to: string): UndoEntry => ({
        label,
        run: async () => {
          const current = this.find(id);
          if (!current || current.entry.name !== from || this.sameName(to, current)) return null;
          await this.moveListFile(current, to);
          return step(to, from);
        },
      });
      // Undo renames from the new name back to the previous one; redo the other way.
      this.remember(step(trimmed, previous));
      void now;
      return { ok: true, listId: this.listId(list.entry), label };
    });
  }

  private async moveListFile(list: Loaded, name: string): Promise<void> {
    const path = join(this.folder, `${name}.md`);
    // Never overwrite another file; a change of case is the same file on Windows.
    if (path.toLowerCase() !== list.entry.path.toLowerCase()) {
      const exists = await readFile(path).then(
        () => true,
        () => false,
      );
      if (exists) throw new Error(`a file named ${name}.md already exists`);
    }
    await rename(list.entry.path, path);
    list.entry = { ...list.entry, path, name };
    list.file = await ListFile.open(path);
  }

  /**
   * LIST-01, D-55: the list's file moves to Trash storage with its deletion time (D-50); Undo
   * moves it back. Inbox can't be deleted (LIST-03).
   */
  deleteList(id: string, now: Date): Promise<ListOutcome> {
    return this.serial(async () => {
      const list = this.find(id);
      if (!list || list.entry.id === INBOX_ID)
        return { ok: false, problem: "Inbox can't be deleted" };
      const label = `Deleted ${list.entry.name}`;
      const trashed = async (loaded: Loaded): Promise<UndoEntry> => {
        const original = loaded.entry.path;
        const inTrash = join(
          await ensureTrashFolder(this.folder),
          `${stamp(now)}-${basename(original)}`,
        );
        await rename(original, inTrash);
        this.lists.splice(this.lists.indexOf(loaded), 1);
        if (loaded.entry.id) this.trashed.add(loaded.entry.id);
        for (const { task } of allTasks(loaded.file.document)) this.trashed.add(task.key);
        return {
          label,
          run: async () => {
            const back = await readFile(original).then(
              () => false,
              () => true,
            );
            if (!back) return null;
            await rename(inTrash, original);
            const restored: Loaded = { entry: loaded.entry, file: await ListFile.open(original) };
            this.lists.push(restored);
            return {
              label,
              run: async () => {
                const current = this.lists.find(({ entry }) => entry.path === original);
                return current ? trashed(current) : null;
              },
            };
          },
        };
      };
      this.remember(await trashed(list));
      await this.forgetRecent(id);
      return { ok: true, listId: id, label };
    });
  }

  /**
   * D-64: a note's text, edited as plain text until the note editor (M5). A file without Flint's
   * header gets one now (D-23), so its ID may change: the outcome says which it is.
   */
  saveNote(id: string, text: string, now: Date): Promise<ListOutcome> {
    return this.serial(async () => {
      const list = this.find(id);
      if (!list || list.entry.mode !== 'note' || list.file.readOnly)
        return { ok: false, problem: "This note can't be edited" };
      let current = serializeDocument(list.file.document);
      let header = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(current)?.[0];
      if (!header) {
        // The header comes first, on its own and not undoable, so undoing an edit never takes the
        // note's ID away while it is open.
        const newId = generateId(this.isTaken);
        header = NEW_LIST_HEADER(newId, 'note');
        current = header + current;
        await this.applyAndSave(
          list,
          { type: 'setText', list: list.file.path, text: current },
          now,
        );
        list.entry = { ...list.entry, id: newId };
      }
      const full = header + text;
      if (full !== current)
        await this.record(
          list,
          { type: 'setText', list: list.file.path, text: full },
          'Edited note',
          now,
        );
      return { ok: true, listId: this.listId(list.entry), label: 'Edited note' };
    });
  }

  private async add(
    list: Loaded,
    change: Extract<ListChange, { kind: 'add' }>,
    now: Date,
    /** M6: added in Today: pinned, at the top of Today or after `after` there. */
    today?: { readonly after?: string },
  ): Promise<ChangeOutcome | null> {
    const parsed = parseCapture(change.text, {
      now,
      lists: this.shorthandLists(),
      ...(change.chooseNewList && { chooseNewList: true }),
    });
    // D-45, D-88: an untitled task is fine when it has notes (pasted code, TASK-09).
    if (parsed.title.trim() === '' && parsed.body.trim() === '') return null;
    let target = list;
    let created = false;
    if (parsed.target.kind === 'new') {
      target = await this.createList(parsed.target.name);
      created = true;
    } else if (parsed.target.kind === 'existing' || parsed.target.kind === 'close-match') {
      target = this.find(parsed.target.list.id) ?? list;
    }
    // Below the task being edited; at the top if it has gone meanwhile (moved by `##`, deleted).
    const where: Where =
      target === list &&
      change.where !== 'top' &&
      findTask(list.file.document, change.where.after) !== undefined
        ? { at: 'after', key: change.where.after }
        : { at: 'top' };
    // A reserved ID is used once; anything else gets a fresh one.
    const id =
      change.id !== undefined && this.reserved.delete(change.id) && !this.isTaken(change.id)
        ? change.id
        : generateId(this.isTaken);
    const op = addTask(
      target.file.document,
      target.file.path,
      {
        id,
        title: parsed.title,
        // D-78: notes added with Shift+Enter in the composer are the new task's body.
        ...(parsed.body.trim() === '' ? {} : { body: parsed.body.trim() }),
        priority: parsed.priority,
        reminder: parsed.reminder,
        ...(today && { pinned: true }),
      },
      where,
    );
    const label = target === list ? 'Added' : `Added to ${target.entry.name}`;
    await this.record(target, op, label, now, created ? { createdList: target.entry.path } : {});
    if (today) this.today.pinnedNow(id, now, today.after);
    if (target !== list) await this.markRecent(this.listId(target.entry));
    return {
      label,
      key: id,
      listId: this.listId(target.entry),
      listName: target.entry.id === INBOX_ID ? 'Inbox' : target.entry.name,
    };
  }

  /**
   * TODAY-01, TODAY-02, TODAY-03 (M6, D-89): Today: the pinned tasks of every list (a pinned
   * subtask on its own unless its parent is pinned too), in Today's order (pins made in Flint
   * first, pins found in files last), with
   * each task's home list; the done ones in its Completed section until the day changes (D-85);
   * the reminders still to come today; and the rollover prompt's tasks (unfinished, pinned before
   * today) until it is answered today (Q-04).
   *
   * D-92 (mockup 12): the done pinned tasks stay among them, faded, "done 11:20", until the day
   * changes; after them the open high-priority tasks that aren't pinned (the sidebar's list order);
   * all of today's reminders (the timeline), the tasks done today, today's captures, Inbox's count
   * and the day's progress (today's pinned and reminder tasks, and how many are done today).
   */
  private todayView(now: Date): ListView {
    const names = new Map(this.listInfos().map((info) => [info.id, info.name]));
    const today = dayStamp(now);
    const open: { readonly row: TaskRow; readonly day: string }[] = [];
    const donePinned: { readonly row: TaskRow; readonly at: number }[] = [];
    const high: { readonly row: TaskRow; readonly rank: number }[] = [];
    const reminders: TodayReminder[] = [];
    const muted: TodayReminder[] = [];
    const overdue: TodayReminder[] = [];
    const done: (TodayEntry & { readonly at: number })[] = [];
    const counted = new Map<string, boolean>();
    const two = (value: number): string => String(value).padStart(2, '0');
    const clock = (when: Date): string => `${two(when.getHours())}:${two(when.getMinutes())}`;
    const order = arrange(this.sidebarFile, this.sidebarLists(), this.sidebarSort).flatMap(
      (item) => (item.kind === 'group' ? item.lists : [item.id]),
    );
    const labels = new Map<string, TodayEntry>();
    let inbox = { id: INBOX_ID, open: 0 };
    for (const { entry, file } of this.lists) {
      if (entry.mode === 'note') continue;
      const listId = this.listId(entry);
      const home = { listId, listName: names.get(listId) ?? entry.name };
      const listRank = entry.id === INBOX_ID ? -1 : order.indexOf(listId);
      let openHere = 0;
      for (const { task, parent } of allTasks(file.document)) {
        const isDone = task.line.status !== ' ';
        if (!isDone && !parent) openHere++;
        const title = taskLabel(titlePlain(task.line.title.trim()), getBody(task));
        labels.set(task.key, { key: task.key, ...home, title, time: '' });
        const completion = task.line.fields.completion?.value.value;
        const doneAt = isDone && completion ? toDate(completion) : null;
        const doneToday = doneAt !== null && dayStamp(doneAt) === today;
        if (doneToday)
          done.push({ key: task.key, ...home, title, time: clock(doneAt), at: doneAt.getTime() });
        const field = task.line.fields.reminder;
        const at = field ? atDefaultTime(field.value) : null;
        if (at && !task.line.fields.muted) {
          const when = toDate(at);
          // REM-07, REM-11, D-94: an open task whose reminder has passed, whatever the day.
          if (!isDone && when.getTime() <= now.getTime())
            overdue.push({
              key: task.key,
              ...home,
              title,
              time: clock(when),
              at: formatLocalDateTime(at),
              done: false,
            });
          if (dayStamp(when) === today && (!isDone || doneToday)) {
            reminders.push({
              key: task.key,
              ...home,
              title,
              time: clock(when),
              at: formatLocalDateTime(at),
              done: isDone,
            });
            counted.set(task.key, isDone);
          }
        } else if (at && !isDone) {
          // D-111: turned off: only mini mode shows it (struck), to turn it back on.
          const when = toDate(at);
          if (dayStamp(when) === today)
            muted.push({
              key: task.key,
              ...home,
              title,
              time: clock(when),
              at: formatLocalDateTime(at),
              done: false,
            });
        }
        const pinnedHere = task.line.fields.pinned && !parent?.line.fields.pinned;
        const highHere =
          !isDone &&
          !task.line.fields.pinned &&
          task.line.fields.priority?.value === 'high' &&
          !parent?.line.fields.pinned &&
          parent?.line.fields.priority?.value !== 'high';
        if (!pinnedHere && !highHere) continue;
        const row: TaskRow = { ...taskRow(task, now, (key) => this.meta.get(key)), home };
        if (highHere) high.push({ row, rank: listRank });
        else if (isDone) {
          donePinned.push({
            row: doneAt ? { ...row, completed: `done ${clock(doneAt)}` } : row,
            at: doneAt?.getTime() ?? 0,
          });
          if (doneToday) counted.set(task.key, true);
        } else {
          open.push({ row, day: this.today.pinnedDay(task.key, now) });
          counted.set(task.key, counted.get(task.key) ?? false);
        }
      }
      if (entry.id === INBOX_ID) inbox = { id: listId, open: openHere };
    }
    // Tasks Today hasn't placed yet (pinned in a file, or before M6) go last, in file order; a
    // task pinned in Flint goes first (TodayFile.pinnedNow).
    const todayOrder = this.today.order();
    const rank = (key: string): number => {
      const at = todayOrder.indexOf(key);
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    open.sort((a, b) => rank(a.row.key) - rank(b.row.key));
    const placed = open.map(({ row }) => row.key);
    if (placed.join() !== todayOrder.join()) this.today.setOrder(placed);
    reminders.sort((a, b) => a.at.localeCompare(b.at));
    overdue.sort((a, b) => a.at.localeCompare(b.at));
    donePinned.sort((a, b) => a.at - b.at);
    // Stable: the same list keeps its file order.
    high.sort((a, b) => a.rank - b.rank);
    const rollover =
      !this.rolloverPrompt || this.today.answered() === today
        ? []
        : open
            .filter((task) => task.day < today)
            .map(({ row }) => ({ key: row.key, title: titlePlain(row.title) || row.label }));
    const captured = this.meta.captures().flatMap((id): TodayEntry[] => {
      const stamp = this.meta.get(id)?.captured;
      const label = labels.get(id);
      if (!stamp || !label || !stamp.startsWith(today)) return [];
      return [{ ...label, time: stamp.slice(11, 16) }];
    });
    const rows = [...open, ...donePinned, ...high].map(({ row }) => row);
    return {
      id: TODAY_ID,
      name: 'Today',
      mode: 'tasks',
      open: open.length,
      items: rows.map((row) => ({ kind: 'task', task: row })),
      completed: [],
      readOnly: null,
      noteText: null,
      today: {
        reminders,
        muted,
        rollover,
        high: high.map(({ row }) => row.key),
        done: done
          .sort((a, b) => b.at - a.at)
          .map(({ key, listId, listName, title, time }) => ({
            key,
            listId,
            listName,
            title,
            time,
          })),
        captured,
        inbox,
        progress: {
          done: [...counted.values()].filter(Boolean).length,
          total: counted.size,
        },
        overdue,
      },
    };
  }

  /** D-92: Today's open pinned tasks, in Today's order: the only ones Alt+↑/↓ and drag move. */
  private todayPinned(now: Date): string[] {
    const view = this.todayView(now);
    return view.items
      .slice(0, view.open)
      .flatMap((item) => (item.kind === 'task' ? [item.task.key] : []));
  }

  /**
   * M6: a change made in Today goes to the task's home list; Today itself only keeps its order
   * (Alt+↑/↓, drag), undoable. A task added in Today is pinned: at the top of Inbox (or of its
   * `##list`), or after the task it was typed below, in its list. Indenting is the home list's
   * business (null: the row nudges).
   */
  private async todayChange(change: ListChange, now: Date): Promise<ChangeOutcome | null> {
    const here = (outcome: ChangeOutcome | null): ChangeOutcome | null =>
      outcome && { ...outcome, listId: TODAY_ID, listName: 'Today' };
    switch (change.kind) {
      case 'add': {
        const after = change.where === 'top' ? null : this.locate(change.where.after);
        const list = this.find(after?.listId ?? INBOX_ID);
        if (!list) return null;
        return here(await this.add(list, change, now, after ? { after: after.key } : {}));
      }
      case 'many': {
        const start = this.undoStack.length;
        let last: ChangeOutcome | null = null;
        for (const each of change.changes)
          if (each.kind !== 'many') last = (await this.todayChange(each, now)) ?? last;
        if (!this.mergeSince(start, change.label)) return null;
        return last && { ...last, label: change.label };
      }
      case 'move':
      case 'place': {
        // D-92: only the open pinned tasks have an order; a done or high-priority row nudges.
        const keys = this.todayPinned(now);
        const from = keys.indexOf(change.key);
        if (from < 0) return null;
        const next = keys.filter((key) => key !== change.key);
        let to: number;
        if (change.kind === 'move') to = from + (change.direction === 'up' ? -1 : 1);
        else {
          const at = next.indexOf(change.where.key);
          if (at < 0) return null;
          to = change.where.at === 'before' ? at : at + 1;
        }
        if (to < 0 || to > next.length || (change.kind === 'move' && to === from)) return null;
        next.splice(to, 0, change.key);
        if (next.every((key, index) => key === keys[index])) return null;
        this.todayOrderStep(keys, next);
        this.notify();
        return { label: 'Moved', key: change.key, listId: TODAY_ID, listName: 'Today' };
      }
      case 'indent':
      case 'outdent':
        return null;
      default: {
        const home = this.locate(change.key);
        return home ? this.changeNow(home.listId, change, now) : null;
      }
    }
  }

  /**
   * FOCUS-02: every task the sprint names that is still in a task list, by ID, with its home
   * list. A task that isn't found (deleted, its list gone or a note) isn't shown; it stays in the
   * file, so undoing a delete brings it back into Focus, until Clear finished drops it.
   */
  private sprintFound(): Map<
    string,
    { readonly task: TaskNode; readonly listId: string; readonly listName: string }
  > {
    const wanted = new Set(this.focus.sprint.tasks.map((task) => task.id));
    const found = new Map<
      string,
      { readonly task: TaskNode; readonly listId: string; readonly listName: string }
    >();
    if (wanted.size === 0) return found;
    const names = new Map(this.listInfos().map((info) => [info.id, info.name]));
    for (const { entry, file } of this.lists) {
      if (entry.mode === 'note') continue;
      const listId = this.listId(entry);
      for (const { task } of allTasks(file.document))
        if (wanted.has(task.key))
          found.set(task.key, { task, listId, listName: names.get(listId) ?? entry.name });
    }
    return found;
  }

  /** FOCUS-02: the sprint's task IDs as Focus shows them, open and done. */
  private focusOrder(): { readonly open: string[]; readonly done: string[] } {
    const found = this.sprintFound();
    const open: string[] = [];
    const done: string[] = [];
    for (const { id } of this.focus.sprint.tasks) {
      const here = found.get(id);
      if (!here) continue;
      (here.task.line.status !== ' ' ? done : open).push(id);
    }
    return { open, done };
  }

  /** FOCUS-02: the active task: the top open one of the sprint. */
  focusActive(): string | null {
    return this.focusOrder().open[0] ?? null;
  }

  /**
   * FOCUS-01, FOCUS-02, FOCUS-03 (D-170): Focus: the sprint's tasks as rows, in its order (the
   * done ones below the open ones with Check to bottom, struck), each with its home list, and
   * their estimates and counts; the active task is the top open one.
   */
  private focusView(now: Date): ListView {
    const found = this.sprintFound();
    const rows: TaskRow[] = [];
    const doneRows: TaskRow[] = [];
    const entries: Record<string, { estimate: number; count: number }> = {};
    let active: string | null = null;
    for (const { id, estimate, count } of this.focus.sprint.tasks) {
      const here = found.get(id);
      if (!here) continue;
      const row: TaskRow = {
        ...taskRow(here.task, now, (key) => this.meta.get(key)),
        home: { listId: here.listId, listName: here.listName },
      };
      entries[id] = { estimate, count };
      if (row.done && this.focusCheckToBottom) doneRows.push(row);
      else rows.push(row);
      if (!row.done && active === null) active = id;
    }
    const all = [...rows, ...doneRows];
    return {
      id: FOCUS_ID,
      name: 'Focus',
      mode: 'tasks',
      open: all.filter((row) => !row.done).length,
      items: all.map((row) => ({ kind: 'task', task: row })),
      completed: [],
      readOnly: null,
      noteText: null,
      focus: { entries, active },
    };
  }

  /** FOCUS-02: the sprint becomes `after`, one undo step back to `before` (and redo again). */
  private sprintStep(before: Sprint, after: Sprint, label: string): boolean {
    if (!this.focus.set(after)) return false;
    const step = (from: Sprint, to: Sprint): UndoEntry => ({
      label,
      run: () => {
        this.focus.set(from);
        this.notify();
        return Promise.resolve(step(to, from));
      },
    });
    this.remember(step(before, after));
    return true;
  }

  /** FOCUS-02, FOCUS-03: Send to Focus or Remove from Focus, Focus on this, an estimate. */
  private sprintChange(
    change: Extract<ListChange, { kind: 'focus' | 'focusTop' | 'estimate' }>,
  ): ChangeOutcome | null {
    const home = this.locate(change.key);
    if (!home) return null;
    const listName = this.listInfos().find((info) => info.id === home.listId)?.name ?? '';
    const before = this.focus.sprint;
    let after: Sprint;
    let label: string;
    if (change.kind === 'focus') {
      if (inSprint(before, change.key) === change.focus) return null;
      after = change.focus
        ? addToSprint(before, [change.key])
        : removeFromSprint(before, [change.key]);
      label = change.focus ? 'Sent to Focus' : 'Removed from Focus';
    } else if (change.kind === 'focusTop') {
      after = moveToTop(before, change.key);
      label = 'Focusing on this';
    } else {
      after = setEstimate(before, change.key, change.estimate);
      const estimate = after.tasks.find((task) => task.id === change.key)?.estimate ?? 1;
      label = estimate === 1 ? 'Estimate 1 session' : `Estimate ${estimate} sessions`;
    }
    if (!this.sprintStep(before, after, label)) return null;
    return { label, key: change.key, listId: home.listId, listName };
  }

  /**
   * FOCUS-02: a change made in Focus goes to the task's home list; Focus itself keeps the sprint's
   * order (Alt+↑/↓, drag), undoable. A task added in Focus goes to Inbox (or its `##list`) and to
   * the end of the sprint, or below the task it was typed under. Indenting is the home list's
   * business (null: the row nudges).
   */
  private async focusChange(change: ListChange, now: Date): Promise<ChangeOutcome | null> {
    const here = (outcome: ChangeOutcome | null): ChangeOutcome | null =>
      outcome && { ...outcome, listId: FOCUS_ID, listName: 'Focus' };
    switch (change.kind) {
      case 'add': {
        const after = change.where === 'top' ? null : this.locate(change.where.after);
        const list = this.find(after?.listId ?? INBOX_ID);
        if (!list) return null;
        const start = this.undoStack.length;
        const added = await this.add(list, after ? change : { ...change, where: 'top' }, now);
        if (!added?.key) return here(added);
        const before = this.focus.sprint;
        let next = addToSprint(before, [added.key]);
        if (after) {
          const ids = next.tasks.map((task) => task.id).filter((id) => id !== added.key);
          ids.splice(ids.indexOf(after.key) + 1, 0, added.key);
          next = orderSprint(next, ids);
        }
        this.sprintStep(before, next, added.label);
        this.mergeSince(start, added.label);
        return here(added);
      }
      case 'many': {
        const start = this.undoStack.length;
        let last: ChangeOutcome | null = null;
        for (const each of change.changes)
          if (each.kind !== 'many') last = (await this.focusChange(each, now)) ?? last;
        if (!this.mergeSince(start, change.label)) return null;
        return last && { ...last, label: change.label };
      }
      case 'move':
      case 'place': {
        // Only the open tasks have an order of their own; a done row nudges.
        const { open: keys } = this.focusOrder();
        const from = keys.indexOf(change.key);
        if (from < 0) return null;
        const next = keys.filter((key) => key !== change.key);
        let to: number;
        if (change.kind === 'move') to = from + (change.direction === 'up' ? -1 : 1);
        else {
          const at = next.indexOf(change.where.key);
          if (at < 0) return null;
          to = change.where.at === 'before' ? at : at + 1;
        }
        if (to < 0 || to > next.length || (change.kind === 'move' && to === from)) return null;
        next.splice(to, 0, change.key);
        if (next.every((key, index) => key === keys[index])) return null;
        const before = this.focus.sprint;
        if (!this.sprintStep(before, orderSprint(before, next), 'Moved')) return null;
        this.notify();
        return { label: 'Moved', key: change.key, listId: FOCUS_ID, listName: 'Focus' };
      }
      case 'indent':
      case 'outdent':
        return null;
      default: {
        const home = this.locate(change.key);
        return home ? this.changeNow(home.listId, change, now) : null;
      }
    }
  }

  /**
   * FOCUS-02: the Focus page's ⋯ menu: Clear finished (the done tasks, and any no longer found),
   * Reset counts, Remove all from Focus. Only the sprint changes, never a task; one undo step.
   */
  focusAction(action: FocusAction): Promise<string | null> {
    return this.serial(() => {
      const before = this.focus.sprint;
      const { open } = this.focusOrder();
      const all = before.tasks.map((task) => task.id);
      const after =
        action === 'clearFinished'
          ? removeFromSprint(
              before,
              all.filter((id) => !open.includes(id)),
            )
          : action === 'resetCounts'
            ? resetCounts(before)
            : removeFromSprint(before, all);
      const label =
        action === 'clearFinished'
          ? 'Cleared finished tasks'
          : action === 'resetCounts'
            ? 'Counts reset'
            : 'Removed all from Focus';
      return Promise.resolve(this.sprintStep(before, after, label) ? label : null);
    });
  }

  /**
   * FOCUS-03, FOCUS-04: a focus session ran to its end: one more for the active task; with Auto
   * check tasks, the task is completed once its count reaches its estimate (an ordinary, undoable
   * completion). Resolves to the task's ID, or null when no task was active.
   */
  focusCounted(autoCheck: boolean, now: Date): Promise<string | null> {
    return this.serial(async () => {
      const active = this.focusActive();
      if (active === null) return null;
      const next = countSession(this.focus.sprint, active);
      this.focus.set(next);
      const entry = next.tasks.find((task) => task.id === active);
      if (autoCheck && entry && entry.count >= entry.estimate) {
        const home = this.locate(active);
        if (home) await this.toggleNow(home.listId, active, now);
      }
      return active;
    });
  }

  /** FOCUS-01: a task's title as the timer card shows it ("#3 · <title>"). */
  taskTitle(id: string): string | null {
    for (const { file } of this.lists) {
      const found = findTask(file.document, id);
      if (found) return taskLabel(titlePlain(found.task.line.title.trim()), getBody(found.task));
    }
    return null;
  }

  /** M6: Today's order changes to `next`, one undo step back to `before` (and redo again). */
  private todayOrderStep(before: readonly string[], next: readonly string[]): void {
    this.today.setOrder(next);
    const step = (from: readonly string[], to: readonly string[]): UndoEntry => ({
      label: 'Moved',
      run: () => {
        this.today.setOrder(from);
        this.notify();
        return Promise.resolve(step(to, from));
      },
    });
    this.remember(step(before, next));
  }

  /**
   * TODAY-02 (Q-04, D-89): the rollover prompt's answer: Roll over (or its ×) keeps the tasks
   * pinned for today; Clear unpins them (one undo step; they stay in their lists).
   */
  todayAnswer(clear: boolean, now: Date): Promise<string | null> {
    return this.serial(async () => {
      const keys = (this.todayView(now).today?.rollover ?? []).map((task) => task.key);
      this.today.answer(now);
      if (!clear) {
        this.today.keep(keys, now);
        this.notify();
        return null;
      }
      const label = keys.length === 1 ? 'Unpinned 1 task' : `Unpinned ${keys.length} tasks`;
      const outcome = await this.todayChange(
        {
          kind: 'many',
          label,
          changes: keys.map((key) => ({ kind: 'pin', key, pinned: false }) as const),
        },
        now,
      );
      this.notify();
      return outcome?.label ?? null;
    });
  }

  /** Every task with a reminder, for the scheduler (REM-01). A note's fields are inert (D-29). */
  reminderTasks(): ReminderTask[] {
    const names = new Map(this.listInfos().map((info) => [info.id, info.name]));
    const tasks: ReminderTask[] = [];
    for (const { entry, file } of this.lists) {
      if (entry.mode === 'note') continue;
      const listId = this.listId(entry);
      for (const { task } of allTasks(file.document)) {
        const field = task.line.fields.reminder;
        const at = field ? atDefaultTime(field.value) : null;
        if (!at) continue;
        tasks.push({
          id: task.key,
          listId,
          listName: names.get(listId) ?? entry.name,
          title: taskLabel(titlePlain(task.line.title.trim()), getBody(task)),
          at,
          done: task.line.status !== ' ',
          muted: task.line.fields.muted !== undefined,
        });
      }
    }
    return tasks;
  }

  /** NAV-07, D-85: the panel's pinned tasks (in list order) and the last popup captures. */
  panelTasks(): { pinned: PanelTask[]; captured: PanelTask[] } {
    const names = new Map(this.listInfos().map((info) => [info.id, info.name]));
    const pinned: PanelTask[] = [];
    const byId = new Map<string, PanelTask>();
    for (const { entry, file } of this.lists) {
      if (entry.mode === 'note') continue;
      const listId = this.listId(entry);
      for (const { task } of allTasks(file.document)) {
        const item: PanelTask = {
          id: task.key,
          listId,
          listName: names.get(listId) ?? entry.name,
          title: taskLabel(titlePlain(task.line.title.trim()), getBody(task)),
          done: task.line.status !== ' ',
        };
        byId.set(task.key, item);
        if (task.line.fields.pinned) pinned.push(item);
      }
    }
    const captured = this.meta
      .captures()
      .flatMap((id) => byId.get(id) ?? [])
      .slice(0, RECENT_CAPTURES);
    return { pinned, captured };
  }

  /**
   * TODAY-01, D-85: at the day change, tasks completed before today lose their pin, whether or not
   * the rollover prompt is on (not an undo step: nothing the user did). The number unpinned.
   */
  unpinDone(now: Date): Promise<number> {
    return this.serial(async () => {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const before = (task: Parameters<typeof getBody>[0]): boolean => {
        const completion = task.line.fields.completion;
        if (completion) return toDate(completion.value.value) < dayStart;
        const touched = this.meta.get(task.key)?.lastTouched;
        return touched === undefined || touched < localStamp(dayStart);
      };
      let count = 0;
      for (const list of this.lists) {
        if (list.entry.mode === 'note' || list.file.readOnly) continue;
        const ops = [...allTasks(list.file.document)]
          .filter(({ task }) => task.line.fields.pinned && task.line.status !== ' ' && before(task))
          .map(({ task }) => setPinned(list.file.path, task.key, false));
        const op = bulk(ops);
        if (!op) continue;
        await this.applyAndSave(list, op, now);
        count += ops.length;
      }
      if (count > 0) this.notify();
      return count;
    });
  }

  /**
   * TASK-06 (Q-13, D-88): completed top-level tasks (with their subtasks) finished more than `days`
   * days ago move to `.flint/archive/<list ID>.md`, a task list of its own, newest at the top; not
   * an undo step (nothing the user did now). The archive is written first: a crash in between leaves
   * a copy, never a loss. The number archived.
   */
  archiveDone(
    now: Date,
    days: number,
    /** AGENT-01: only this list's done tasks (an agent's archiveDone). */
    only?: string,
  ): Promise<number> {
    return this.serial(async () => {
      const cutoff = now.getTime() - days * 86_400_000;
      let count = 0;
      for (const list of this.lists) {
        if (list.entry.mode === 'note' || list.file.readOnly) continue;
        if (only !== undefined && this.listId(list.entry) !== only) continue;
        const keys = list.file.document.blocks.flatMap((block) => {
          if (block.kind !== 'task' || block.line.status === ' ') return [];
          const completion = block.line.fields.completion;
          return completion && toDate(completion.value.value).getTime() < cutoff ? [block.key] : [];
        });
        if (keys.length === 0) continue;
        const folder = join(this.folder, '.flint', 'archive');
        await mkdir(folder, { recursive: true });
        const path = join(folder, `${this.listId(list.entry)}.md`);
        const exists = await readFile(path).then(
          () => true,
          () => false,
        );
        if (!exists)
          await writeFileAtomic(path, NEW_LIST_HEADER(generateId(this.isTaken), 'tasks'), {
            tempDirectory: tempDirectoryFor(path),
          });
        const archive = await ListFile.open(path);
        if (archive.readOnly) continue;
        const op = moveTasksToList(
          new Map([
            [list.file.path, list.file.document],
            [path, archive.document],
          ]),
          list.file.path,
          keys,
          path,
        );
        if (op?.type !== 'batch') continue;
        const onto = (target: string): Op | null =>
          bulk(op.ops.filter((part) => 'list' in part && part.list === target));
        const inserted = onto(path);
        const removed = onto(list.file.path);
        if (!inserted || !removed || !archive.apply(inserted)) continue;
        await archive.save({ now: fromDate(now), isTaken: this.isTaken });
        await this.applyAndSave(list, removed, now);
        count += keys.length;
      }
      if (count > 0) this.notify();
      return count;
    });
  }

  /**
   * DATA-02, TASK-06, D-97: the Trash view: what was deleted (newest first, each with the list a
   * task came from) and the auto-archived tasks by list.
   */
  async trashView(): Promise<TrashView> {
    const names = new Map(this.listInfos().map((info) => [info.id, info.name]));
    const deleted: TrashItem[] = [];
    for (const entry of await readTrash(this.folder)) {
      const when = formatLocalDateTime(fromDate(entry.at)).slice(0, 16);
      if (entry.kind === 'task') {
        const task = parseDocument(entry.text).blocks.find(
          (block): block is TaskNode => block.kind === 'task',
        );
        if (!task) continue;
        const listId = /^list:\s*(\S+)\s*$/m.exec(entry.text)?.[1];
        let listName: string | null;
        try {
          listName = JSON.parse(/^listName:\s*(.+)$/m.exec(entry.text)?.[1] ?? 'null') as string;
        } catch {
          listName = null;
        }
        deleted.push({
          id: entry.name,
          kind: 'task',
          title: taskLabel(titlePlain(task.line.title.trim()), getBody(task)),
          from: (listId && names.get(listId)) || listName,
          deleted: when,
        });
      } else {
        deleted.push({
          id: entry.name,
          kind: /^mode:\s*note\s*$/m.test(entry.text) ? 'note' : 'list',
          title: trashedListName(entry.name),
          from: null,
          deleted: when,
        });
      }
    }
    const archived: TrashView['archived'][number][] = [];
    const folder = join(this.folder, '.flint', 'archive');
    for (const name of (await readdir(folder).catch(() => [])).sort()) {
      if (!name.endsWith('.md')) continue;
      const listId = name.slice(0, -3);
      const text = await readFile(join(folder, name), 'utf8').catch(() => '');
      const tasks = parseDocument(text).blocks.flatMap((block) =>
        block.kind === 'task'
          ? [
              {
                key: block.key,
                title: taskLabel(titlePlain(block.line.title.trim()), getBody(block)),
                completed: block.line.fields.completion?.value.value
                  ? formatLocalDateTime(block.line.fields.completion.value.value).slice(0, 10)
                  : '',
              },
            ]
          : [],
      );
      if (tasks.length > 0)
        archived.push({ listId, listName: names.get(listId) ?? 'A deleted list', tasks });
    }
    archived.sort((a, b) => a.listName.localeCompare(b.listName));
    return { deleted, archived };
  }

  /** D-98: a trash item, read-only: its title, its text, its tasks (or a task's subtasks). */
  async trashPreview(name: string): Promise<TrashPreview | null> {
    const item = (await this.trashView()).deleted.find((each) => each.id === name);
    const path = trashPath(this.folder, name);
    const text = path ? await readFile(path, 'utf8').catch(() => null) : null;
    if (!item || text === null) return null;
    const document = parseDocument(text);
    const label = (task: TaskNode): string => taskLabel(titlePlain(task.line.title.trim()), '');
    if (item.kind === 'task') {
      const task = document.blocks.find((block): block is TaskNode => block.kind === 'task');
      return {
        ...item,
        body: task ? getBody(task) : '',
        tasks: (task ? [...allTasks({ ...document, blocks: [task] })] : [])
          .filter(({ parent }) => parent)
          .map(({ task: sub }) => ({
            title: label(sub),
            done: sub.line.status !== ' ',
            sub: true,
          })),
      };
    }
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    if (item.kind === 'note') return { ...item, body, tasks: [] };
    return {
      ...item,
      body: '',
      tasks: [...allTasks(document)].map(({ task, parent }) => ({
        title: label(task),
        done: task.line.status !== ' ',
        sub: parent !== null,
      })),
    };
  }

  /**
   * DATA-02, D-97: restores something from the trash, one undo step: a task to the top of its list
   * (Inbox if that list is gone), a list or note to the Flint folder under its name ("(restored)"
   * added if that name is taken). Its label, or null when it can't be.
   */
  restoreFromTrash(name: string, now: Date): Promise<RestoredItem | null> {
    return this.serial(async () => {
      const path = trashPath(this.folder, name);
      const text = path ? await readFile(path, 'utf8').catch(() => null) : null;
      if (!path || text === null) return null;
      if (/^trashed:/m.test(text)) {
        const task = parseDocument(text).blocks.find(
          (block): block is TaskNode => block.kind === 'task',
        );
        const listId = /^list:\s*(\S+)\s*$/m.exec(text)?.[1];
        const home = listId ? this.find(listId) : undefined;
        const list =
          home && home.entry.mode !== 'note' && !home.file.readOnly ? home : this.find(INBOX_ID);
        if (!task || !list || list.file.readOnly || findTask(list.file.document, task.key))
          return null;
        const where = list.entry.id === INBOX_ID ? 'Inbox' : list.entry.name;
        const label = `Restored to ${where}`;
        await this.record(
          list,
          {
            type: 'insert',
            list: list.file.path,
            task: { ...task, eol: '\n' },
            where: { at: 'top' },
          },
          label,
          now,
          { restored: { path, text } },
        );
        await unlink(path).catch(() => undefined);
        return { label, listId: this.listId(list.entry), listName: where, key: task.key };
      }
      const original = trashedListName(name);
      let target = join(this.folder, `${original}.md`);
      for (
        let count = 1;
        await stat(target).then(
          () => true,
          () => false,
        );
        count++
      )
        target = join(this.folder, `${original} (restored${count > 1 ? ` ${count}` : ''}).md`);
      const label = `Restored ${basename(target, '.md')}`;
      const step = (from: string, to: string): UndoEntry => ({
        label,
        run: async () => {
          const there = await stat(from).then(
            () => true,
            () => false,
          );
          if (!there) return null;
          await rename(from, to);
          await this.refresh(to);
          await this.refresh(from);
          return step(to, from);
        },
      });
      await rename(path, target);
      await this.refresh(target);
      this.remember(step(target, path));
      const restored = this.lists.find(({ entry }) => entry.path === target);
      return restored
        ? {
            label,
            listId: this.listId(restored.entry),
            listName: restored.entry.name,
            key: null,
          }
        : null;
    });
  }

  /**
   * DATA-04, D-97: everything read again from disk (after "Restore everything"): the lists, the
   * sidebar's file, Today's order, task metadata and the IDs in the trash.
   */
  private async reloadAll(): Promise<void> {
    await this.refresh(join(this.folder, '.none'));
    for (const list of this.lists) await list.file.reload();
    this.sidebarFile = readSidebar(await readFile(this.sidebarPath, 'utf8').catch(() => null));
    await this.meta.load();
    await this.today.load();
    await this.focus.load();
    this.trashed.clear();
    for (const id of await trashedIds(this.folder)) this.trashed.add(id);
  }

  /** DATA-04, D-97: the snapshots, newest first, each with how many lists or notes differ from now. */
  async snapshots(store: SnapshotStore): Promise<SnapshotSummary[]> {
    const now = await store.current();
    return (await store.list()).map((snapshot) => ({
      id: snapshot.id,
      at: formatLocalDateTime(fromDate(snapshot.at)).slice(0, 16),
      differs: Object.entries(snapshot.files).filter(
        ([path, hash]) => isListPath(path) && now[path] !== hash,
      ).length,
    }));
  }

  /** DATA-04, D-97: a snapshot's lists and notes (the folder's top level), against now. */
  async snapshotFiles(store: SnapshotStore, id: string): Promise<SnapshotFile[]> {
    const snapshot = (await store.list()).find((each) => each.id === id);
    if (!snapshot) return [];
    const now = await store.current();
    const files: SnapshotFile[] = [];
    for (const [path, hash] of Object.entries(snapshot.files)) {
      if (!isListPath(path)) continue;
      const text = (await store.content(hash))?.toString('utf8') ?? '';
      files.push({
        path,
        name: path.slice(0, -3),
        kind: /^mode:\s*note\s*$/m.test(text) ? 'note' : 'list',
        state: now[path] === undefined ? 'deleted' : now[path] === hash ? 'same' : 'changed',
      });
    }
    const rank = { changed: 0, deleted: 1, same: 2 } as const;
    return files.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
  }

  /**
   * DATA-04, D-97: a snapshot restored: one list or note (`path`), or everything (null). A fresh
   * snapshot of how things are is taken first; one undo step puts them back. A restored list's
   * pictures and files that are gone come back too. Its label, or null.
   */
  restoreSnapshot(
    store: SnapshotStore,
    id: string,
    path: string | null,
    now: Date,
  ): Promise<string | null> {
    return this.serial(async () => {
      const snapshot = (await store.list()).find((each) => each.id === id);
      if (!snapshot || (path !== null && snapshot.files[path] === undefined)) return null;
      const safety = await store.take(now, true);
      if (!safety) return null;
      const label =
        path === null ? 'Restored the whole Flint folder' : `Restored ${path.slice(0, -3)}`;
      const apply = async (files: Readonly<Record<string, string>>, only: string | null) => {
        const current = await store.current();
        const wanted = only === null ? files : pick(files, only);
        for (const [file, hash] of Object.entries(wanted)) {
          if (current[file] === hash) continue;
          const content = await store.content(hash);
          if (!content) continue;
          const target = join(this.folder, ...file.split('/'));
          await mkdir(dirname(target), { recursive: true });
          await writeFileAtomic(target, content, { tempDirectory: this.folderTemp });
        }
        if (only === null) {
          for (const file of Object.keys(current))
            if (files[file] === undefined)
              await unlink(join(this.folder, ...file.split('/'))).catch(() => undefined);
          await this.reloadAll();
        } else if (files[only] === undefined) {
          // Undoing the restore of a list that didn't exist before: it goes again.
          await unlink(join(this.folder, ...only.split('/'))).catch(() => undefined);
          await this.refresh(join(this.folder, ...only.split('/')));
        } else await this.refresh(join(this.folder, ...only.split('/')));
      };
      /** One restored list's attachments that are gone now (named in its text). */
      const pick = (
        files: Readonly<Record<string, string>>,
        only: string,
      ): Record<string, string> => {
        const chosen: Record<string, string> = {};
        const hash = files[only];
        if (hash) chosen[only] = hash;
        return chosen;
      };
      const text = path
        ? ((await store.content(snapshot.files[path] ?? ''))?.toString('utf8') ?? '')
        : '';
      const current = await store.current();
      const attachments = Object.entries(snapshot.files).filter(
        ([file]) =>
          path !== null &&
          file.startsWith('attachments/') &&
          current[file] === undefined &&
          (text.includes(file.slice(12)) || text.includes(encodeURIComponent(file.slice(12)))),
      );
      for (const [file, hash] of attachments) {
        const content = await store.content(hash);
        if (!content) continue;
        const target = join(this.folder, ...file.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await writeFileAtomic(target, content, { tempDirectory: this.folderTemp });
      }
      await apply(snapshot.files, path);
      const step = (
        from: Readonly<Record<string, string>>,
        to: Readonly<Record<string, string>>,
      ): UndoEntry => ({
        label,
        run: async () => {
          await apply(to, path);
          return step(to, from);
        },
      });
      this.remember(step(snapshot.files, safety.files));
      return label;
    });
  }

  /**
   * D-99: a list or note in a snapshot against now: a task list by task ID (added, deleted,
   * changed, and what changed), a note line by line, one deleted since as it was.
   */
  async snapshotDiff(store: SnapshotStore, id: string, path: string): Promise<SnapshotDiff | null> {
    const snapshot = (await store.list()).find((each) => each.id === id);
    const hash = snapshot?.files[path];
    if (!hash || !isListPath(path)) return null;
    const text = (await store.content(hash))?.toString('utf8') ?? '';
    const name = path.slice(0, -3);
    const then = parseDocument(text);
    const list = this.lists.find(
      ({ entry }) => entry.path.toLowerCase() === join(this.folder, path).toLowerCase(),
    );
    const label = (task: TaskNode): string =>
      taskLabel(titlePlain(task.line.title.trim()), getBody(task));
    const mode = documentMode(then) === 'note' ? 'note' : 'list';
    if (!list) {
      return {
        kind: 'deleted',
        name,
        mode,
        text: mode === 'note' ? text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : '',
        tasks:
          mode === 'list'
            ? [...allTasks(then)].map(({ task, parent }) => ({
                title: label(task),
                done: task.line.status !== ' ',
                sub: parent !== null,
              }))
            : [],
      };
    }
    if (mode === 'note') {
      const strip = (value: string): string[] =>
        value
          .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
          .replace(/\n$/, '')
          .split(/\r?\n/);
      return {
        kind: 'note',
        name,
        lines: lineDiff(strip(text), strip(serializeDocument(list.file.document))),
      };
    }
    const top = (document: typeof then): Map<string, TaskNode> =>
      new Map(
        document.blocks.flatMap((block): [string, TaskNode][] =>
          block.kind === 'task' ? [[block.key, block]] : [],
        ),
      );
    const before = top(then);
    const now = top(list.file.document);
    const tasks: SnapshotTaskDiff[] = [];
    for (const [key, task] of before) {
      const current = now.get(key);
      if (!current) {
        tasks.push({ key, state: 'deleted', title: label(task), changes: [] });
        continue;
      }
      const changes = taskChanges(task, current, then, list.file.document);
      if (changes.length > 0) tasks.push({ key, state: 'changed', title: label(task), changes });
    }
    for (const [key, task] of now)
      if (!before.has(key)) tasks.push({ key, state: 'added', title: label(task), changes: [] });
    return { kind: 'list', name, tasks };
  }

  /**
   * D-99: chosen tasks of a list as they were in a snapshot: a deleted one back where it was
   * (after the nearest earlier task that is still there), a changed one replaced in place, one
   * added since removed. A fresh snapshot first; one undo step. Its label, or null.
   */
  restoreSnapshotTasks(
    store: SnapshotStore,
    id: string,
    path: string,
    keys: readonly string[],
    now: Date,
  ): Promise<string | null> {
    return this.serial(async () => {
      const snapshot = (await store.list()).find((each) => each.id === id);
      const hash = snapshot?.files[path];
      const list = this.lists.find(
        ({ entry }) => entry.path.toLowerCase() === join(this.folder, path).toLowerCase(),
      );
      if (!hash || !list || list.file.readOnly || keys.length === 0) return null;
      const then = parseDocument((await store.content(hash))?.toString('utf8') ?? '');
      const order = then.blocks.flatMap((block) => (block.kind === 'task' ? [block] : []));
      if (!(await store.take(now, true))) return null;
      const target = list.file.path;
      let documents: ReadonlyMap<string, typeof list.file.document> = new Map([
        [target, list.file.document],
      ]);
      const run = (op: Op | null): void => {
        const next = op ? applyOp(documents, op) : null;
        if (next) documents = next.documents;
      };
      const topKeys = (): string[] =>
        (documents.get(target)?.blocks ?? []).flatMap((block) =>
          block.kind === 'task' ? [block.key] : [],
        );
      for (const key of keys) {
        const was = order.find((task) => task.key === key);
        const keysNow = topKeys();
        const at = keysNow.indexOf(key);
        if (!was) {
          if (at >= 0) run(deleteTask(target, key));
          continue;
        }
        let where: Where = { at: 'top' };
        if (at >= 0) {
          // Changed: replaced in its place.
          const previous = keysNow[at - 1];
          const next = keysNow[at + 1];
          run(deleteTask(target, key));
          where = previous
            ? { at: 'after', key: previous }
            : next
              ? { at: 'before', key: next }
              : { at: 'top' };
        } else {
          // Deleted: after the nearest earlier task that is still there, else before the next one.
          const index = order.indexOf(was);
          const earlier = order
            .slice(0, index)
            .reverse()
            .find((task) => keysNow.includes(task.key));
          const later = order.slice(index + 1).find((task) => keysNow.includes(task.key));
          if (earlier) where = { at: 'after', key: earlier.key };
          else if (later) where = { at: 'before', key: later.key };
        }
        run({ type: 'insert', list: target, task: { ...was, eol: '\n' }, where });
      }
      const document = documents.get(target);
      if (!document) return null;
      const name = path.slice(0, -3);
      const label = `Restored ${keys.length === 1 ? '1 task' : `${keys.length} tasks`} in ${name}`;
      await this.record(
        list,
        { type: 'setText', list: target, text: serializeDocument(document) },
        label,
        now,
      );
      return label;
    });
  }

  /** TODAY-02, D-100: whether "Unfinished from yesterday" is asked (Settings). */
  rolloverPrompt = true;

  /** D-97: Delete now (gone for good, not undoable); true when it was there. */
  deleteFromTrash(name: string): Promise<boolean> {
    return this.serial(() => removeFromTrash(this.folder, name));
  }

  /** D-97: Empty Trash; how many went. */
  emptyTrash(): Promise<number> {
    return this.serial(async () => {
      let count = 0;
      for (const entry of await readTrash(this.folder))
        if (await removeFromTrash(this.folder, entry.name)) count++;
      return count;
    });
  }

  /**
   * DATA-02, MEDIA-04, D-97: what has been in the trash over 30 days goes for good (at start-up
   * and each day change); at start-up (`orphans`), attachments nothing mentions go too.
   */
  expireTrash(now: Date, orphans: boolean): Promise<{ expired: number; orphans: string[] }> {
    return this.serial(async () => {
      const expired = await expireTrash(this.folder, now);
      return { expired, orphans: orphans ? await cleanOrphanAttachments(this.folder, now) : [] };
    });
  }

  /**
   * TASK-06, D-97: an archived task back in its list (Inbox if that list is gone), still completed;
   * one undo step, which puts it back in the archive.
   */
  restoreArchived(listId: string, key: string, now: Date): Promise<string | null> {
    return this.serial(async () => {
      const path = join(this.folder, '.flint', 'archive', `${listId}.md`);
      if (basename(listId) !== listId) return null;
      const home = this.find(listId);
      const list =
        home && home.entry.mode !== 'note' && !home.file.readOnly ? home : this.find(INBOX_ID);
      if (!list) return null;
      const where = list.entry.id === INBOX_ID ? 'Inbox' : list.entry.name;
      const label = `Restored to ${where}`;
      const step = (toList: boolean): UndoEntry => ({
        label,
        run: async (at) =>
          (await this.shuttle(list, path, key, toList, at)) ? step(!toList) : null,
      });
      if (!(await this.shuttle(list, path, key, true, now))) return null;
      this.remember(step(false));
      return label;
    });
  }

  /** D-97: a task moved between a list and an archive file; the copy is written before the removal. */
  private async shuttle(
    list: Loaded,
    archivePath: string,
    key: string,
    toList: boolean,
    now: Date,
  ): Promise<boolean> {
    if (!this.lists.includes(list) || list.file.readOnly) return false;
    const archive = await ListFile.open(archivePath).catch(() => null);
    if (!archive || archive.readOnly) return false;
    const [from, to] = toList ? [archivePath, list.file.path] : [list.file.path, archivePath];
    const op = moveTasksToList(
      new Map([
        [list.file.path, list.file.document],
        [archivePath, archive.document],
      ]),
      from,
      [key],
      to,
    );
    if (op?.type !== 'batch') return false;
    const onto = (target: string): Op | null =>
      bulk(op.ops.filter((part) => 'list' in part && part.list === target));
    const inserted = onto(to);
    const removed = onto(from);
    if (!inserted || !removed) return false;
    if (toList) {
      await this.applyAndSave(list, inserted, now);
      if (!archive.apply(removed)) return false;
      await archive.save({ now: fromDate(now), isTaken: this.isTaken });
    } else {
      if (!archive.apply(inserted)) return false;
      await archive.save({ now: fromDate(now), isTaken: this.isTaken });
      await this.applyAndSave(list, removed, now);
    }
    return true;
  }

  /** The list holding a task; task IDs are unique in the Flint folder (D-21, D-29). */
  locate(taskId: string): { readonly listId: string; readonly key: string } | null {
    for (const { entry, file } of this.lists)
      if (findTask(file.document, taskId)) return { listId: this.listId(entry), key: taskId };
    return null;
  }

  /** A reminder's Done (REM-05): completes the task if it is still open; undoable. */
  completeById(taskId: string, now: Date): Promise<string | null> {
    const found = this.locate(taskId);
    const list = found ? this.find(found.listId) : undefined;
    const task = list ? findTask(list.file.document, taskId) : undefined;
    if (!found || !task || task.task.line.status !== ' ') return Promise.resolve(null);
    return this.toggleDone(found.listId, taskId, now);
  }

  /** A reminder's Snooze 10m (REM-05): the reminder moves to 10 minutes from now; undoable. */
  snoozeById(taskId: string, now: Date): Promise<string | null> {
    return this.serial(async () => {
      const found = this.locate(taskId);
      const list = found ? this.find(found.listId) : undefined;
      if (!found || !list) return null;
      // Reminders are whole minutes: round up, so a snooze is never shorter than 10 minutes.
      const at = fromDate(new Date(Math.ceil((now.getTime() + SNOOZE_MS) / 60_000) * 60_000));
      return this.record(list, setReminder(list.file.path, taskId, at), 'Snoozed', now);
    });
  }

  /** Space or the checkbox (TASK-06): completes an open task, reopens a completed one. */
  toggleDone(id: string, key: string, now: Date): Promise<string | null> {
    return this.serial(() => this.toggleNow(id, key, now));
  }

  private async toggleNow(id: string, key: string, now: Date): Promise<string | null> {
    // M6: in Today (and Focus, FOCUS-02), the task's home list.
    if (id === TODAY_ID || id === FOCUS_ID) {
      const home = this.locate(key);
      return home ? this.toggleNow(home.listId, key, now) : null;
    }
    const list = this.find(id);
    const found = list ? findTask(list.file.document, key) : undefined;
    if (!list || !found) return null;
    const document = list.file.document;
    const path = list.file.path;
    const done = found.task.line.status !== ' ';
    if (!done) {
      const completion = completeTask(document, path, key, fromDate(now));
      if (!completion) return null;
      this.completedAfter.set(`${path}:${key}`, completion.completedAfter);
      return this.record(list, completion.op, 'Completed', now);
    }
    const op = uncompleteTask(
      document,
      path,
      key,
      (task) => this.completedAfter.get(`${path}:${task}`) ?? null,
    );
    return op ? this.record(list, op, 'Reopened', now) : null;
  }

  /** Undoes the newest change made in the main window; resolves to what was undone. */
  undoLast(now: Date): Promise<string | null> {
    return this.serial(() => this.step(this.undoStack, this.redoStack, now));
  }

  /** Ctrl+Shift+Z / Ctrl+Y: redoes the newest undone change. */
  redoLast(now: Date): Promise<string | null> {
    return this.serial(() => this.step(this.redoStack, this.undoStack, now));
  }

  /**
   * AGENT-01 (D-185): an AI agent's request as one exclusive run. Its changes never go on the
   * window's undo stack (Q5): the run says what it did as data (`AgentStep`s) for Recent agent
   * changes instead. A failure part-way still reports what was done, so it can be undone.
   */
  agentRun<T>(
    agent: string,
    work: () => Promise<T>,
    /** AGENT-06 (security review H1): which lists the agent may see. */
    visible?: (listId: string) => boolean,
  ): Promise<AgentRunOutcome<T>> {
    return this.serial(async () => {
      const run: Exclusive = { agent, applied: [], ...(visible && { visible }) };
      const undoStart = this.undoStack.length;
      const redo = [...this.redoStack];
      const before = await this.agentSnapshot();
      let result: T | undefined;
      let error: unknown;
      try {
        result = await this.exclusive.run(run, work);
      } catch (caught) {
        error = caught;
      } finally {
        this.undoStack.splice(undoStart);
        this.redoStack.splice(0, this.redoStack.length, ...redo);
      }
      const after = await this.agentSnapshot();
      return {
        ...(error === undefined ? { result: result as T } : { error }),
        ...this.agentSteps(before, after, run.applied),
      };
    });
  }

  private async agentSnapshot(): Promise<AgentSnapshot> {
    return {
      lists: new Map(
        this.lists.map((list) => [
          this.listId(list.entry),
          {
            name: list.entry.name,
            path: list.entry.path,
            text: serializeDocument(list.file.document),
          },
        ]),
      ),
      sidebar: writeSidebar(this.sidebarFile),
      trash: new Set(await readdir(trashFolder(this.folder)).catch(() => [])),
    };
  }

  private agentSteps(
    before: AgentSnapshot,
    after: AgentSnapshot,
    applied: Exclusive['applied'],
  ): Pick<AgentRunOutcome<unknown>, 'steps' | 'keys' | 'lists'> {
    const steps: AgentStep[] = [];
    const created = [...after.lists.keys()].filter((id) => !before.lists.has(id));
    const createdPaths = new Set(created.map((id) => after.lists.get(id)?.path));
    const keys = new Set<string>();
    const changedLists = new Set<string>();
    const texts = new Map<string, { before: string }>();
    for (const part of applied) {
      const list = this.lists.find(({ entry }) => entry.path === part.path);
      if (list) changedLists.add(this.listId(list.entry));
      for (const key of opKeys(part.inverse)) keys.add(key);
      if (createdPaths.has(part.path)) continue;
      if (part.inverse.type === 'setText') {
        if (!texts.has(part.path)) texts.set(part.path, { before: part.inverse.text });
        continue;
      }
      const document = list?.file.document;
      const fingerprints = Object.fromEntries(
        opKeys(part.inverse).map((key) => [key, document ? taskFingerprint(document, key) : null]),
      );
      steps.push({ kind: 'ops', path: part.path, inverse: part.inverse, after: fingerprints });
    }
    for (const [path, text] of texts) {
      const list = this.lists.find(({ entry }) => entry.path === path);
      if (list)
        steps.push({
          kind: 'text',
          path,
          before: text.before,
          after: serializeDocument(list.file.document),
        });
    }
    for (const id of created) {
      const list = after.lists.get(id);
      if (list) steps.push({ kind: 'created', listId: id, text: list.text });
      changedLists.add(id);
    }
    const newTrash = [...after.trash].filter((name) => !before.trash.has(name));
    for (const [id, list] of before.lists) {
      const now = after.lists.get(id);
      if (!now) {
        const trash = newTrash.find((name) => name.endsWith(`-${basename(list.path)}`));
        if (trash) steps.push({ kind: 'deletedList', trash });
      } else if (now.name !== list.name) {
        steps.push({ kind: 'renamed', listId: id, from: list.name, to: now.name });
        changedLists.add(id);
      }
    }
    for (const trash of newTrash) {
      if (!steps.some((step) => step.kind === 'deletedList' && step.trash === trash))
        steps.push({ kind: 'taskTrash', trash });
    }
    if (after.sidebar !== before.sidebar)
      steps.push({ kind: 'sidebar', before: before.sidebar, after: after.sidebar });
    return { steps, keys: [...keys], lists: [...changedLists] };
  }

  /**
   * AGENT-07 (D-185 Q5): the user undoes an agent's change. Out of order, never over a later
   * change: tasks changed since are skipped, a text is merged, a list made is trashed only if
   * unchanged. It is the user's own action: one step on the window's undo stack (Ctrl+Z redoes it).
   */
  undoAgentSteps(
    steps: readonly AgentStep[],
    label: string,
    now: Date,
  ): Promise<{ readonly undone: number; readonly skipped: number }> {
    return this.serial(() =>
      this.exclusive.run({ agent: null, applied: [] }, async () => {
        const start = this.undoStack.length;
        let undone = 0;
        let skipped = 0;
        // Newest first; a deleted task's Trash file goes last, once its task is back.
        const ordered = [...steps]
          .reverse()
          .sort((a, b) => Number(a.kind === 'taskTrash') - Number(b.kind === 'taskTrash'));
        for (const step of ordered) {
          const outcome = await this.undoAgentStep(step, label, now).catch(
            () => 'skipped' as const,
          );
          if (outcome === 'undone') undone += 1;
          else if (outcome === 'skipped') skipped += 1;
        }
        this.mergeSince(start, `Undid ${label}`);
        return { undone, skipped };
      }),
    );
  }

  private async undoAgentStep(
    step: AgentStep,
    label: string,
    now: Date,
  ): Promise<'undone' | 'skipped' | 'nothing'> {
    switch (step.kind) {
      case 'ops': {
        const list = this.lists.find(({ entry }) => entry.path === step.path);
        if (!list || list.file.readOnly) return 'skipped';
        const plan = planInverse(list.file.document, step.inverse, step.after);
        if (plan.op) await this.record(list, plan.op, label, now);
        if (plan.skipped.length > 0) return 'skipped';
        return plan.op ? 'undone' : 'nothing';
      }
      case 'text': {
        const list = this.lists.find(({ entry }) => entry.path === step.path);
        if (!list || list.file.readOnly) return 'skipped';
        const text = planText(step.before, step.after, serializeDocument(list.file.document));
        if (text === null) return 'skipped';
        await this.record(list, { type: 'setText', list: list.file.path, text }, label, now);
        return 'undone';
      }
      case 'created': {
        const list = this.find(step.listId);
        if (!list) return 'nothing';
        if (serializeDocument(list.file.document) !== step.text) return 'skipped';
        const outcome = await this.deleteList(step.listId, now);
        return outcome.ok ? 'undone' : 'skipped';
      }
      case 'deletedList':
        return (await this.restoreFromTrash(step.trash, now)) ? 'undone' : 'skipped';
      case 'renamed': {
        const list = this.find(step.listId);
        if (!list || list.entry.name !== step.to) return 'skipped';
        return (await this.renameList(step.listId, step.from, now)).ok ? 'undone' : 'skipped';
      }
      case 'sidebar': {
        if (writeSidebar(this.sidebarFile) !== step.after) return 'skipped';
        const previous = this.sidebarFile;
        const restored = readSidebar(step.before);
        await this.saveSidebar(restored);
        this.remember(this.sidebarStep(label, previous, restored));
        return 'undone';
      }
      case 'taskTrash': {
        const path = trashPath(this.folder, step.trash);
        const text = path ? await readFile(path, 'utf8').catch(() => null) : null;
        if (!path || text === null) return 'nothing';
        const keys = [...allTasks(parseDocument(text))].map(({ task }) => task.key);
        const back = keys.every((key) => this.locate(key) !== null);
        if (back) await unlink(path).catch(() => undefined);
        return 'nothing';
      }
    }
  }

  private async step(from: UndoEntry[], to: UndoEntry[], now: Date): Promise<string | null> {
    const entry = from.pop();
    // A list deleted since (an undone new list, or by another program) can't be redone into.
    const opposite = entry ? await entry.run(now) : null;
    if (!entry || !opposite) return null;
    to.push(opposite);
    return entry.label;
  }

  private async refresh(path: string): Promise<void> {
    const entries = await discoverLists(this.folder);
    for (const loaded of [...this.lists]) {
      const entry = entries.find((candidate) => candidate.path === loaded.entry.path);
      // D-156: a known list whose file couldn't be read just then (held by another program, or
      // empty while one writes it) keeps its ID and mode: taking the unread entry's turned it into
      // another list (`file:<name>`) until the next read, and the window, asking for it by its ID,
      // got nothing and showed a blank page.
      if (entry)
        loaded.entry = entry.unsettled
          ? {
              path: entry.path,
              name: entry.name,
              created: entry.created,
              id: loaded.entry.id,
              mode: loaded.entry.mode,
            }
          : entry;
      else this.lists.splice(this.lists.indexOf(loaded), 1);
    }
    for (const entry of entries) {
      if (!this.lists.some((loaded) => loaded.entry.path === entry.path)) {
        this.lists.push({ entry, file: await ListFile.open(entry.path) });
      }
    }
    await this.lists.find((loaded) => loaded.entry.path === path)?.file.reload();
  }

  private get recent(): string[] {
    const value = this.uiState.recentLists;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  }

  private listId(entry: ListEntry): string {
    return entry.id ?? `file:${entry.name}`;
  }

  /** Lists as the shorthand sees them, Inbox first, with their most-recently-used rank. */
  /** D-105: every list's and note's text, for counting what a link pattern would match. */
  texts(): string[] {
    return this.lists.map((list) => serializeDocument(list.file.document));
  }

  /** The lists shorthand's ##list may name: in an agent's run, only those it may see (AGENT-06). */
  private shorthandLists(): ListInfo[] {
    const visible = this.exclusive.getStore()?.visible;
    const all = this.listInfos();
    return visible ? all.filter((info) => visible(info.id)) : all;
  }

  listInfos(): ListInfo[] {
    const recent = this.recent;
    const infos = this.lists.map(({ entry }) => {
      const id = this.listId(entry);
      const rank = recent.indexOf(id);
      return {
        id,
        name: entry.id === INBOX_ID ? 'Inbox' : entry.name,
        mode: entry.mode === 'note' ? 'note' : 'tasks',
        ...(rank >= 0 ? { recentRank: rank } : {}),
      } satisfies ListInfo;
    });
    return infos.sort((a, b) => Number(b.id === INBOX_ID) - Number(a.id === INBOX_ID));
  }

  /**
   * IDs handed out ahead for the main window's new rows: the row knows its task's ID when Enter is
   * pressed, so the next row can go below it before the save has finished (docs/03 §2).
   */
  private readonly reserved = new Set<string>();

  reserveId(): string {
    const id = generateId(this.isTaken);
    this.reserved.add(id);
    return id;
  }

  /** IDs are unique in the whole Flint folder (D-21, D-29): tasks and lists. */
  isTaken = (id: string): boolean =>
    this.reserved.has(id) ||
    this.trashed.has(id) ||
    this.lists.some(
      ({ entry, file }) =>
        entry.id === id ||
        [...allTasks(file.document)].some(({ task }) => task.line.fields.id?.value === id),
    );

  /** Parses what was typed, as the popup's chips show it (CAP-04). */
  parse(request: CaptureRequest, now: Date): CaptureParse {
    return parseCapture(request.text, {
      now,
      lists: this.listInfos(),
      chooseNewList: request.chooseNewList,
    });
  }

  /**
   * SYNC-01, D-161: the lists and notes Google Drive sync may carry: those with a Flint ID (a file
   * without Flint's header gets one when it is next edited in Flint, D-23), with their file, group
   * and whether they are an empty quick note (never uploaded, D-161 Q9).
   */
  syncEntries(): {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly mode: ListMode;
    readonly group: string | null;
    readonly emptyQuick: boolean;
  }[] {
    const groups = arrange(this.sidebarFile, this.sidebarLists(), 'manual');
    return this.lists
      .filter(({ entry }) => entry.id !== null && !this.listId(entry).startsWith('file:'))
      .map((loaded) => {
        const id = this.listId(loaded.entry);
        const group = groups.find((item) => item.kind === 'group' && item.lists.includes(id));
        const text = serializeDocument(loaded.file.document).replace(
          /^---\r?\n[\s\S]*?\r?\n---\r?\n/,
          '',
        );
        return {
          id,
          name: id === INBOX_ID ? 'Inbox' : loaded.entry.name,
          path: loaded.file.path,
          mode: loaded.entry.mode === 'note' ? ('note' as const) : ('tasks' as const),
          group: group?.id ?? null,
          emptyQuick: this.isQuick(loaded) && text.trim() === '',
        };
      });
  }

  /** SYNC-01: the sidebar's groups (ID, name, lists in order). */
  syncGroups(): { readonly id: string; readonly name: string; readonly lists: string[] }[] {
    return arrange(this.sidebarFile, this.sidebarLists(), 'manual').flatMap((item) =>
      item.kind === 'group' ? [{ id: item.id, name: item.name, lists: [...item.lists] }] : [],
    );
  }

  /**
   * SYNC-01, D-161 Q3: synced groups made so here: created (at the end of Lists), renamed, their
   * lists set (lists that left a group stay ungrouped in its place); `removed` groups go, their
   * lists staying. Not undoable: it is another PC's change, as an edit from outside Flint is.
   */
  applySyncGroups(
    groups: readonly {
      readonly id: string;
      readonly name: string;
      readonly lists: readonly string[];
    }[],
    removed: readonly string[],
  ): Promise<void> {
    // D-183: the sidebar as it was tells no one (a sync run would answer it with another run).
    const run = this.serial(async () => {
      let items = arrange(this.sidebarFile, this.sidebarLists(), 'manual');
      for (const id of removed) items = deleteGroup(items, id);
      const known = new Set(this.syncEntries().map((entry) => entry.id));
      for (const group of groups) {
        const exists = items.some((item) => item.kind === 'group' && item.id === group.id);
        if (!exists)
          items = [...items, { kind: 'group', id: group.id, name: group.name, lists: [] }];
        else items = renameGroup(items, group.id, group.name);
        const current = items.find((item) => item.kind === 'group' && item.id === group.id);
        const had = current?.kind === 'group' ? current.lists : [];
        for (const list of had) {
          if (group.lists.includes(list)) continue;
          const index = items.findIndex((item) => item.kind === 'group' && item.id === group.id);
          items = moveInSidebar(items, list, { group: null, index: index + 1 });
        }
        group.lists
          .filter((list) => known.has(list))
          .forEach((list, index) => {
            items = moveInSidebar(items, list, { group: group.id, index });
          });
      }
      const after = fromItems(items, this.sidebarFile.extra);
      if (writeSidebar(after) === writeSidebar(this.sidebarFile)) return false;
      await this.saveSidebar(after);
      return true;
    }, Boolean);
    return run.then(() => undefined);
  }

  /** SYNC-01: sync wrote or removed a file in the folder; read it now (DATA-06), as the watcher would. */
  syncWritten(path: string): Promise<void> {
    return this.fileChanged(path);
  }

  /** SYNC-01: the task IDs of a list, for the times sync carries (D-161 Q3). */
  syncTaskIds(id: string): string[] {
    const list = this.find(id);
    return list ? [...allTasks(list.file.document)].map(({ task }) => task.key) : [];
  }

  /** SYNC-01: a list's file, by ID. */
  syncPath(id: string): string | null {
    return this.find(id)?.file.path ?? null;
  }

  private find(id: string): Loaded | undefined {
    return this.lists.find(({ entry }) => this.listId(entry) === id);
  }

  private get inbox(): Loaded {
    const inbox = this.find(INBOX_ID);
    if (!inbox) throw new Error('the Flint folder has no Inbox');
    return inbox;
  }

  /** Saves a capture (D-27): resolves when it is durably on disk; throws if it can't be written. */
  capture(request: CaptureRequest, now: Date): Promise<CaptureOutcome> {
    return this.serial(() => this.save(request, now));
  }

  private async save(request: CaptureRequest, now: Date): Promise<CaptureOutcome> {
    const parsed = this.parse(request, now);
    const attachments = request.attachments ?? [];
    if (parsed.title.trim() === '' && parsed.body.trim() === '' && attachments.length === 0)
      return { kind: 'empty' };
    // D-45: an untitled capture (code, or only an image) keeps an empty task line; nothing is
    // generated for the file. Short labels are made when the task is shown (`taskLabel`).
    const title = parsed.title;

    let target: Loaded;
    let createdList: CreatedList | null = null;
    const id = generateId(this.isTaken);
    if (parsed.target.kind === 'new') {
      target = await this.createList(parsed.target.name);
      createdList = { path: target.entry.path, name: target.entry.name, taskId: id };
    } else if (parsed.target.kind === 'existing' || parsed.target.kind === 'close-match') {
      target = this.find(parsed.target.list.id) ?? this.inbox;
    } else {
      // Inbox; notes and unusable names never win a `##` token, so they land here too.
      target = this.inbox;
    }

    // MEDIA-02: images go to `attachments/` and are linked relatively, so the folder can move.
    const links: string[] = [];
    if (attachments.length > 0) {
      await mkdir(join(this.folder, 'attachments'), { recursive: true });
      for (const [index, attachment] of attachments.entries()) {
        const name = `${stamp(now)}-${id}${index > 0 ? `-${index + 1}` : ''}.${attachment.extension}`;
        await copyFile(attachment.file, join(this.folder, 'attachments', name));
        links.push(`![](attachments/${name})`);
      }
    }
    const body = [parsed.body.trim() !== '' ? parsed.body : '', ...links]
      .filter((part) => part !== '')
      .join('\n');

    const op = addTask(target.file.document, target.file.path, {
      id,
      title,
      ...(body !== '' ? { body } : {}),
      priority: parsed.priority,
      reminder: parsed.reminder,
    });
    await this.applyAndSave(target, op, now);
    // D-85: for the panel's Recently captured.
    this.meta.captured(id, now);
    if (target.entry.id !== INBOX_ID) await this.markRecent(this.listId(target.entry));
    return {
      kind: 'saved',
      listName: target.entry.id === INBOX_ID ? 'Inbox' : target.entry.name,
      taskId: id,
      createdList,
    };
  }

  /** `Created list <name> · Undo` (CAP-05): the task moves to Inbox; the list goes if still empty. */
  undoCreatedList(created: CreatedList, now: Date): Promise<void> {
    return this.serial(() => this.undo(created, now));
  }

  private async undo(created: CreatedList, now: Date): Promise<void> {
    const list = this.lists.find(({ entry }) => entry.path === created.path);
    const task = list ? findTask(list.file.document, created.taskId)?.task : undefined;
    if (!list || !task) return;
    await this.applyAndSave(
      this.inbox,
      { type: 'insert', list: this.inbox.file.path, task, where: { at: 'top' } },
      now,
    );
    await this.applyAndSave(list, deleteTask(list.file.path, created.taskId), now);
    await this.dropIfEmpty(list);
  }

  /** Only a list that is exactly what a capture created is removed; anything added since stays. */
  private async dropIfEmpty(list: Loaded): Promise<void> {
    const id = list.entry.id ?? '';
    await this.dropIfUnchanged(
      list,
      NEW_LIST_HEADER(id, list.entry.mode === 'note' ? 'note' : 'tasks'),
    );
  }

  /** Removes a list Flint made (a new list, a duplicate) if it is still exactly as made. */
  private async dropIfUnchanged(list: Loaded, text: string): Promise<void> {
    if (serializeDocument(list.file.document) !== text) return;
    await unlink(list.file.path);
    this.lists.splice(this.lists.indexOf(list), 1);
    await this.forgetRecent(list.entry.id ?? '');
  }

  private async applyAndSave(list: Loaded, op: Op, now: Date): Promise<Applied> {
    if (list.file.readOnly)
      throw new Error(`${list.entry.name} can't be edited (${list.file.readOnly})`);
    const applied = list.file.apply(op);
    if (!applied) throw new Error(`could not change ${list.entry.name}`);
    await list.file.save({ now: fromDate(now), isTaken: this.isTaken });
    // docs/04 §3: what changed was touched; new tasks (with their IDs written now) are first seen.
    // AGENT-01 (D-185 Q4): by the agent whose request this is, or by the user (clearing touchedBy).
    const run = this.exclusive.getStore();
    const by = run?.agent ?? undefined;
    this.meta.touch(
      applied.touched.map((each) => each.key),
      now,
      by,
    );
    this.meta.seen(
      [...allTasks(list.file.document)].map(({ task }) => task.key),
      now,
      by,
    );
    run?.applied.push({ path: list.entry.path, op, inverse: applied.inverse });
    // A conversion (LIST-04), or undoing one, changes the list's mode.
    list.entry = { ...list.entry, mode: documentMode(list.file.document) };
    return applied;
  }

  /**
   * LIST-01, D-72, D-74: a copy of a list or note as "<name> copy" ("<name> copy 2"…), with new IDs
   * and without reminders; undoable while the copy is unchanged.
   */
  duplicateList(id: string, now: Date): Promise<ListOutcome> {
    return this.serial(async () => {
      const list = this.find(id);
      if (!list) return { ok: false, problem: 'That list is gone' };
      const base = `${list.entry.id === INBOX_ID ? 'Inbox' : list.entry.name} copy`;
      let name = base;
      for (let count = 2; this.sameName(name); count++) name = `${base} ${count}`;
      if (listNameProblem(name)) return { ok: false, problem: 'The copy needs a shorter name' };
      const copyId = generateId(this.isTaken);
      const text = duplicateDocument(list.file.document, copyId, () => generateId(this.isTaken));
      const mode = list.entry.mode === 'note' ? 'note' : 'tasks';
      await this.createList(name, mode, copyId, text);
      await this.placeAfter(copyId, this.listId(list.entry));
      const label = `Duplicated as ${name}`;
      const created = (): UndoEntry => ({
        label,
        run: async () => {
          const copy = this.find(copyId);
          if (!copy) return null;
          await this.dropIfUnchanged(copy, text);
          if (this.find(copyId)) return null;
          return {
            label,
            run: async () => {
              if (this.find(copyId) || this.sameName(name)) return null;
              await this.createList(name, mode, copyId, text);
              return created();
            },
          };
        },
      });
      this.remember(created());
      void now;
      return { ok: true, listId: copyId, label };
    });
  }

  /** LIST-01, D-59: several lists and notes deleted from the sidebar, undone together. */
  async deleteLists(ids: readonly string[], now: Date): Promise<ListOutcome> {
    const start = await this.serial(() => Promise.resolve(this.undoStack.length));
    let last: ListOutcome = { ok: false, problem: 'Nothing to delete' };
    for (const id of ids) last = await this.deleteList(id, now);
    const label = `Deleted ${ids.length} lists`;
    const merged = await this.serial(() => Promise.resolve(this.mergeSince(start, label)));
    return merged ? { ok: true, listId: 'inbox', label } : last;
  }

  /** D-117: what exists now (lists, notes and quick notes; every task), as the tour starts. */
  tourBaseline(): { readonly lists: string[]; readonly tasks: string[] } {
    return {
      lists: this.lists.map(({ entry }) => this.listId(entry)),
      tasks: this.lists.flatMap(({ file }) =>
        [...allTasks(file.document)].map(({ task }) => task.key),
      ),
    };
  }

  /**
   * D-116, D-117: "Remove what I created during the tour": every list, note, quick note and task
   * that wasn't there when it started goes to Trash, as one undoable step. Edits to what was there
   * stay. A new task in a new list goes with its list; a new subtask of a new task with its parent.
   * Null when the tour made nothing.
   */
  async removeMadeSince(
    baseline: { readonly lists: readonly string[]; readonly tasks: readonly string[] },
    now: Date,
  ): Promise<string | null> {
    const knownLists = new Set(baseline.lists);
    const knownTasks = new Set(baseline.tasks);
    const { start, lists, tasks } = await this.serial(() => {
      const newLists = this.lists
        .map(({ entry }) => this.listId(entry))
        .filter((id) => id !== INBOX_ID && !knownLists.has(id));
      // In document order, so a parent comes before its subtasks (which go with it).
      const newTasks = this.lists
        .filter(({ entry }) => !newLists.includes(this.listId(entry)))
        .flatMap(({ entry, file }) =>
          [...allTasks(file.document)]
            .filter(({ task }) => !knownTasks.has(task.key))
            .map(({ task }) => ({ list: this.listId(entry), key: task.key })),
        );
      return Promise.resolve({ start: this.undoStack.length, lists: newLists, tasks: newTasks });
    });
    if (lists.length === 0 && tasks.length === 0) return null;
    let count = 0;
    for (const { list, key } of tasks) {
      // Gone already when its parent went.
      const current = this.find(list);
      if (current && findTask(current.file.document, key)) {
        if (await this.change(list, { kind: 'delete', key }, now)) count++;
      }
    }
    for (const id of lists) if ((await this.deleteList(id, now)).ok) count++;
    const label =
      count === 1 ? 'Removed 1 item from the tour' : `Removed ${count} items from the tour`;
    const merged = await this.serial(() => Promise.resolve(this.mergeSince(start, label)));
    return merged ? label : null;
  }

  /** LIST-04, D-22, D-72: a task list becomes a note, or a note a task list; undoable. */
  convertList(id: string, mode: 'tasks' | 'note', now: Date): Promise<ListOutcome> {
    return this.serial(async () => {
      const list = this.find(id);
      if (!list || list.entry.id === INBOX_ID)
        return { ok: false, problem: 'Inbox stays a task list' };
      if (list.entry.mode === mode) return { ok: true, listId: id, label: '' };
      const op = (mode === 'note' ? convertToNote : convertToTasks)(
        list.file.document,
        list.file.path,
      );
      const label = mode === 'note' ? 'Converted to a note' : 'Converted to a task list';
      await this.record(list, op, label, now);
      return { ok: true, listId: this.listId(list.entry), label };
    });
  }

  private async createList(
    name: string,
    mode: ListMode = 'tasks',
    listId?: string,
    /** The file's text (a duplicate); a new list's header otherwise. */
    text?: string,
  ): Promise<Loaded> {
    const path = join(this.folder, `${name}.md`);
    const id = listId ?? generateId(this.isTaken);
    // `wx`-like guard: never overwrite a file that appeared since the folder was read.
    try {
      await readFile(path);
      throw new Error(`a file named ${name}.md already exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeFileAtomic(path, text ?? NEW_LIST_HEADER(id, mode), {
      tempDirectory: tempDirectoryFor(path),
    });
    const entry: ListEntry = { path, name, id, mode, created: Date.now() };
    const loaded = { entry, file: await ListFile.open(path) };
    this.lists.push(loaded);
    return loaded;
  }

  private async markRecent(id: string): Promise<void> {
    await this.saveUiState({
      recentLists: [id, ...this.recent.filter((other) => other !== id)].slice(0, 20),
    });
  }

  private async forgetRecent(id: string): Promise<void> {
    await this.saveUiState({ recentLists: this.recent.filter((other) => other !== id) });
  }

  /** ui-state.json keeps keys this version doesn't know (docs/04 §2). */
  private async saveUiState(changes: Record<string, unknown>): Promise<void> {
    this.uiState = { ...this.uiState, ...changes };
    await writeFileAtomic(this.uiStatePath, `${JSON.stringify(this.uiState, null, 2)}\n`, {
      tempDirectory: join(this.uiStatePath, '..', 'tmp'),
    });
  }
}
