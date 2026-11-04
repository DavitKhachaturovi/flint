import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { discoverLists, isInsideOneDrive } from './flint-folder.js';

/**
 * Changing the Flint folder (DATA-07, D-104): what a chosen folder holds, so Settings can offer
 * the right choices, and moving the Flint folder there: copied file by file, never over a file
 * that is there already, every copy checked; on any failure, what was copied goes again and the
 * old folder is as it was.
 */

/** D-104: what a chosen folder holds. */
export type FolderState = 'empty' | 'flint' | 'other';

export interface FolderCheck {
  readonly path: string;
  readonly state: FolderState;
  /** Markdown lists and notes at its top level. */
  readonly lists: number;
  /** D-24: inside OneDrive (warned, allowed). */
  readonly insideOneDrive: boolean;
  /** Why it can't be used, if it can't (the Flint folder itself, inside it). */
  readonly refused: string | null;
  /** D-104: its `Flint` subfolder, offered for a folder that holds other things. */
  readonly subfolder: {
    readonly path: string;
    readonly state: FolderState | 'missing';
    readonly refused: string | null;
  };
}

/** Windows' own files, which don't make a folder non-empty. */
const IGNORED = new Set(['desktop.ini', 'thumbs.db']);

/** `inner` is `outer` or inside it (Windows paths: case-insensitive). */
export function isWithin(inner: string, outer: string): boolean {
  const path = relative(resolve(outer).toLowerCase(), resolve(inner).toLowerCase());
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function stateOf(path: string): Promise<{ state: FolderState | 'missing'; lists: number }> {
  let names: string[];
  try {
    names = (await readdir(path)).filter((name) => !IGNORED.has(name.toLowerCase()));
  } catch {
    return { state: 'missing', lists: 0 };
  }
  if (names.length === 0) return { state: 'empty', lists: 0 };
  const lists = await discoverLists(path).catch(() => []);
  const flint =
    names.some((name) => name.toLowerCase() === '.flint') || lists.some((list) => list.id !== null);
  return { state: flint ? 'flint' : 'other', lists: lists.length };
}

/** Why `target` can't be the new Flint folder, given the current one (null when it can). */
function refusal(target: string, current: string): string | null {
  if (isWithin(target, current) && isWithin(current, target))
    return 'That is already your Flint folder.';
  if (isWithin(target, current)) return 'That folder is inside your Flint folder.';
  if (isWithin(current, target)) return 'Your Flint folder is inside that folder.';
  return null;
}

export async function checkFolder(
  path: string,
  current: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FolderCheck> {
  const own = await stateOf(path);
  const sub = join(path, 'Flint');
  const subState = await stateOf(sub);
  return {
    path,
    state: own.state === 'missing' ? 'empty' : own.state,
    lists: own.lists,
    insideOneDrive: isInsideOneDrive(path, env),
    refused: refusal(path, current),
    subfolder: { path: sub, state: subState.state, refused: refusal(sub, current) },
  };
}

/** Every file under `folder`, as paths relative to it; Flint's scratch (`.flint/tmp`) left out. */
async function filesIn(folder: string, inside = ''): Promise<string[]> {
  const entries = await readdir(join(folder, inside), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = inside === '' ? entry.name : join(inside, entry.name);
    if (entry.isDirectory()) {
      if (path.toLowerCase() === join('.flint', 'tmp')) continue;
      files.push(...(await filesIn(folder, path)));
    } else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface CopyOutcome {
  readonly ok: boolean;
  readonly files: number;
  /** Why it stopped (nothing is left behind in the target then). */
  readonly problem?: string;
}

/**
 * D-104: the Flint folder copied into `target` and checked. Never over an existing file; on any
 * failure everything it made in `target` goes again.
 */
export async function copyFlintFolder(source: string, target: string): Promise<CopyOutcome> {
  const made: string[] = [];
  const madeFolders: string[] = [];
  const ensure = async (folder: string): Promise<void> => {
    const missing: string[] = [];
    let at = folder;
    while (!(await stat(at).catch(() => null))) {
      missing.unshift(at);
      const parent = resolve(at, '..');
      if (parent === at) break;
      at = parent;
    }
    for (const path of missing) {
      await mkdir(path);
      madeFolders.push(path);
    }
  };
  const undo = async (): Promise<void> => {
    for (const path of made.reverse()) await rm(path, { force: true }).catch(() => undefined);
    for (const path of madeFolders.reverse()) await rmdir(path).catch(() => undefined);
  };
  let files: string[];
  try {
    files = await filesIn(source);
  } catch (error) {
    return { ok: false, files: 0, problem: `Flint couldn't read its folder (${String(error)}).` };
  }
  try {
    await ensure(target);
    for (const file of files) {
      const to = join(target, file);
      await ensure(resolve(to, '..'));
      try {
        await copyFile(join(source, file), to, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          await undo();
          return {
            ok: false,
            files: 0,
            problem: `“${file}” is already there. Choose an empty folder or a subfolder.`,
          };
        }
        throw error;
      }
      made.push(to);
    }
    for (const file of files) {
      const [from, to] = [join(source, file), join(target, file)];
      const [a, b] = await Promise.all([stat(from), stat(to)]);
      if (a.size !== b.size || (await digest(from)) !== (await digest(to))) {
        await undo();
        return {
          ok: false,
          files: 0,
          problem: `The copy of “${file}” didn't match. Nothing changed.`,
        };
      }
    }
    return { ok: true, files: files.length };
  } catch (error) {
    await undo();
    return { ok: false, files: 0, problem: `Flint couldn't copy its folder (${String(error)}).` };
  }
}

/** D-104: "Use this folder directly" with Move: a name already there stops it (no overwriting). */
export async function clashes(source: string, target: string): Promise<string | null> {
  const there = new Set(
    (await readdir(target).catch(() => [] as string[])).map((name) => name.toLowerCase()),
  );
  for (const name of await readdir(source)) if (there.has(name.toLowerCase())) return name;
  return null;
}
