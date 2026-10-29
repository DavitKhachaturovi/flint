import type { TaskNode } from '../format/document.js';
import { flintField } from '../format/fields.js';
import { applyOp, type Documents, type Op } from '../model/ops.js';
import type { Where } from '../model/tree.js';

/**
 * Global undo and redo (DATA-03): one history across all lists, per session, covering text edits and
 * structural changes. Entries hold operations keyed by task ID, so undo still finds the right task
 * after other changes, and skips (with a reason) when the task is gone.
 */
export interface HistoryEntry {
  /** What the user did, for the undo toast ("Completed 3 tasks"). */
  readonly label: string;
  /** Re-applies the change (redo). */
  readonly op: Op;
  /** Reverts the change (undo). */
  readonly inverse: Op;
  /** Consecutive entries with the same key, close in time, merge into one (typing a title). */
  readonly mergeKey: string | null;
  readonly time: number;
}

export interface UndoHistory {
  readonly done: readonly HistoryEntry[];
  readonly undone: readonly HistoryEntry[];
}

export interface HistoryOptions {
  /** Entries kept; the oldest are dropped first. */
  readonly limit?: number;
  /** Edits with the same merge key within this many milliseconds become one undo step. */
  readonly mergeWindow?: number;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_MERGE_WINDOW = 1_000;

export const emptyHistory: UndoHistory = { done: [], undone: [] };

export interface Performed {
  readonly history: UndoHistory;
  readonly documents: Documents;
  readonly touched: readonly { readonly list: string; readonly key: string }[];
}

/** Applies an operation and records it. Null if it changed nothing. Clears redo. */
export function perform(
  history: UndoHistory,
  documents: Documents,
  op: Op,
  label: string,
  options: HistoryOptions & { readonly mergeKey?: string; readonly time?: number } = {},
): Performed | null {
  const applied = applyOp(documents, op);
  if (!applied) return null;
  const time = options.time ?? Date.now();
  const mergeKey = options.mergeKey ?? null;
  const last = history.done.at(-1);
  const merge =
    mergeKey !== null &&
    last?.mergeKey === mergeKey &&
    time - last.time <= (options.mergeWindow ?? DEFAULT_MERGE_WINDOW);
  // Merged: keep the first inverse (back to before the first keystroke), take the newest operation.
  const entry: HistoryEntry = merge
    ? { label, op, inverse: last.inverse, mergeKey, time }
    : { label, op, inverse: applied.inverse, mergeKey, time };
  const done = [...(merge ? history.done.slice(0, -1) : history.done), entry].slice(
    -(options.limit ?? DEFAULT_LIMIT),
  );
  return { history: { done, undone: [] }, documents: applied.documents, touched: applied.touched };
}

export type Stepped =
  | {
      readonly kind: 'applied';
      readonly history: UndoHistory;
      readonly documents: Documents;
      readonly entry: HistoryEntry;
    }
  /** The tasks it refers to are gone (deleted, or changed on disk); the entry is dropped. */
  | {
      readonly kind: 'skipped';
      readonly history: UndoHistory;
      readonly documents: Documents;
      readonly entry: HistoryEntry;
      readonly reason: 'task-gone';
    };

/** Ctrl+Z. Null when there's nothing to undo. */
export function undo(history: UndoHistory, documents: Documents): Stepped | null {
  const entry = history.done.at(-1);
  if (!entry) return null;
  const done = history.done.slice(0, -1);
  const applied = applyOp(documents, entry.inverse);
  if (!applied) {
    return {
      kind: 'skipped',
      history: { ...history, done },
      documents,
      entry,
      reason: 'task-gone',
    };
  }
  // Redo re-applies the original operation; its inverse is recomputed when it runs.
  return {
    kind: 'applied',
    history: {
      done,
      undone: [...history.undone, { ...entry, inverse: applied.inverse, mergeKey: null }],
    },
    documents: applied.documents,
    entry,
  };
}

/** Ctrl+Shift+Z / Ctrl+Y. Null when there's nothing to redo. */
export function redo(history: UndoHistory, documents: Documents): Stepped | null {
  const entry = history.undone.at(-1);
  if (!entry) return null;
  const undone = history.undone.slice(0, -1);
  const applied = applyOp(documents, entry.op);
  if (!applied) {
    return {
      kind: 'skipped',
      history: { ...history, undone },
      documents,
      entry,
      reason: 'task-gone',
    };
  }
  return {
    kind: 'applied',
    history: {
      undone,
      done: [...history.done, { ...entry, inverse: applied.inverse, mergeKey: null }],
    },
    documents: applied.documents,
    entry,
  };
}

function renameKey(key: string, renamed: ReadonlyMap<string, string>): string {
  return renamed.get(key) ?? key;
}

function renameWhere(where: Where, renamed: ReadonlyMap<string, string>): Where {
  switch (where.at) {
    case 'before':
    case 'after':
      return { ...where, key: renameKey(where.key, renamed) };
    case 'child':
      return { ...where, parent: renameKey(where.parent, renamed) };
    case 'anchor':
      return {
        ...where,
        parent: where.parent === null ? null : renameKey(where.parent, renamed),
        after: where.after === null ? null : renameKey(where.after, renamed),
      };
    default:
      return where;
  }
}

function renameTask(node: TaskNode, renamed: ReadonlyMap<string, string>): TaskNode {
  const id = renamed.get(node.key);
  const children = node.children.map((child) =>
    child.kind === 'task' ? renameTask(child, renamed) : child,
  );
  if (id === undefined) return { ...node, children };
  // The snapshot gets the ID the save wrote, so re-inserting it keeps the same identity.
  return {
    ...node,
    key: id,
    raw: null,
    line: { ...node.line, fields: { ...node.line.fields, id: flintField(id) } },
    children,
  };
}

function renameOp(op: Op, renamed: ReadonlyMap<string, string>): Op {
  switch (op.type) {
    case 'update': {
      const id = renamed.get(op.key);
      const restore = op.changes.restoreLine;
      if (id === undefined) return op;
      // Undo restores the line as it was, but never takes away the ID the save wrote.
      const changes = restore
        ? {
            ...op.changes,
            restoreLine: {
              line: { ...restore.line, fields: { ...restore.line.fields, id: flintField(id) } },
              raw: null,
            },
          }
        : op.changes;
      return { ...op, key: id, changes };
    }
    case 'remove':
      return { ...op, key: renameKey(op.key, renamed) };
    case 'move':
      return { ...op, key: renameKey(op.key, renamed), where: renameWhere(op.where, renamed) };
    case 'insert':
      return { ...op, task: renameTask(op.task, renamed), where: renameWhere(op.where, renamed) };
    case 'batch':
      return { ...op, ops: op.ops.map((child) => renameOp(child, renamed)) };
    default:
      return op;
  }
}

/**
 * After a save gave tasks their IDs (provisional key or duplicate → new ID, see `prepareForSave`),
 * points the history at the new IDs so undo and redo still find those tasks.
 */
export function renameKeys(
  history: UndoHistory,
  renamed: ReadonlyMap<string, string>,
): UndoHistory {
  if (renamed.size === 0) return history;
  const rename = (entry: HistoryEntry): HistoryEntry => ({
    ...entry,
    op: renameOp(entry.op, renamed),
    inverse: renameOp(entry.inverse, renamed),
  });
  return { done: history.done.map(rename), undone: history.undone.map(rename) };
}
