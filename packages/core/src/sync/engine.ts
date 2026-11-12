/**
 * The Google Drive sync engine (SYNC-01, D-161, docs/04 §7, docs/05 §5): one run compares this
 * PC's synced lists and notes, their merge bases and the Drive folder, merges what changed on
 * either side, writes the results to both, and carries attachments, groups, task times, linked
 * files and deletions. Local data is never lost: the worst case is both versions kept.
 */
import { conflictTime } from './conflict.js';
import {
  DriveError,
  type BaseStore,
  type Drive,
  type LocalGroup,
  type LocalSide,
  type RemoteFile,
  type AgentFlag,
  type TaskTimes,
} from './drive.js';
import { mergeLists, type ListVersions } from './merge.js';
import type { LinkedFile, SyncState, SyncedGroup } from './state.js';
import { documentLines, parseDocument, type TaskNode } from '../format/document.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

export type SyncStatus = 'synced' | 'offline' | 'auth' | 'quota' | 'folder-gone' | 'error';

export interface RemoteOnlyItem {
  readonly listId: string;
  readonly name: string;
  /** The synced group it is in, if any. */
  readonly group: string | null;
}

export interface SyncReport {
  readonly status: SyncStatus;
  /** Lists and notes written here, and to Drive. */
  readonly downloaded: readonly string[];
  readonly uploaded: readonly string[];
  /** Conflict callouts added this run, per list. */
  readonly conflicts: ReadonlyMap<string, number>;
  /** Attachments that didn't fit in Drive (name and size). */
  readonly didNotFit: readonly { readonly name: string; readonly size: number }[];
  /** What Drive has that this PC doesn't sync (for Choose…). */
  readonly remoteOnly: readonly RemoteOnlyItem[];
  readonly remoteGroups: readonly SyncedGroup[];
  /** Something changed in Drive while this run wrote: run again soon. */
  readonly again: boolean;
  /** D-181: why it runs again (a note being typed in, a file Drive changed meanwhile), for the log. */
  readonly againWhy: readonly string[];
  readonly message?: string;
}

interface GroupsFile {
  flint: 1;
  groups: SyncedGroup[];
}
interface ItemsFile {
  flint: 1;
  items: Record<string, { tasks?: Record<string, TaskTimes>; linked?: Record<string, LinkedFile> }>;
  /** AGENT-06 (D-185): Hidden from agents for synced lists, notes and groups; the later change wins. */
  agents?: Record<string, AgentFlag>;
}
interface RemovedFile {
  flint: 1;
  removed: Record<string, { how: 'deleted' | 'unsynced'; at: number; device: string }>;
}

const KEEP_REMOVED_MS = 90 * 24 * 60 * 60 * 1000;
const encoder = { encode: encodeUtf8 };
const decoder = { decode: decodeUtf8 };

export interface EngineOptions {
  readonly drive: Drive;
  readonly local: LocalSide;
  readonly bases: BaseStore;
  readonly state: SyncState;
  /** The Drive folder's name for a new folder: `Flint`, or `Flint (development)`. */
  readonly folderName: string;
  readonly random?: () => number;
}

const ATTACHMENT_LINK = /\]\(<?(?:\.\/)?attachments\/([^)\s>]+)>?\)/g;
const LINKED_FILE = /\]\(<?(file:\/\/\/[^)\s>]+)>?\)/g;

/** Attachment names a text links to (relative `attachments/…` links). */
export function attachmentNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(ATTACHMENT_LINK)) {
    try {
      names.add(decodeURIComponent(match[1] ?? ''));
    } catch {
      names.add(match[1] ?? '');
    }
  }
  return [...names].filter((name) => name !== '' && !name.includes('/') && !name.includes('\\'));
}

/** `file:///` targets a text links to (linked large files, MEDIA-03). */
export function linkedTargets(text: string): string[] {
  return [...new Set([...text.matchAll(LINKED_FILE)].map((match) => match[1] ?? ''))];
}

function json<T>(bytes: Uint8Array | null, fallback: T): T {
  if (bytes === null) return fallback;
  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch {
    return fallback;
  }
}

function blockText(node: TaskNode): string {
  return documentLines({
    bom: false,
    finalNewline: true,
    eol: '\n',
    indentUnit: '    ',
    frontmatter: null,
    blocks: [node],
  })
    .map((line) => line.text)
    .join('\n');
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/** Three-way merge of group membership: what either side added, minus what either removed. */
function mergeMembers(
  base: readonly string[],
  mine: readonly string[],
  theirs: readonly string[],
): string[] {
  const inBase = new Set(base);
  const inMine = new Set(mine);
  const inTheirs = new Set(theirs);
  const result: string[] = [];
  for (const id of [...mine, ...theirs]) {
    if (result.includes(id)) continue;
    const keep = inBase.has(id) ? inMine.has(id) && inTheirs.has(id) : true;
    if (keep) result.push(id);
  }
  return result;
}

export class SyncEngine {
  private readonly drive: Drive;
  private readonly local: LocalSide;
  private readonly bases: BaseStore;
  readonly state: SyncState;
  private readonly folderName: string;
  private readonly random: (() => number) | undefined;
  /** The bookkeeping files as last read or written, by revision: an idle run reads none. */
  private readonly metaCache = new Map<string, { revision: string; text: string }>();

  constructor(options: EngineOptions) {
    this.drive = options.drive;
    this.local = options.local;
    this.bases = options.bases;
    this.state = options.state;
    this.folderName = options.folderName;
    this.random = options.random;
  }

  /** Stops syncing lists or groups on this PC; `everywhere`: also removes them from Drive (Q6). */
  stop(
    ids: readonly string[],
    everywhere: boolean,
    groupLists: (id: string) => readonly string[],
  ): void {
    const all = new Set<string>();
    for (const id of ids) {
      all.add(id);
      for (const list of groupLists(id)) all.add(list);
    }
    for (const id of all) {
      if (!this.state.stopped.includes(id)) this.state.stopped.push(id);
      this.state.chosen = this.state.chosen.filter((entry) => entry !== id);
      this.state.notices = this.state.notices.filter((entry) => entry !== id);
      if (everywhere && !this.state.removals.includes(id)) this.state.removals.push(id);
    }
  }

  /** Starts syncing lists or groups on this PC (right-click, Choose…, a move into a synced group). */
  start(ids: readonly string[]): void {
    for (const id of ids) {
      this.state.stopped = this.state.stopped.filter((entry) => entry !== id);
      this.state.notices = this.state.notices.filter((entry) => entry !== id);
      if (this.state.mode === 'chosen' && !this.state.chosen.includes(id))
        this.state.chosen.push(id);
    }
  }

  /** Whether a list (or group) syncs on this PC under the current choice. */
  wanted(id: string, groupOf: (listId: string) => readonly string[]): boolean {
    if (this.state.mode === null || this.state.stopped.includes(id)) return false;
    if (this.state.mode === 'everything') return true;
    if (this.state.chosen.includes(id)) return true;
    return groupOf(id).some(
      (group) => this.state.chosen.includes(group) && !this.state.stopped.includes(group),
    );
  }

  async run(): Promise<SyncReport> {
    const downloaded: string[] = [];
    const uploaded: string[] = [];
    const conflicts = new Map<string, number>();
    const didNotFit: { name: string; size: number }[] = [];
    let again = false;
    const againWhy: string[] = [];
    const report = (status: SyncReport['status'], extra: Partial<SyncReport> = {}): SyncReport => ({
      status,
      downloaded,
      uploaded,
      conflicts,
      didNotFit,
      remoteOnly: [],
      remoteGroups: [],
      again,
      againWhy,
      ...extra,
    });
    if (this.state.mode === null) return report('synced');
    try {
      return await this.runOnce(
        { downloaded, uploaded, conflicts, didNotFit },
        (why) => {
          again = true;
          againWhy.push(why);
        },
        report,
      );
    } catch (error) {
      if (error instanceof DriveError) {
        const status: SyncStatus =
          error.problem === 'offline' ||
          error.problem === 'auth' ||
          error.problem === 'quota' ||
          error.problem === 'folder-gone'
            ? error.problem
            : error.problem === 'changed'
              ? 'synced'
              : 'error';
        if (error.problem === 'changed') {
          again = true;
          againWhy.push(`Drive changed during the run: ${error.message}`);
        }
        return report(status, { message: error.message });
      }
      return report('error', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async runOnce(
    out: {
      downloaded: string[];
      uploaded: string[];
      conflicts: Map<string, number>;
      didNotFit: { name: string; size: number }[];
    },
    setAgain: (why: string) => void,
    report: (status: SyncStatus, extra?: Partial<SyncReport>) => SyncReport,
  ): Promise<SyncReport> {
    const { drive, local, bases, state } = this;
    const device = local.device;
    const now = local.now();
    const folder = await drive.folder(state.folderId, this.folderName);
    if (state.folderId !== folder.id) {
      // A new folder: nothing in it was synced from here.
      state.items = {};
      state.attachments = {};
      state.groups = [];
    }
    state.folderId = folder.id;
    state.folderPath = folder.path;
    const files = await drive.list(folder.id);
    const meta = (name: string): RemoteFile | undefined =>
      files.find((file) => file.kind === 'meta' && file.flintId === name);
    const groupsFileRemote = meta('groups.json');
    const itemsFileRemote = meta('items.json');
    const removedFileRemote = meta('removed.json');
    const readMeta = async (file: RemoteFile | undefined): Promise<Uint8Array | null> => {
      if (!file) return null;
      const cached = this.metaCache.get(file.flintId);
      if (cached && cached.revision === file.revision) return encoder.encode(cached.text);
      const content = await drive.read(file);
      this.metaCache.set(file.flintId, { revision: file.revision, text: decoder.decode(content) });
      return content;
    };
    const groupsFile = json<GroupsFile>(await readMeta(groupsFileRemote), { flint: 1, groups: [] });
    const itemsFile = json<ItemsFile>(await readMeta(itemsFileRemote), { flint: 1, items: {} });
    const removedFile = json<RemovedFile>(await readMeta(removedFileRemote), {
      flint: 1,
      removed: {},
    });
    groupsFile.groups = Array.isArray(groupsFile.groups) ? groupsFile.groups : [];
    itemsFile.items = itemsFile.items && typeof itemsFile.items === 'object' ? itemsFile.items : {};
    removedFile.removed =
      removedFile.removed && typeof removedFile.removed === 'object' ? removedFile.removed : {};
    const groupsBefore = JSON.stringify(groupsFile);
    const itemsBefore = JSON.stringify(itemsFile);
    const removedBefore = JSON.stringify(removedFile);

    // The newest file per list ID (two would only come from a race between PCs).
    const remote = new Map<string, RemoteFile>();
    for (const file of files) {
      if (file.kind !== 'list') continue;
      const known = remote.get(file.flintId);
      if (!known || file.modifiedTime > known.modifiedTime) remote.set(file.flintId, file);
    }

    const items = await local.items();
    const localById = new Map(items.map((item) => [item.listId, item]));
    const localGroups = await local.groups();
    const groupOf = (listId: string): string[] => [
      ...localGroups.filter((group) => group.lists.includes(listId)).map((group) => group.id),
      ...groupsFile.groups.filter((group) => group.lists.includes(listId)).map((group) => group.id),
    ];
    const memberLists = (groupId: string): string[] => [
      ...(localGroups.find((group) => group.id === groupId)?.lists ?? []),
      ...(groupsFile.groups.find((group) => group.id === groupId)?.lists ?? []),
    ];

    // "Also remove from Drive": those lists leave Drive, recorded as unsynced (each PC keeps its copy).
    for (const id of state.removals.splice(0)) {
      for (const listId of [id, ...memberLists(id)]) {
        const file = remote.get(listId);
        if (file) {
          await drive.trash(file);
          remote.delete(listId);
        }
        removedFile.removed[listId] = { how: 'unsynced', at: now, device };
        delete state.items[listId];
        await bases.delete(listId);
      }
      groupsFile.groups = groupsFile.groups.filter((group) => group.id !== id);
      state.groups = state.groups.filter((group) => group.id !== id);
    }

    const wanted = (listId: string): boolean => this.wanted(listId, groupOf);

    // Decide per list what this run does.
    const versions: ListVersions[] = [];
    const texts = new Map<
      string,
      { mine: string | null; theirs: string | null; file: RemoteFile | null }
    >();
    const ids = new Set<string>([
      ...items.filter((item) => wanted(item.listId) && !item.skip).map((item) => item.listId),
      ...[...remote.keys()].filter(wanted),
      ...Object.keys(state.items),
    ]);
    for (const id of ids) {
      if (local.busy?.(id)) {
        setAgain(`${id}: being typed in`);
        continue;
      }
      const previous = state.items[id];
      const mineItem = localById.get(id);
      const file = remote.get(id) ?? null;
      if (previous && !wanted(id)) {
        // Unchosen or stopped here: this PC keeps its copy and stops syncing it.
        delete state.items[id];
        await bases.delete(id);
        continue;
      }
      if (previous) {
        const base = await bases.get(id);
        if (!file) {
          const record = removedFile.removed[id];
          if (!mineItem) {
            delete state.items[id];
            await bases.delete(id);
            continue;
          }
          const mine = await local.read(id);
          if (record?.how === 'deleted') {
            if (mine === base) {
              await local.trashList(id);
              delete state.items[id];
              await bases.delete(id);
              continue;
            }
            // Edited here after it was deleted elsewhere: it stays, and goes back up.
            delete removedFile.removed[id];
            delete state.items[id];
            versions.push({ listId: id, base: null, mine, theirs: null });
            texts.set(id, { mine, theirs: null, file: null });
            continue;
          }
          // Removed from Drive (on another PC, or in Drive itself): keep it here, stop, say so.
          if (!state.stopped.includes(id)) state.stopped.push(id);
          if (!state.notices.includes(id)) state.notices.push(id);
          delete state.items[id];
          await bases.delete(id);
          continue;
        }
        if (!mineItem) {
          if (file.revision === previous.revision) {
            await drive.trash(file);
            removedFile.removed[id] = { how: 'deleted', at: now, device };
            delete state.items[id];
            await bases.delete(id);
            delete itemsFile.items[id];
            continue;
          }
          // Deleted here, edited elsewhere: the edit wins, it comes back.
          const theirs = decoder.decode(await drive.read(file));
          versions.push({ listId: id, base: null, mine: null, theirs });
          texts.set(id, { mine: null, theirs, file });
          delete state.items[id];
          continue;
        }
        const mine = await local.read(id);
        const localChanged = mine !== base;
        const remoteChanged = file.revision !== previous.revision;
        const renamedHere = mineItem.name !== previous.localName;
        const renamedThere = file.name !== previous.name;
        if (renamedThere && !renamedHere) {
          const name = await local.rename(id, file.name);
          state.items[id] = { ...previous, name: file.name, localName: name };
        } else if (renamedHere) {
          const updated = await drive.update(file, null, { name: mineItem.name, device });
          remote.set(id, updated);
          state.items[id] = {
            ...previous,
            revision: remoteChanged ? previous.revision : updated.revision,
            name: mineItem.name,
            localName: mineItem.name,
          };
        }
        if (!localChanged && !remoteChanged) continue;
        const theirs = remoteChanged ? decoder.decode(await drive.read(file)) : base;
        versions.push({ listId: id, base, mine, theirs });
        texts.set(id, { mine, theirs, file: remote.get(id) ?? file });
        continue;
      }
      if (!wanted(id)) continue;
      if (mineItem?.skip) continue;
      const mine = mineItem ? await local.read(id) : null;
      const theirs = file ? decoder.decode(await drive.read(file)) : null;
      versions.push({ listId: id, base: null, mine, theirs });
      texts.set(id, { mine, theirs, file });
    }

    // Merge everything that changed together (tasks can move between lists).
    const remoteTimes = (listId: string): Record<string, TaskTimes> =>
      itemsFile.items[listId]?.tasks ?? {};
    const localTimes = new Map<string, ReadonlyMap<string, TaskTimes>>();
    for (const version of versions) {
      if (version.mine !== null)
        localTimes.set(version.listId, await local.taskTimes(version.listId));
    }
    const touched = (side: 'mine' | 'theirs', key: string): number | null => {
      for (const version of versions) {
        if (side === 'mine') {
          const value = localTimes.get(version.listId)?.get(key)?.t;
          if (value !== undefined) return Math.min(value, now);
        } else {
          const value = remoteTimes(version.listId)[key]?.t;
          const file = texts.get(version.listId)?.file;
          if (value !== undefined) return Math.min(value, file ? file.modifiedTime : now);
        }
      }
      return null;
    };
    const taken = new Set<string>();
    for (const version of versions) {
      for (const text of [version.mine, version.theirs, version.base]) {
        if (text === null) continue;
        const words = text.match(/\[id::\s*([A-Za-z0-9_-]+)\]/g) ?? [];
        for (const word of words) taken.add(word.replace(/^\[id::\s*|\]$/g, ''));
      }
    }
    const merged = mergeLists(versions, {
      mineDevice: device,
      theirsDevice: (listId) => texts.get(listId)?.file?.device ?? 'another PC',
      when: (listId) => {
        const file = texts.get(listId)?.file;
        return conflictTime(new Date(file ? file.modifiedTime : now));
      },
      touched,
      isTaken: (id) => taken.has(id),
      ...(this.random ? { random: this.random } : {}),
    });
    if (merged.reIded.size > 0) await local.renamedTasks(merged.reIded);
    for (const entry of merged.trashed) await local.trashTask(entry.listId, blockText(entry.node));

    // Text first (D-161 Q8): write here, then to Drive.
    for (const version of versions) {
      const id = version.listId;
      const text = merged.texts.get(id);
      if (text === undefined) continue;
      const known = texts.get(id);
      const mineItem = localById.get(id);
      const file = known?.file ?? null;
      out.conflicts.set(id, merged.conflicts.get(id) ?? 0);
      let localName = mineItem?.name ?? file?.name ?? id;
      if (known?.mine !== text) {
        localName = await local.write(id, text, mineItem?.name ?? file?.name ?? id);
        out.downloaded.push(id);
      }
      let written = file;
      if (!file) {
        written = await drive.create(
          folder.id,
          'list',
          localName,
          id,
          encoder.encode(text),
          device,
        );
        out.uploaded.push(id);
      } else if (known?.theirs !== text) {
        try {
          written = await drive.update(file, encoder.encode(text), {
            device,
            expect: file.revision,
          });
          out.uploaded.push(id);
        } catch (error) {
          if (error instanceof DriveError && error.problem === 'changed') {
            // Another PC wrote it meanwhile: this PC keeps its merged text; the next run merges again.
            setAgain(`${id}: changed in Drive (${error.message})`);
            await bases.set(id, known?.theirs ?? text);
            state.items[id] = {
              fileId: file.id,
              revision: state.items[id]?.revision ?? '',
              name: file.name,
              localName,
            };
            continue;
          }
          throw error;
        }
      }
      if (!written) continue;
      await bases.set(id, text);
      state.items[id] = {
        fileId: written.id,
        revision: written.revision,
        name: written.name,
        localName,
      };
    }

    // Task times (Q3, Q4): the newer of both sides, clamped; carried into items.json and back here.
    for (const version of versions) {
      const id = version.listId;
      const mineTimes = localTimes.get(id) ?? new Map<string, TaskTimes>();
      const theirTimes = remoteTimes(id);
      const file = texts.get(id)?.file;
      const limit = file ? file.modifiedTime : now;
      const combined: Record<string, TaskTimes> = {};
      for (const key of new Set([...mineTimes.keys(), ...Object.keys(theirTimes)])) {
        const a = mineTimes.get(key);
        const b = theirTimes[key];
        const ta = Math.min(a?.t ?? 0, now);
        const tt = Math.min(b?.t ?? 0, limit);
        const t = Math.max(ta, tt);
        const cs = [a?.c, b?.c].filter((value): value is number => typeof value === 'number');
        // AGENT-01 (D-185 Q4): who made it comes from the side that saw it first; who changed it
        // last from the side with the later change (none there: the user changed it, so none).
        const first = (a?.c ?? Infinity) <= (b?.c ?? Infinity) ? a : b;
        const cb = first?.cb ?? a?.cb ?? b?.cb;
        const tb = (ta >= tt ? a : b)?.tb;
        combined[key] = {
          ...(cs.length > 0 ? { c: Math.min(...cs) } : {}),
          ...(t > 0 ? { t } : {}),
          ...(cb !== undefined ? { cb } : {}),
          ...(tb !== undefined ? { tb } : {}),
        };
      }
      const entry = (itemsFile.items[id] ??= {});
      entry.tasks = combined;
      await local.applyTaskTimes(id, new Map(Object.entries(combined)));
    }

    // Linked files (MEDIA-03): which PC has each, and its size; never in the markdown.
    // Lists to look at for attachments and linked files: what changed, what waits, and every synced
    // list when Drive has attachments this PC hasn't seen (another PC's, uploaded later).
    const unseen = files.some(
      (file) => file.kind === 'attachment' && !state.attachments[file.flintId],
    );
    const touchedLists = new Set([
      ...versions.map((version) => version.listId),
      ...state.pending,
      ...(unseen ? Object.keys(state.items) : []),
    ]);
    state.pending = [];
    for (const id of touchedLists) {
      if (!state.items[id]) continue;
      const text = merged.texts.get(id) ?? (await local.read(id));
      if (text === null) continue;
      const entry = (itemsFile.items[id] ??= {});
      const before = entry.linked ?? {};
      const linked: Record<string, LinkedFile> = {};
      for (const target of linkedTargets(text)) {
        const size = await local.linkedFileSize(target);
        const known = before[target];
        if (size !== null && (!known || known.device === device)) linked[target] = { device, size };
        else if (known) linked[target] = known;
      }
      if (Object.keys(linked).length > 0) entry.linked = linked;
      else delete entry.linked;
      state.linked[id] = linked;
    }
    for (const id of Object.keys(state.linked)) if (!state.items[id]) delete state.linked[id];

    // Groups (Q3): name and members, three-way against the last synced groups.json.
    const baseGroups = new Map(state.groups.map((group) => [group.id, group]));
    const theirGroups = new Map(groupsFile.groups.map((group) => [group.id, group]));
    const hereGroups = new Map(localGroups.map((group) => [group.id, group]));
    const syncedHere = (id: string): boolean => this.wanted(id, () => []);
    const toWrite: SyncedGroup[] = [];
    const toApply: LocalGroup[] = [];
    const toRemove: string[] = [];
    const changed = (group: LocalGroup | SyncedGroup, base: SyncedGroup): boolean =>
      group.name !== base.name || !sameMembers(group.lists, base.lists);
    for (const id of new Set([...hereGroups.keys(), ...theirGroups.keys()])) {
      const b = baseGroups.get(id);
      const here = hereGroups.get(id);
      const m = here && syncedHere(id) ? here : undefined;
      const t = theirGroups.get(id);
      if (t && !m) {
        if (here) {
          // Stopped or not chosen here: Drive keeps it as it is.
          toWrite.push(t);
        } else if (b && !changed(t, b)) {
          // Deleted here: deleted in Drive too (its lists stay where they are).
        } else {
          toWrite.push(t);
          if (syncedHere(id)) toApply.push(t);
        }
        continue;
      }
      if (m && !t) {
        if (b && !changed(m, b)) toRemove.push(id);
        else toWrite.push({ id, name: m.name, lists: [...m.lists] });
        continue;
      }
      if (!m || !t) continue;
      const name = b && m.name === b.name ? t.name : m.name;
      const merged: SyncedGroup = {
        id,
        name,
        lists: mergeMembers(b?.lists ?? [], m.lists, t.lists),
      };
      toWrite.push(merged);
      // D-183: applied here only when it differs from the group here (its members as this PC has
      // them; lists it doesn't have can't be in its group). Applying an unchanged group on every
      // run told the workspace something changed, which asked for the next run 5 s later, for ever.
      const mergedHere = merged.lists.filter(
        (list) => m.lists.includes(list) || localById.has(list),
      );
      if (merged.name !== m.name || !sameMembers(mergedHere, m.lists)) toApply.push(merged);
    }
    if (toApply.length > 0 || toRemove.length > 0) await local.applyGroups(toApply, toRemove);
    groupsFile.groups = toWrite;
    state.groups = toWrite.map((group) => ({ ...group, lists: [...group.lists] }));

    // Attachments inside the Flint folder (Q3): text first, then the smallest first; never deleted.
    const attachmentFiles = new Map(
      files.filter((file) => file.kind === 'attachment').map((file) => [file.flintId, file]),
    );
    const needed = new Map<string, string>();
    for (const id of touchedLists) {
      if (!state.items[id]) continue;
      const text = merged.texts.get(id) ?? (await local.read(id));
      if (text !== null) for (const name of attachmentNames(text)) needed.set(name, id);
    }
    const uploads: { name: string; size: number }[] = [];
    for (const [name] of needed) {
      const there = attachmentFiles.get(name);
      const size = await local.attachmentSize(name);
      if (there && size === null) {
        await local.writeAttachment(name, await drive.read(there));
        state.attachments[name] = { fileId: there.id, revision: there.revision };
      } else if (!there && size !== null) {
        uploads.push({ name, size });
      } else if (there) {
        state.attachments[name] = { fileId: there.id, revision: there.revision };
      }
    }
    uploads.sort((a, b) => a.size - b.size);
    for (let index = 0; index < uploads.length; index++) {
      const { name } = uploads[index] as { name: string; size: number };
      const content = await local.readAttachment(name);
      if (content === null) continue;
      try {
        const file = await drive.create(folder.id, 'attachment', name, name, content, device);
        state.attachments[name] = { fileId: file.id, revision: file.revision };
      } catch (error) {
        if (error instanceof DriveError && error.problem === 'quota') {
          out.didNotFit.push(...uploads.slice(index));
          // Tried again on the next runs, once there is room.
          for (const entry of uploads.slice(index)) {
            const list = needed.get(entry.name);
            if (list !== undefined && !state.pending.includes(list)) state.pending.push(list);
          }
          break;
        }
        throw error;
      }
    }

    // The bookkeeping files, only when they changed.
    for (const [key, entry] of Object.entries(removedFile.removed)) {
      if (now - entry.at > KEEP_REMOVED_MS) delete removedFile.removed[key];
    }
    const writeMeta = async (
      name: string,
      before: string,
      value: unknown,
      file: RemoteFile | undefined,
    ): Promise<void> => {
      const text = JSON.stringify(value);
      if (text === before && file) return;
      const pretty = JSON.stringify(value, null, 2);
      const content = encoder.encode(pretty);
      if (file) {
        try {
          const written = await drive.update(file, content, { device, expect: file.revision });
          this.metaCache.set(name, { revision: written.revision, text: pretty });
        } catch (error) {
          if (error instanceof DriveError && error.problem === 'changed') {
            setAgain(`${name}: changed in Drive (${error.message})`);
            return;
          }
          throw error;
        }
      } else {
        const written = await drive.create(folder.id, 'meta', name, name, content, device);
        this.metaCache.set(name, { revision: written.revision, text: pretty });
      }
    };
    // AGENT-06 (D-185 Q15): Hidden from agents travels with synced lists, notes and groups; per
    // item, the later change wins, on every PC.
    if (local.agentFlags && local.applyAgentFlags) {
      const synced = new Set([
        ...Object.keys(state.items),
        ...groupsFile.groups.map((group) => group.id),
      ]);
      const mine = await local.agentFlags();
      const theirs: Record<string, AgentFlag> = {};
      // D-185 security review L3: only well-formed flags from Drive.
      if (itemsFile.agents && typeof itemsFile.agents === 'object')
        for (const [id, flag] of Object.entries(itemsFile.agents as Record<string, unknown>)) {
          const { hidden, at } = (flag ?? {}) as Record<string, unknown>;
          if (
            typeof hidden === 'boolean' &&
            typeof at === 'string' &&
            !Number.isNaN(Date.parse(at))
          )
            theirs[id] = { hidden, at };
        }
      const adopt: Record<string, AgentFlag> = {};
      for (const id of synced) {
        const here = mine[id];
        const there = theirs[id];
        if (here && (!there || here.at > there.at)) theirs[id] = here;
        else if (there && (!here || there.at > here.at)) adopt[id] = there;
      }
      for (const id of Object.keys(theirs)) if (!synced.has(id)) delete theirs[id];
      if (Object.keys(theirs).length > 0 || itemsFile.agents) itemsFile.agents = theirs;
      if (Object.keys(adopt).length > 0) await local.applyAgentFlags(adopt);
    }
    await writeMeta('groups.json', groupsBefore, groupsFile, groupsFileRemote);
    await writeMeta('items.json', itemsBefore, itemsFile, itemsFileRemote);
    await writeMeta('removed.json', removedBefore, removedFile, removedFileRemote);

    state.lastSync = now;
    const remoteOnly: RemoteOnlyItem[] = [];
    for (const [id, file] of remote) {
      if (localById.has(id) || state.items[id]) continue;
      remoteOnly.push({
        listId: id,
        name: file.name,
        group: groupsFile.groups.find((group) => group.lists.includes(id))?.id ?? null,
      });
    }
    return report(out.didNotFit.length > 0 ? 'quota' : 'synced', {
      remoteOnly,
      remoteGroups: groupsFile.groups,
    });
  }
}

/** For tests and the UI: the conflict callouts a text has (re-exported for convenience). */
export { countConflicts } from './conflict.js';

/** Whether a list text is a task list (used by the service to pick what to show). */
export function isTaskList(text: string): boolean {
  return parseDocument(text).frontmatter?.mode === 'tasks';
}
