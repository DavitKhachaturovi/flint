import {
  dominantEol,
  indentWidth,
  isBlank,
  joinLines,
  splitLines,
  stripColumns,
  type Line,
  type LineEnding,
} from './lines.js';
import {
  fenceOpen,
  interruptsParagraph,
  isCompletedHeading,
  isFenceClose,
  isParagraphText,
  listItemStart,
  opensHtmlComment,
  type Fence,
} from './markdown-blocks.js';
import { formatTaskLine, parseTaskLine, type TaskLine } from './task-line.js';

/** The YAML frontmatter block, kept as written; only Flint's keys are read (docs/04 §3–4). */
export interface Frontmatter {
  /** All lines, both `---` delimiters included. */
  readonly lines: readonly Line[];
  readonly flint: string | null;
  readonly id: string | null;
  readonly mode: string | null;
}

/** Lines that belong to a task but aren't a subtask: its body (TASK-05). */
export interface TextChunk {
  readonly kind: 'text';
  readonly lines: readonly Line[];
}

export interface TaskNode {
  readonly kind: 'task';
  /**
   * Stable key: the task's ID, or a provisional key starting with `~` until an ID is written on
   * the next save (docs/04 §3).
   */
  readonly key: string;
  readonly line: TaskLine;
  /** The task line exactly as read, while Flint hasn't changed it; null once it has. */
  readonly raw: string | null;
  readonly eol: LineEnding;
  /** Column where the task's content starts; its body and subtasks are indented at least this far. */
  readonly contentColumn: number;
  /** Body text and, for top-level tasks, subtasks, in file order. */
  readonly children: readonly (TextChunk | TaskNode)[];
}

/** Anything at the top level that isn't a task (D-22): kept in place, shown read-only. */
export interface OtherBlock {
  readonly kind: 'other';
  readonly lines: readonly Line[];
  /** The `## Completed` heading that starts the Completed section (its own block). */
  readonly completedHeading: boolean;
}

export type Block = TaskNode | OtherBlock;

export interface FlintDocument {
  readonly bom: boolean;
  /** Whether the file ends with a line break; kept as it was (docs/04 §6). */
  readonly finalNewline: boolean;
  /** Line ending for new lines: the file's most common one. */
  readonly eol: '\n' | '\r\n';
  /** Indentation one level deeper: a tab if the file indents with tabs, otherwise 4 spaces. */
  readonly indentUnit: string;
  readonly frontmatter: Frontmatter | null;
  readonly blocks: readonly Block[];
}

export interface ParseOptions {
  /** Makes provisional keys unique across files (e.g. the file path or list ID). */
  readonly keySeed?: string;
}

interface ParseContext {
  readonly seed: string;
  readonly ids: Set<string>;
  readonly keys: Set<string>;
  readonly occurrences: Map<string, number>;
}

/** FNV-1a, enough to derive provisional keys that stay the same when an unchanged file is re-read. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

function assignKey(line: TaskLine, text: string, context: ParseContext): string {
  const id = line.fields.id?.value;
  if (id !== undefined && !context.ids.has(id)) {
    context.ids.add(id);
    context.keys.add(id);
    return id;
  }
  // No ID yet, or a duplicate (the first occurrence keeps it): a provisional key derived from the
  // line, so re-reading an unchanged file gives the same keys.
  const content = text.trim();
  const occurrence = context.occurrences.get(content) ?? 0;
  context.occurrences.set(content, occurrence + 1);
  let key = `~${hash(`${context.seed}\u0000${content}`)}${occurrence === 0 ? '' : `.${occurrence}`}`;
  while (context.keys.has(key)) key += '+';
  context.keys.add(key);
  return key;
}

const BOM = String.fromCharCode(0xfeff);
const FRONTMATTER_DELIMITER = /^---[ \t]*$/;
const FRONTMATTER_END = /^(?:---|\.\.\.)[ \t]*$/;
const FLINT_FRONTMATTER_KEY = /^(flint|id|mode)[ \t]*:(.*)$/;

function yamlScalar(text: string): string {
  const value = text.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    return end > 0 ? value.slice(1, end) : value.slice(1);
  }
  return value.replace(/[ \t]+#.*$/, '').trim();
}

function parseFrontmatter(lines: readonly Line[]): Frontmatter | null {
  const first = lines[0];
  if (!first || !FRONTMATTER_DELIMITER.test(first.text)) return null;
  for (let index = 1; index < lines.length; index++) {
    if (!FRONTMATTER_END.test(lines[index]?.text ?? '')) continue;
    const values: Record<'flint' | 'id' | 'mode', string | null> = {
      flint: null,
      id: null,
      mode: null,
    };
    for (const line of lines.slice(1, index)) {
      const match = FLINT_FRONTMATTER_KEY.exec(line.text);
      if (match) values[match[1] as 'flint' | 'id' | 'mode'] = yamlScalar(match[2] ?? '');
    }
    return { lines: lines.slice(0, index + 1), ...values };
  }
  return null;
}

function scanFence(lines: readonly Line[], start: number, fence: Fence): number {
  for (let index = start + 1; index < lines.length; index++) {
    if (isFenceClose(lines[index]?.text ?? '', fence)) return index + 1;
  }
  return lines.length;
}

function scanHtmlComment(lines: readonly Line[], start: number): number {
  for (let index = start + 1; index < lines.length; index++) {
    if ((lines[index]?.text ?? '').includes('-->')) return index + 1;
  }
  return lines.length;
}

/**
 * Where the list item starting at `start` ends (exclusive): CommonMark container rules, simplified.
 * Lines indented to the content column belong to it, blank lines only if more of it follows, and a
 * paragraph line may be followed by under-indented "lazy" continuation lines.
 */
function scanItem(
  lines: readonly Line[],
  start: number,
  limit: number,
  contentColumn: number,
  firstLine: string,
  /** The content column of the item's container (a subtask's parent task), 0 at the top level. */
  containerColumn = 0,
): number {
  let fence = fenceOpen(firstLine);
  let inComment = fence === null && opensHtmlComment(firstLine);
  let paragraph = fence === null && !inComment && isParagraphText(firstLine);
  let end = start + 1;
  while (end < limit) {
    const text = lines[end]?.text ?? '';
    if (isBlank(text)) {
      if (fence || inComment) {
        end++;
        continue;
      }
      let next = end + 1;
      while (next < limit && isBlank(lines[next]?.text ?? '')) next++;
      if (next < limit && indentWidth(lines[next]?.text ?? '') >= contentColumn) {
        end = next;
        paragraph = false;
        continue;
      }
      break;
    }
    const indented = indentWidth(text) >= contentColumn;
    if (fence || inComment) {
      if (!indented) break;
      const relative = stripColumns(text, contentColumn);
      if (fence && isFenceClose(relative, fence)) fence = null;
      else if (inComment && text.includes('-->')) inComment = false;
      end++;
      continue;
    }
    if (indented) {
      const relative = stripColumns(text, contentColumn);
      fence = fenceOpen(relative);
      inComment = fence === null && opensHtmlComment(relative);
      paragraph = fence === null && !inComment && isParagraphText(relative);
      end++;
      continue;
    }
    // Whether a line interrupts the paragraph is judged inside the container: a sibling subtask
    // ("    - [ ] b" under "- [ ] parent") is a list item there, not indented code.
    const inContainer = stripColumns(text, Math.min(indentWidth(text), containerColumn));
    if (paragraph && !interruptsParagraph(inContainer)) {
      end++;
      continue;
    }
    break;
  }
  return end;
}

function buildTask(
  lines: readonly Line[],
  start: number,
  end: number,
  line: TaskLine,
  contentColumn: number,
  depth: 0 | 1,
  context: ParseContext,
): TaskNode {
  const head = lines[start] ?? { text: '', eol: '' };
  const key = assignKey(line, head.text, context);
  const children: (TextChunk | TaskNode)[] = [];
  let chunk: Line[] = [];
  const flush = (): void => {
    if (chunk.length > 0) children.push({ kind: 'text', lines: chunk });
    chunk = [];
  };

  if (depth === 1) {
    // One level of subtasks only: everything under a subtask is its body (docs/04 §3).
    chunk = lines.slice(start + 1, end);
  } else {
    let fence: Fence | null = null;
    let inComment = false;
    let index = start + 1;
    while (index < end) {
      const current = lines[index] ?? { text: '', eol: '' };
      const text = current.text;
      const relative =
        indentWidth(text) >= contentColumn ? stripColumns(text, contentColumn) : null;
      if (fence) {
        if (relative !== null && isFenceClose(relative, fence)) fence = null;
      } else if (inComment) {
        if (text.includes('-->')) inComment = false;
      } else if (relative !== null && !isBlank(text)) {
        fence = fenceOpen(relative);
        inComment = fence === null && opensHtmlComment(relative);
        const item = fence === null && !inComment ? listItemStart(relative) : null;
        if (item) {
          const itemColumn = contentColumn + item.contentColumn;
          const itemEnd = scanItem(lines, index, end, itemColumn, item.firstLine, contentColumn);
          const subtask = item.bullet ? parseTaskLine(text) : null;
          if (subtask) {
            flush();
            children.push(buildTask(lines, index, itemEnd, subtask, itemColumn, 1, context));
          } else {
            chunk.push(...lines.slice(index, itemEnd));
          }
          index = itemEnd;
          continue;
        }
      }
      chunk.push(current);
      index++;
    }
  }
  flush();
  return { kind: 'task', key, line, raw: head.text, eol: head.eol, contentColumn, children };
}

function parseBlocks(lines: readonly Line[], start: number, context: ParseContext): Block[] {
  const blocks: Block[] = [];
  let other: Line[] = [];
  const flush = (): void => {
    if (other.length > 0) blocks.push({ kind: 'other', lines: other, completedHeading: false });
    other = [];
  };
  let completedSeen = false;
  let index = start;
  while (index < lines.length) {
    const text = lines[index]?.text ?? '';
    const fence = fenceOpen(text);
    if (fence) {
      const end = scanFence(lines, index, fence);
      other.push(...lines.slice(index, end));
      index = end;
      continue;
    }
    if (opensHtmlComment(text)) {
      const end = scanHtmlComment(lines, index);
      other.push(...lines.slice(index, end));
      index = end;
      continue;
    }
    const item = listItemStart(text);
    if (item) {
      const end = scanItem(lines, index, lines.length, item.contentColumn, item.firstLine);
      const task = item.bullet ? parseTaskLine(text) : null;
      if (task) {
        flush();
        blocks.push(buildTask(lines, index, end, task, item.contentColumn, 0, context));
      } else {
        other.push(...lines.slice(index, end));
      }
      index = end;
      continue;
    }
    if (!completedSeen && isCompletedHeading(text)) {
      flush();
      blocks.push({
        kind: 'other',
        lines: [lines[index] ?? { text, eol: '' }],
        completedHeading: true,
      });
      completedSeen = true;
      index++;
      continue;
    }
    other.push(lines[index] ?? { text, eol: '' });
    index++;
  }
  flush();
  return blocks;
}

function usesTabs(blocks: readonly Block[]): boolean {
  const check = (node: TaskNode): boolean =>
    node.children.some((child) =>
      child.kind === 'text'
        ? child.lines.some((line) => line.text.startsWith('\t'))
        : child.line.indent.startsWith('\t') || check(child),
    );
  return blocks.some((block) => block.kind === 'task' && check(block));
}

/**
 * Reads a list file. Never fails and never loses anything: `serializeDocument(parseDocument(text))`
 * returns `text` byte-for-byte (docs/04 §3).
 */
export function parseDocument(text: string, options: ParseOptions = {}): FlintDocument {
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(1) : text;
  const lines = splitLines(body);
  const frontmatter = parseFrontmatter(lines);
  const context: ParseContext = {
    seed: options.keySeed ?? '',
    ids: new Set(),
    keys: new Set(),
    occurrences: new Map(),
  };
  const blocks = parseBlocks(lines, frontmatter?.lines.length ?? 0, context);
  return {
    bom,
    finalNewline: body === '' || /[\r\n]$/.test(body),
    eol: dominantEol(lines),
    indentUnit: usesTabs(blocks) ? '\t' : '    ',
    frontmatter,
    blocks,
  };
}

function emitTask(node: TaskNode, out: Line[]): void {
  out.push({ text: node.raw ?? formatTaskLine(node.line), eol: node.eol });
  for (const child of node.children) {
    if (child.kind === 'text') out.push(...child.lines);
    else emitTask(child, out);
  }
}

/** All lines of the document as they will be written. */
export function documentLines(document: FlintDocument): Line[] {
  const out: Line[] = [];
  if (document.frontmatter) out.push(...document.frontmatter.lines);
  for (const block of document.blocks) {
    if (block.kind === 'other') out.push(...block.lines);
    else emitTask(block, out);
  }
  // Lines moved or added by an edit: every line but the last needs a line break, and the last one
  // keeps the file's original ending (with or without a final newline).
  const last = out.length - 1;
  for (let index = 0; index < out.length; index++) {
    const line = out[index];
    if (!line) continue;
    if (index < last && line.eol === '') out[index] = { text: line.text, eol: document.eol };
    if (index === last) {
      const eol = document.finalNewline ? line.eol || document.eol : '';
      if (eol !== line.eol) out[index] = { text: line.text, eol };
    }
  }
  return out;
}

export function serializeDocument(document: FlintDocument): string {
  return (document.bom ? BOM : '') + joinLines(documentLines(document));
}

export type ListMode = 'tasks' | 'note' | 'unknown';

/** `mode` from the frontmatter. A file without it is a note (D-23); an unrecognised mode is `unknown`. */
export function documentMode(document: FlintDocument): ListMode {
  const mode = document.frontmatter?.mode;
  if (mode === null || mode === undefined || mode === '') return 'note';
  if (mode === 'tasks' || mode === 'note') return mode;
  return 'unknown';
}

/** The `flint:` format version, or null for a file Flint hasn't written its header to yet. */
export function formatVersion(document: FlintDocument): number | null {
  const value = document.frontmatter?.flint;
  if (value === null || value === undefined || value === '') return null;
  const version = Number(value);
  return Number.isFinite(version) ? version : null;
}

/** The highest `flint:` format this code reads and writes (docs/04 §3). */
export const FORMAT_VERSION = 1;

/** A file written by a newer Flint: opened read-only, never merged or rewritten (04 §3, D-166). */
export function isNewerFormat(document: FlintDocument): boolean {
  const version = formatVersion(document);
  return version !== null && version > FORMAT_VERSION;
}

/** Every task, top-level and subtasks, in file order, with its parent. */
export function* allTasks(
  document: FlintDocument,
): Generator<{ readonly task: TaskNode; readonly parent: TaskNode | null }> {
  for (const block of document.blocks) {
    if (block.kind !== 'task') continue;
    yield { task: block, parent: null };
    for (const child of block.children) {
      if (child.kind === 'task') yield { task: child, parent: block };
    }
  }
}

export function findTask(
  document: FlintDocument,
  key: string,
): { readonly task: TaskNode; readonly parent: TaskNode | null } | undefined {
  for (const entry of allTasks(document)) if (entry.task.key === key) return entry;
  return undefined;
}

export function isProvisionalKey(key: string): boolean {
  return key.startsWith('~');
}
