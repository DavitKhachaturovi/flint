/**
 * SPACE-02 (D-190, docs/04 §9 and §7, docs/05 §5 "Sync reuses the engine"): a whole space merged,
 * three ways, with personal sync's rules: lists and notes matched by their list ID (the file name
 * may differ), their content merged together by `mergeLists` (tasks by ID, so a task can move
 * between lists; notes as text; the frontmatter key by key). A list one side deleted and the other
 * left as it was is gone; one deleted on one side and edited on the other comes back (the edit
 * wins, as in personal sync). A rename on one side is taken (on both, this side's); two lists that
 * end up with one name are told apart ("Groceries 2"), the same on every device.
 */
import { parseDocument } from '../format/document.js';
import {
  mergeLists,
  type ListsMergeContext,
  type ListVersions,
  type TrashedTask,
} from '../sync/merge.js';
import {
  readSpaceArchive,
  writeSpaceArchive,
  type SpaceArchive,
  type SpaceMetaName,
} from './space-archive.js';
import { nameTaken } from './untrusted-names.js';
import type { Merge3 } from './write-safely.js';
import type { ZipCodec } from './zip.js';

export interface SpaceListsMerge {
  /** The merged lists and notes by file name (without `.md`). */
  readonly lists: ReadonlyMap<string, string>;
  /** Conflict callouts added, by list ID. */
  readonly conflicts: ReadonlyMap<string, number>;
  /** Tasks this side had that the other side deleted (to this side's Trash). */
  readonly trashed: readonly TrashedTask[];
  /** Incoming tasks re-IDed because their ID was taken here: old → new. */
  readonly reIded: ReadonlyMap<string, string>;
  /** Lists gone in the merge (deleted on one side, unchanged on the other), by ID. */
  readonly deleted: readonly string[];
}

interface Entry {
  readonly name: string;
  readonly text: string;
}

/** Each list by its ID (`file:<name>` for one without, which Flint never writes in a space). */
function byId(lists: ReadonlyMap<string, string> | null): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const [name, text] of lists ?? []) {
    const id = parseDocument(text).frontmatter?.id ?? `file:${name}`;
    if (!out.has(id)) out.set(id, { name, text });
  }
  return out;
}

/** The lists and notes of a space, merged (base null: the first meeting of the two sides). */
export function mergeSpaceLists(
  base: ReadonlyMap<string, string> | null,
  mine: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
  context: ListsMergeContext,
): SpaceListsMerge {
  const b = byId(base);
  const m = byId(mine);
  const t = byId(theirs);
  const ids = [...new Set([...m.keys(), ...t.keys()])].sort();
  const versions: ListVersions[] = [];
  const names = new Map<string, string>();
  const deleted: string[] = [];
  for (const id of ids) {
    const was = b.get(id);
    const ours = m.get(id);
    const their = t.get(id);
    // Gone on one side: deleted there if the other side left it as it was; else the edit wins.
    if (!their && ours && was) {
      if (ours.text === was.text) {
        deleted.push(id);
        continue;
      }
    }
    if (!ours && their && was) {
      if (their.text === was.text) {
        deleted.push(id);
        continue;
      }
    }
    versions.push({
      listId: id,
      // Deleted on one side and edited on the other: the edit wins and the whole list comes back,
      // as in personal sync (merged without a base, so its tasks don't read as deleted there).
      base: ours && their ? (was?.text ?? null) : null,
      mine: ours?.text ?? null,
      theirs: their?.text ?? null,
    });
    // Its name: a rename on one side is taken; on both, this side's.
    const name =
      ours && their
        ? was && ours.name === was.name
          ? their.name
          : ours.name
        : (ours ?? their)?.name;
    if (name !== undefined) names.set(id, name);
  }
  const merged = mergeLists(versions, context);
  // Names told apart in ID order: the same on every device.
  const taken = nameTaken();
  const lists = new Map<string, string>();
  for (const id of ids) {
    const text = merged.texts.get(id);
    const wanted = names.get(id);
    if (text === undefined || wanted === undefined) continue;
    let name = wanted;
    for (let n = 2; taken(name); n++) name = `${wanted} ${n}`;
    lists.set(name, text);
  }
  return {
    lists,
    conflicts: merged.conflicts,
    trashed: merged.trashed,
    reIded: merged.reIded,
    deleted,
  };
}

/** A bookkeeping file merged as a whole: this side's when it changed it, else the other side's. */
function mergeMeta(
  base: SpaceArchive | null,
  mine: SpaceArchive,
  theirs: SpaceArchive,
): Map<SpaceMetaName, string> {
  const out = new Map<SpaceMetaName, string>();
  for (const name of new Set([...mine.meta.keys(), ...theirs.meta.keys()])) {
    const ours = mine.meta.get(name);
    const their = theirs.meta.get(name);
    const was = base?.meta.get(name);
    const value = ours !== undefined && ours !== was ? ours : (their ?? ours);
    if (value !== undefined) out.set(name, value);
  }
  return out;
}

/**
 * `writeSafely`'s merge for a `.flintspace`: the three archives read (the other side's checked,
 * D-190 Q11), their lists merged, and written again. `context` names this device and the other
 * side for conflict callouts.
 */
export function spaceMerge3(codec: ZipCodec, context: ListsMergeContext): Merge3 {
  return (baseBytes, mineBytes, theirsBytes) => {
    const base = baseBytes === null ? null : readSpaceArchive(baseBytes, codec);
    const mine = readSpaceArchive(mineBytes, codec);
    const theirs = readSpaceArchive(theirsBytes, codec);
    const lists = mergeSpaceLists(base?.lists ?? null, mine.lists, theirs.lists, context).lists;
    return writeSpaceArchive({ lists, meta: mergeMeta(base, mine, theirs) }, codec);
  };
}
