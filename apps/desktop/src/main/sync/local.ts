/**
 * This PC's side of Google Drive sync (SYNC-01, D-161, docs/05 §5): the Flint folder through the
 * workspace. Sync writes a list as another program would (atomically, then the workspace reads it,
 * DATA-06), so open views, undo and the editor see it as an outside edit and keep the cursor.
 */
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, type TaskNode } from '@flint/core';
import type { AgentFlag, LocalGroup, LocalItem, LocalSide, TaskTimes } from '@flint/core/sync';
import type { HiddenFile } from '../agents/hidden.js';
import type { Workspace } from '../capture/workspace.js';
import { writeFileAtomic, readListFile } from '../storage/atomic.js';
import { tempDirectoryFor } from '../storage/list-file.js';
import { stamp, trashFolder, trashedTaskText } from '../storage/trash.js';
import { localStamp, parseStamp } from '../task-meta.js';

/** The Windows computer name, as conflict callouts and linked files name this PC. */
export function deviceName(): string {
  return hostname().toUpperCase();
}

/** A name Windows can use for a file, as the workspace's list names are (D-25). */
function fileName(name: string): string {
  const clean = [...name]
    .map((char) => (char < ' ' ? ' ' : char))
    .join('')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return clean === '' ? 'Synced list' : clean.slice(0, 120);
}

export interface WorkspaceSideOptions {
  readonly workspace: () => Workspace;
  /** A note being typed in with nothing saved yet (an open editor): left for the next run. */
  readonly busy: (listId: string) => boolean;
  readonly now?: () => number;
  /** AGENT-06 (D-185): the current Flint folder's Hidden from agents, which syncs too. */
  readonly hidden?: () => HiddenFile;
}

export class WorkspaceSide implements LocalSide {
  readonly device = deviceName();
  private readonly options: WorkspaceSideOptions;

  constructor(options: WorkspaceSideOptions) {
    this.options = options;
  }

  private get workspace(): Workspace {
    return this.options.workspace();
  }

  now(): number {
    return this.options.now?.() ?? Date.now();
  }

  busy(listId: string): boolean {
    return this.options.busy(listId);
  }

  items(): Promise<LocalItem[]> {
    return Promise.resolve(
      this.workspace.syncEntries().map((entry) => ({
        listId: entry.id,
        name: entry.name,
        group: entry.group,
        skip: entry.emptyQuick,
      })),
    );
  }

  async read(listId: string): Promise<string | null> {
    const path = this.workspace.syncPath(listId);
    if (!path) return null;
    const read = await readListFile(path);
    return read.kind === 'text' ? read.text : null;
  }

  /** A free file name in the folder (another list has this one: "Groceries 2", D-161 Q2). */
  private freeName(name: string, listId: string): string {
    const taken = new Set(
      this.workspace
        .syncEntries()
        .filter((entry) => entry.id !== listId)
        .map((entry) => basename(entry.path, '.md').toLowerCase()),
    );
    const wanted = fileName(name);
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let number = 2; ; number++) {
      const candidate = `${wanted} ${number}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  async write(listId: string, text: string, name: string): Promise<string> {
    const known = this.workspace.syncPath(listId);
    const path = known ?? join(this.workspace.folder, `${this.freeName(name, listId)}.md`);
    await writeFileAtomic(path, text, { tempDirectory: tempDirectoryFor(path) });
    await this.workspace.syncWritten(path);
    return basename(path, '.md');
  }

  async rename(listId: string, name: string): Promise<string> {
    const from = this.workspace.syncPath(listId);
    if (!from) return name;
    const free = this.freeName(name, listId);
    if (basename(from, '.md') === free) return free;
    const to = join(dirname(from), `${free}.md`);
    await rename(from, to);
    await this.workspace.syncWritten(from);
    await this.workspace.syncWritten(to);
    return free;
  }

  async trashList(listId: string): Promise<void> {
    await this.workspace.deleteList(listId, new Date(this.now()));
  }

  async trashTask(listId: string, block: string): Promise<void> {
    const document = parseDocument(`${block}\n`);
    const task = document.blocks.find((entry): entry is TaskNode => entry.kind === 'task');
    if (!task) return;
    const name = this.workspace.syncEntries().find((entry) => entry.id === listId)?.name ?? listId;
    const now = new Date(this.now());
    const folder = trashFolder(this.workspace.folder);
    await mkdir(folder, { recursive: true });
    const path = join(folder, `${stamp(now)}-task-${task.key}.md`);
    await writeFileAtomic(path, trashedTaskText(task, { id: listId, name }, now), {
      tempDirectory: tempDirectoryFor(path),
    });
  }

  groups(): Promise<LocalGroup[]> {
    return Promise.resolve(this.workspace.syncGroups());
  }

  applyGroups(groups: readonly LocalGroup[], removed: readonly string[]): Promise<void> {
    return this.workspace.applySyncGroups(groups, removed);
  }

  taskTimes(listId: string): Promise<ReadonlyMap<string, TaskTimes>> {
    const out = new Map<string, TaskTimes>();
    const path = this.workspace.syncPath(listId);
    if (!path) return Promise.resolve(out);
    const view = this.workspace.syncTaskIds(listId);
    for (const id of view) {
      const meta = this.workspace.meta.get(id);
      if (!meta) continue;
      const c = parseStamp(meta.created)?.getTime();
      const t = parseStamp(meta.lastTouched)?.getTime();
      out.set(id, {
        ...(c !== undefined ? { c } : {}),
        ...(t !== undefined ? { t } : {}),
        // AGENT-01 (D-185 Q4): who made and last changed it travel with its times.
        ...(meta.createdBy !== undefined ? { cb: meta.createdBy } : {}),
        ...(meta.touchedBy !== undefined ? { tb: meta.touchedBy } : {}),
      });
    }
    return Promise.resolve(out);
  }

  applyTaskTimes(_listId: string, times: ReadonlyMap<string, TaskTimes>): Promise<void> {
    for (const [id, time] of times) {
      this.workspace.meta.adopt(
        id,
        time.c !== undefined ? localStamp(new Date(time.c)) : undefined,
        time.t !== undefined ? localStamp(new Date(time.t)) : undefined,
      );
      this.workspace.meta.adoptAgents(id, time.cb, time.tb);
    }
    return Promise.resolve();
  }

  /** AGENT-06: Hidden from agents, by list, note and group ID, with when each last changed. */
  agentFlags(): Promise<Readonly<Record<string, AgentFlag>>> {
    const hidden = this.options.hidden?.();
    const flags: Record<string, AgentFlag> = {};
    if (!hidden) return Promise.resolve(flags);
    for (const id of hidden.knownIds()) {
      const changed = hidden.changedAt(id);
      if (changed) flags[id] = changed;
    }
    return Promise.resolve(flags);
  }

  async applyAgentFlags(flags: Readonly<Record<string, AgentFlag>>): Promise<void> {
    const hidden = this.options.hidden?.();
    if (!hidden) return;
    for (const [id, flag] of Object.entries(flags)) await hidden.adopt(id, flag.hidden, flag.at);
  }

  renamedTasks(renamed: ReadonlyMap<string, string>): Promise<void> {
    // Today's order follows a re-IDed incoming task (the pin itself is in its line).
    const order = this.workspace.today.order();
    if (order.some((id) => renamed.has(id))) {
      this.workspace.today.setOrder(order.map((id) => renamed.get(id) ?? id));
    }
    return Promise.resolve();
  }

  private attachmentPath(name: string): string | null {
    // Only a plain file name inside attachments/ (never a path out of the folder).
    if (name === '' || name !== basename(name) || name.startsWith('.')) return null;
    return join(this.workspace.folder, 'attachments', name);
  }

  async readAttachment(name: string): Promise<Uint8Array | null> {
    const path = this.attachmentPath(name);
    if (!path) return null;
    return readFile(path).catch(() => null);
  }

  async attachmentSize(name: string): Promise<number | null> {
    const path = this.attachmentPath(name);
    if (!path) return null;
    return stat(path).then(
      (info) => (info.isFile() ? info.size : null),
      () => null,
    );
  }

  async writeAttachment(name: string, content: Uint8Array): Promise<void> {
    const path = this.attachmentPath(name);
    if (!path) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomic(path, content, { tempDirectory: tempDirectoryFor(path) });
  }

  async linkedFileSize(target: string): Promise<number | null> {
    try {
      const info = await stat(fileURLToPath(target));
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  }
}
