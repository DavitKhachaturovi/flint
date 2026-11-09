import {
  formatLocalDateTime,
  parseLocalDateTime,
  type LocalDateTime,
  type ParsedLocalDateTime,
} from '../time/local-datetime.js';
import { codeSpanRanges, rangeContaining, type Range } from './code-spans.js';

/** Flint's own field keys, in the order Flint writes them (D-21). */
export const FLINT_KEYS = ['reminder', 'muted', 'pinned', 'completion', 'priority', 'id'] as const;
export type FlintKey = (typeof FLINT_KEYS)[number];

export type Priority = 'low' | 'medium' | 'high';

/** Generated IDs are `[a-z0-9]{4,6}`; anything matching this is read as an ID (D-21). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** A field's key and value exactly as written (trimmed). */
export interface RawField {
  readonly key: string;
  readonly value: string;
}

/**
 * A Flint field. `raw` is the text it was read from; it is written back unchanged unless Flint sets
 * a new value (then `raw` is null and the canonical form is written).
 */
export interface FieldValue<T> {
  readonly value: T;
  readonly raw: RawField | null;
}

export interface FlintFields {
  readonly reminder?: FieldValue<ParsedLocalDateTime>;
  /** REM-12, D-66: the reminder is turned off (kept, never fired). */
  readonly muted?: FieldValue<true>;
  /** TODAY-01, D-85: pinned (the Today view in M6). Read also from `today`, its earlier name. */
  readonly pinned?: FieldValue<true>;
  readonly completion?: FieldValue<ParsedLocalDateTime>;
  readonly priority?: FieldValue<Priority>;
  readonly id?: FieldValue<string>;
}

/** What follows `- [ ] ` on a task line, split into title text and fields (docs/04 §3). */
export interface TaskContent {
  /** Markdown title text with recognised fields and the block ID removed. */
  readonly title: string;
  readonly fields: FlintFields;
  /** Unknown fields from the trailing run, in their original order. */
  readonly unknown: readonly RawField[];
  /** Obsidian block ID (`^a1b2`) at the very end of the line, without the caret. */
  readonly blockId: string | null;
}

interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly key: string;
  readonly value: string;
  /** Whitespace directly after `::`. Unknown keys need it to count as fields (D-21). */
  readonly spaced: boolean;
}

const BLOCK_ID = /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;

export function isFlintKey(key: string): key is FlintKey {
  return (FLINT_KEYS as readonly string[]).includes(key);
}

/** D-85: `today` is the earlier name of `pinned`; it reads as `pinned` and is written as `pinned`. */
const ALIASES: Readonly<Record<string, FlintKey>> = { today: 'pinned' };

/** The Flint key a lower-case field key stands for, aliases included, or null. */
function flintKeyOf(key: string): FlintKey | null {
  return isFlintKey(key) ? key : (ALIASES[key] ?? null);
}

export function readPriority(value: string): Priority | null {
  switch (value.toLowerCase()) {
    case 'low':
    case 'lowest':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'highest':
      return 'high';
    default:
      return null;
  }
}

/** `pinned` and `muted` (D-66, D-85): `true`, any letter case. */
function readTrue(value: string): true | null {
  return /^true$/i.test(value) ? true : null;
}

function readId(value: string): string | null {
  return ID_PATTERN.test(value) ? value : null;
}

function isValidFlintValue(key: FlintKey, value: string): boolean {
  switch (key) {
    case 'priority':
      return readPriority(value) !== null;
    case 'reminder':
    case 'completion':
      return parseLocalDateTime(value) !== null;
    case 'pinned':
    case 'muted':
      return readTrue(value) !== null;
    case 'id':
      return readId(value) !== null;
  }
}

/**
 * What one scan of a line for field candidates keeps, so that each opening bracket costs a
 * bounded amount of work however long the line (D-146). Before, each one searched and read the
 * rest of the line, so a long line of unclosed fields took time quadratic in its length.
 */
interface Scan {
  readonly text: string;
  /** Candidates end before this index (the block ID's caret, or the text's length). */
  readonly end: number;
  readonly code: readonly Range[];
  /** `text.indexOf('::', separatorFrom)`, kept while the searches move forward. */
  separatorFrom: number;
  separatorAt: number;
  /** The first bracket of any kind at or after `bracketFrom` (`text.length` if none). */
  bracketFrom: number;
  bracketAt: number;
  /** Made when first needed (see `closings`): where values opened by `[` or by `(` close. */
  square: Int32Array | null;
  round: Int32Array | null;
}

function startScan(text: string, end: number, code: readonly Range[]): Scan {
  return {
    text,
    end,
    code,
    separatorFrom: -1,
    separatorAt: -1,
    bracketFrom: -1,
    bracketAt: -1,
    square: null,
    round: null,
  };
}

/** `text.indexOf('::', from)`; while `from` only grows, each part of the text is searched once. */
function separatorAfter(scan: Scan, from: number): number {
  const known =
    scan.separatorFrom >= 0 &&
    from >= scan.separatorFrom &&
    (scan.separatorAt < 0 || scan.separatorAt >= from);
  if (!known) scan.separatorAt = scan.text.indexOf('::', from);
  scan.separatorFrom = from;
  return scan.separatorAt;
}

function isBracket(char: string | undefined): boolean {
  return char === '[' || char === ']' || char === '(' || char === ')';
}

/** The first `[`, `]`, `(` or `)` at or after `from`, or the text's length; as `separatorAfter`. */
function bracketAfter(scan: Scan, from: number): number {
  const known = scan.bracketFrom >= 0 && from >= scan.bracketFrom && scan.bracketAt >= from;
  if (!known) {
    let index = from;
    while (index < scan.text.length && !isBracket(scan.text[index])) index++;
    scan.bracketAt = index;
  }
  scan.bracketFrom = from;
  return scan.bracketAt;
}

/** The index of the first code span starting after `index` (`code.length` if none). */
function firstSpanAfter(code: readonly Range[], index: number): number {
  let low = 0;
  let high = code.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((code[middle]?.[0] ?? Infinity) > index) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** `rangeContaining` by binary search (the spans are in order and don't overlap). */
function spanAt(code: readonly Range[], index: number): Range | undefined {
  const span = code[firstSpanAfter(code, index) - 1];
  return span && index < span[1] ? span : undefined;
}

/**
 * Where the values opened by `open` close, worked out for the whole line at once (D-146). The
 * line is read once from its start the way a value is read: code spans skipped, a backslash
 * escaping the next character, `open` a level deeper and `close` a level out; `depth[j]` is the
 * level before index `j`. A value read from index `j` (not escaping, at its own level 0) ends at
 * the first `close` that takes the level below `depth[j]`. The returned `next[j]` is the index
 * just after that `close`, or -1: the first `k > j` with `depth[k] === depth[j] - 1`, since the
 * level moves one step at a time.
 */
function closings(scan: Scan, open: string, close: string): Int32Array {
  const { text, end, code } = scan;
  const depth = new Int32Array(end + 1);
  let level = 0;
  let lowest = 0;
  let highest = 0;
  let escaped = false;
  let spanIndex = 0;
  let index = 0;
  while (index < end) {
    while ((code[spanIndex]?.[1] ?? Infinity) <= index) spanIndex++;
    const span = code[spanIndex];
    if (span && span[0] <= index) {
      const stop = Math.min(span[1], end);
      for (; index < stop; index++) depth[index] = level;
      escaped = false;
      continue;
    }
    depth[index] = level;
    const char = text[index];
    if (char === '\\') escaped = !escaped;
    else if (escaped) escaped = false;
    else if (char === open) highest = Math.max(highest, ++level);
    else if (char === close) lowest = Math.min(lowest, --level);
    index++;
  }
  depth[end] = level;

  // From the end back, the index last seen at a level is the first one after `j` at that level.
  // `next[j]` replaces `depth[j]` in place: the indexes still to do are all before `j`.
  const next = depth;
  const offset = 1 - lowest;
  const seen = new Int32Array(highest + offset + 1).fill(-1);
  for (let j = end; j >= 0; j--) {
    const at = (depth[j] ?? 0) + offset;
    next[j] = seen[at - 1] ?? -1;
    seen[at] = j;
  }
  return next;
}

/**
 * Finds `[key:: value]` / `(key:: value)` candidates the way Dataview does: the first `::` after
 * the bracket separates the key (which may not contain brackets), and the value runs to the
 * matching closing bracket, respecting nesting and backslash escapes. Brackets that are escaped or
 * inside inline code never open a field.
 *
 * Linear in the line's length (D-146): the code spans are walked with a pointer that only moves
 * forward, and `readCandidate` does a bounded amount of work for each bracket.
 */
function findCandidates(text: string, end: number, code: readonly Range[]): Candidate[] {
  const scan = startScan(text, end, code);
  const candidates: Candidate[] = [];
  let spanIndex = 0;
  let index = 0;
  while (index < end) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    while ((code[spanIndex]?.[1] ?? Infinity) <= index) spanIndex++;
    const span = code[spanIndex];
    if (span && span[0] <= index) {
      index = span[1];
      continue;
    }
    if (char === '[' || char === '(') {
      const candidate = readCandidate(scan, index);
      if (candidate) {
        candidates.push(candidate);
        index = candidate.end;
        continue;
      }
    }
    index++;
  }
  return candidates;
}

/**
 * Reads the candidate a bracket at `start` opens (one that isn't escaped or in a code span). Apart
 * from text no later bracket reads again, its work is bounded (D-146): the key is read only when
 * it holds no bracket (then the next bracket comes after its `::`), a run of backslashes at the
 * start of the value is this value's alone, and where the value ends comes from `closings`.
 */
function readCandidate(scan: Scan, start: number): Candidate | null {
  const { text, end, code } = scan;
  const open = text[start];
  const close = open === '[' ? ']' : ')';
  const separator = separatorAfter(scan, start + 1);
  if (separator < 0 || separator >= end) return null;
  if (bracketAfter(scan, start + 1) < separator) return null;
  const key = text.slice(start + 1, separator).trim();
  if (key === '') return null;
  if ((code[firstSpanAfter(code, start)]?.[0] ?? Infinity) <= separator + 1) return null;

  // The value is read character by character only until the read stops escaping: after its
  // first character that isn't a backslash, or at a code span. From there on, its read and the
  // line-wide one in `closings` see the same levels.
  let nesting = 0;
  let escaped = false;
  let index = separator + 2;
  let closeAt = -1;
  while (index < end) {
    const span = spanAt(code, index);
    if (span) {
      index = span[1];
      break;
    }
    const char = text[index];
    index++;
    if (char === '\\') {
      escaped = !escaped;
      continue;
    }
    if (escaped) break;
    if (char === open) nesting = 1;
    else if (char === close) closeAt = index - 1;
    break;
  }
  if (closeAt < 0) {
    if (index >= end) return null;
    const next =
      open === '['
        ? (scan.square ??= closings(scan, '[', ']'))
        : (scan.round ??= closings(scan, '(', ')'));
    let after = index;
    for (let level = 0; level <= nesting && after >= 0; level++) after = next[after] ?? -1;
    if (after < 0) return null;
    closeAt = after - 1;
  }

  const rawValue = text.slice(separator + 2, closeAt);
  return {
    start,
    end: closeAt + 1,
    key,
    value: rawValue.trim(),
    spaced: /^[ \t]/.test(rawValue),
  };
}

type Classified = Candidate & { readonly kind: 'flint' | 'unknown' | 'text' };

function classify(candidates: readonly Candidate[]): Classified[] {
  const seen = new Set<FlintKey>();
  return candidates.map((candidate) => {
    const key = flintKeyOf(candidate.key.toLowerCase());
    if (key) {
      // Only the first valid occurrence is the field; an invalid value or a repeat stays visible
      // as title text (D-21).
      if (!seen.has(key) && isValidFlintValue(key, candidate.value)) {
        seen.add(key);
        return { ...candidate, kind: 'flint' };
      }
      return { ...candidate, kind: 'text' };
    }
    return { ...candidate, kind: candidate.spaced ? 'unknown' : 'text' };
  });
}

function isWhitespace(text: string): boolean {
  return /^[ \t]*$/.test(text);
}

function isSpaceOrTab(char: string | undefined): boolean {
  return char === ' ' || char === '\t';
}

/** Appends a piece of title text, collapsing the gap a removed field leaves behind. */
function appendPiece(title: string, piece: string): string {
  if (piece === '') return title;
  if (title === '') return piece;
  const titleEndsWithSpace = /[ \t]$/.test(title);
  const pieceStartsWithSpace = /^[ \t]/.test(piece);
  if (titleEndsWithSpace && pieceStartsWithSpace) return title + piece.replace(/^[ \t]+/, '');
  if (!titleEndsWithSpace && !pieceStartsWithSpace) return `${title} ${piece}`;
  return title + piece;
}

/**
 * Removes spaces and tabs at both ends. `replace(/^[ \t]+|[ \t]+$/g, '')` did the same in time
 * quadratic in a long run of spaces inside the text (D-146).
 */
function trimSpacesAndTabs(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isSpaceOrTab(text[start])) start++;
  while (end > start && isSpaceOrTab(text[end - 1])) end--;
  return text.slice(start, end);
}

function buildField<T>(candidate: Candidate, value: T): FieldValue<T> {
  return { value, raw: { key: candidate.key, value: candidate.value } };
}

/**
 * Splits the text after `- [ ] ` into title and fields (D-21):
 * - Flint's keys count anywhere, either bracket, with or without a space after `::`, but only with
 *   a valid value;
 * - unknown keys count only in the trailing run of fields, and only with a space after `::`;
 * - nothing inside inline code counts.
 */
export function parseTaskContent(text: string): TaskContent {
  const code = codeSpanRanges(text);
  let end = text.length;
  let blockId: string | null = null;
  const block = BLOCK_ID.exec(text);
  if (block) {
    const caret = block.index + (block[1] ?? '').length;
    if (!rangeContaining(caret, code)) {
      blockId = block[2] ?? null;
      end = caret;
    }
  }

  const classified = classify(findCandidates(text, end, code));

  const trailing = new Set<Classified>();
  let cursor = end;
  for (let index = classified.length - 1; index >= 0; index--) {
    const candidate = classified[index];
    if (!candidate || !isWhitespace(text.slice(candidate.end, cursor))) break;
    if (candidate.kind === 'text') break;
    trailing.add(candidate);
    cursor = candidate.start;
  }

  const recognised = classified.filter(
    (candidate) =>
      candidate.kind === 'flint' || (candidate.kind === 'unknown' && trailing.has(candidate)),
  );

  let title = '';
  let position = 0;
  for (const candidate of recognised) {
    title = appendPiece(title, text.slice(position, candidate.start));
    position = candidate.end;
  }
  title = trimSpacesAndTabs(appendPiece(title, text.slice(position, end)));

  const fields: {
    reminder?: FieldValue<ParsedLocalDateTime>;
    muted?: FieldValue<true>;
    pinned?: FieldValue<true>;
    completion?: FieldValue<ParsedLocalDateTime>;
    priority?: FieldValue<Priority>;
    id?: FieldValue<string>;
  } = {};
  const unknown: RawField[] = [];
  for (const candidate of recognised) {
    if (candidate.kind === 'unknown') {
      unknown.push({ key: candidate.key, value: candidate.value });
      continue;
    }
    const key = flintKeyOf(candidate.key.toLowerCase());
    switch (key) {
      case 'reminder':
      case 'completion': {
        const parsed = parseLocalDateTime(candidate.value);
        if (parsed) fields[key] = buildField(candidate, parsed);
        break;
      }
      case 'pinned':
      case 'muted':
        // An alias (`today`) is written under its current name (D-85) the next time the line is.
        fields[key] =
          candidate.key.toLowerCase() === key
            ? buildField(candidate, true)
            : { value: true, raw: null };
        break;
      case 'priority': {
        const priority = readPriority(candidate.value);
        if (priority) fields.priority = buildField(candidate, priority);
        break;
      }
      case 'id':
        fields.id = buildField(candidate, candidate.value);
        break;
    }
  }

  return { title, fields, unknown, blockId };
}

function formatFlintValue(key: FlintKey, value: unknown): string {
  switch (key) {
    case 'reminder':
    case 'completion':
      return formatLocalDateTime((value as ParsedLocalDateTime).value);
    case 'pinned':
    case 'muted':
      return 'true';
    case 'priority':
    case 'id':
      return String(value);
  }
}

/** True when `[`/`]` (or `(`/`)`) in a value pair up, so the field can be read back as written. */
function isBalanced(value: string, open: string, close: string): boolean {
  let depth = 0;
  let escaped = false;
  for (const char of value) {
    if (char === '\\') {
      escaped = !escaped;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === open) depth++;
    else if (char === close && --depth < 0) return false;
  }
  return depth === 0;
}

function wrapField(key: string, value: string): string {
  if (isBalanced(value, '[', ']')) return `[${key}:: ${value}]`;
  return `(${key}:: ${value})`;
}

function compose(title: string, content: TaskContent): string {
  const parts: string[] = [];
  if (title !== '') parts.push(title);
  for (const key of FLINT_KEYS) {
    const field = content.fields[key];
    if (!field) continue;
    parts.push(
      field.raw
        ? wrapField(field.raw.key, field.raw.value)
        : wrapField(key, formatFlintValue(key, field.value)),
    );
  }
  for (const field of content.unknown) parts.push(wrapField(field.key, field.value));
  if (content.blockId) parts.push(`^${content.blockId}`);
  return parts.join(' ');
}

function sameFieldValue(
  a: FieldValue<unknown> | undefined,
  b: FieldValue<unknown> | undefined,
): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}

/** Whether `text` reads back as exactly this title and these fields. */
function readsBackAs(text: string, title: string, content: TaskContent): boolean {
  const reread = parseTaskContent(text);
  return (
    reread.title === title &&
    reread.blockId === content.blockId &&
    reread.unknown.length === content.unknown.length &&
    reread.unknown.every(
      (field, index) =>
        field.key === content.unknown[index]?.key && field.value === content.unknown[index]?.value,
    ) &&
    FLINT_KEYS.every((key) => sameFieldValue(reread.fields[key], content.fields[key]))
  );
}

/** Puts a backslash before the character at each index, in one pass over the text (D-146). */
function insertBackslashes(text: string, indexes: readonly number[]): string {
  let escaped = '';
  let position = 0;
  for (const index of [...indexes].sort((a, b) => a - b)) {
    escaped += `${text.slice(position, index)}\\`;
    position = index;
  }
  return escaped + text.slice(position);
}

/** Escapes the opening bracket of field-like text in a title (Markdown renders `\[` as `[`). */
function escapeFieldOpeners(title: string, flintOnly: boolean): string {
  const code = codeSpanRanges(title);
  // Every occurrence, not just the first: once the first is escaped, a repeat would be read back.
  const indexes = findCandidates(title, title.length, code)
    .filter((candidate) => {
      const key = flintKeyOf(candidate.key.toLowerCase());
      if (key) return isValidFlintValue(key, candidate.value);
      return !flintOnly && candidate.spaced;
    })
    .map((candidate) => candidate.start);
  return insertBackslashes(title, indexes);
}

/**
 * D-153: how many escaping passes `escapeFieldOpenersFully` makes before its last resort. Each pass
 * undoes one layer of nesting; titles people type need one to three.
 */
const ESCAPE_PASSES = 16;

/**
 * Escaping one opener can turn an outer bracket into a field (`[ a :: [priority:: high]`), so
 * repeat until nothing changes. Each pass escapes at least one more opener, so this ends.
 *
 * D-153: but on nested field-like text each pass may escape only one more opener (`[ a :: `
 * repeated before `[priority:: high]`: 8 s at 50,000 characters). A title that needs more than
 * `ESCAPE_PASSES` passes gets every bracket with `::` after it escaped instead, in one linear pass
 * (`escapeEverything`'s openers only: its backticks and `^id` stay as they are), so nothing in it
 * can read as a field. The output is the same as before for every title that needs no more
 * passes; a deeper one is escaped more than it strictly needs, and still reads back and renders
 * the same (`\[` shows as `[`).
 */
function escapeFieldOpenersFully(title: string, flintOnly: boolean): string {
  let current = title;
  for (let pass = 0; pass < ESCAPE_PASSES; pass++) {
    const next = escapeFieldOpeners(current, flintOnly);
    if (next === current) return current;
    current = next;
  }
  // The pass that would confirm the last one changed nothing.
  if (escapeFieldOpeners(current, flintOnly) === current) return current;
  return escapeEverything(current, false);
}

/**
 * Last resort: every bracket that has `::` after it, backticks that don't pair up, and a trailing
 * `^id` that would read as a block ID. Nothing in the title can then start a field or a code span.
 * With `all` false only the brackets (D-153): nothing in the title can start a field.
 */
function escapeEverything(title: string, all = true): string {
  const code = codeSpanRanges(title);
  const indexes: number[] = [];
  // A bracket has `::` after it when the last `::` starts after it (D-146: not a search each).
  const lastSeparator = title.lastIndexOf('::');
  let spanIndex = 0;
  for (let index = 0; index < title.length; index++) {
    const char = title[index];
    if (char === '\\') {
      index++;
      continue;
    }
    while ((code[spanIndex]?.[1] ?? Infinity) <= index) spanIndex++;
    const span = code[spanIndex];
    if (span && span[0] <= index) {
      index = span[1] - 1;
      continue;
    }
    if (char === '`') {
      if (all) indexes.push(index);
    } else if ((char === '[' || char === '(') && lastSeparator > index) indexes.push(index);
  }
  const block = all ? BLOCK_ID.exec(title) : null;
  if (block && !rangeContaining(block.index, code))
    indexes.push(block.index + (block[1] ?? '').length);
  return insertBackslashes(title, indexes);
}

/**
 * Writes task content canonically (D-21, D-66): title, then Flint's fields in the order `reminder`,
 * `muted`, `pinned`, `completion`, `priority`, `id`, then unknown fields, then the block ID.
 *
 * The written line must read back as the same task. When the title contains text that would then be
 * read as a field (a repeated Flint field that was visible text, say), the least escaping that
 * makes it read back correctly is applied; unescaped text is preferred so Dataview keeps seeing
 * the fields it saw before. D-153: except in a title whose escaping needs more than 16 passes
 * (about 16 layers of nested field-like text), where every bracket with `::` after it is escaped
 * (see `escapeFieldOpenersFully`).
 *
 * Each escaped form is worked out only when the one before it doesn't read back (D-146): a task
 * read from a file and then changed (completed, pinned) usually reads back with its title as it
 * is, and the repeated escaping costs time quadratic in a long field-like title.
 */
export function formatTaskContent(content: TaskContent): string {
  const plain = compose(content.title, content);
  if (readsBackAs(plain, content.title, content)) return plain;
  const flintEscaped = escapeFieldOpenersFully(content.title, true);
  const flintText = compose(flintEscaped, content);
  if (readsBackAs(flintText, flintEscaped, content)) return flintText;
  const allEscaped = escapeFieldOpenersFully(content.title, false);
  const allText = compose(allEscaped, content);
  if (readsBackAs(allText, allEscaped, content)) return allText;
  return compose(escapeEverything(allEscaped), content);
}

/**
 * Escapes text a user typed as a title so it can't be read back as a field: the opening bracket
 * of anything that would parse as a Flint field, or as an unknown field once Flint's own fields
 * follow it, gets a backslash (Markdown renders `\[` as `[`). Line breaks become spaces.
 */
export function escapeTitle(title: string): string {
  return escapeFieldOpenersFully(title.replace(/\r\n|\r|\n/g, ' '), false);
}

/** A Flint field set by Flint itself (written canonically). */
export function flintField<T>(value: T): FieldValue<T> {
  return { value, raw: null };
}

export function localDateTimeField(value: LocalDateTime): FieldValue<ParsedLocalDateTime> {
  return { value: { value, dateOnly: false }, raw: null };
}
