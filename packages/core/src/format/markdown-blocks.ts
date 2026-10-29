/**
 * The small part of CommonMark block structure Flint needs to tell tasks from everything else:
 * list items and how far they extend, fenced code, HTML comments, and lines that end a paragraph.
 * Flint never rewrites what these find; it only needs to know where a task's lines start and end.
 */
import { indentWidth, isBlank } from './lines.js';

export interface Fence {
  readonly char: '`' | '~';
  readonly length: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}>/;
const HTML_START = /^ {0,3}</;
const HTML_COMMENT_START = /^ {0,3}<!--/;
const LIST_MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const COMPLETED_HEADING = /^ {0,3}##[ \t]+completed[ \t]*(?:#+[ \t]*)?$/i;

export function fenceOpen(text: string): Fence | null {
  const match = FENCE_OPEN.exec(text);
  if (!match) return null;
  const run = match[1] ?? '';
  const char = run[0] as Fence['char'];
  // A backtick fence's info string may not contain backticks (that's inline code instead).
  if (char === '`' && (match[2] ?? '').includes('`')) return null;
  return { char, length: run.length };
}

export function isFenceClose(text: string, fence: Fence): boolean {
  const match = FENCE_CLOSE.exec(text);
  const run = match?.[1];
  return run !== undefined && run[0] === fence.char && run.length >= fence.length;
}

/** An HTML comment that starts on this line and doesn't end on it. */
export function opensHtmlComment(text: string): boolean {
  if (!HTML_COMMENT_START.test(text)) return false;
  const start = text.indexOf('<!--');
  return !text.includes('-->', start + 4);
}

/** The visual column of `index` in `text` (tabs advance to the next multiple of 4). */
export function columnAt(text: string, index: number): number {
  let column = 0;
  for (let position = 0; position < index && position < text.length; position++) {
    column = text[position] === '\t' ? column + 4 - (column % 4) : column + 1;
  }
  return column;
}

export interface ListItemStart {
  readonly bullet: boolean;
  /** Column where the item's content starts; continuation lines must be indented this far. */
  readonly contentColumn: number;
  /** The text after the marker (the item's first line of content). */
  readonly firstLine: string;
}

/** A list item starting on this line, indented at most 3 columns (else it's not one at this level). */
export function listItemStart(text: string): ListItemStart | null {
  if (THEMATIC_BREAK.test(text)) return null;
  const match = LIST_MARKER.exec(text);
  if (!match) return null;
  const indent = match[1] ?? '';
  const marker = match[2] ?? '';
  if (indentWidth(indent) > 3) return null;
  const markerEnd = match[0].length;
  const markerColumn = columnAt(text, markerEnd);
  const rest = text.slice(markerEnd);
  const firstLine = rest.replace(/^[ \t]+/, '');
  let contentColumn: number;
  if (firstLine === '') {
    contentColumn = markerColumn + 1;
  } else {
    const firstColumn = columnAt(text, text.length - firstLine.length);
    // Five or more spaces after the marker: content starts after one (indented code follows).
    contentColumn = firstColumn - markerColumn > 4 ? markerColumn + 1 : firstColumn;
  }
  return { bullet: /^[-*+]$/.test(marker), contentColumn, firstLine };
}

/** Lines that start a new block and so can't be a lazy continuation of a paragraph. */
export function interruptsParagraph(text: string): boolean {
  return (
    ATX_HEADING.test(text) ||
    THEMATIC_BREAK.test(text) ||
    BLOCKQUOTE.test(text) ||
    HTML_START.test(text) ||
    fenceOpen(text) !== null ||
    listItemStart(text) !== null
  );
}

/** Text that continues a paragraph (so a following under-indented line can be lazy). */
export function isParagraphText(text: string): boolean {
  return (
    !isBlank(text) &&
    !ATX_HEADING.test(text) &&
    !THEMATIC_BREAK.test(text) &&
    fenceOpen(text) === null &&
    !HTML_START.test(text)
  );
}

export function isCompletedHeading(text: string): boolean {
  return COMPLETED_HEADING.test(text);
}

export function isHeading(text: string): boolean {
  return ATX_HEADING.test(text);
}
