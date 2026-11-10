/**
 * The conflict callout of Google Drive sync (SYNC-01, D-161 Q5, docs/04 §7): where two PCs changed
 * the same lines, this PC's lines stay in place and the other PC's follow in a quote callout:
 *
 *     > [!conflict] Also changed on DAVIT-LAPTOP, 10 Nov 14:02 (the 2 lines above are WORK-PC's)
 *     > Leave Saturday morning instead.
 *
 * The parenthesis says how many lines above are the other version, so Use … / Keep mine / Keep both
 * know exactly what to replace, on any PC. Plain markdown: Obsidian shows a callout, Drive a quote.
 */
import { splitLines, dominantEol, joinLines, type Line } from '../format/lines.js';

export interface ConflictLabels {
  /** This PC's name: its lines stay in place. */
  readonly mine: string;
  /** The other PC's name: its lines go into the callout. */
  readonly theirs: string;
  /** When the other version was written, as shown: `10 Nov 14:02`. */
  readonly when: string;
}

/** A conflict callout found in a text. */
export interface ConflictBlock {
  /** Index of the header line. */
  readonly start: number;
  /** Index just after the callout's last line. */
  readonly end: number;
  /** The PC whose version is in the callout. */
  readonly theirs: string;
  readonly when: string;
  /** The PC whose version is above, when known. */
  readonly mine: string | null;
  /** How many lines right above the callout are the other version; null when not known. */
  readonly mineCount: number | null;
  /** The callout's version, unquoted; empty when that PC deleted the lines. */
  readonly lines: readonly string[];
}

export type Resolution = 'theirs' | 'mine' | 'both';

const DELETED = '(deleted these lines)';
const HEADER =
  /^ {0,3}>[ \t]?\[!conflict\][ \t]*Also changed on (.+?), (\d{1,2} [A-Za-z]{3} \d{1,2}:\d{2})[ \t]*(?:\((.*)\))?[ \t]*$/i;
const COUNTED = /^the (\d+) lines? above (?:is|are) (.+)'s$/i;
const REMOVED = /^(.+) deleted these lines$/i;
const IN_CODE = /^(.+)'s version is in the code block above$/i;
const QUOTED = /^ {0,3}>/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `10 Nov 14:02` from a local time: the form callouts and their cards show. */
export function conflictTime(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getHours()}:${minutes}`;
}

/**
 * The callout's lines. `mineCount`: how many lines right above it are this PC's version; null when
 * the callout had to move below a code block (its lines are then not right above).
 */
export function conflictCallout(
  theirs: readonly string[],
  mineCount: number | null,
  labels: ConflictLabels,
): string[] {
  const where =
    mineCount === null
      ? `${labels.mine}'s version is in the code block above`
      : mineCount === 0
        ? `${labels.mine} deleted these lines`
        : `the ${mineCount} ${mineCount === 1 ? 'line above is' : 'lines above are'} ${labels.mine}'s`;
  const header = `> [!conflict] Also changed on ${labels.theirs}, ${labels.when} (${where})`;
  const body =
    theirs.length === 0
      ? [`> ${DELETED}`]
      : theirs.map((line) => (line === '' ? '>' : `> ${line}`));
  return [header, ...body];
}

function unquote(line: string): string {
  return line.replace(/^ {0,3}>[ \t]?/, '');
}

/** Every conflict callout in these lines, in order. */
export function findConflicts(lines: readonly string[]): ConflictBlock[] {
  const found: ConflictBlock[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = HEADER.exec(lines[index] ?? '');
    if (!match) continue;
    let end = index + 1;
    while (end < lines.length && QUOTED.test(lines[end] ?? '')) end++;
    const body = lines.slice(index + 1, end).map(unquote);
    const deleted = body.length === 1 && body[0] === DELETED;
    const where = match[3] ?? '';
    let mine: string | null = null;
    let mineCount: number | null = null;
    const counted = COUNTED.exec(where);
    const removed = REMOVED.exec(where);
    const inCode = IN_CODE.exec(where);
    if (counted) {
      mineCount = Number(counted[1]);
      mine = counted[2] ?? null;
    } else if (removed) {
      mineCount = 0;
      mine = removed[1] ?? null;
    } else if (inCode) {
      mine = inCode[1] ?? null;
    }
    // A count that reaches past the start of the text can't be right: treat it as unknown.
    if (mineCount !== null && mineCount > index) mineCount = null;
    found.push({
      start: index,
      end,
      theirs: match[1] ?? '',
      when: match[2] ?? '',
      mine,
      mineCount,
      lines: deleted ? [] : body,
    });
    index = end - 1;
  }
  return found;
}

/** Conflict callouts in a text (for the note's chip and the status popover). */
export function countConflicts(text: string): number {
  return findConflicts(splitLines(text).map((line) => line.text)).length;
}

/**
 * Resolves the `which`-th conflict of a text: `theirs` puts the callout's version in place of the
 * lines above it, `mine` removes the callout, `both` keeps both (the callout's version as plain
 * lines below). Returns the text unchanged when there is no such conflict, or when `theirs` is
 * asked of a callout whose lines above aren't known.
 */
export function resolveConflict(text: string, which: number, how: Resolution): string {
  const bom = text.startsWith('﻿');
  const lines = splitLines(bom ? text.slice(1) : text);
  const block = findConflicts(lines.map((line) => line.text))[which];
  if (!block) return text;
  if (how === 'theirs' && block.mineCount === null) return text;
  const eol = dominantEol(lines);
  const last = lines[block.end - 1];
  const tailEol = last?.eol ?? '';
  const replacement: Line[] =
    how === 'mine'
      ? []
      : block.lines.map((line, index) => ({
          text: line,
          eol: index === block.lines.length - 1 ? tailEol : eol,
        }));
  const from = how === 'theirs' ? block.start - (block.mineCount ?? 0) : block.start;
  let before = lines.slice(0, from);
  // Removing the callout at the end of the text: the line before it now ends the text as it did.
  if (replacement.length === 0 && block.end === lines.length && before.length > 0) {
    const previous = before[before.length - 1] as Line;
    before = [...before.slice(0, -1), { text: previous.text, eol: tailEol }];
  }
  const result = joinLines([...before, ...replacement, ...lines.slice(block.end)]);
  return (bom ? '﻿' : '') + result;
}
