import { copyFile, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  addTask,
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
  outdentTask,
  serializeDocument,
  setBody,
  setPriority,
  setMuted,
  setReminder,
  uncompleteTask,
  type Applied,
  type Op,
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
import { atDefaultTime, fromDate } from '@flint/core/time';
import type {
  ChangeOutcome,
  ListActionOutcome,
  ListChange,
  ListSummary,
  ListView,
} from '../../shared/ipc.js';
import { writeFileAtomic } from '../storage/atomic.js';
import { titlePlain } from '../../shared/inline-markdown.js';
import type { ReminderTask } from '../reminders.js';
import { listView } from '../views.js';
import { discoverLists, INBOX_ID, type ListEntry } from '../storage/flint-folder.js';
import { ListFile, tempDirectoryFor } from '../storage/list-file.js';
import {
  ensureTrashFolder,
  stamp,
  trashedIds,
  trashedTaskText,
  trashFolder,
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
}

export type ListMode = 'tasks' | 'note';

/** What a list action did, or why it couldn't (shown next to the name being typed). */
export type ListOutcome = ListActionOutcome;

const NEW_LIST_HEADER = (id: string, mode: ListMode = 'tasks'): string =>
  `---\nflint: 1\nid: ${id}\nmode: ${mode}\n---\n`;

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
    return new Workspace(folder, lists, uiStatePath, uiState, await trashedIds(folder));
  }

  /**
   * A file in the folder changed (DATA-06, from the watcher): lists added, removed or edited by
   * another program are picked up; Flint's own writes come back unchanged (`ListFile.reload`).
   */
  fileChanged(path: string): Promise<void> {
    return this.serial(() => this.refresh(path));
  }

  /** Changes run one at a time: watcher refreshes, captures and undos never interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => undefined).then(work);
    this.queue = run;
    // Whatever changed, the main window shows it (M4).
    void run.then(
      () => this.notify(),
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
      return {
        id: info.id,
        name: info.name,
        mode: info.mode,
        open,
        inbox: info.id === INBOX_ID,
        ...(info.recentRank === undefined ? {} : { recentRank: info.recentRank }),
      };
    });
  }

  /** One list as the main window shows it (M4). */
  view(id: string, now: Date): ListView | null {
    const loaded = this.find(id);
    if (!loaded) return null;
    const info = this.listInfos().find((list) => list.id === id);
    return listView(
      loaded.file.document,
      {
        id,
        name: info?.name ?? loaded.entry.name,
        mode: info?.mode ?? 'tasks',
        readOnly: loaded.file.readOnly,
      },
      now,
    );
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
        const parsed = parseCapture(change.text, { now, lists: this.listInfos() });
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
      case 'reminder': {
        if (!findTask(document, change.key)) return null;
        return outcome(
          await this.record(list, setReminder(path, change.key, change.at), 'Reminder set', now),
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
      if (listNameProblem(name) || this.sameName(name)) return null;
      target = await this.createList(name);
      created = true;
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
  ): Promise<ChangeOutcome | null> {
    const parsed = parseCapture(change.text, { now, lists: this.listInfos() });
    if (parsed.title.trim() === '') return null;
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
      { id, title: parsed.title, priority: parsed.priority, reminder: parsed.reminder },
      where,
    );
    const label = target === list ? 'Added' : `Added to ${target.entry.name}`;
    await this.record(target, op, label, now, created ? { createdList: target.entry.path } : {});
    if (target !== list) await this.markRecent(this.listId(target.entry));
    return {
      label,
      key: id,
      listId: this.listId(target.entry),
      listName: target.entry.id === INBOX_ID ? 'Inbox' : target.entry.name,
    };
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
      if (entry) loaded.entry = entry;
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
