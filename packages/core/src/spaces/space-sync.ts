/**
 * SPACE-02 (D-190, docs/04 §9, docs/05 §5): one sync round of a space's text with its provider.
 * 1. This side's lists and notes are read and split (`splitPersonal`: your pins, reminders and
 *    mutes stay here); with the space's bookkeeping they make this side's `.flintspace`. A round
 *    refuses to start (nothing uploaded) while two files claim one list ID (a copy made outside
 *    Flint) or a task list has tasks without IDs (not saved by Flint yet).
 * 2. It is written safely (`writeSafely`, Q9), merged with whatever the provider holds
 *    (`spaceMerge3`: lists by ID, deletes against edits, renames; the other side's file checked,
 *    Q11).
 * 3. The merged space comes back to the local files **by list ID**, never by name alone: lists the
 *    merge dropped go to Trash; renames are done so that no file is ever replaced (a swap goes
 *    through a temporary name); a list whose name is held by a list this round leaves alone waits
 *    for the next round; changed lists are written, new ones created (a file that appeared
 *    meanwhile is never replaced); tasks another member deleted go to Trash; the bookkeeping is
 *    written. A list changed here during the round (`changedSince`) is left for the next round.
 * 4. The next base, per list ID: the merged space, except a list left alone this round, whose base
 *    stays what its local text was made from (this side's copy), or none when it isn't here yet.
 * Nothing is written locally before the provider has the merged space. The app holds its own
 * writes to the space's files while a round applies, and flushes unsaved typing before `lists()`.
 */
import {
  allTasks,
  parseDocument,
  serializeDocument,
  type FlintDocument,
} from '../format/document.js';
import type { ListsMergeContext } from '../sync/merge.js';
import { applyPersonal, splitPersonal, type PersonalFields } from './personal.js';
import {
  readSpaceArchive,
  writeSpaceArchive,
  type SpaceArchive,
  type SpaceMetaName,
} from './space-archive.js';
import { spaceMerge3 } from './space-merge.js';
import type { SpaceStore } from './store.js';
import { writeSafely } from './write-safely.js';
import type { ZipCodec } from './zip.js';

/** The prefix of a list's temporary name while names are swapped (a crash may leave one). */
export const MOVING_PREFIX = '~flint-moving ';

/** A space's folder on this device, as the round sees it. */
export interface LocalSpace {
  /** Its lists and notes now: file name (without `.md`) → text, as saved by Flint. */
  lists(): Promise<ReadonlyMap<string, string>>;
  /** Its bookkeeping files now (`space.json` and the rest). */
  meta(): Promise<ReadonlyMap<SpaceMetaName, string>>;
  /**
   * Whether the file `name` no longer holds exactly `text` (edited, renamed away or deleted since
   * `lists()`): the round then leaves that list for the next one.
   */
  changedSince(name: string, text: string): Promise<boolean>;
  /** Writes a list `lists()` returned under this name (and that `changedSince` says is unchanged). */
  write(name: string, text: string): Promise<void>;
  /** Makes a new list; throws when a file of that name exists (never replaces one). */
  create(name: string, text: string): Promise<void>;
  /** Renames a list; throws when a file named `to` exists (never replaces one). */
  rename(from: string, to: string): Promise<void>;
  /** Into the space's Trash (Undo-able, never deleted outright). */
  trash(name: string): Promise<void>;
  /** A task another member deleted, into the space's Trash (`block`: its text, as in the list). */
  trashTask(name: string, block: string): Promise<void>;
  writeMeta(name: SpaceMetaName, text: string): Promise<void>;
}

/** What a round keeps between rounds: the merge base. */
export interface SpaceBase {
  read(): Promise<Uint8Array | null>;
  write(content: Uint8Array): Promise<void>;
}

export interface SpaceRoundReport {
  /** Whether this side's changes went up. */
  readonly uploaded: boolean;
  readonly written: readonly string[];
  readonly created: readonly string[];
  readonly renamed: readonly (readonly [string, string])[];
  readonly trashed: readonly string[];
  /** Tasks another member deleted, put in Trash: `list name` and task ID. */
  readonly trashedTasks: readonly (readonly [string, string])[];
  /** Lists left for the next round (changed here meanwhile, or their name held). */
  readonly skipped: readonly string[];
}

export class SpaceRoundError extends Error {
  readonly problem: 'duplicate-id' | 'unsaved';

  constructor(problem: SpaceRoundError['problem'], message: string) {
    super(message);
    this.name = 'SpaceRoundError';
    this.problem = problem;
  }
}

export interface SpaceRoundOptions {
  readonly store: SpaceStore;
  /** The space's `.flintspace` at the provider. */
  readonly fileId: string;
  readonly local: LocalSpace;
  readonly base: SpaceBase;
  readonly codec: ZipCodec;
  readonly context: ListsMergeContext;
}

/** The list's ID (or `file:<name>`), as the merge matches lists. */
function idOf(name: string, text: string): string {
  return parseDocument(text).frontmatter?.id ?? `file:${name}`;
}

/** A task's own text (its line, body and subtasks), as Trash keeps it. */
function taskBlock(document: FlintDocument, key: string): string | null {
  for (const { task } of allTasks(document))
    if (task.key === key)
      return serializeDocument({ ...document, frontmatter: null, blocks: [task] }).trimEnd();
  return null;
}

const taskIds = (text: string): Set<string> =>
  new Set([...allTasks(parseDocument(text))].map(({ task }) => task.key));

export async function spaceRound(options: SpaceRoundOptions): Promise<SpaceRoundReport> {
  const { store, fileId, local, base, codec, context } = options;
  const lists = await local.lists();
  const before = await base.read();
  const baseArchive: SpaceArchive | null = before ? readSpaceArchive(before, codec) : null;
  const baseNames = new Map<string, string>();
  for (const [name, text] of baseArchive?.lists ?? []) baseNames.set(idOf(name, text), name);

  // 1. This side's space, your fields kept apart; refused while IDs are doubled or unsaved.
  const localById = new Map<string, { name: string; text: string }>();
  const shared = new Map<string, string>();
  const ourIds = new Map<string, string>();
  const mine = new Map<string, PersonalFields>();
  for (const [name, text] of lists) {
    const id = idOf(name, text);
    if (localById.has(id))
      throw new SpaceRoundError(
        'duplicate-id',
        `${name} and ${localById.get(id)?.name} share ${id}`,
      );
    localById.set(id, { name, text });
    const split = splitPersonal(parseDocument(text));
    if (split.unkeyed > 0)
      throw new SpaceRoundError('unsaved', `${name} has tasks without IDs (not saved by Flint)`);
    for (const [task, fields] of split.mine) mine.set(task, fields);
    // A temporary name a crash left: what the base called it.
    const upName = name.startsWith(MOVING_PREFIX) ? (baseNames.get(id) ?? name) : name;
    shared.set(upName, serializeDocument(split.shared));
    ourIds.set(id, upName);
  }
  const ours = writeSpaceArchive({ lists: shared, meta: await local.meta() }, codec);

  // 2. Up, merged with the provider's.
  const written = await writeSafely(store, fileId, before, ours, spaceMerge3(codec, context));
  const merged = readSpaceArchive(written.content, codec);
  const mergedById = new Map<string, { name: string; text: string }>();
  for (const [name, text] of merged.lists) mergedById.set(idOf(name, text), { name, text });

  // 3. Back to the local files, by ID.
  const report = {
    written: [] as string[],
    created: [] as string[],
    renamed: [] as [string, string][],
    trashed: [] as string[],
    trashedTasks: [] as [string, string][],
    skipped: [] as string[],
  };
  const skipped = new Set<string>();
  const skip = (id: string, name: string): void => {
    skipped.add(id);
    if (!report.skipped.includes(name)) report.skipped.push(name);
  };
  /** Which local list holds each file name now. */
  const holder = new Map<string, string>();
  for (const [id, here] of localById) holder.set(here.name, id);
  // Lists changed during the round are left alone, whatever the merge did to them.
  for (const [id, here] of localById)
    if (await local.changedSince(here.name, here.text)) skip(id, here.name);
  // Lists the merge dropped: to Trash.
  for (const [id, here] of localById) {
    if (mergedById.has(id) || skipped.has(id)) continue;
    await local.trash(here.name);
    holder.delete(here.name);
    report.trashed.push(here.name);
  }
  // Renames, never onto a held name: those whose target is free first; a cycle through a
  // temporary name; one whose target a list left alone holds waits.
  const where = new Map<string, string>();
  for (const [id, here] of localById) if (holder.get(here.name) === id) where.set(id, here.name);
  const pending = [...mergedById]
    .filter(([id, target]) => where.has(id) && !skipped.has(id) && where.get(id) !== target.name)
    .map(([id, target]) => ({ id, to: target.name }));
  const move = async (id: string, to: string): Promise<boolean> => {
    const from = where.get(id);
    if (from === undefined) return false;
    try {
      await local.rename(from, to);
    } catch {
      return false;
    }
    holder.delete(from);
    holder.set(to, id);
    where.set(id, to);
    return true;
  };
  while (pending.length > 0) {
    const free = pending.findIndex((p) => !holder.has(p.to));
    if (free >= 0) {
      const [p] = pending.splice(free, 1);
      if (!p) break;
      const from = where.get(p.id) ?? '';
      if (await move(p.id, p.to)) report.renamed.push([from, p.to]);
      else skip(p.id, from);
      continue;
    }
    // Every target held: by a list that is itself moving (a cycle) → that one aside first.
    const cycle = pending.find((p) => pending.some((q) => q.id === holder.get(p.to)));
    if (cycle) {
      const blocking = holder.get(cycle.to) ?? '';
      if (!(await move(blocking, `${MOVING_PREFIX}${blocking}`))) {
        skip(blocking, where.get(blocking) ?? '');
        pending.splice(
          pending.findIndex((p) => p.id === blocking),
          1,
        );
      }
      continue;
    }
    // Held by a list this round leaves alone: wait for the next round.
    for (const p of pending.splice(0)) skip(p.id, where.get(p.id) ?? p.to);
  }
  // Changed lists written, new ones created (never over a file), tasks others deleted to Trash.
  const mergedTasks = new Set<string>();
  for (const target of mergedById.values())
    for (const task of taskIds(target.text)) mergedTasks.add(task);
  for (const [id, target] of mergedById) {
    if (skipped.has(id)) continue;
    const text = serializeDocument(applyPersonal(parseDocument(target.text), mine));
    const here = localById.get(id);
    if (here) {
      if (where.get(id) !== target.name) continue;
      for (const task of taskIds(here.text)) {
        if (mergedTasks.has(task)) continue;
        const block = taskBlock(parseDocument(here.text), task);
        if (block !== null) {
          await local.trashTask(target.name, block);
          report.trashedTasks.push([target.name, task]);
        }
      }
      if (here.text !== text) {
        await local.write(target.name, text);
        report.written.push(target.name);
      }
    } else if (holder.has(target.name)) {
      skip(id, target.name);
    } else {
      try {
        await local.create(target.name, text);
        holder.set(target.name, id);
        report.created.push(target.name);
      } catch {
        skip(id, target.name);
      }
    }
  }
  // The bookkeeping, as merged.
  const localMeta = await local.meta();
  for (const [name, text] of merged.meta)
    if (localMeta.get(name) !== text) await local.writeMeta(name, text);

  // 4. The next base, per list ID.
  const baseLists = new Map<string, string>();
  for (const [id, target] of mergedById) {
    if (!skipped.has(id)) baseLists.set(target.name, target.text);
  }
  for (const id of skipped) {
    const name = ourIds.get(id);
    const text = name === undefined ? undefined : shared.get(name);
    if (name !== undefined && text !== undefined && !baseLists.has(name)) baseLists.set(name, text);
  }
  await base.write(writeSpaceArchive({ lists: baseLists, meta: merged.meta }, codec));
  return { uploaded: written.wrote, ...report };
}
