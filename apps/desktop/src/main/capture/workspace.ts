import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addTask,
  allTasks,
  bulk,
  completeTask,
  deleteTask,
  editTitle,
  findTask,
  generateId,
  getBody,
  indentTask,
  moveDown,
  moveUp,
  outdentTask,
  serializeDocument,
  setPriority,
  setReminder,
  uncompleteTask,
  type Applied,
  type Op,
  type Where,
} from '@flint/core';
import { parseCapture, type CaptureParse, type ListInfo } from '@flint/core/shorthand';
import { fromDate } from '@flint/core/time';
import type { ChangeOutcome, ListChange, ListSummary, ListView } from '../../shared/ipc.js';
import { writeFileAtomic } from '../storage/atomic.js';
import { listView } from '../views.js';
import { discoverLists, INBOX_ID, type ListEntry } from '../storage/flint-folder.js';
import { ListFile, tempDirectoryFor } from '../storage/list-file.js';

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

/** `2026-10-29-153012`: attachment names sort by time (docs/04 §5). */
function stamp(now: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
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
  readonly file: ListFile;
}

interface UndoEntry {
  readonly label: string;
  /** The list file the change was made in. */
  readonly list: string;
  readonly inverse: Op;
  readonly createdList: boolean;
}

const NEW_LIST_HEADER = (id: string): string => `---\nflint: 1\nid: ${id}\nmode: tasks\n---\n`;

export class Workspace {
  readonly folder: string;
  private readonly lists: Loaded[];
  private readonly uiStatePath: string;
  private uiState: Record<string, unknown>;

  private constructor(
    folder: string,
    lists: Loaded[],
    uiStatePath: string,
    uiState: Record<string, unknown>,
  ) {
    this.folder = folder;
    this.lists = lists;
    this.uiStatePath = uiStatePath;
    this.uiState = uiState;
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
    return new Workspace(folder, lists, uiStatePath, uiState);
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
      return { id: info.id, name: info.name, mode: info.mode, open, inbox: info.id === INBOX_ID };
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
   * Undo and redo for the main window (DATA-03): its own changes, newest first. Applying an entry's
   * inverse yields the inverse that goes on the other stack, so undo and redo are the same step.
   * `createdList`: the change created that list, which goes again when undoing leaves it empty.
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
    createdList = false,
  ): Promise<string> {
    const applied = await this.applyAndSave(list, op, now);
    this.undoStack.push({ label, list: list.entry.path, inverse: applied.inverse, createdList });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
    return label;
  }

  /**
   * The Navigate/Edit keys and the composer (M4, TASK-02, TASK-03, TASK-04, docs/03 §2): one change
   * to list `id`, undoable. Null when it changes nothing (Alt+↑ on the first task, an unchanged
   * title). Text arrives with selected or pasted stretches already escaped (D-45).
   */
  change(id: string, change: ListChange, now: Date): Promise<ChangeOutcome | null> {
    return this.serial(async () => {
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
        case 'priority': {
          const op = setPriority(path, change.key, change.priority);
          const label = change.priority ? `Priority ${change.priority}` : 'No priority';
          return outcome(await this.record(list, op, label, now), change.key);
        }
        case 'move': {
          const op = (change.direction === 'up' ? moveUp : moveDown)(document, path, change.key);
          return op ? outcome(await this.record(list, op, 'Moved', now), change.key) : null;
        }
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
    });
  }

  /**
   * The composer adds to the top of the list it sits in, Edit-state Enter below the task being
   * edited (docs/03 §2); `##list` sends the task elsewhere, to the top, like a capture (D-25).
   */
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
    await this.record(target, op, label, now, created);
    if (target !== list) await this.markRecent(this.listId(target.entry));
    return {
      label,
      key: id,
      listId: this.listId(target.entry),
      listName: target.entry.id === INBOX_ID ? 'Inbox' : target.entry.name,
    };
  }

  /** Space or the checkbox (TASK-06): completes an open task, reopens a completed one. */
  toggleDone(id: string, key: string, now: Date): Promise<string | null> {
    return this.serial(async () => {
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
    });
  }

  /** Undoes the newest change made in the main window; resolves to what was undone. */
  undoLast(now: Date): Promise<string | null> {
    return this.serial(() => this.step(this.undoStack, this.redoStack, now, true));
  }

  /** Ctrl+Shift+Z / Ctrl+Y: redoes the newest undone change. */
  redoLast(now: Date): Promise<string | null> {
    return this.serial(() => this.step(this.redoStack, this.undoStack, now, false));
  }

  private async step(
    from: UndoEntry[],
    to: UndoEntry[],
    now: Date,
    undoing: boolean,
  ): Promise<string | null> {
    const entry = from.pop();
    // A list deleted since (an undone new list, or by another program) can't be redone into.
    const list = entry ? this.lists.find(({ entry: item }) => item.path === entry.list) : undefined;
    if (!entry || !list) return null;
    const applied = await this.applyAndSave(list, entry.inverse, now);
    to.push({ ...entry, inverse: applied.inverse });
    if (undoing && entry.createdList) await this.dropIfEmpty(list);
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
    if (serializeDocument(list.file.document) === NEW_LIST_HEADER(id)) {
      await unlink(list.file.path);
      this.lists.splice(this.lists.indexOf(list), 1);
      await this.forgetRecent(id);
    }
  }

  private async applyAndSave(list: Loaded, op: Op, now: Date): Promise<Applied> {
    if (list.file.readOnly)
      throw new Error(`${list.entry.name} can't be edited (${list.file.readOnly})`);
    const applied = list.file.apply(op);
    if (!applied) throw new Error(`could not change ${list.entry.name}`);
    await list.file.save({ now: fromDate(now), isTaken: this.isTaken });
    return applied;
  }

  private async createList(name: string): Promise<Loaded> {
    const path = join(this.folder, `${name}.md`);
    const id = generateId(this.isTaken);
    // `wx`-like guard: never overwrite a file that appeared since the folder was read.
    try {
      await readFile(path);
      throw new Error(`a file named ${name}.md already exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeFileAtomic(path, NEW_LIST_HEADER(id), { tempDirectory: tempDirectoryFor(path) });
    const entry: ListEntry = { path, name, id, mode: 'tasks', created: Date.now() };
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
