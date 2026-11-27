/**
 * SPACE-02 (D-190, docs/04 §9, docs/05 §5): one sync round of a space's text with its provider.
 * 1. This side's lists and notes are read and split (`splitPersonal`: your pins, reminders and
 *    mutes stay here); with the space's bookkeeping they make this side's `.flintspace`.
 * 2. It is written safely (`writeSafely`, Q9), merged with whatever the provider holds
 *    (`spaceMerge3`: lists by ID, deletes against edits, renames; the other side's file checked,
 *    Q11).
 * 3. The merged space comes back to the local files with your fields put back by task ID: a list
 *    whose text differs is written, one renamed is renamed, one the merge deleted goes to Trash
 *    (never deleted outright), a new one is made.
 * 4. The merged file is kept as the next round's base.
 * Nothing is written locally before the provider has the merged space, and a list changed here
 * while the round ran is never overwritten (`changedSince`: the round leaves it, the next one takes
 * it). Task lists are saved by Flint before a round (every task with its ID): `unkeyed` is checked.
 */
import { parseDocument, serializeDocument } from '../format/document.js';
import type { ListsMergeContext } from '../sync/merge.js';
import { applyPersonal, splitPersonal, type PersonalFields } from './personal.js';
import { readSpaceArchive, writeSpaceArchive, type SpaceMetaName } from './space-archive.js';
import { spaceMerge3 } from './space-merge.js';
import type { SpaceStore } from './store.js';
import { writeSafely } from './write-safely.js';
import type { ZipCodec } from './zip.js';

/** A space's folder on this device, as the round sees it. */
export interface LocalSpace {
  /** Its lists and notes now: file name (without `.md`) → text, as saved by Flint. */
  lists(): Promise<ReadonlyMap<string, string>>;
  /** Its bookkeeping files now (`space.json` and the rest). */
  meta(): Promise<ReadonlyMap<SpaceMetaName, string>>;
  /**
   * Whether this list's file changed since `lists()` read it (an edit during the round): then the
   * round leaves it alone and the next one merges it.
   */
  changedSince(name: string, text: string): Promise<boolean>;
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Into the space's Trash (Undo-able, never deleted outright). */
  trash(name: string): Promise<void>;
}

/** What a round keeps between rounds: the merged file last written or read (the merge base). */
export interface SpaceBase {
  read(): Promise<Uint8Array | null>;
  write(content: Uint8Array): Promise<void>;
}

export interface SpaceRoundReport {
  /** Whether this side's changes went up. */
  readonly uploaded: boolean;
  readonly written: readonly string[];
  readonly renamed: readonly (readonly [string, string])[];
  readonly trashed: readonly string[];
  /** Lists changed here during the round: left for the next one. */
  readonly skipped: readonly string[];
  /** Tasks without an ID that kept personal fields (should be none: lists are saved first). */
  readonly unkeyed: number;
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

export async function spaceRound(options: SpaceRoundOptions): Promise<SpaceRoundReport> {
  const { store, fileId, local, base, codec, context } = options;
  // 1. This side's space, your fields kept apart.
  const lists = await local.lists();
  const shared = new Map<string, string>();
  const mine = new Map<string, PersonalFields>();
  let unkeyed = 0;
  for (const [name, text] of lists) {
    const split = splitPersonal(parseDocument(text));
    unkeyed += split.unkeyed;
    for (const [id, fields] of split.mine) mine.set(id, fields);
    shared.set(name, serializeDocument(split.shared));
  }
  const ours = writeSpaceArchive({ lists: shared, meta: await local.meta() }, codec);
  const before = await base.read();
  // 2. Up, merged with the provider's.
  const written = await writeSafely(store, fileId, before, ours, spaceMerge3(codec, context));
  // 3. Back to the local files.
  const merged = readSpaceArchive(written.content, codec);
  const localById = new Map<string, { name: string; text: string }>();
  for (const [name, text] of lists) localById.set(idOf(name, text), { name, text });
  const report = {
    written: [] as string[],
    renamed: [] as [string, string][],
    trashed: [] as string[],
    skipped: [] as string[],
  };
  const kept = new Set<string>();
  for (const [name, sharedText] of merged.lists) {
    const id = idOf(name, sharedText);
    kept.add(id);
    const text = serializeDocument(applyPersonal(parseDocument(sharedText), mine));
    const here = localById.get(id);
    if (here && (await local.changedSince(here.name, here.text))) {
      report.skipped.push(here.name);
      continue;
    }
    if (here && here.name !== name) {
      await local.rename(here.name, name);
      report.renamed.push([here.name, name]);
    }
    if (!here || here.text !== text) {
      await local.write(name, text);
      report.written.push(name);
    }
  }
  for (const [id, here] of localById) {
    if (kept.has(id)) continue;
    if (await local.changedSince(here.name, here.text)) {
      report.skipped.push(here.name);
      continue;
    }
    await local.trash(here.name);
    report.trashed.push(here.name);
  }
  // 4. The next base: the merged space, except a list left here (edited during the round): its
  // base stays what its local text was made from, this side's copy, so the next round merges the
  // edit against that and not against changes this side never took in.
  const skipped = new Set(report.skipped);
  const baseLists = new Map<string, string>();
  for (const [name, text] of merged.lists) {
    const here = localById.get(idOf(name, text));
    if (here && skipped.has(here.name)) continue;
    baseLists.set(name, text);
  }
  for (const [name] of lists) if (skipped.has(name)) baseLists.set(name, shared.get(name) ?? '');
  await base.write(writeSpaceArchive({ lists: baseLists, meta: merged.meta }, codec));
  return { uploaded: written.wrote, unkeyed, ...report };
}
