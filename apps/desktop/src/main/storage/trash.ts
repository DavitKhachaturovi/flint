import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { applyOp, parseDocument, serializeDocument, type TaskNode } from '@flint/core';
import { formatLocalDateTime, fromDate } from '@flint/core/time';

/**
 * Trash storage (DATA-02, D-50, docs/04 §Trash): nothing Flint deletes is destroyed. Until the Trash
 * screen (M7) it is kept as plain markdown in `.flint/trash/`, readable and restorable by hand:
 * - a deleted list or note: its file, moved there as `<YYYY-MM-DD-HHmmss>-<name>.md`;
 * - a deleted task: `<YYYY-MM-DD-HHmmss>-task-<id>.md`, a small file whose header says when it was
 *   deleted and from which list, followed by the task as it was (subtasks and body included).
 */

export function trashFolder(folder: string): string {
  return join(folder, '.flint', 'trash');
}

/** `2026-10-29-153012`: sorts by time (also used for attachment names, docs/04 §5). */
export function stamp(now: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

/** The text of a deleted task's trash file. */
export function trashedTaskText(
  task: TaskNode,
  from: { readonly id: string; readonly name: string },
  now: Date,
): string {
  const header = [
    '---',
    'flint: 1',
    `trashed: ${formatLocalDateTime(fromDate(now))}`,
    `list: ${from.id}`,
    `listName: ${JSON.stringify(from.name)}`,
    '---',
    '',
  ].join('\n');
  const path = 'trash.md';
  const document = parseDocument(header);
  const placed = applyOp(new Map([[path, document]]), {
    type: 'insert',
    list: path,
    task: { ...task, eol: '\n' },
    where: { at: 'top' },
  });
  const result = placed?.documents.get(path);
  return result ? serializeDocument(result) : header;
}

const TASK_ID = /\[id::\s*([A-Za-z0-9_-]{1,32})\s*\]/g;
const LIST_ID = /^id:\s*([A-Za-z0-9_-]{1,32})\s*$/m;

/** Every task and list ID in the trash: IDs stay unique in the Flint folder, Trash included (D-29). */
export async function trashedIds(folder: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let names: string[];
  try {
    names = await readdir(trashFolder(folder));
  } catch {
    return ids;
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const text = await readFile(join(trashFolder(folder), name), 'utf8').catch(() => '');
    for (const match of text.matchAll(TASK_ID)) ids.add(match[1] ?? '');
    const list = LIST_ID.exec(text);
    if (list?.[1]) ids.add(list[1]);
  }
  ids.delete('');
  return ids;
}

export async function ensureTrashFolder(folder: string): Promise<string> {
  const path = trashFolder(folder);
  await mkdir(path, { recursive: true });
  return path;
}

/** A file in the trash (D-97): when it was deleted (its name's stamp), whether a task or a list. */
export interface TrashEntry {
  /** Its file name in `.flint/trash/`: what restore and delete refer to. */
  readonly name: string;
  readonly kind: 'task' | 'list';
  readonly at: Date;
  readonly text: string;
}

const TRASH_NAME = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)\.md$/;

/** When a trash file was deleted, from its name; null for a name Flint didn't give. */
export function trashedAt(name: string): Date | null {
  const match = TRASH_NAME.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0);
}

/** The name a deleted list or note had (its trash name without the stamp). */
export function trashedListName(name: string): string {
  return TRASH_NAME.exec(name)?.[7] ?? name.replace(/\.md$/, '');
}

/** Everything in the trash Flint can show (DATA-02, D-97), newest first. */
export async function readTrash(folder: string): Promise<TrashEntry[]> {
  let names: string[];
  try {
    names = await readdir(trashFolder(folder));
  } catch {
    return [];
  }
  const entries: TrashEntry[] = [];
  for (const name of names) {
    const at = trashedAt(name);
    if (!at) continue;
    const text = await readFile(join(trashFolder(folder), name), 'utf8').catch(() => null);
    if (text === null) continue;
    // A deleted task's file has a `trashed:` header; a list's or note's is the file as it was.
    entries.push({ name, kind: /^trashed:/m.test(text) ? 'task' : 'list', at, text });
  }
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The path of one trash file; only a plain name inside `.flint/trash/` (never a path elsewhere). */
export function trashPath(folder: string, name: string): string | null {
  return name === basename(name) && trashedAt(name) ? join(trashFolder(folder), name) : null;
}

/** Delete now and Empty Trash (D-97): gone for good. */
export async function removeFromTrash(folder: string, name: string): Promise<boolean> {
  const path = trashPath(folder, name);
  if (!path) return false;
  return unlink(path).then(
    () => true,
    () => false,
  );
}

/** DATA-02: what has been in the trash longer than `days` goes for good; how many. */
export async function expireTrash(folder: string, now: Date, days = 30): Promise<number> {
  const cutoff = now.getTime() - days * 86_400_000;
  let count = 0;
  for (const entry of await readTrash(folder))
    if (entry.at.getTime() < cutoff && (await removeFromTrash(folder, entry.name))) count++;
  return count;
}

/** Every markdown file that can mention an attachment: lists, notes, archive, Trash (any depth). */
async function markdownTexts(folder: string): Promise<string[]> {
  const texts: string[] = [];
  const walk = async (at: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    const items = await readdir(at, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const path = join(at, item.name);
      if (item.isDirectory()) {
        if (item.name !== 'attachments' && item.name !== 'node_modules')
          await walk(path, depth + 1);
      } else if (item.name.toLowerCase().endsWith('.md'))
        texts.push(await readFile(path, 'utf8').catch(() => ''));
    }
  };
  await walk(folder, 0);
  return texts;
}

/**
 * MEDIA-04, D-97: attachments nothing mentions any more (no list, note, archive or Trash file has
 * their file name, as written or URL-encoded) are deleted; their names. Run at start-up only, after
 * the expiry, when no undo step can bring a removed link back. Files younger than a day stay (a
 * paste whose task isn't saved yet).
 */
export async function cleanOrphanAttachments(folder: string, now: Date): Promise<string[]> {
  const attachments = join(folder, 'attachments');
  const items = await readdir(attachments, { withFileTypes: true }).catch(() => []);
  const files = items.filter((item) => item.isFile()).map((item) => item.name);
  if (files.length === 0) return [];
  const all = (await markdownTexts(folder)).join('\n');
  const removed: string[] = [];
  for (const name of files) {
    if (
      all.includes(name) ||
      all.includes(encodeURIComponent(name)) ||
      all.includes(encodeURI(name))
    )
      continue;
    const path = join(attachments, name);
    const info = await stat(path).catch(() => null);
    if (!info || now.getTime() - info.mtimeMs < 86_400_000) continue;
    if (
      await unlink(path).then(
        () => true,
        () => false,
      )
    )
      removed.push(name);
  }
  return removed;
}
