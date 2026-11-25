/**
 * D-190 Q8, Q11 (docs/04 §9): `.flintfiles`, a space's attachments as one zip, written only when
 * they change. Each file is an entry named by the SHA-256 of its bytes and listed in `index.json`
 * (hash → file name, size, who added it): `{ "flint": 1, "files": { "<hash>": { "name":
 * "20260310-ab12.png", "size": 1234, "addedBy": "<member>" } } }`. Two members adding pictures at
 * once merge as a union, never a conflict; an attachment no list links any more is dropped at the
 * next write; at most 100 MB in all. It comes from other people's Flint, so it is checked whole
 * before anything is written (Q11): every entry's bytes hash to its name, the index and the
 * entries match one to one with their sizes, names are plain attachment file names (no folders,
 * no `..`, nothing starting with a dot, no reserved names), no two files share a name, and the
 * limits hold. Written attachments get Mark-of-the-Web in the app (`Zone.Identifier`, ZoneId=3).
 */
import { isSafeAttachmentName, isSafeLabel, windowsKeys } from './untrusted-names.js';
import { encodeUtf8 } from '../sync/utf8.js';
import { sha256 } from './sha256.js';
import { readZip, strictUtf8, writeZip, ZipError, type ZipCodec, type ZipProblem } from './zip.js';

/** At most 100 MB of attachments (D-190 Q8) and 10,000 of them. */
export const FILES_LIMITS = { maxEntries: 10_001, maxTotal: 100 * 1024 * 1024 + 4 * 1024 * 1024 };
export const FILES_MAX_BYTES = 100 * 1024 * 1024;

export interface SpaceAttachment {
  /** The attachment's file name in `attachments/` (what lists link). */
  readonly name: string;
  readonly size: number;
  /** The member who added it. */
  readonly addedBy: string;
}

export interface FilesArchive {
  /** By content hash. */
  readonly index: ReadonlyMap<string, SpaceAttachment>;
  readonly data: ReadonlyMap<string, Uint8Array>;
}

export type FilesProblem =
  ZipProblem | 'no-index' | 'bad-index' | 'hash-mismatch' | 'missing' | 'name-clash' | 'too-big';

export class FilesArchiveError extends Error {
  readonly problem: FilesProblem;

  constructor(problem: FilesProblem, message: string = problem) {
    super(message);
    this.name = 'FilesArchiveError';
    this.problem = problem;
  }
}

const HASH = /^[0-9a-f]{64}$/;

/** Whether this is a plain attachment file name Flint would write in `attachments/`. */
export function isAttachmentName(name: string): boolean {
  return isSafeAttachmentName(name);
}

/** One key per file Windows would see: its upper-case form (how NTFS compares). */
const fileKey = (name: string): string => windowsKeys(name)[0] ?? name;

function readIndex(text: string): Map<string, SpaceAttachment> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FilesArchiveError('bad-index');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new FilesArchiveError('bad-index');
  const record = data as Record<string, unknown>;
  const files = record['files'];
  if (record['flint'] !== 1 || typeof files !== 'object' || files === null || Array.isArray(files))
    throw new FilesArchiveError('bad-index');
  const out = new Map<string, SpaceAttachment>();
  const names = new Set<string>();
  for (const [hash, value] of Object.entries(files as Record<string, unknown>)) {
    if (!HASH.test(hash) || typeof value !== 'object' || value === null)
      throw new FilesArchiveError('bad-index', hash);
    const { name, size, addedBy } = value as Record<string, unknown>;
    if (typeof name !== 'string' || !isAttachmentName(name))
      throw new FilesArchiveError('bad-name', String(name));
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0)
      throw new FilesArchiveError('bad-index', hash);
    if (typeof addedBy !== 'string' || !isSafeLabel(addedBy))
      throw new FilesArchiveError('bad-index', hash);
    if (windowsKeys(name).some((key) => names.has(key)))
      throw new FilesArchiveError('name-clash', name);
    for (const key of windowsKeys(name)) names.add(key);
    out.set(hash, { name, size, addedBy });
  }
  return out;
}

/** A `.flintfiles`'s content, checked (Q11). Throws `FilesArchiveError`. */
export function readFilesArchive(
  bytes: Uint8Array,
  codec: ZipCodec,
  /** SHA-256 as hex: core's by default; the app passes the platform's (pure JavaScript takes seconds on 100 MB). */
  hash: (data: Uint8Array) => string = sha256,
): FilesArchive {
  let entries;
  try {
    entries = readZip(bytes, codec, FILES_LIMITS);
  } catch (error) {
    if (error instanceof ZipError) throw new FilesArchiveError(error.problem, error.message);
    throw error;
  }
  const indexEntry = entries.find((entry) => entry.name === 'index.json');
  if (!indexEntry) throw new FilesArchiveError('no-index');
  let indexText: string;
  try {
    indexText = strictUtf8(indexEntry.data);
  } catch {
    throw new FilesArchiveError('bad-index');
  }
  const index = readIndex(indexText);
  const data = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of entries) {
    if (entry === indexEntry) continue;
    if (!HASH.test(entry.name)) throw new FilesArchiveError('bad-name', entry.name);
    const listed = index.get(entry.name);
    if (!listed) throw new FilesArchiveError('missing', entry.name);
    if (listed.size !== entry.data.length || hash(entry.data) !== entry.name)
      throw new FilesArchiveError('hash-mismatch', entry.name);
    total += entry.data.length;
    data.set(entry.name, entry.data);
  }
  if (total > FILES_MAX_BYTES) throw new FilesArchiveError('too-big');
  for (const hash of index.keys())
    if (!data.has(hash)) throw new FilesArchiveError('missing', hash);
  return { index, data };
}

/** The `.flintfiles` for these attachments (by hash). Throws `too-big` past 100 MB. */
export function writeFilesArchive(
  archive: FilesArchive,
  codec: Pick<ZipCodec, 'deflate'>,
): Uint8Array {
  const hashes = [...archive.index.keys()].sort();
  const files: Record<string, SpaceAttachment> = Object.create(null) as Record<
    string,
    SpaceAttachment
  >;
  let total = 0;
  // Never a file the other members would refuse (the Q11 review's L4).
  if (hashes.length >= FILES_LIMITS.maxEntries) throw new FilesArchiveError('too-many');
  const names = new Set<string>();
  for (const hash of hashes) {
    const entry = archive.index.get(hash);
    const data = archive.data.get(hash);
    if (!entry || !data) throw new FilesArchiveError('missing', hash);
    if (!isAttachmentName(entry.name)) throw new FilesArchiveError('bad-name', entry.name);
    if (windowsKeys(entry.name).some((key) => names.has(key)))
      throw new FilesArchiveError('name-clash', entry.name);
    for (const key of windowsKeys(entry.name)) names.add(key);
    total += data.length;
    files[hash] = { name: entry.name, size: data.length, addedBy: entry.addedBy };
  }
  if (total > FILES_MAX_BYTES) throw new FilesArchiveError('too-big');
  return writeZip(
    [
      { name: 'index.json', data: encodeUtf8(`${JSON.stringify({ flint: 1, files }, null, 2)}\n`) },
      ...hashes.map((hash) => ({ name: hash, data: archive.data.get(hash) ?? new Uint8Array() })),
    ],
    codec,
  );
}

/** An attachment as an archive entry: its hash and listing. */
export function attachmentEntry(
  name: string,
  data: Uint8Array,
  addedBy: string,
  hash: (data: Uint8Array) => string = sha256,
): { readonly hash: string; readonly entry: SpaceAttachment } {
  return { hash: hash(data), entry: { name, size: data.length, addedBy } };
}

/**
 * Two members' attachments as one: a union by hash. Two different files of one name (which Flint's
 * time-and-random names make all but impossible) keep the one whose hash sorts first, the same on
 * every device.
 */
export function mergeFiles(a: FilesArchive, b: FilesArchive): FilesArchive {
  const index = new Map(a.index);
  const data = new Map(a.data);
  for (const [hash, entry] of b.index) {
    const bytes = b.data.get(hash);
    if (bytes && !index.has(hash)) {
      index.set(hash, entry);
      data.set(hash, bytes);
    }
  }
  const byName = new Map<string, string>();
  for (const hash of [...index.keys()].sort()) {
    const key = fileKey(index.get(hash)?.name ?? '');
    if (byName.has(key)) {
      index.delete(hash);
      data.delete(hash);
    } else byName.set(key, hash);
  }
  return { index, data };
}

/** Without the attachments no list or note links any more (their file names). */
export function pruneFiles(archive: FilesArchive, linked: ReadonlySet<string>): FilesArchive {
  const index = new Map<string, SpaceAttachment>();
  const data = new Map<string, Uint8Array>();
  // Linked in any case or Unicode form: Windows opens the same file for either.
  const keys = new Set([...linked].map(fileKey));
  for (const [hash, entry] of archive.index) {
    if (!keys.has(fileKey(entry.name))) continue;
    const bytes = archive.data.get(hash);
    if (!bytes) continue;
    index.set(hash, entry);
    data.set(hash, bytes);
  }
  return { index, data };
}
