/**
 * SPACE-02 (D-190, docs/04 §9, docs/05 §5): one sync round of a space's text with its provider.
 * 1. This side's lists and notes are read and split (`splitPersonal`: your pins, reminders and
 *    mutes stay here); with the space's bookkeeping they make this side's `.flintspace`. A round
 *    refuses to start (nothing uploaded) while two files claim one list ID (a copy made outside
 *    Flint) or a task list's pinned, reminded or muted task has no ID (not saved by Flint yet).
 *    After a round that stopped half-way through renames (a file named `~flint-moving …` is left),
 *    every list goes up under the name the base has for it, so the interrupted renames, which were
 *    the other side's, are simply applied again.
 * 2. It is written safely (`writeSafely`, Q9), merged with whatever the provider holds
 *    (`spaceMerge3`: lists by ID, deletes against edits, renames; the other side's file checked).
 * 3. The merged space comes back to the local files **by list ID**, never by name alone, and no
 *    file is ever replaced: lists the merge dropped go to Trash; renames go where the name is free
 *    (names compared as Windows does), a cycle (a swap) through a temporary name, and one waiting
 *    on a list left alone waits a round; changed lists are written, new ones created; tasks another
 *    member deleted go to Trash; the bookkeeping is written. A list or bookkeeping file changed
 *    here during the round (`changedSince`, checked again right before each write) is left for the
 *    next round.
 * 4. The next base, per list ID: the merged space, except what was left alone this round, whose
 *    base stays what its local text was made from. Your fields on tasks that couldn't be put in
 *    place this round (moved into a list left alone) are kept for the next (`carried`).
 * Nothing is written locally before the provider has the merged space. The app holds its own
 * writes to the space's files while a round applies, and flushes unsaved typing before `lists()`.
 */
import {
  allTasks,
  isProvisionalKey,
  parseDocument,
  serializeDocument,
  type FlintDocument,
} from '../format/document.js';
import { ID_PATTERN } from '../format/fields.js';
import type { ListsMergeContext } from '../sync/merge.js';
import { applyPersonal, splitPersonal, type PersonalFields } from './personal.js';
import {
  readSpaceArchive,
  writeSpaceArchive,
  type SpaceArchive,
  type SpaceMetaName,
} from './space-archive.js';
import { listIdOf, spaceMerge3 } from './space-merge.js';
import type { SpaceStore } from './store.js';
import { windowsKeys } from './untrusted-names.js';
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
  /**
   * Renames a list; throws when another file is named `to` (never replaces one). A rename that
   * changes only the case of the name is allowed.
   */
  rename(from: string, to: string): Promise<void>;
  /** Into the space's Trash (Undo-able, never deleted outright). */
  trash(name: string): Promise<void>;
  /** A task another member deleted, into the space's Trash (`block`: its text, as in the list). */
  trashTask(name: string, block: string): Promise<void>;
  writeMeta(name: SpaceMetaName, text: string): Promise<void>;
}

/** What a round keeps between rounds: the merge base, and your fields still to put in place. */
export interface SpaceBase {
  read(): Promise<Uint8Array | null>;
  write(content: Uint8Array): Promise<void>;
  /** Your fields on tasks a round couldn't put in place yet (JSON, local only). */
  readCarried(): Promise<string | null>;
  writeCarried(text: string): Promise<void>;
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

/** One key per file name as Windows sees it. */
const nameKey = (name: string): string => windowsKeys(name)[0] ?? name;

/** A task's own text (its line, body and subtasks), as Trash keeps it. */
function taskBlock(document: FlintDocument, key: string): string | null {
  for (const { task } of allTasks(document))
    if (task.key === key)
      return serializeDocument({ ...document, frontmatter: null, blocks: [task] }).trimEnd();
  return null;
}

/** Your fields as `carried` keeps them: their text, put back as written. */
function writeCarried(fields: ReadonlyMap<string, PersonalFields>): string {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, each] of fields) {
    const entry: Record<string, string> = {};
    if (each.reminder) entry['reminder'] = each.reminder.raw?.value ?? '';
    if (each.muted) entry['muted'] = each.muted.raw?.value ?? 'true';
    if (each.pinned) entry['pinned'] = each.pinned.raw?.value ?? 'true';
    out[id] = entry;
  }
  return JSON.stringify(out);
}

function readCarried(text: string | null): Map<string, PersonalFields> {
  const out = new Map<string, PersonalFields>();
  if (text === null) return out;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof data !== 'object' || data === null) return out;
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!ID_PATTERN.test(id) || typeof value !== 'object' || value === null) continue;
    // Read back through the format's own reader, so the fields are exactly what a line holds.
    const entry = value as Record<string, unknown>;
    const parts = ['reminder', 'muted', 'pinned']
      .filter((key) => typeof entry[key] === 'string')
      .map((key) => `[${key}:: ${String(entry[key])}]`);
    const line = parseDocument(`- [ ] x ${parts.join(' ')} [id:: ${id}]\n`);
    const fields = [...allTasks(line)][0]?.task.line.fields;
    if (!fields) continue;
    const { reminder, muted, pinned } = fields;
    if (reminder || muted || pinned)
      out.set(id, {
        ...(reminder && { reminder }),
        ...(muted && { muted }),
        ...(pinned && { pinned }),
      });
  }
  return out;
}

export async function spaceRound(options: SpaceRoundOptions): Promise<SpaceRoundReport> {
  const { store, fileId, local, base, codec, context } = options;
  const lists = await local.lists();
  const metaBefore = await local.meta();
  const before = await base.read();
  const baseArchive: SpaceArchive | null = before ? readSpaceArchive(before, codec) : null;
  const baseNames = new Map<string, string>();
  for (const [name, text] of baseArchive?.lists ?? []) baseNames.set(listIdOf(name, text), name);

  // 1. This side's space, your fields kept apart; refused while IDs are doubled or unsaved.
  const localById = new Map<string, { name: string; text: string }>();
  const sharedById = new Map<string, string>();
  const mine = readCarried(await base.readCarried());
  for (const [name, text] of lists) {
    const id = listIdOf(name, text);
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
    sharedById.set(id, serializeDocument(split.shared));
  }
  // The names going up: after a round stopped half-way through renames, the base's.
  const recovering = [...lists.keys()].some((name) => name.startsWith(MOVING_PREFIX));
  const upNames = new Map<string, string>();
  const upTaken = new Set<string>();
  const order = [...localById].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const claim = (id: string, wanted: string): void => {
    let name = wanted;
    for (let n = 2; upTaken.has(nameKey(name)); n++) name = `${wanted} ${n}`;
    upTaken.add(nameKey(name));
    upNames.set(id, name);
  };
  // Names from the base first (they are unique), then the rest.
  if (recovering)
    for (const [id] of order) {
      const was = baseNames.get(id);
      if (was !== undefined) claim(id, was);
    }
  for (const [id, here] of order)
    if (!upNames.has(id))
      claim(
        id,
        here.name.startsWith(MOVING_PREFIX) ? here.name.slice(MOVING_PREFIX.length) : here.name,
      );
  const shared = new Map<string, string>();
  for (const [id, text] of sharedById) shared.set(upNames.get(id) ?? '', text);
  const ours = writeSpaceArchive({ lists: shared, meta: metaBefore }, codec);

  // 2. Up, merged with the provider's.
  const written = await writeSafely(store, fileId, before, ours, spaceMerge3(codec, context));
  const merged = readSpaceArchive(written.content, codec);
  const mergedById = new Map<string, { name: string; text: string }>();
  for (const [name, text] of merged.lists) mergedById.set(listIdOf(name, text), { name, text });

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
  /** Which list holds each file name now (by Windows' key) and where each list is. */
  const holder = new Map<string, string>();
  const where = new Map<string, string>();
  for (const [id, here] of localById) {
    holder.set(nameKey(here.name), id);
    where.set(id, here.name);
  }
  const heldByOther = (name: string, id: string): boolean => {
    const owner = holder.get(nameKey(name));
    return owner !== undefined && owner !== id;
  };
  // Lists changed during the round are left alone, whatever the merge did to them.
  for (const [id, here] of localById)
    if (await local.changedSince(here.name, here.text)) skip(id, here.name);
  // Lists the merge dropped: to Trash.
  for (const [id, here] of localById) {
    if (mergedById.has(id) || skipped.has(id)) continue;
    await local.trash(here.name);
    holder.delete(nameKey(here.name));
    where.delete(id);
    report.trashed.push(here.name);
  }
  // Renames, never onto a name another list holds.
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
    holder.delete(nameKey(from));
    holder.set(nameKey(to), id);
    where.set(id, to);
    return true;
  };
  /** Whether following the holders from this rename comes back to it (a cycle, not a chain). */
  const inCycle = (start: { id: string; to: string }): boolean => {
    const seen = new Set<string>();
    let at: { id: string; to: string } | undefined = start;
    while (at) {
      const owner = holder.get(nameKey(at.to));
      if (owner === undefined || owner === at.id) return false;
      if (owner === start.id) return true;
      if (seen.has(owner)) return false;
      seen.add(owner);
      at = pending.find((p) => p.id === owner);
    }
    return false;
  };
  while (pending.length > 0) {
    const free = pending.findIndex((p) => !heldByOther(p.to, p.id));
    if (free >= 0) {
      const [p] = pending.splice(free, 1);
      if (!p) break;
      const from = where.get(p.id) ?? '';
      if (await move(p.id, p.to)) report.renamed.push([from, p.to]);
      else skip(p.id, from);
      continue;
    }
    const cycle = pending.find(inCycle);
    if (cycle) {
      // A swap: one list aside under a temporary name made from its own (checked) name.
      const aside = holder.get(nameKey(cycle.to)) ?? '';
      const from = where.get(aside) ?? '';
      const temporary = `${MOVING_PREFIX}${from}`.slice(0, 200);
      if (heldByOther(temporary, aside) || !(await move(aside, temporary))) {
        skip(aside, from);
        pending.splice(
          pending.findIndex((p) => p.id === aside),
          1,
        );
      }
      continue;
    }
    // A chain ending at a list left alone: it waits for the next round.
    for (const p of pending.splice(0)) skip(p.id, where.get(p.id) ?? p.to);
  }
  // Changed lists written, new ones created (never over a file), tasks others deleted to Trash.
  const mergedTasks = new Set<string>();
  for (const target of mergedById.values())
    for (const { task } of allTasks(parseDocument(target.text))) mergedTasks.add(task.key);
  const placed = new Set<string>();
  for (const [id, target] of mergedById) {
    if (skipped.has(id)) continue;
    const text = serializeDocument(applyPersonal(parseDocument(target.text), mine));
    const here = localById.get(id);
    if (here) {
      if (where.get(id) !== target.name) continue;
      // Changed meanwhile (an editor's save during the renames): left for the next round.
      if (await local.changedSince(target.name, here.text)) {
        skip(id, target.name);
        continue;
      }
      const document = parseDocument(here.text);
      const gone = new Set(
        [...allTasks(document)]
          .map(({ task }) => task.key)
          .filter((key) => !isProvisionalKey(key) && !mergedTasks.has(key)),
      );
      for (const { task, parent } of allTasks(document)) {
        // A deleted parent takes its subtasks with it (in Trash once).
        if (!gone.has(task.key) || (parent && gone.has(parent.key))) continue;
        const block = taskBlock(document, task.key);
        if (block === null) continue;
        await local.trashTask(target.name, block);
        report.trashedTasks.push([target.name, task.key]);
      }
      if (here.text !== text) {
        await local.write(target.name, text);
        report.written.push(target.name);
      }
    } else if (holder.has(nameKey(target.name))) {
      skip(id, target.name);
      continue;
    } else {
      try {
        await local.create(target.name, text);
        holder.set(nameKey(target.name), id);
        report.created.push(target.name);
      } catch {
        skip(id, target.name);
        continue;
      }
    }
    for (const { task } of allTasks(parseDocument(target.text))) placed.add(task.key);
  }
  // The bookkeeping, as merged, unless changed here during the round.
  const metaNow = await local.meta();
  const metaKept = new Set<SpaceMetaName>();
  for (const [name, text] of merged.meta) {
    if (metaNow.get(name) !== metaBefore.get(name)) {
      metaKept.add(name);
      continue;
    }
    if (metaNow.get(name) !== text) await local.writeMeta(name, text);
  }

  // 4. The next base, per list ID; your fields still to place carried.
  const baseLists = new Map<string, string>();
  const baseTaken = new Set<string>();
  const put = (name: string, text: string): void => {
    let key = name;
    for (let n = 2; baseTaken.has(nameKey(key)); n++) key = `${name} (${n})`;
    baseTaken.add(nameKey(key));
    baseLists.set(key, text);
  };
  for (const [id, target] of mergedById) if (!skipped.has(id)) put(target.name, target.text);
  for (const id of skipped) {
    const text = sharedById.get(id);
    const name = upNames.get(id);
    if (text !== undefined && name !== undefined) put(name, text);
  }
  const baseMeta = new Map(merged.meta);
  for (const name of metaKept) {
    const kept = metaBefore.get(name);
    if (kept !== undefined) baseMeta.set(name, kept);
  }
  await base.write(writeSpaceArchive({ lists: baseLists, meta: baseMeta }, codec));
  const carried = new Map<string, PersonalFields>();
  for (const [task, fields] of mine)
    if (mergedTasks.has(task) && !placed.has(task)) carried.set(task, fields);
  await base.writeCarried(writeCarried(carried));
  return { uploaded: written.wrote, ...report };
}
