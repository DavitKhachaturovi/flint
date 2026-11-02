import {
  documentLines,
  parseDocument,
  serializeDocument,
  type FlintDocument,
  type TaskNode,
} from '../format/document.js';
import { flintField } from '../format/fields.js';
import { indentWidth, isBlank, joinLines, stripColumns, type Line } from '../format/lines.js';
import {
  fenceOpen,
  isFenceClose,
  listItemStart,
  opensHtmlComment,
  type Fence,
} from '../format/markdown-blocks.js';
import { setFrontmatterValues } from '../format/save.js';
import { getBody } from './body.js';
import type { Op } from './ops.js';

/**
 * LIST-04, task list → note: only `mode` changes. Task lines keep their fields, so converting back
 * is lossless; while the list is a note they are inert (docs/04 §4).
 */
export function convertToNote(document: FlintDocument, list: string): Op {
  return {
    type: 'setText',
    list,
    text: serializeDocument(setFrontmatterValues(document, { mode: 'note' })),
  };
}

const CHECKBOX = /^\[[^\]]\](?:[ \t]|$)/;

/** Turns `- text` into `- [ ] text`; leaves checklist items and anything else alone. */
function asTask(text: string, offset: number): string | null {
  const item = listItemStart(text.slice(offset));
  if (!item?.bullet || item.firstLine === '' || CHECKBOX.test(item.firstLine)) return null;
  const at = text.length - item.firstLine.length;
  return `${text.slice(0, at)}[ ] ${text.slice(at)}`;
}

/**
 * Converts plain bullets (outside code blocks and HTML comments) whose list item starts within
 * `[from, to]` columns. Returns the new lines.
 */
function convertBullets(lines: readonly Line[], from: number, to: number): Line[] {
  let fence: Fence | null = null;
  let inComment = false;
  return lines.map((line) => {
    const width = indentWidth(line.text);
    const relative = width >= from ? stripColumns(line.text, from) : null;
    if (fence) {
      if (relative !== null && isFenceClose(relative, fence)) fence = null;
      return line;
    }
    if (inComment) {
      if (line.text.includes('-->')) inComment = false;
      return line;
    }
    if (relative === null || isBlank(line.text)) return line;
    fence = fenceOpen(relative);
    inComment = fence === null && opensHtmlComment(relative);
    if (fence || inComment || width > to) return line;
    const converted = asTask(line.text, line.text.length - relative.length);
    return converted === null ? line : { text: converted, eol: line.eol };
  });
}

const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const TABLE = /^ {0,3}\|/;

/**
 * D-77: a note's top-level lines as tasks. List items (bullets and numbered) and every other
 * non-empty plain line become tasks; fenced code and quotes go under the task before them, as its
 * body; headings, rules, tables, HTML comments and indented lines stay as they are.
 */
function topLevelTasks(lines: readonly Line[]): Line[] {
  const out: Line[] = [];
  let fence: Fence | null = null;
  let attach = false;
  let inComment = false;
  /** A task is the last top-level block above (blank lines don't end it). */
  let afterTask = false;
  const under = (line: Line): Line =>
    attach && !isBlank(line.text) ? { text: `    ${line.text}`, eol: line.eol } : line;
  for (const line of lines) {
    const text = line.text;
    if (fence) {
      out.push(under(line));
      if (isFenceClose(text, fence)) fence = null;
      continue;
    }
    if (inComment) {
      out.push(line);
      if (text.includes('-->')) inComment = false;
      continue;
    }
    if (isBlank(text) || indentWidth(text) > 3) {
      out.push(line);
      continue;
    }
    fence = fenceOpen(text);
    if (fence || QUOTE.test(text)) {
      attach = afterTask;
      out.push(under(line));
      continue;
    }
    attach = false;
    if (opensHtmlComment(text) || HEADING.test(text) || RULE.test(text) || TABLE.test(text)) {
      inComment = opensHtmlComment(text);
      afterTask = false;
      out.push(line);
      continue;
    }
    const item = listItemStart(text);
    if (item && item.firstLine === '') {
      out.push(line);
      continue;
    }
    afterTask = true;
    if (item?.bullet) {
      out.push({ text: asTask(text, 0) ?? text, eol: line.eol });
      continue;
    }
    const indent = /^[ \t]*/.exec(text)?.[0] ?? '';
    out.push({ text: `${indent}- [ ] ${item ? item.firstLine : text.trim()}`, eol: line.eol });
  }
  return out;
}

/**
 * LIST-04, note → task list (D-22, D-77): checklist items stay tasks; plain bullets, numbered items
 * and every other non-empty plain line become tasks (plain bullets directly under them become
 * subtasks); fenced code and quotes go under the task before them as its body; headings and the
 * rest stay in place as non-task content. Nothing is dropped.
 */
export function convertToTasks(document: FlintDocument, list: string): Op {
  const header = setFrontmatterValues(document, { mode: 'tasks' });
  const frontmatterLength = header.frontmatter?.lines.length ?? 0;

  // Pass 1: the top-level lines.
  const top = documentLines(header);
  const body = topLevelTasks(top.slice(frontmatterLength));
  const bom = document.bom ? String.fromCharCode(0xfeff) : '';
  const first = parseDocument(bom + joinLines([...top.slice(0, frontmatterLength), ...body]), {
    keySeed: list,
  });

  // Pass 2: bullets one level down, now inside the tasks pass 1 created.
  const blocks = first.blocks.map((block) => {
    if (block.kind !== 'task') return block;
    const column = block.contentColumn;
    return {
      ...block,
      children: block.children.map((child) =>
        child.kind === 'text'
          ? { kind: 'text' as const, lines: convertBullets(child.lines, column, column + 3) }
          : child,
      ),
    };
  });
  return { type: 'setText', list, text: serializeDocument({ ...first, blocks }) };
}

/**
 * LIST-01, D-72, D-74: a list or note copied for "Duplicate": the list gets `listId` and every
 * task a new ID from `newId`; reminders (and `muted`) are left out, so a copy never fires the same
 * reminder twice, and so are Obsidian block IDs. Everything else is copied as it is.
 */
export function duplicateDocument(
  document: FlintDocument,
  listId: string,
  newId: () => string,
): string {
  const renew = (node: TaskNode): TaskNode => {
    const id = newId();
    const { pinned, completion, priority } = node.line.fields;
    return {
      ...node,
      key: id,
      raw: null,
      line: {
        ...node.line,
        fields: {
          ...(pinned ? { pinned } : {}),
          ...(completion ? { completion } : {}),
          ...(priority ? { priority } : {}),
          id: flintField(id),
        },
        blockId: null,
      },
      children: node.children.map((child) => (child.kind === 'task' ? renew(child) : child)),
    };
  };
  const blocks = document.blocks.map((block) => (block.kind === 'task' ? renew(block) : block));
  return serializeDocument(setFrontmatterValues({ ...document, blocks }, { id: listId }));
}

/**
 * TASK-17, D-85: what a task becomes as a note: its body, then its subtasks as a checklist with
 * their own bodies under them. The title becomes the note's name; Flint's fields (priority,
 * reminder, IDs) aren't carried over, since a note's fields are inert (LIST-04).
 */
export function taskAsNoteText(node: TaskNode): string {
  const body = getBody(node);
  const checklist = node.children.flatMap((child) => {
    if (child.kind !== 'task') return [];
    const mark = child.line.status === ' ' ? ' ' : 'x';
    const text = getBody(child);
    const under =
      text === '' ? [] : text.split('\n').map((line) => (line === '' ? '' : `    ${line}`));
    return [`- [${mark}] ${child.line.title.trim()}`, ...under];
  });
  return [body, checklist.join('\n')].filter((part) => part !== '').join('\n\n');
}
