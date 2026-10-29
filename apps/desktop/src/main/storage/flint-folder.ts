import { mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { documentMode, parseDocument, type ListMode } from '@flint/core';
import { readListFile, writeFileAtomic } from './atomic.js';
import { tempDirectoryFor } from './list-file.js';

/**
 * The Flint folder (DATA-07, docs/04 §2): which files are lists, where Inbox is, and the two
 * situations Flint warns about (D-23, D-24).
 */

export const INBOX_ID = 'inbox';
const NEW_INBOX = '---\nflint: 1\nid: inbox\nmode: tasks\n---\n';

export interface ListEntry {
  readonly path: string;
  /** The file name without `.md`: the list's name (docs/04 §2). */
  readonly name: string;
  /** Frontmatter `id`, null until Flint writes its header (D-23). */
  readonly id: string | null;
  readonly mode: ListMode;
  readonly created: number;
}

export interface FolderReport {
  readonly folder: string;
  readonly lists: readonly ListEntry[];
  readonly inbox: string;
  readonly inboxCreated: boolean;
  /** D-24: the folder syncs through OneDrive, which v1 doesn't support. */
  readonly insideOneDrive: boolean;
  /** D-23: the folder is an Obsidian vault root; suggest a `Flint` subfolder. */
  readonly obsidianVaultRoot: boolean;
}

/** Lists are the top-level `*.md` files; subfolders and dot-folders never hold lists (D-23). */
export async function discoverLists(folder: string): Promise<ListEntry[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const lists: ListEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const path = join(folder, entry.name);
    const read = await readListFile(path);
    const document = parseDocument(read.kind === 'text' ? read.text : '');
    lists.push({
      path,
      name: entry.name.slice(0, -3),
      id: document.frontmatter?.id ?? null,
      mode: documentMode(document),
      created: (await stat(path)).birthtimeMs,
    });
  }
  return lists;
}

/** Whether `folder` is inside one of the user's OneDrive folders (D-24). */
export function isInsideOneDrive(folder: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const roots = [env.OneDrive, env.OneDriveCommercial, env.OneDriveConsumer].filter(
    (root): root is string => typeof root === 'string' && root !== '',
  );
  const target = resolve(folder).toLowerCase();
  return roots.some((root) => {
    // Windows paths are case-insensitive; another drive gives an absolute "relative" path.
    const path = relative(resolve(root).toLowerCase(), target);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes sure the Flint folder and Inbox exist (LIST-03, D-23): Inbox is the list with `id: inbox`
 * (the oldest file wins if several claim it); otherwise `Inbox.md` is adopted (its header is added on
 * its first edit); otherwise a new Inbox is created.
 */
export async function prepareFlintFolder(
  folder: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FolderReport> {
  await mkdir(folder, { recursive: true });
  let lists = await discoverLists(folder);
  const claimed = lists
    .filter((list) => list.id === INBOX_ID)
    .sort((a, b) => a.created - b.created || (a.path < b.path ? -1 : 1));
  let inbox = claimed[0]?.path ?? lists.find((list) => list.name.toLowerCase() === 'inbox')?.path;
  let inboxCreated = false;
  if (!inbox) {
    inbox = join(folder, 'Inbox.md');
    await writeFileAtomic(inbox, NEW_INBOX, { tempDirectory: tempDirectoryFor(inbox) });
    inboxCreated = true;
    lists = await discoverLists(folder);
  }
  return {
    folder,
    lists,
    inbox,
    inboxCreated,
    insideOneDrive: isInsideOneDrive(folder, env),
    obsidianVaultRoot: await exists(join(folder, '.obsidian')),
  };
}
