import {
  parseDocument,
  serializeDocument,
  type FlintDocument,
  type TaskNode,
  type TextChunk,
} from '../format/document.js';
import type { FieldValue, FlintFields, FlintKey } from '../format/fields.js';
import type { TaskLine, TaskStatus } from '../format/task-line.js';
import { withBody } from './body.js';
import {
  completedHeadingIndex,
  headingNeedsBlank,
  insertTask,
  locate,
  removeTask,
  replaceTask,
  withCompletedHeading,
  withoutCompletedHeading,
  type Where,
} from './tree.js';

/** Inserts a task; if that created the Completed heading, undo also removes it. */
function insertWithInverse(
  document: FlintDocument,
  list: string,
  task: TaskNode,
  where: Where,
  inverse: Op,
): { document: FlintDocument; inverse: Op } | null {
  const inserted = insertTask(document, task, where);
  if (!inserted) return null;
  if (completedHeadingIndex(document) >= 0 || completedHeadingIndex(inserted) < 0) {
    return { document: inserted, inverse };
  }
  const heading: Op = {
    type: 'completedHeading',
    list,
    action: 'remove',
    withBlank: headingNeedsBlank(document),
  };
  return { document: inserted, inverse: { type: 'batch', ops: [inverse, heading] } };
}

export type FieldChanges = { readonly [K in FlintKey]?: NonNullable<FlintFields[K]> | null };

/** What an `update` changes on one task. Unset properties are left alone. */
export interface TaskChanges {
  /** Title markdown, already escaped (see `escapeTitle`). */
  readonly title?: string;
  readonly status?: TaskStatus;
  /** Field values to set; null removes the field. */
  readonly fields?: FieldChanges;
  readonly body?: string;
  /** Undo: the task line exactly as it was. */
  readonly restoreLine?: { readonly line: TaskLine; readonly raw: string | null };
  /** Undo: body text and subtask order exactly as they were. */
  readonly restoreChildren?: readonly (TextChunk | { readonly key: string })[];
}

/**
 * A change to one or more lists (DATA-03). Operations are data keyed by task ID, so they can be
 * undone, redone, and re-applied to a file that changed on disk in the meantime (docs/04 §6).
 */
export type Op =
  | {
      readonly type: 'update';
      readonly list: string;
      readonly key: string;
      readonly changes: TaskChanges;
    }
  | { readonly type: 'move'; readonly list: string; readonly key: string; readonly where: Where }
  | {
      readonly type: 'insert';
      readonly list: string;
      readonly task: TaskNode;
      readonly where: Where;
    }
  | { readonly type: 'remove'; readonly list: string; readonly key: string }
  /** Replaces a whole file (mode conversion, LIST-04). */
  | { readonly type: 'setText'; readonly list: string; readonly text: string }
  /** Adds or removes the `## Completed` heading Flint created (so undo restores the file exactly). */
  | {
      readonly type: 'completedHeading';
      readonly list: string;
      readonly action: 'add' | 'remove';
      readonly withBlank: boolean;
    }
  | { readonly type: 'batch'; readonly ops: readonly Op[] };

export type Documents = ReadonlyMap<string, FlintDocument>;

export interface Applied {
  readonly documents: Documents;
  /** Applying this undoes the operation exactly. */
  readonly inverse: Op;
  /** Tasks whose `lastTouched` should be updated (docs/04 §3). */
  readonly touched: readonly { readonly list: string; readonly key: string }[];
}

function withDocument(documents: Documents, list: string, document: FlintDocument): Documents {
  const next = new Map(documents);
  next.set(list, document);
  return next;
}

function setField(
  fields: FlintFields,
  key: FlintKey,
  value: FieldValue<unknown> | null,
): FlintFields {
  const next: Record<string, unknown> = { ...fields };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

function childShape(node: TaskNode): (TextChunk | { key: string })[] {
  return node.children.map((child) => (child.kind === 'task' ? { key: child.key } : child));
}

function rebuildChildren(
  node: TaskNode,
  shape: readonly (TextChunk | { readonly key: string })[],
): TaskNode {
  const subtasks = new Map(
    node.children.filter((child) => child.kind === 'task').map((child) => [child.key, child]),
  );
  const children: (TextChunk | TaskNode)[] = [];
  for (const item of shape) {
    if ('kind' in item) {
      children.push(item);
      continue;
    }
    const subtask = subtasks.get(item.key);
    if (subtask) {
      children.push(subtask);
      subtasks.delete(item.key);
    }
  }
  children.push(...subtasks.values());
  return { ...node, children };
}

function applyUpdate(
  document: FlintDocument,
  key: string,
  changes: TaskChanges,
): { document: FlintDocument; inverse: TaskChanges } | null {
  const found = locate(document, key);
  if (!found) return null;
  const before = found.task;
  let next: TaskNode = before;

  if (changes.restoreLine) {
    next = { ...next, line: changes.restoreLine.line, raw: changes.restoreLine.raw };
  } else if (
    changes.title !== undefined ||
    changes.status !== undefined ||
    changes.fields !== undefined
  ) {
    let fields = next.line.fields;
    for (const [field, value] of Object.entries(changes.fields ?? {})) {
      fields = setField(fields, field as FlintKey, value);
    }
    next = {
      ...next,
      raw: null,
      line: {
        ...next.line,
        title: changes.title ?? next.line.title,
        status: changes.status ?? next.line.status,
        fields,
      },
    };
  }
  if (changes.restoreChildren) next = rebuildChildren(next, changes.restoreChildren);
  else if (changes.body !== undefined) next = withBody(document, next, changes.body);

  const inverse: TaskChanges = {
    ...(next.line !== before.line || next.raw !== before.raw
      ? { restoreLine: { line: before.line, raw: before.raw } }
      : {}),
    ...(next.children !== before.children ? { restoreChildren: childShape(before) } : {}),
  };
  return { document: replaceTask(document, key, next), inverse };
}

/**
 * Applies an operation. Returns null if nothing could be applied (the task is gone, or the
 * position is impossible); a batch applies what it can.
 */
export function applyOp(documents: Documents, op: Op): Applied | null {
  switch (op.type) {
    case 'update': {
      const document = documents.get(op.list);
      const result = document && applyUpdate(document, op.key, op.changes);
      if (!result) return null;
      return {
        documents: withDocument(documents, op.list, result.document),
        inverse: { type: 'update', list: op.list, key: op.key, changes: result.inverse },
        touched: [{ list: op.list, key: op.key }],
      };
    }
    case 'move': {
      const document = documents.get(op.list);
      const removed = document && removeTask(document, op.key);
      const back: Op | null = removed
        ? { type: 'move', list: op.list, key: op.key, where: removed.anchor }
        : null;
      const result =
        removed &&
        back &&
        insertWithInverse(removed.document, op.list, removed.task, op.where, back);
      if (!result) return null;
      return {
        documents: withDocument(documents, op.list, result.document),
        inverse: result.inverse,
        touched: [{ list: op.list, key: op.key }],
      };
    }
    case 'insert': {
      const document = documents.get(op.list);
      if (!document || locate(document, op.task.key)) return null;
      const remove: Op = { type: 'remove', list: op.list, key: op.task.key };
      const result = insertWithInverse(document, op.list, op.task, op.where, remove);
      if (!result) return null;
      return {
        documents: withDocument(documents, op.list, result.document),
        inverse: result.inverse,
        touched: [{ list: op.list, key: op.task.key }],
      };
    }
    case 'completedHeading': {
      const document = documents.get(op.list);
      if (!document) return null;
      let next: FlintDocument | undefined;
      if (op.action === 'remove') {
        next = withoutCompletedHeading(document, op.withBlank);
      } else if (completedHeadingIndex(document) < 0) {
        const added = withCompletedHeading(document).document;
        const blankAdded = headingNeedsBlank(document);
        // Recreate exactly what was removed: with the blank line only if one was removed too.
        next =
          blankAdded && !op.withBlank
            ? { ...added, blocks: [...added.blocks.slice(0, -2), ...added.blocks.slice(-1)] }
            : added;
      }
      if (!next) return null;
      return {
        documents: withDocument(documents, op.list, next),
        inverse: { ...op, action: op.action === 'add' ? 'remove' : 'add' },
        touched: [],
      };
    }
    case 'remove': {
      const document = documents.get(op.list);
      const removed = document && removeTask(document, op.key);
      if (!removed) return null;
      return {
        documents: withDocument(documents, op.list, removed.document),
        inverse: { type: 'insert', list: op.list, task: removed.task, where: removed.anchor },
        touched: [],
      };
    }
    case 'setText': {
      const document = documents.get(op.list);
      if (!document) return null;
      return {
        documents: withDocument(documents, op.list, parseDocument(op.text, { keySeed: op.list })),
        inverse: { type: 'setText', list: op.list, text: serializeDocument(document) },
        touched: [],
      };
    }
    case 'batch': {
      let current = documents;
      const inverses: Op[] = [];
      const touched: { list: string; key: string }[] = [];
      for (const child of op.ops) {
        const applied = applyOp(current, child);
        if (!applied) continue;
        current = applied.documents;
        inverses.unshift(applied.inverse);
        touched.push(...applied.touched);
      }
      if (inverses.length === 0) return null;
      return { documents: current, inverse: { type: 'batch', ops: inverses }, touched };
    }
  }
}

/** Re-applies operations that weren't saved yet to a freshly read file (docs/04 §6). */
export function rebase(documents: Documents, pending: readonly Op[]): Documents {
  let current = documents;
  for (const op of pending) current = applyOp(current, op)?.documents ?? current;
  return current;
}
