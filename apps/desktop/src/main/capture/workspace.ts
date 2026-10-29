import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addTask,
  allTasks,
  deleteTask,
  findTask,
  generateId,
  serializeDocument,
  type Op,
} from '@flint/core';
import { parseCapture, type CaptureParse, type ListInfo } from '@flint/core/shorthand';
import { fromDate } from '@flint/core/time';
import { writeFileAtomic } from '../storage/atomic.js';
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
    return run;
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

  /** IDs are unique in the whole Flint folder (D-21, D-29): tasks and lists. */
  isTaken = (id: string): boolean =>
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
    // Only a list that is exactly what the capture created is removed; anything added since stays.
    const id = list.entry.id ?? '';
    if (serializeDocument(list.file.document) === NEW_LIST_HEADER(id)) {
      await unlink(list.file.path);
      this.lists.splice(this.lists.indexOf(list), 1);
      await this.forgetRecent(id);
    }
  }

  private async applyAndSave(list: Loaded, op: Op, now: Date): Promise<void> {
    if (list.file.readOnly)
      throw new Error(`${list.entry.name} can't be edited (${list.file.readOnly})`);
    if (!list.file.apply(op)) throw new Error(`could not add the task to ${list.entry.name}`);
    await list.file.save({ now: fromDate(now), isTaken: this.isTaken });
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
