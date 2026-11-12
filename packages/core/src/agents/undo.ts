import { findTask, type FlintDocument, type TaskNode } from '../format/document.js';
import { formatTaskLine } from '../format/task-line.js';
import type { Op } from '../model/ops.js';
import { anchorOf } from '../model/tree.js';
import { mergeText } from '../sync/text-merge.js';

/**
 * AGENT-07 (D-185 Q5): undoing one agent change, out of order, never over a later change. An
 * agent change keeps, per task it touched, how that task looked right after it (a fingerprint);
 * undo applies an inverse only to tasks that still look exactly so, and skips the others. A note
 * (a whole text) is undone by a three-way merge, so the user's later typing survives.
 */

/** How a task looks: its line, its body, its subtasks and where it stands. Null: no such task. */
export function taskFingerprint(document: FlintDocument, key: string): string | null {
  const found = findTask(document, key);
  if (!found) return null;
  return JSON.stringify([
    formatTaskLine(found.task.line).trimStart(),
    bodyText(found.task),
    found.task.children.flatMap((child) => (child.kind === 'task' ? [child.key] : [])),
    found.parent?.key ?? null,
    anchorOf(document, key) ?? null,
  ]);
}

function bodyText(task: TaskNode): string {
  return task.children
    .flatMap((child) => (child.kind === 'text' ? child.lines.map((line) => line.text.trim()) : []))
    .join('\n');
}

/** The task keys an operation is about (a batch: all of them). */
export function opKeys(op: Op): string[] {
  switch (op.type) {
    case 'update':
    case 'move':
    case 'remove':
      return [op.key];
    case 'insert':
      return [op.task.key];
    case 'batch':
      return op.ops.flatMap(opKeys);
    default:
      return [];
  }
}

export interface InversePlan {
  /** What to apply; null when nothing is left. */
  readonly op: Op | null;
  /** Task keys left alone because they changed since (or are gone). */
  readonly skipped: readonly string[];
}

/**
 * The part of `inverse` still safe to apply to `document`: only operations on tasks whose
 * fingerprint is what it was right after the agent's change (`after`, by key). A Completed-heading
 * step is kept only along with another kept step of the same batch.
 */
export function planInverse(
  document: FlintDocument,
  inverse: Op,
  after: Readonly<Record<string, string | null>>,
): InversePlan {
  const skipped = new Set<string>();
  const unchanged = (key: string): boolean => {
    const ok = key in after && taskFingerprint(document, key) === after[key];
    if (!ok) skipped.add(key);
    return ok;
  };
  const keep = (op: Op): Op | null => {
    switch (op.type) {
      case 'update':
      case 'move':
      case 'remove':
        return unchanged(op.key) ? op : null;
      case 'insert':
        return unchanged(op.task.key) ? op : null;
      case 'batch': {
        const kept = op.ops.map(keep);
        const tasks = kept.filter(
          (each, index): each is Op => each !== null && op.ops[index]?.type !== 'completedHeading',
        );
        if (tasks.length === 0) return null;
        const ops = kept.filter((each): each is Op => each !== null);
        return ops.length === 1 ? (ops[0] as Op) : { type: 'batch', ops };
      }
      case 'completedHeading':
        return op;
      case 'setText':
        // A whole text is undone by `planText`, never blindly.
        return null;
    }
  };
  const op = keep(inverse);
  return { op: op?.type === 'completedHeading' ? null : op, skipped: [...skipped] };
}

/**
 * Undoing a change to a whole text (a note's text, a list converted): `before` and `after` the
 * agent's change, `now` as it is. Null when the user's later changes overlap the agent's.
 */
export function planText(before: string, after: string, now: string): string | null {
  if (now === after) return before;
  const merged = mergeText(after, now, before, { mine: 'this', theirs: 'undo', when: '' });
  return merged.conflicts > 0 ? null : merged.text;
}
