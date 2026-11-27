/**
 * D-190 Q8, Q11 (docs/04 §9): `.flintspace`, a space's text as one zip: its lists and notes (the
 * shared copies, `personal.ts`) and its bookkeeping (`space.json`, `items.json`, `groups.json`,
 * `removed.json`, `compat.json`, `people.json`). It comes from other people's Flint, so it is
 * checked whole before anything is written (Q11): at most 10,000 entries and 20 MB of text; only
 * those bookkeeping names and top-level `<name>.md` files whose name Windows takes as a list's
 * (no folders, no `..`, no absolute paths, nothing starting with a dot, no two names Windows would
 * see as one); text in UTF-8; `space.json` present. A file failing any check isn't applied at all.
 */
import { isSafeFileName, nameTaken } from './untrusted-names.js';
import { encodeUtf8 } from '../sync/utf8.js';
import { readZip, strictUtf8, writeZip, ZipError, type ZipCodec, type ZipProblem } from './zip.js';

export const SPACE_ARCHIVE_LIMITS = { maxEntries: 10_000, maxTotal: 20 * 1024 * 1024 } as const;

/**
 * The prefix of a list's temporary name while a sync round swaps names (`space-sync.ts`): never a
 * list's name in a space's file (a round uploads such a list under its real name).
 */
export const MOVING_PREFIX = '~flint-moving ';

/** The bookkeeping files a `.flintspace` may hold. */
export const SPACE_META = [
  'space.json',
  'items.json',
  'groups.json',
  'removed.json',
  'compat.json',
  'people.json',
] as const;
export type SpaceMetaName = (typeof SPACE_META)[number];

export interface SpaceArchive {
  /** Lists and notes by name (without `.md`): their text. */
  readonly lists: ReadonlyMap<string, string>;
  readonly meta: ReadonlyMap<SpaceMetaName, string>;
}

export type SpaceArchiveProblem = ZipProblem | 'not-text' | 'no-space-json' | 'name-clash';

export class SpaceArchiveError extends Error {
  readonly problem: SpaceArchiveProblem;

  constructor(problem: SpaceArchiveProblem, message: string = problem) {
    super(message);
    this.name = 'SpaceArchiveError';
    this.problem = problem;
  }
}

const isMeta = (name: string): name is SpaceMetaName =>
  (SPACE_META as readonly string[]).includes(name);

/** A list's name from an entry's, or null when the entry isn't one Flint would write. */
function listName(entry: string): string | null {
  if (!entry.endsWith('.md')) return null;
  const name = entry.slice(0, -3);
  // The file's name and the list's (no trailing space or dot before `.md` either).
  if (!isSafeFileName(entry) || !isSafeFileName(name) || name.startsWith(MOVING_PREFIX))
    return null;
  return name;
}

/** A `.flintspace`'s content, checked (Q11). Throws `SpaceArchiveError`. */
export function readSpaceArchive(bytes: Uint8Array, codec: ZipCodec): SpaceArchive {
  let entries;
  try {
    entries = readZip(bytes, codec, SPACE_ARCHIVE_LIMITS);
  } catch (error) {
    if (error instanceof ZipError) throw new SpaceArchiveError(error.problem, error.message);
    throw error;
  }
  const lists = new Map<string, string>();
  const meta = new Map<SpaceMetaName, string>();
  const taken = nameTaken();
  for (const entry of entries) {
    let text: string;
    try {
      text = strictUtf8(entry.data);
    } catch {
      throw new SpaceArchiveError('not-text', entry.name);
    }
    if (isMeta(entry.name)) {
      meta.set(entry.name, text);
      continue;
    }
    const name = listName(entry.name);
    if (name === null) throw new SpaceArchiveError('bad-name', entry.name);
    if (taken(name)) throw new SpaceArchiveError('name-clash', entry.name);
    lists.set(name, text);
  }
  if (!meta.has('space.json')) throw new SpaceArchiveError('no-space-json');
  return { lists, meta };
}

/** The `.flintspace` for this content: bookkeeping first, then lists by name. */
export function writeSpaceArchive(
  archive: SpaceArchive,
  codec: Pick<ZipCodec, 'deflate'>,
): Uint8Array {
  const entries = [
    ...SPACE_META.flatMap((name) => {
      const text = archive.meta.get(name);
      return text === undefined ? [] : [{ name, data: encodeUtf8(text) }];
    }),
    ...[...archive.lists.keys()]
      .sort()
      .map((name) => ({ name: `${name}.md`, data: encodeUtf8(archive.lists.get(name) ?? '') })),
  ];
  // Never a file the other members would refuse (the Q11 review's L4).
  const taken = nameTaken();
  let total = 0;
  for (const entry of entries) {
    total += entry.data.length;
    if (isMeta(entry.name)) continue;
    const name = listName(entry.name);
    if (name === null) throw new SpaceArchiveError('bad-name', entry.name);
    if (taken(name)) throw new SpaceArchiveError('name-clash', entry.name);
  }
  if (entries.length > SPACE_ARCHIVE_LIMITS.maxEntries) throw new SpaceArchiveError('too-many');
  if (total > SPACE_ARCHIVE_LIMITS.maxTotal) throw new SpaceArchiveError('too-big');
  return writeZip(entries, codec);
}
