import {
  formatLocalDateTime,
  parseLocalDateTime,
  type LocalDateTime,
  type ParsedLocalDateTime,
} from '../time/local-datetime.js';
import { codeSpanRanges, rangeContaining, type Range } from './code-spans.js';

/** Flint's own field keys, in the order Flint writes them (D-21). */
export const FLINT_KEYS = ['reminder', 'today', 'completion', 'priority', 'id'] as const;
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
  readonly today?: FieldValue<true>;
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

function readToday(value: string): true | null {
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
    case 'today':
      return readToday(value) !== null;
    case 'id':
      return readId(value) !== null;
  }
}

/**
 * Finds `[key:: value]` / `(key:: value)` candidates the way Dataview does: the first `::` after
 * the bracket separates the key (which may not contain brackets), and the value runs to the
 * matching closing bracket, respecting nesting and backslash escapes. Brackets that are escaped or
 * inside inline code never open a field.
 */
function findCandidates(text: string, end: number, code: readonly Range[]): Candidate[] {
  const candidates: Candidate[] = [];
  let index = 0;
  while (index < end) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    const span = rangeContaining(index, code);
    if (span) {
      index = span[1];
      continue;
    }
    if (char === '[' || char === '(') {
      const candidate = readCandidate(text, index, end, code);
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

function readCandidate(
  text: string,
  start: number,
  end: number,
  code: readonly Range[],
): Candidate | null {
  const open = text[start];
  const close = open === '[' ? ']' : ')';
  const separator = text.indexOf('::', start + 1);
  if (separator < 0 || separator >= end) return null;
  const key = text.slice(start + 1, separator).trim();
  if (key === '' || /[[\]()]/.test(key)) return null;
  if (code.some(([codeStart]) => codeStart > start && codeStart <= separator + 1)) return null;

  let nesting = 0;
  let escaped = false;
  for (let index = separator + 2; index < end; index++) {
    const span = rangeContaining(index, code);
    if (span) {
      index = span[1] - 1;
      escaped = false;
      continue;
    }
    const char = text[index];
    if (char === '\\') {
      escaped = !escaped;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === open) nesting++;
    else if (char === close) {
      if (nesting === 0) {
        const rawValue = text.slice(separator + 2, index);
        return {
          start,
          end: index + 1,
          key,
          value: rawValue.trim(),
          spaced: /^[ \t]/.test(rawValue),
        };
      }
      nesting--;
    }
  }
  return null;
}

type Classified = Candidate & { readonly kind: 'flint' | 'unknown' | 'text' };

function classify(candidates: readonly Candidate[]): Classified[] {
  const seen = new Set<FlintKey>();
  return candidates.map((candidate) => {
    const key = candidate.key.toLowerCase();
    if (isFlintKey(key)) {
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
  title = appendPiece(title, text.slice(position, end));
  title = title.replace(/^[ \t]+|[ \t]+$/g, '');

  const fields: {
    reminder?: FieldValue<ParsedLocalDateTime>;
    today?: FieldValue<true>;
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
    const key = candidate.key.toLowerCase() as FlintKey;
    switch (key) {
      case 'reminder':
      case 'completion': {
        const parsed = parseLocalDateTime(candidate.value);
        if (parsed) fields[key] = buildField(candidate, parsed);
        break;
      }
      case 'today':
        fields.today = buildField(candidate, true);
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
    case 'today':
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

function insertBackslashes(text: string, indexes: readonly number[]): string {
  let escaped = text;
  for (const index of [...indexes].sort((a, b) => b - a)) {
    escaped = `${escaped.slice(0, index)}\\${escaped.slice(index)}`;
  }
  return escaped;
}

/** Escapes the opening bracket of field-like text in a title (Markdown renders `\[` as `[`). */
function escapeFieldOpeners(title: string, flintOnly: boolean): string {
  const code = codeSpanRanges(title);
  // Every occurrence, not just the first: once the first is escaped, a repeat would be read back.
  const indexes = findCandidates(title, title.length, code)
    .filter((candidate) => {
      const key = candidate.key.toLowerCase();
      if (isFlintKey(key)) return isValidFlintValue(key, candidate.value);
      return !flintOnly && candidate.spaced;
    })
    .map((candidate) => candidate.start);
  return insertBackslashes(title, indexes);
}

/**
 * Escaping one opener can turn an outer bracket into a field (`[ a :: [priority:: high]`), so
 * repeat until nothing changes. Each pass escapes at least one more opener, so this ends.
 */
function escapeFieldOpenersFully(title: string, flintOnly: boolean): string {
  let current = title;
  for (;;) {
    const next = escapeFieldOpeners(current, flintOnly);
    if (next === current) return current;
    current = next;
  }
}

/**
 * Last resort: every bracket that has `::` after it, backticks that don't pair up, and a trailing
 * `^id` that would read as a block ID. Nothing in the title can then start a field or a code span.
 */
function escapeEverything(title: string): string {
  const code = codeSpanRanges(title);
  const indexes: number[] = [];
  for (let index = 0; index < title.length; index++) {
    const char = title[index];
    if (char === '\\') {
      index++;
      continue;
    }
    const span = rangeContaining(index, code);
    if (span) {
      index = span[1] - 1;
      continue;
    }
    if (char === '`') indexes.push(index);
    else if ((char === '[' || char === '(') && title.includes('::', index + 1)) indexes.push(index);
  }
  const block = BLOCK_ID.exec(title);
  if (block && !rangeContaining(block.index, code))
    indexes.push(block.index + (block[1] ?? '').length);
  return insertBackslashes(title, indexes);
}

/**
 * Writes task content canonically (D-21): title, then Flint's fields in the order `reminder`,
 * `today`, `completion`, `priority`, `id`, then unknown fields, then the block ID.
 *
 * The written line must read back as the same task. When the title contains text that would then be
 * read as a field (a repeated Flint field that was visible text, say), the least escaping that
 * makes it read back correctly is applied; unescaped text is preferred so Dataview keeps seeing
 * the fields it saw before.
 */
export function formatTaskContent(content: TaskContent): string {
  const flintEscaped = escapeFieldOpenersFully(content.title, true);
  const allEscaped = escapeFieldOpenersFully(content.title, false);
  for (const title of [content.title, flintEscaped, allEscaped]) {
    const text = compose(title, content);
    if (readsBackAs(text, title, content)) return text;
  }
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
