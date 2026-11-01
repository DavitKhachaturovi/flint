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

/**
 * LIST-04, note → task list (D-22): checklist items stay tasks, plain bullets become tasks (and
 * plain bullets directly under them become subtasks); headings, paragraphs and everything else stay
 * in place as non-task content. Nothing is dropped.
 */
export function convertToTasks(document: FlintDocument, list: string): Op {
  const header = setFrontmatterValues(document, { mode: 'tasks' });
  const frontmatterLength = header.frontmatter?.lines.length ?? 0;

  // Pass 1: top-level bullets.
  const top = documentLines(header);
  const body = convertBullets(top.slice(frontmatterLength), 0, 3);
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
    const { today, completion, priority } = node.line.fields;
    return {
      ...node,
      key: id,
      raw: null,
      line: {
        ...node.line,
        fields: {
          ...(today ? { today } : {}),
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
