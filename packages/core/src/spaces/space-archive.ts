/**
 * D-190 Q8, Q11 (docs/04 §9): `.flintspace`, a space's text as one zip: its lists and notes (the
 * shared copies, `personal.ts`) and its bookkeeping (`space.json`, `items.json`, `groups.json`,
 * `removed.json`, `compat.json`, `people.json`). It comes from other people's Flint, so it is
 * checked whole before anything is written (Q11): at most 10,000 entries and 20 MB of text; only
 * those bookkeeping names and top-level `<name>.md` files whose name Windows takes as a list's
 * (no folders, no `..`, no absolute paths, nothing starting with a dot, no two names Windows would
 * see as one); text in UTF-8; `space.json` present. A file failing any check isn't applied at all.
 */
import { isValidListName } from '../shorthand/lists.js';
import { encodeUtf8 } from '../sync/utf8.js';
import { readZip, strictUtf8, writeZip, ZipError, type ZipCodec, type ZipProblem } from './zip.js';

export const SPACE_ARCHIVE_LIMITS = { maxEntries: 10_000, maxTotal: 20 * 1024 * 1024 } as const;

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
  if (!isValidListName(name) || name.startsWith('.') || name.trim() !== name) return null;
  return name;
}

/** How Windows compares file names: one key for names that would be the same file. */
const fileKey = (name: string): string => name.normalize('NFC').toLowerCase();

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
  const seen = new Set<string>();
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
    const key = fileKey(name);
    if (seen.has(key)) throw new SpaceArchiveError('name-clash', entry.name);
    seen.add(key);
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
  for (const entry of entries)
    if (!isMeta(entry.name) && listName(entry.name) === null)
      throw new SpaceArchiveError('bad-name', entry.name);
  return writeZip(entries, codec);
}
