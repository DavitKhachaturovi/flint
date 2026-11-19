/**
 * The spaces on disk (SPACE-01, 04 §9, D-189 decision 4, D-190 Q14, Q20): every subfolder of
 * `<Flint folder>/Spaces/` that holds a valid `.flint/space.json` is a space, with the layout of a
 * Flint folder (its top-level `*.md` files are its lists and notes; no folders inside it). Anything
 * else under `Spaces/` (a folder the user already had, one without `space.json`) is left alone.
 */
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanSpaceName, readSpaceFile, writeSpaceFile, type SpaceFile } from '@flint/core/spaces';
import { isValidListName } from '@flint/core/shorthand';
import { writeFileAtomic } from './atomic.js';
import { tempDirectoryFor } from './list-file.js';

/** The folder that holds the spaces, inside the Flint folder. */
export const SPACES_FOLDER = 'Spaces';

export interface SpaceFolder {
  readonly id: string;
  readonly name: string;
  /** The space's own folder (`<Flint folder>/Spaces/<name>`). */
  readonly folder: string;
  /** Kept as read, for writing `space.json` again (unknown keys survive). */
  readonly file: SpaceFile;
}

export function spaceFilePath(folder: string): string {
  return join(folder, '.flint', 'space.json');
}

/**
 * The spaces in `<flintFolder>/Spaces/`, sorted by name. Two folders claiming the same ID (a space
 * folder copied in Explorer): the older one is the space, the other is left alone and reported.
 */
export async function discoverSpaces(
  flintFolder: string,
  log: (line: string) => void = () => undefined,
): Promise<SpaceFolder[]> {
  const root = join(flintFolder, SPACES_FOLDER);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { space: SpaceFolder; created: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = join(root, entry.name);
    const file = readSpaceFile(await readFile(spaceFilePath(folder), 'utf8').catch(() => null));
    if (!file) continue;
    const created = await stat(spaceFilePath(folder)).then(
      (info) => info.birthtimeMs,
      () => 0,
    );
    found.push({ space: { id: file.id, name: file.name, folder, file }, created });
  }
  found.sort((a, b) => a.created - b.created || (a.space.folder < b.space.folder ? -1 : 1));
  const spaces = new Map<string, SpaceFolder>();
  for (const { space } of found) {
    const first = spaces.get(space.id);
    if (first) {
      log(`spaces: ${space.folder} claims ${space.id}, already ${first.folder}: left alone`);
      continue;
    }
    spaces.set(space.id, space);
  }
  return [...spaces.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

/**
 * A folder name for a space: its name, made safe for Windows like list files (D-25), with a number
 * added when the name is taken (`Home 2`).
 */
export function spaceFolderName(name: string, taken: ReadonlySet<string>): string {
  const base = isValidListName(name) ? name : 'Space';
  const lower = new Set([...taken].map((entry) => entry.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let number = 2; ; number++) {
    const candidate = `${base} ${number}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** Makes a new space on disk: `Spaces/<name>/.flint/space.json`. `null` for a name that can't be one. */
export async function createSpaceFolder(
  flintFolder: string,
  rawName: string,
  id: string,
): Promise<SpaceFolder | null> {
  const name = cleanSpaceName(rawName);
  if (name === null) return null;
  const root = join(flintFolder, SPACES_FOLDER);
  await mkdir(root, { recursive: true });
  const taken = new Set(await readdir(root).catch(() => [] as string[]));
  const folder = join(root, spaceFolderName(name, taken));
  await mkdir(join(folder, '.flint'), { recursive: true });
  const file: SpaceFile = { id, name, extra: {} };
  // The space's own `.flint/tmp` (tempDirectoryFor takes a file at the top of the folder).
  await writeFileAtomic(spaceFilePath(folder), writeSpaceFile(file), {
    tempDirectory: tempDirectoryFor(join(folder, 'space.md')),
  });
  return { id, name, folder, file };
}
