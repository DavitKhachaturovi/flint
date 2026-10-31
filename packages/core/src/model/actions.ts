import { allTasks, type FlintDocument, type TaskNode, type TextChunk } from '../format/document.js';
import { escapeTitle, flintField, localDateTimeField, type Priority } from '../format/fields.js';
import { isCompletedStatus, type TaskLine } from '../format/task-line.js';
import type { LocalDateTime } from '../time/local-datetime.js';
import type { Documents, Op, TaskChanges } from './ops.js';
import { anchorOf, completedHeadingIndex, locate, withLineEndings, type Where } from './tree.js';

/**
 * User actions on tasks (TASK-*, TODAY-01, REM-01). Each returns the operation to apply (and to
 * keep for undo), or null when the action doesn't apply. Nothing here touches the disk.
 */

export interface NewTask {
  /** A new ID from `generateId`, unique in the Flint folder. */
  readonly id: string;
  /** What the user typed; escaped so it can't read back as a field. */
  readonly title: string;
  readonly body?: string;
  readonly priority?: Priority | null;
  readonly reminder?: LocalDateTime | null;
  readonly today?: boolean;
}

export function newTaskNode(document: FlintDocument, task: NewTask): TaskNode {
  const line: TaskLine = {
    indent: '',
    marker: '-',
    gap: ' ',
    status: ' ',
    title: escapeTitle(task.title).trim(),
    fields: {
      ...(task.reminder ? { reminder: localDateTimeField(task.reminder) } : {}),
      ...(task.today ? { today: flintField(true as const) } : {}),
      ...(task.priority ? { priority: flintField(task.priority) } : {}),
      id: flintField(task.id),
    },
    unknown: [],
    blockId: null,
  };
  const body = task.body ?? '';
  const children: TextChunk[] =
    body === ''
      ? []
      : [
          {
            kind: 'text',
            lines: body.split(/\r\n|\r|\n/).map((text) => ({
              text: text === '' ? '' : document.indentUnit + text,
              eol: document.eol,
            })),
          },
        ];
  return {
    kind: 'task',
    key: task.id,
    line,
    raw: null,
    eol: document.eol,
    contentColumn: 2,
    children,
  };
}

/** The bullet the tasks around a position use, so a new task keeps the file's list style. */
function neighbourMarker(document: FlintDocument, where: Where): TaskLine['marker'] | undefined {
  if (where.at === 'before' || where.at === 'after')
    return locate(document, where.key)?.task.line.marker;
  if (where.at === 'child' || (where.at === 'anchor' && where.parent !== null)) {
    const parent = locate(document, where.parent ?? '')?.task;
    return parent?.children.find((child): child is TaskNode => child.kind === 'task')?.line.marker;
  }
  return document.blocks.find((block): block is TaskNode => block.kind === 'task')?.line.marker;
}

/** Adds a task; captures go to the top of Inbox (CAP-02, D-22). */
export function addTask(
  document: FlintDocument,
  list: string,
  task: NewTask,
  where: Where = { at: 'top' },
): Op {
  const node = newTaskNode(document, task);
  const marker = neighbourMarker(document, where) ?? node.line.marker;
  return { type: 'insert', list, task: { ...node, line: { ...node.line, marker } }, where };
}

export function editTitle(list: string, key: string, title: string): Op {
  return { type: 'update', list, key, changes: { title: escapeTitle(title).trim() } };
}

export function setBody(list: string, key: string, body: string): Op {
  return { type: 'update', list, key, changes: { body } };
}

/** TASK-03. Null removes the priority. */
export function setPriority(list: string, key: string, priority: Priority | null): Op {
  return {
    type: 'update',
    list,
    key,
    changes: { fields: { priority: priority === null ? null : flintField(priority) } },
  };
}

/** REM-01. One reminder per task; null clears it. */
export function setReminder(list: string, key: string, at: LocalDateTime | null): Op {
  return {
    type: 'update',
    list,
    key,
    // D-66: a new time turns the reminder back on; removing it removes the muted mark too.
    changes: { fields: { reminder: at === null ? null : localDateTimeField(at), muted: null } },
  };
}

/** REM-12, D-66: turns a reminder off (kept, never fired) or back on. */
export function setMuted(list: string, key: string, muted: boolean): Op {
  return {
    type: 'update',
    list,
    key,
    changes: { fields: { muted: muted ? flintField(true as const) : null } },
  };
}

/** TODAY-01: star or unstar. */
export function setToday(list: string, key: string, starred: boolean): Op {
  return {
    type: 'update',
    list,
    key,
    changes: { fields: { today: starred ? flintField(true as const) : null } },
  };
}

function completionChanges(at: LocalDateTime): TaskChanges {
  return { status: 'x', fields: { completion: localDateTimeField(at) } };
}

export interface Completion {
  readonly op: Op;
  /** The task before it, to put it back on un-check (`completedAfter` in meta.json, TASK-06). */
  readonly completedAfter: string | null;
}

/**
 * TASK-06: checks a task. A top-level task moves to the top of the Completed section (most recently
 * completed first) and completes its open subtasks (TASK-04); a subtask stays under its parent.
 */
export function completeTask(
  document: FlintDocument,
  list: string,
  key: string,
  at: LocalDateTime,
): Completion | null {
  const found = locate(document, key);
  if (!found || isCompletedStatus(found.task.line.status)) return null;
  const update: Op = { type: 'update', list, key, changes: completionChanges(at) };
  if (found.parent) return { op: update, completedAfter: null };
  const subtasks = found.task.children
    .filter(
      (child): child is TaskNode => child.kind === 'task' && !isCompletedStatus(child.line.status),
    )
    .map((child): Op => ({ type: 'update', list, key: child.key, changes: completionChanges(at) }));
  const anchor = anchorOf(document, key);
  return {
    op: {
      type: 'batch',
      ops: [update, ...subtasks, { type: 'move', list, key, where: { at: 'completed-top' } }],
    },
    completedAfter: anchor?.at === 'anchor' ? anchor.after : null,
  };
}

function isActiveTopLevel(document: FlintDocument, key: string): boolean {
  const found = locate(document, key);
  if (!found || found.parent || isCompletedStatus(found.task.line.status)) return false;
  const heading = completedHeadingIndex(document);
  return heading < 0 || found.index < heading;
}

function reopen(
  document: FlintDocument,
  list: string,
  key: string,
  restoreAfter: string | null,
): Op[] {
  const update: Op = {
    type: 'update',
    list,
    key,
    changes: { status: ' ', fields: { completion: null } },
  };
  const where: Where =
    restoreAfter !== null && isActiveTopLevel(document, restoreAfter)
      ? { at: 'after', key: restoreAfter }
      : { at: 'bottom' };
  return [update, { type: 'move', list, key, where }];
}

/**
 * TASK-06: un-checks a task. A top-level task returns to its previous position if the task before
 * it is still open in the list, otherwise to the bottom. Un-checking a subtask of a completed parent
 * reopens the parent too (**Proposed**).
 */
export function uncompleteTask(
  document: FlintDocument,
  list: string,
  key: string,
  completedAfter: (key: string) => string | null,
): Op | null {
  const found = locate(document, key);
  if (!found || !isCompletedStatus(found.task.line.status)) return null;
  if (!found.parent)
    return { type: 'batch', ops: reopen(document, list, key, completedAfter(key)) };
  const update: Op = {
    type: 'update',
    list,
    key,
    changes: { status: ' ', fields: { completion: null } },
  };
  if (!isCompletedStatus(found.parent.line.status)) return update;
  return {
    type: 'batch',
    ops: [update, ...reopen(document, list, found.parent.key, completedAfter(found.parent.key))],
  };
}

function siblings(
  document: FlintDocument,
  key: string,
): { list: TaskNode[]; index: number } | null {
  const found = locate(document, key);
  if (!found) return null;
  if (found.parent) {
    const list = found.parent.children.filter((child): child is TaskNode => child.kind === 'task');
    return { list, index: list.findIndex((task) => task.key === key) };
  }
  // Top-level tasks move within their section: before the Completed heading, or after it.
  const heading = completedHeadingIndex(document);
  const inCompleted = heading >= 0 && found.index > heading;
  const list = document.blocks.filter(
    (block, index): block is TaskNode =>
      block.kind === 'task' && (heading < 0 || index > heading === inCompleted),
  );
  return { list, index: list.findIndex((task) => task.key === key) };
}

/** Alt+↑ (TASK-02): swaps with the previous task at the same level; non-task content stays put. */
export function moveUp(document: FlintDocument, list: string, key: string): Op | null {
  const found = siblings(document, key);
  const previous = found && found.list[found.index - 1];
  return previous ? { type: 'move', list, key, where: { at: 'before', key: previous.key } } : null;
}

/** Alt+↓ (TASK-02). */
export function moveDown(document: FlintDocument, list: string, key: string): Op | null {
  const found = siblings(document, key);
  const next = found && found.list[found.index + 1];
  return next ? { type: 'move', list, key, where: { at: 'after', key: next.key } } : null;
}

/** Drag-and-drop (TASK-01): only the task's block moves (D-22). */
export function moveTo(list: string, key: string, where: Where): Op {
  return { type: 'move', list, key, where };
}

/** Tab (TASK-04): the task becomes the last subtask of the task above. Not for tasks with subtasks. */
export function indentTask(document: FlintDocument, list: string, key: string): Op | null {
  const found = locate(document, key);
  if (!found || found.parent || found.task.children.some((child) => child.kind === 'task'))
    return null;
  const position = siblings(document, key);
  const previous = position && position.list[position.index - 1];
  return previous
    ? { type: 'move', list, key, where: { at: 'child', parent: previous.key, index: 'last' } }
    : null;
}

/** Shift+Tab (TASK-04): the subtask moves to just after its parent's group. */
export function outdentTask(document: FlintDocument, list: string, key: string): Op | null {
  const found = locate(document, key);
  return found?.parent
    ? { type: 'move', list, key, where: { at: 'after', key: found.parent.key } }
    : null;
}

/** TASK-12: removes the task; the operation's inverse holds it, Trash storage comes with DATA-02. */
export function deleteTask(list: string, key: string): Op {
  return { type: 'remove', list, key };
}

/**
 * TASK-11, TASK-07: moves tasks (with their subtasks, TASK-04) to the top of another list, like
 * captures, keeping their relative order from the source list (D-29). A subtask whose parent moves
 * too goes with the parent; one moved on its own becomes a top-level task. The tasks take on the
 * target file's line endings.
 */
export function moveTasksToList(
  documents: Documents,
  from: string,
  keys: readonly string[],
  to: string,
): Op | null {
  const source = documents.get(from);
  const target = documents.get(to);
  if (!source || !target || from === to) return null;
  const selected = new Set(keys);
  const moving = [...allTasks(source)]
    .filter(({ task, parent }) => selected.has(task.key) && !(parent && selected.has(parent.key)))
    .map(({ task }) => task);
  if (moving.length === 0) return null;
  const ops: Op[] = [];
  let previous: string | null = null;
  for (const task of moving) {
    ops.push({ type: 'remove', list: from, key: task.key });
    ops.push({
      type: 'insert',
      list: to,
      task: withLineEndings(task, target.eol),
      where: previous === null ? { at: 'top' } : { at: 'after', key: previous },
    });
    previous = task.key;
  }
  return { type: 'batch', ops };
}

/** TASK-11: one task to the top of another list. */
export function moveToList(documents: Documents, from: string, key: string, to: string): Op | null {
  return moveTasksToList(documents, from, [key], to);
}

/** TASK-07: several actions as one undo step. */
export function bulk(ops: readonly (Op | null)[]): Op | null {
  const present = ops.filter((op): op is Op => op !== null);
  return present.length > 0 ? { type: 'batch', ops: present } : null;
}
