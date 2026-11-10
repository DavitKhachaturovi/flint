/**
 * Merging synced lists and notes (SYNC-01, D-161, docs/04 §7): task lists per task by ID (all
 * together, so tasks can move between them), notes as text, and the frontmatter key by key.
 */
import { documentMode, parseDocument } from '../format/document.js';
import { splitLines, type Line } from '../format/lines.js';
import {
  mergeTaskLists,
  type ListVersions,
  type ListsMergeContext,
  type TrashedTask,
} from './list-merge.js';
import { mergeText } from './text-merge.js';

export type { ListVersions, ListsMergeContext, TrashedTask } from './list-merge.js';

export interface MergeResult {
  /** The merged text per list. */
  readonly texts: ReadonlyMap<string, string>;
  readonly conflicts: ReadonlyMap<string, number>;
  readonly trashed: readonly TrashedTask[];
  readonly reIded: ReadonlyMap<string, string>;
}

interface Split {
  readonly bom: boolean;
  /** Frontmatter lines, delimiters included; empty when there is none. */
  readonly head: Line[];
  /** The rest, as text. */
  readonly rest: string;
}

const OPEN = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY = /^([A-Za-z0-9_-]+)[ \t]*:/;

function split(text: string): Split {
  const bom = text.startsWith('\uFEFF');
  const lines = splitLines(bom ? text.slice(1) : text);
  if (lines.length > 0 && OPEN.test(lines[0]?.text ?? '')) {
    for (let index = 1; index < lines.length; index++) {
      if (CLOSE.test(lines[index]?.text ?? '')) {
        return {
          bom,
          head: lines.slice(0, index + 1),
          rest: lines
            .slice(index + 1)
            .map((line) => line.text + line.eol)
            .join(''),
        };
      }
    }
  }
  return { bom, head: [], rest: bom ? text.slice(1) : text };
}

/** Frontmatter entries: a key line and its continuation lines (lists, indented values). */
function entries(head: readonly Line[]): Map<string, Line[]> {
  const map = new Map<string, Line[]>();
  let current: Line[] | null = null;
  let unnamed = 0;
  for (const line of head.slice(1, -1)) {
    const match = KEY.exec(line.text);
    if (match) {
      current = [line];
      map.set(match[1] as string, current);
    } else if (current) {
      current.push(line);
    } else {
      map.set(`\u0000${unnamed++}`, [line]);
    }
  }
  return map;
}

const text = (lines: readonly Line[] | undefined): string | undefined =>
  lines?.map((line) => line.text).join('\n');

/** Merges frontmatter key by key: the side that changed a key wins; both changed: this PC's. */
export function mergeFrontmatter(
  base: readonly Line[] | null,
  mine: readonly Line[],
  theirs: readonly Line[],
): Line[] {
  if (text(mine) === text(theirs)) return [...mine];
  if (base !== null && text(base) === text(mine)) return [...theirs];
  if (base !== null && text(base) === text(theirs)) return [...mine];
  if (mine.length === 0) return [...theirs];
  if (theirs.length === 0) return [...mine];
  const b = base ? entries(base) : new Map<string, Line[]>();
  const m = entries(mine);
  const t = entries(theirs);
  const out: Line[] = [mine[0] as Line];
  for (const [key, lines] of m) {
    const inBase = b.get(key);
    const inTheirs = t.get(key);
    if (inTheirs === undefined) {
      // Removed there and untouched here: removed.
      if (inBase !== undefined && text(inBase) === text(lines)) continue;
      out.push(...lines);
    } else if (inBase !== undefined && text(inBase) === text(lines)) {
      out.push(...inTheirs);
    } else {
      out.push(...lines);
    }
  }
  for (const [key, lines] of t) {
    if (!m.has(key) && !b.has(key)) out.push(...lines);
  }
  out.push(mine[mine.length - 1] as Line);
  return out;
}

function withHead(merged: string, head: readonly Line[], bom: boolean, bodyOnly: boolean): string {
  const rest = bodyOnly ? merged.replace(/^\uFEFF/, '') : split(merged).rest;
  return (bom ? '\uFEFF' : '') + head.map((line) => line.text + line.eol).join('') + rest;
}

/**
 * Merges every list and note given (base null: a first meeting). A list that only one side has
 * comes back as that side has it; the engine decides about lists that left (deletes, unsyncing).
 */
export function mergeLists(
  versions: readonly ListVersions[],
  context: ListsMergeContext,
): MergeResult {
  const texts = new Map<string, string>();
  const conflicts = new Map<string, number>();
  const isTasks = (value: string | null): boolean =>
    value !== null && documentMode(parseDocument(value)) === 'tasks';
  const taskLists = versions.filter(
    (version) =>
      (version.mine === null || isTasks(version.mine)) &&
      (version.theirs === null || isTasks(version.theirs)),
  );
  const listResult = mergeTaskLists(taskLists, context);
  const asTasks = new Set(taskLists.map((version) => version.listId));
  for (const version of versions) {
    const { listId } = version;
    if (version.mine === null && version.theirs === null) continue;
    let merged: string;
    let bodyOnly = false;
    if (version.mine !== null && version.mine === version.theirs) {
      texts.set(listId, version.mine);
      conflicts.set(listId, 0);
      continue;
    }
    if (asTasks.has(listId)) {
      merged = listResult.texts.get(listId) ?? version.mine ?? version.theirs ?? '';
      conflicts.set(listId, listResult.conflicts.get(listId) ?? 0);
    } else if (version.mine === null || version.theirs === null) {
      merged = (version.mine ?? version.theirs) as string;
      conflicts.set(listId, 0);
    } else {
      const result = mergeText(
        version.base === null ? null : split(version.base).rest,
        split(version.mine).rest,
        split(version.theirs).rest,
        {
          mine: context.mineDevice,
          theirs: context.theirsDevice(listId),
          when: context.when(listId),
        },
      );
      merged = result.text;
      bodyOnly = true;
      conflicts.set(listId, result.conflicts);
    }
    if (version.mine !== null && version.theirs !== null) {
      const mineSplit = split(version.mine);
      const head = mergeFrontmatter(
        version.base === null ? null : split(version.base).head,
        mineSplit.head,
        split(version.theirs).head,
      );
      merged = withHead(merged, head, mineSplit.bom, bodyOnly);
    }
    texts.set(listId, merged);
  }
  return { texts, conflicts, trashed: listResult.trashed, reIded: listResult.reIded };
}
