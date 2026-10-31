import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
