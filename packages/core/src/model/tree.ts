import type { Block, FlintDocument, TaskNode, TextChunk } from '../format/document.js';
import { indentWidth, isBlank, stripColumns, type Line } from '../format/lines.js';

/**
 * Where to put a task. Positions are relative to tasks, never to line numbers, so they still work
 * after the file changed on disk (rebase, undo).
 */
export type Where =
  /** Just before the first top-level task, below any heading or paragraph the file starts with (D-22). */
  | { readonly at: 'top' }
  /** After the last top-level task before the Completed section. */
  | { readonly at: 'bottom' }
  /** First in the Completed section (most recently completed first); the heading is added if needed. */
  | { readonly at: 'completed-top' }
  /** Next to another task, at its level. */
  | { readonly at: 'before' | 'after'; readonly key: string }
  /** As a subtask. */
  | { readonly at: 'child'; readonly parent: string; readonly index: 'first' | 'last' }
  /**
   * Exactly where a task was (undo): after task `after` (or the start, if null), past `skip`
   * non-task blocks, so non-task content keeps its place around the task (D-22).
   */
  | {
      readonly at: 'anchor';
      readonly parent: string | null;
      readonly after: string | null;
      readonly skip: number;
      /** The task's own indentation there, restored exactly. */
      readonly indent: string;
    };

export interface Located {
  readonly task: TaskNode;
  readonly parent: TaskNode | null;
  /** Index in `document.blocks` (top-level) or in `parent.children` (subtask). */
  readonly index: number;
}

export function locate(document: FlintDocument, key: string): Located | undefined {
  for (let index = 0; index < document.blocks.length; index++) {
    const block = document.blocks[index];
    if (block?.kind !== 'task') continue;
    if (block.key === key) return { task: block, parent: null, index };
    const childIndex = block.children.findIndex(
      (child) => child.kind === 'task' && child.key === key,
    );
    const child = block.children[childIndex];
    if (child?.kind === 'task') return { task: child, parent: block, index: childIndex };
  }
  return undefined;
}

type Item = Block | TextChunk | TaskNode;

function isTask(item: Item | undefined): item is TaskNode {
  return item?.kind === 'task';
}

/** The position a task occupies, as an anchor that survives edits elsewhere. */
export function anchorOf(document: FlintDocument, key: string): Where | undefined {
  const found = locate(document, key);
  if (!found) return undefined;
  const items: readonly Item[] = found.parent ? found.parent.children : document.blocks;
  let skip = 0;
  let index = found.index - 1;
  while (index >= 0 && !isTask(items[index])) {
    skip++;
    index--;
  }
  const previous = items[index];
  return {
    at: 'anchor',
    parent: found.parent?.key ?? null,
    after: isTask(previous) ? previous.key : null,
    skip,
    indent: found.task.line.indent,
  };
}

/** The index of the Completed heading block, or -1. */
export function completedHeadingIndex(document: FlintDocument): number {
  return document.blocks.findIndex((block) => block.kind === 'other' && block.completedHeading);
}

export function isBlankBlock(block: Block | undefined): boolean {
  return (
    block?.kind === 'other' &&
    !block.completedHeading &&
    block.lines.every((line) => isBlank(line.text))
  );
}

/** Where new top-level tasks go when there's no task to be next to. */
function emptyListIndex(document: FlintDocument): number {
  const heading = completedHeadingIndex(document);
  if (heading < 0) return document.blocks.length;
  return isBlankBlock(document.blocks[heading - 1]) ? heading - 1 : heading;
}

function activeEnd(document: FlintDocument): number {
  const heading = completedHeadingIndex(document);
  return heading < 0 ? document.blocks.length : heading;
}

/** Whether adding the Completed heading to this document also adds a blank line before it. */
export function headingNeedsBlank(document: FlintDocument): boolean {
  return document.blocks.length > 0 && !isBlankBlock(document.blocks.at(-1));
}

/** Appends `## Completed` (after a blank line, unless the file already ends with one). */
export function withCompletedHeading(document: FlintDocument): {
  document: FlintDocument;
  heading: number;
} {
  const existing = completedHeadingIndex(document);
  if (existing >= 0) return { document, heading: existing };
  const eol = document.eol;
  const blocks = [...document.blocks];
  if (headingNeedsBlank(document)) {
    blocks.push({ kind: 'other', lines: [{ text: '', eol }], completedHeading: false });
  }
  blocks.push({ kind: 'other', lines: [{ text: '## Completed', eol }], completedHeading: true });
  return { document: { ...document, blocks }, heading: blocks.length - 1 };
}

/**
 * Removes a Completed heading Flint added (undo), with the blank line it added before it. Only when
 * the section is empty and the heading is the last block, so nothing else can be affected.
 */
export function withoutCompletedHeading(
  document: FlintDocument,
  withBlank: boolean,
): FlintDocument | undefined {
  const heading = completedHeadingIndex(document);
  if (heading < 0 || heading !== document.blocks.length - 1) return undefined;
  const from = withBlank && isBlankBlock(document.blocks[heading - 1]) ? heading - 1 : heading;
  return { ...document, blocks: document.blocks.slice(0, from) };
}

/** Indentation for a task's body and subtasks: what its existing children use, else one level more. */
export function childIndent(document: FlintDocument, parent: TaskNode): string {
  for (const child of parent.children) {
    if (child.kind === 'task') return child.line.indent;
    const line = child.lines.find((candidate) => !isBlank(candidate.text));
    if (line && indentWidth(line.text) >= parent.contentColumn)
      return /^[ \t]*/.exec(line.text)?.[0] ?? '';
  }
  return parent.line.indent + document.indentUnit;
}

function shiftLine(line: Line, from: string, to: string): Line {
  if (isBlank(line.text)) return line;
  const rest = line.text.startsWith(from)
    ? line.text.slice(from.length)
    : stripColumns(line.text, indentWidth(from)).replace(/^[ \t]*/, '');
  return { text: to + rest, eol: line.eol };
}

/** Re-indents a task and everything under it from indent `from` to indent `to`. */
export function shiftTask(node: TaskNode, from: string, to: string): TaskNode {
  if (from === to) return node;
  const indent =
    to + (node.line.indent.startsWith(from) ? node.line.indent.slice(from.length) : '');
  const children = node.children.map((child) =>
    child.kind === 'text'
      ? { kind: 'text' as const, lines: child.lines.map((line) => shiftLine(line, from, to)) }
      : shiftTask(child, from, to),
  );
  return {
    ...node,
    // Only the indentation changes: the rest of an unchanged line keeps its exact text.
    raw:
      node.raw !== null && node.raw.startsWith(node.line.indent)
        ? indent + node.raw.slice(node.line.indent.length)
        : null,
    line: { ...node.line, indent },
    contentColumn: node.contentColumn - indentWidth(node.line.indent) + indentWidth(indent),
    children,
  };
}

/** Gives every line of a task the line ending `eol` (a task moved into a file that uses another). */
export function withLineEndings(node: TaskNode, eol: '\n' | '\r\n'): TaskNode {
  return {
    ...node,
    eol,
    children: node.children.map((child) =>
      child.kind === 'text'
        ? { kind: 'text' as const, lines: child.lines.map((line) => ({ text: line.text, eol })) }
        : withLineEndings(child, eol),
    ),
  };
}

function hasSubtasks(node: TaskNode): boolean {
  return node.children.some((child) => child.kind === 'task');
}

export function removeTask(
  document: FlintDocument,
  key: string,
):
  | { readonly document: FlintDocument; readonly task: TaskNode; readonly anchor: Where }
  | undefined {
  const found = locate(document, key);
  const anchor = anchorOf(document, key);
  if (!found || !anchor) return undefined;
  if (!found.parent) {
    const blocks = document.blocks.filter((_, index) => index !== found.index);
    return { document: { ...document, blocks }, task: found.task, anchor };
  }
  const parent = found.parent;
  const children = parent.children.filter((_, index) => index !== found.index);
  return {
    document: replaceTask(document, parent.key, { ...parent, children }),
    task: found.task,
    anchor,
  };
}

/** Replaces the task with this key (at any depth). */
export function replaceTask(document: FlintDocument, key: string, next: TaskNode): FlintDocument {
  const blocks = document.blocks.map((block) => {
    if (block.kind !== 'task') return block;
    if (block.key === key) return next;
    if (!block.children.some((child) => child.kind === 'task' && child.key === key)) return block;
    return {
      ...block,
      children: block.children.map((child) =>
        child.kind === 'task' && child.key === key ? next : child,
      ),
    };
  });
  return { ...document, blocks };
}

/**
 * A task keeps its own indentation when it is already right for the level it lands on (so undo
 * restores lines byte-for-byte); otherwise it is re-indented. Top-level tasks go to column 0 unless
 * they're restored to their exact old place.
 */
function fitIndent(
  node: TaskNode,
  indent: string,
  keepIfWithin: [number, number] | null,
): TaskNode {
  const width = indentWidth(node.line.indent);
  if (keepIfWithin && width >= keepIfWithin[0] && width <= keepIfWithin[1]) return node;
  return shiftTask(node, node.line.indent, indent);
}

/**
 * Inserts a task. Returns undefined when the position is impossible: the target task is gone, or
 * the task would nest two levels deep (TASK-04).
 */
export function insertTask(
  document: FlintDocument,
  node: TaskNode,
  where: Where,
): FlintDocument | undefined {
  const parentKey =
    where.at === 'child' || where.at === 'anchor'
      ? where.parent
      : where.at === 'before' || where.at === 'after'
        ? (locate(document, where.key)?.parent?.key ?? null)
        : null;

  if (parentKey !== null) {
    const parent = locate(document, parentKey);
    if (!parent || parent.parent || hasSubtasks(node)) return undefined;
    const column = parent.task.contentColumn;
    const shifted =
      where.at === 'anchor'
        ? shiftTask(node, node.line.indent, where.indent)
        : fitIndent(node, childIndent(document, parent.task), [column, column + 3]);
    const children = [...parent.task.children];
    let index: number;
    if (where.at === 'child') {
      index = where.index === 'first' ? firstChildIndex(children) : children.length;
    } else if (where.at === 'anchor') {
      index = anchorIndex(children, where.after, where.skip);
    } else if (where.at === 'before' || where.at === 'after') {
      const key = where.key;
      const target = children.findIndex((child) => child.kind === 'task' && child.key === key);
      if (target < 0) return undefined;
      index = where.at === 'before' ? target : target + 1;
    } else {
      return undefined;
    }
    children.splice(index, 0, shifted);
    return replaceTask(document, parentKey, { ...parent.task, children });
  }

  const shifted =
    where.at === 'anchor'
      ? shiftTask(node, node.line.indent, where.indent)
      : fitIndent(node, '', [0, 0]);
  if (where.at === 'completed-top') {
    const { document: withHeading, heading } = withCompletedHeading(document);
    const blocks = [...withHeading.blocks];
    blocks.splice(heading + 1, 0, shifted);
    return { ...withHeading, blocks };
  }
  const blocks = [...document.blocks];
  let index: number;
  switch (where.at) {
    case 'top': {
      const first = blocks.slice(0, activeEnd(document)).findIndex(isTask);
      index = first >= 0 ? first : emptyListIndex(document);
      break;
    }
    case 'bottom': {
      const active = blocks.slice(0, activeEnd(document));
      let last = -1;
      active.forEach((block, position) => {
        if (isTask(block)) last = position;
      });
      index = last >= 0 ? last + 1 : emptyListIndex(document);
      break;
    }
    case 'anchor':
      index = anchorIndex(blocks, where.after, where.skip);
      break;
    case 'before':
    case 'after': {
      const target = blocks.findIndex((block) => isTask(block) && block.key === where.key);
      if (target < 0) return undefined;
      index = where.at === 'before' ? target : target + 1;
      break;
    }
    case 'child':
      return undefined;
  }
  blocks.splice(index, 0, shifted);
  return { ...document, blocks };
}

function firstChildIndex(children: readonly (TextChunk | TaskNode)[]): number {
  // Subtasks come after the body text that directly follows the task line.
  const first = children.findIndex((child) => child.kind === 'task');
  return first >= 0 ? first : children.length;
}

function anchorIndex(items: readonly Item[], after: string | null, skip: number): number {
  let index = 0;
  if (after !== null) {
    const found = items.findIndex((item) => isTask(item) && item.key === after);
    index = found >= 0 ? found + 1 : items.length;
  }
  let remaining = skip;
  while (remaining > 0 && index < items.length && !isTask(items[index])) {
    index++;
    remaining--;
  }
  return index;
}

export function topLevelTasks(document: FlintDocument): TaskNode[] {
  return document.blocks.filter(isTask);
}
