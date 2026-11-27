/**
 * D-190 Q9 (docs/04 §9 "The write gap"): a space's file written whole without losing another
 * member's write. Read, merge, write with the expected revision; `changed` → read, merge, write
 * again. Drive has no conditional write (the revision is checked, then the file written), so after
 * every write to such a store the file's revisions are listed: if the one before ours isn't the one
 * merged against, another member's write landed in the gap and was replaced; each such revision is
 * read back (Drive keeps them 30 days), merged in, and the file written again. OneDrive's `If-Match`
 * refuses such a write instead (`changed`). The same repair serves personal sync's files (04 §7).
 */
import { sha256 } from './sha256.js';
import { SpaceStoreError, type SpaceFileRef, type SpaceStore } from './store.js';

/** A three-way merge of a file's content: `base` → `mine` and `base` → `theirs`. */
export type Merge3 = (base: Uint8Array | null, mine: Uint8Array, theirs: Uint8Array) => Uint8Array;

export interface Written {
  readonly ref: SpaceFileRef;
  /** What the file holds now: the next merge base. */
  readonly content: Uint8Array;
  /** Whether anything was written (an unchanged file isn't). */
  readonly wrote: boolean;
}

/** Rounds before giving up (`changed`): another member writing continuously. */
export const WRITE_TRIES = 6;

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * A write whose gap check hadn't run when the device stopped (the network gone, the app closed):
 * the revision merged against, and the hash of what was written. Kept before each write and
 * cleared once checked, so the next run finishes the check (the third review of the sync round).
 */
export interface PendingWrite {
  readonly revision: string;
  readonly hash: string;
}

export interface WriteJournal {
  read(): Promise<PendingWrite | null>;
  write(pending: PendingWrite | null): Promise<void>;
}

export interface WriteOptions {
  readonly journal?: WriteJournal;
  /** SHA-256 as hex (the platform's in the app). */
  readonly hash?: (data: Uint8Array) => string;
}

/**
 * The revisions a write left unchecked replaced: those between the one merged against and the one
 * holding what was written (found by its hash). None when that write never landed.
 */
async function replacedBy(
  store: SpaceStore,
  fileId: string,
  pending: PendingWrite,
  hash: (data: Uint8Array) => string,
): Promise<{ readonly from: Uint8Array; readonly lost: readonly Uint8Array[] } | null> {
  const revisions = await store.revisions(fileId);
  const from = revisions.findIndex((each) => each.revision === pending.revision);
  if (from < 0) return null;
  const lost: Uint8Array[] = [];
  for (const each of revisions.slice(from + 1)) {
    const data = await store.readRevision(fileId, each.revision);
    if (hash(data) === pending.hash) {
      return { from: await store.readRevision(fileId, pending.revision), lost };
    }
    lost.push(data);
  }
  return null;
}

/**
 * Writes this device's `mine` (changed from `base`, the content last synced) into the file,
 * merged with whatever the file holds, keeping every other member's write.
 */
export async function writeSafely(
  store: SpaceStore,
  fileId: string,
  base: Uint8Array | null,
  mine: Uint8Array,
  merge: Merge3,
  options: WriteOptions = {},
): Promise<Written> {
  const { journal } = options;
  const hash = options.hash ?? sha256;
  /** The file as last known: what `content` was merged against. */
  let current = await store.read(fileId);
  let content = merge(base, mine, current.content);
  // A write the last run didn't get to check: what it replaced is merged in first.
  const pending = await journal?.read();
  if (pending && !store.conditionalWrites) {
    const replaced = await replacedBy(store, fileId, pending, hash);
    if (replaced) {
      let previous = replaced.from;
      for (const theirs of replaced.lost) {
        content = merge(previous, content, theirs);
        previous = theirs;
      }
    }
  }
  let wrote = false;
  const done = async (written: Written): Promise<Written> => {
    await journal?.write(null);
    return written;
  };
  for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
    if (same(content, current.content)) return done({ ref: current.ref, content, wrote });
    let written: SpaceFileRef;
    try {
      await journal?.write({ revision: current.ref.revision, hash: hash(content) });
      written = await store.write(fileId, content, current.ref.revision);
    } catch (error) {
      if (!(error instanceof SpaceStoreError) || error.problem !== 'changed') throw error;
      // Someone wrote since it was read: their version merged with ours, against what we had.
      const before = current.content;
      current = await store.read(fileId);
      content = merge(before, content, current.content);
      continue;
    }
    wrote = true;
    if (store.conditionalWrites) return done({ ref: written, content, wrote });
    // The gap (Q9): did another write land between the one merged against and ours?
    const revisions = await store.revisions(fileId);
    const ours = revisions.findIndex((each) => each.revision === written.revision);
    const from = revisions.findIndex((each) => each.revision === current.ref.revision);
    if (ours >= 0 && from >= 0 && from < ours) {
      const lost = revisions.slice(from + 1, ours);
      if (lost.length === 0) return done({ ref: written, content, wrote });
      // Each replaced revision merged in, in order, against the one before it; then written again
      // over ours.
      const writtenContent = content;
      let previous = current.content;
      for (const each of lost) {
        const theirs = await store.readRevision(fileId, each.revision);
        content = merge(previous, content, theirs);
        previous = theirs;
      }
      current = { ref: written, content: writtenContent };
      continue;
    }
    // The history doesn't show ours right after the one merged against (trimmed, or written over
    // already): read the file as it is now and merge again.
    const before = current.content;
    const writtenContent = content;
    current = await store.read(fileId);
    content = merge(before, writtenContent, current.content);
  }
  throw new SpaceStoreError('changed', 'the file kept changing while it was written');
}
