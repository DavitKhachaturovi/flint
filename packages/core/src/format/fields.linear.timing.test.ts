import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatLocalDateTime,
  parseLocalDateTime,
  type ParsedLocalDateTime,
} from '../time/local-datetime.js';
import { codeSpanRanges, rangeContaining, type Range } from './code-spans.js';
import {
  escapeTitle,
  FLINT_KEYS,
  formatTaskContent,
  ID_PATTERN,
  isFlintKey,
  parseTaskContent,
  readPriority,
  type FieldValue,
  type FlintKey,
  type Priority,
  type RawField,
  type TaskContent,
} from './fields.js';

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);
// Deep runs (FLINT_FUZZ_RUNS=200000 was run once for D-146) take longer than the default timeout.
const TIMEOUT = Math.max(5_000, RUNS * 2);

const COMPLETED_AT = parseLocalDateTime('2026-03-10T10:00');
if (!COMPLETED_AT) throw new Error('the completion time must parse');
/** A completion Flint sets (written canonically), as completing a task does. */
const COMPLETION: FieldValue<ParsedLocalDateTime> = { value: COMPLETED_AT, raw: null };

/**
 * D-146: the task-line reader as it was before (1.1.1), quadratic on long field-like text. It is
 * the reference the linear reader must match exactly, and the writer with it, since the writer
 * reads its own output back and escapes what the reader would take as a field. Copied verbatim
 * apart from names; only safe on short lines.
 */
interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly key: string;
  readonly value: string;
  readonly spaced: boolean;
}

/**
 * D-146: `codeSpanRanges` as it was before, quadratic when openers don't close (each one read the
 * rest of the line for a run of its length). The reference reader uses it too, so the property
 * tests cover the code-span scan as well as the reader.
 */
function oldCodeSpanRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char !== '`') {
      index++;
      continue;
    }
    const openEnd = oldRunEnd(text, index);
    const length = openEnd - index;
    let cursor = openEnd;
    let close = -1;
    while (cursor < text.length) {
      if (text[cursor] !== '`') {
        cursor++;
        continue;
      }
      const end = oldRunEnd(text, cursor);
      if (end - cursor === length) {
        close = cursor;
        break;
      }
      cursor = end;
    }
    if (close === -1) {
      index = openEnd;
      continue;
    }
    ranges.push([index, close + length]);
    index = close + length;
  }
  return ranges;
}

function oldRunEnd(text: string, start: number): number {
  let end = start;
  while (text[end] === '`') end++;
  return end;
}

const BLOCK_ID = /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const ALIASES: Readonly<Record<string, FlintKey>> = { today: 'pinned' };

function flintKeyOf(key: string): FlintKey | null {
  return isFlintKey(key) ? key : (ALIASES[key] ?? null);
}

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
    const key = flintKeyOf(candidate.key.toLowerCase());
    if (key) {
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

function oldParseTaskContent(text: string): TaskContent {
  const code = oldCodeSpanRanges(text);
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

function readsBackAs(text: string, title: string, content: TaskContent): boolean {
  const reread = oldParseTaskContent(text);
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

function escapeFieldOpeners(title: string, flintOnly: boolean): string {
  const code = oldCodeSpanRanges(title);
  const indexes = findCandidates(title, title.length, code)
    .filter((candidate) => {
      const key = flintKeyOf(candidate.key.toLowerCase());
      if (key) return isValidFlintValue(key, candidate.value);
      return !flintOnly && candidate.spaced;
    })
    .map((candidate) => candidate.start);
  return insertBackslashes(title, indexes);
}

function escapeFieldOpenersFully(title: string, flintOnly: boolean): string {
  let current = title;
  for (;;) {
    const next = escapeFieldOpeners(current, flintOnly);
    if (next === current) return current;
    current = next;
  }
}

function escapeEverything(title: string): string {
  const code = oldCodeSpanRanges(title);
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

function oldFormatTaskContent(content: TaskContent): string {
  const flintEscaped = escapeFieldOpenersFully(content.title, true);
  const allEscaped = escapeFieldOpenersFully(content.title, false);
  for (const title of [content.title, flintEscaped, allEscaped]) {
    const text = compose(title, content);
    if (readsBackAs(text, title, content)) return text;
  }
  return compose(escapeEverything(allEscaped), content);
}

function oldEscapeTitle(title: string): string {
  return escapeFieldOpenersFully(title.replace(/\r\n|\r|\n/g, ' '), false);
}

/** The best of three runs, so a busy machine or a GC pause doesn't fail the test. */
function elapsed(run: () => void): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * D-146: the task-line reader runs in the main process for every task line read, and a line can
 * be long (a pasted log line or minified JSON). Each shape below took 0.3 to 4.4 s at 50,000
 * characters before (quadratic; the two with code spans in unclosed fields were cubic, about a
 * second already at 5,000); now each takes 1 to 3 ms. The limit leaves room for a machine many
 * times slower under the whole suite's load, while the old reader fails every one of them.
 */
describe('parseTaskContent: long field-like lines stay fast (D-146)', () => {
  const size = 50_000;
  const LIMIT_MS = 100;
  const repeat = (piece: string): string => piece.repeat(Math.ceil(size / piece.length));

  it.each([
    ['unclosed [a:: fields', repeat('[a::')],
    ['unclosed (a:: fields', repeat('(a:: ')],
    ['unclosed fields with a value', repeat('[a:: b ')],
    ['unclosed fields of both brackets', repeat('[a:: (b:: c ')],
    ['short inline code spans', repeat('`a` ')],
    ['code spans between unclosed fields', repeat('`a` [b:: c ')],
    ['code spans inside unclosed values', repeat('[a:: `]` ')],
    ['a code span in every key', repeat('[a `b`:: c ')],
    ['nested fields', repeat('[a:: [')],
    ['nested balanced brackets in unclosed fields', repeat('[a:: [b] ')],
    ['escaped closing brackets in values', repeat('[a:: \\] ')],
    ['even backslash runs in unclosed values', repeat('[a:: \\\\\\\\ ')],
    ['escaped and real unclosed fields', repeat('\\[a:: [b:: ')],
    ['triple colons', repeat('[a:::')],
    ['emoji keys and values', repeat('[😀:: 😀 ')],
    ['emoji between brackets', repeat('😀[a::😀(')],
    ['a lone surrogate before each field', repeat('\ud83d[a:: ')],
    ['unclosed fields after a long title', `${'a'.repeat(size / 2)} ${repeat('(k:: v ')}`],
    ['spaces inside the title', `a${' '.repeat(size)}b [priority:: high]`],
    ['an escaped backtick before each pair of backticks', repeat('\\``')],
    ['escaped backticks after code spans', repeat('``a`` \\``')],
  ])(
    '%s',
    (_, input) => {
      expect(input.length).toBeGreaterThanOrEqual(size);
      parseTaskContent(input.slice(0, 1000)); // Warms the JIT, so the time measured is the read.
      expect(elapsed(() => parseTaskContent(input))).toBeLessThan(LIMIT_MS);
    },
    10_000,
  );

  it('still reads the fields of a long line', () => {
    const noise = '[a:: (b:: `c` \\] '.repeat(size / 17);
    const content = parseTaskContent(`${noise}x [priority:: high] [due:: 2026-11-02] ^blk`);
    expect(content.fields.priority?.value).toBe('high');
    expect(content.unknown).toEqual([{ key: 'due', value: '2026-11-02' }]);
    expect(content.blockId).toBe('blk');
    expect(content.title).toBe(`${noise}x`);
    const fields = parseTaskContent(`${'[a::'.repeat(size / 4)} [id:: abcd]`);
    expect(fields.fields.id?.value).toBe('abcd');
    expect(fields.title).toBe('[a::'.repeat(size / 4));
  });
});

/**
 * D-146: the writer reads its own output back, and its last resort (escapeEverything) looked for
 * the code span around each character, searched for `::` after each bracket and inserted its
 * backslashes one copy of the title at a time. On these titles the old writer took 0.38 s, 1.7 s
 * and 5.8 s (at only 5,000 characters, the third); now each takes under 10 ms.
 */
describe('formatTaskContent: long titles that need escaping stay fast (D-146)', () => {
  const size = 50_000;
  const LIMIT_MS = 100;
  const repeat = (piece: string): string => piece.repeat(Math.ceil(size / piece.length));

  it.each([
    ['opening brackets, then one separator and a space', `${'('.repeat(size)}:: `],
    ['short inline code spans, a space at the end', repeat('`a` ')],
    ['code spans holding unclosed fields', repeat('`[a:: b ')],
  ])(
    '%s',
    (_, title) => {
      const content: TaskContent = { title, fields: {}, unknown: [], blockId: null };
      formatTaskContent({ ...content, title: title.slice(0, 1000) }); // Warms the JIT.
      expect(elapsed(() => formatTaskContent(content))).toBeLessThan(LIMIT_MS);
    },
    10_000,
  );
});

/** Backtick runs of rising length (1, 2, 3…), each followed by a space, `size` characters or more. */
function risingRuns(size: number, before = ''): string {
  let text = '';
  for (let length = 1; text.length < size; length++) text += `${before}${'`'.repeat(length)} `;
  return text;
}

/**
 * D-146 (review): `codeSpanRanges` skips an escaped backtick only while looking for an opening run,
 * so on `\``` repeated every opener is one backtick and every later run two: each opener read the
 * rest of the line (1.55 s at 50,000 characters). It runs for every task line read, in the
 * shorthand parse on every keystroke and in each pass of the writer's escaping. Runs of rising
 * length took about n^1.5 (15 ms at 50,000, 0.6 s at 200,000), so they are measured at 400,000.
 * Now each shape takes a few milliseconds.
 */
describe('codeSpanRanges: openers that never close stay fast (D-146)', () => {
  const size = 50_000;
  const LIMIT_MS = 100;
  const repeat = (piece: string): string => piece.repeat(Math.ceil(size / piece.length));

  it.each([
    ['an escaped backtick before each pair', repeat('\\``')],
    ['an escaped backtick before each pair, text between', repeat('\\`` a ')],
    ['an escaped backtick before each triple', repeat('\\```')],
    ['escaped backticks and emoji', repeat('\\``😀')],
    ['escaped backticks after code spans', repeat('``a`` \\``')],
    ['escaped backticks inside unclosed fields', repeat('[a:: \\`` ')],
    ['runs of rising length', risingRuns(8 * size)],
    ['escaped runs of rising length', risingRuns(8 * size, '\\')],
  ])(
    '%s',
    (_, input) => {
      expect(input.length).toBeGreaterThanOrEqual(size);
      codeSpanRanges(input.slice(0, 1000)); // Warms the JIT.
      expect(elapsed(() => codeSpanRanges(input))).toBeLessThan(LIMIT_MS);
    },
    10_000,
  );

  it('finds the same spans as the old scan on long lines', () => {
    for (const input of [repeat('`a` \\`` ``b`` '), risingRuns(5_000), risingRuns(5_000, '\\')]) {
      expect(codeSpanRanges(input)).toEqual(oldCodeSpanRanges(input));
    }
  });
});

/**
 * D-146 (review): a task read from a file goes through the writer whenever it is changed
 * (completed, pinned, given a reminder). The writer worked out both escaped forms of the title
 * before trying the title as it is, so a long field-like title that reads back unchanged still
 * paid for the repeated escaping: 2.1 s at 25,000 characters, 7.7 s at 50,000 for the nested shape
 * below. `escapeTitle` on escaped backticks took 3 s through the code-span scan.
 */
describe('the writer on long lines read from a file stays fast (D-146)', () => {
  const size = 50_000;
  const LIMIT_MS = 100;
  const repeat = (piece: string): string => piece.repeat(Math.ceil(size / piece.length));
  const nested = (count: number): string =>
    `${'[a:: (b:: [c:: '.repeat(count)}${']'.repeat(3 * count)}`;

  /** The line as Flint reads it from a file, then completed and pinned. */
  function changed(line: string): TaskContent {
    const content = parseTaskContent(line);
    return {
      ...content,
      fields: { ...content.fields, completion: COMPLETION, pinned: { value: true, raw: null } },
    };
  }

  it.each([
    ['nested field-like text that reads back as it is', nested(Math.ceil(size / 18))],
    ['an escaped backtick before each pair of backticks', repeat('\\``')],
    ['escaped backticks inside unclosed fields', repeat('[a:: \\`` ')],
  ])(
    '%s',
    (_, line) => {
      expect(line.length).toBeGreaterThanOrEqual(size);
      formatTaskContent(changed(line.slice(0, 1000))); // Warms the JIT.
      const content = changed(line);
      expect(elapsed(() => formatTaskContent(content))).toBeLessThan(LIMIT_MS);
      // The title is written as it was read: nothing in it is escaped.
      expect(formatTaskContent(content)).toBe(
        `${line.trimEnd()} [pinned:: true] [completion:: 2026-03-10T10:00]`,
      );
    },
    10_000,
  );

  it('escapeTitle on escaped backticks', () => {
    const title = repeat('\\``');
    escapeTitle(title.slice(0, 1000)); // Warms the JIT.
    expect(elapsed(() => escapeTitle(title))).toBeLessThan(LIMIT_MS);
    expect(escapeTitle(title)).toBe(title);
  }, 10_000);
});

describe('the linear task-line reader reads exactly as the old one (D-146)', () => {
  // Pieces that exercise the reader: brackets of both kinds, separators, escapes, backtick runs,
  // block IDs, Flint's keys and values, non-Latin text and surrogates (a lone one too).
  const piece = fc.oneof(
    {
      weight: 6,
      arbitrary: fc.constantFrom(
        '[',
        '[',
        ']',
        '(',
        ')',
        '::',
        ':',
        ':::',
        '\\',
        '\\\\',
        '`',
        '``',
        '```',
        ' ',
        ' ',
        '  ',
        '\t',
        '^',
        '^a1',
        ' ^blk',
        '-',
        'a',
        'key',
        'priority',
        'Priority',
        'id',
        'today',
        'pinned',
        'muted',
        'reminder',
        'completion',
        'due',
        'high',
        'urgent',
        'true',
        'abcd',
        '2026-11-02',
        '2026-11-02T10:00',
        '😀',
        'ქართ',
        '\ud83d',
        ' ',
      ),
    },
    {
      weight: 2,
      arbitrary: fc.constantFrom(
        '[priority:: high]',
        '(priority::low)',
        '[id:: abcd]',
        '[pinned:: true]',
        '[today:: true]',
        '[muted:: TRUE]',
        '[reminder:: 2026-10-30T15:00]',
        '[completion:: 2026-10-27]',
        '[due:: 2026-11-02]',
        '(due:: x)',
        '[note::x]',
        '[source:: [[Note]]]',
        '[cmd:: `npm test`]',
        '[a:: \\]]',
        '`[id:: abcd]`',
      ),
    },
    { weight: 1, arbitrary: fc.string({ maxLength: 4 }) },
  );
  const line = fc.array(piece, { maxLength: 24 }).map((pieces) => pieces.join(''));

  it(
    'parseTaskContent, formatTaskContent and escapeTitle match the reference on random lines',
    () => {
      fc.assert(
        fc.property(line, (text) => {
          const content = parseTaskContent(text);
          expect(content).toEqual(oldParseTaskContent(text));
          expect(formatTaskContent(content)).toBe(oldFormatTaskContent(content));
          expect(escapeTitle(text)).toBe(oldEscapeTitle(text));
          // The whole line as a title, with the fields read from it: field-like text, unpaired
          // backticks and spaces at its ends take the writer to its escaping, often to the last
          // resort (escapeEverything).
          const typed = { ...content, title: text };
          expect(formatTaskContent(typed)).toBe(oldFormatTaskContent(typed));
          // The task read from the line, then completed and pinned by Flint.
          const done: TaskContent = {
            ...content,
            fields: {
              ...content.fields,
              completion: COMPLETION,
              pinned: { value: true, raw: null },
            },
          };
          expect(formatTaskContent(done)).toBe(oldFormatTaskContent(done));
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'matches the reference on arbitrary strings',
    () => {
      fc.assert(
        fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
          expect(parseTaskContent(text)).toEqual(oldParseTaskContent(text));
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'codeSpanRanges finds the same spans as the old scan',
    () => {
      const backticky = fc
        .array(fc.constantFrom('`', '``', '```', '````', '\\', '\\`', 'a', ' ', '😀', '\ud83d'), {
          maxLength: 30,
        })
        .map((pieces) => pieces.join(''));
      fc.assert(
        fc.property(fc.oneof(backticky, fc.string({ unit: 'binary', maxLength: 40 })), (text) => {
          expect(codeSpanRanges(text)).toEqual(oldCodeSpanRanges(text));
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});

/** How many passes of the old escaping change the title before nothing does (D-153). */
function oldEscapePasses(title: string, flintOnly: boolean): number {
  let current = title;
  for (let passes = 0; ; passes++) {
    const next = escapeFieldOpeners(current, flintOnly);
    if (next === current) return passes;
    current = next;
  }
}

/** A title written alone on a task line reads back as exactly that title, with no fields. */
function readsBackAsTitle(title: string): boolean {
  const content = parseTaskContent(title);
  return (
    content.title === title.replace(/^[ \t]+|[ \t]+$/g, '') &&
    Object.keys(content.fields).length === 0 &&
    content.unknown.length === 0
  );
}

/** `escaped` is `title` with backslashes added before some `[` and `(`, and nothing else. */
function onlyOpenersEscaped(title: string, escaped: string): boolean {
  let at = 0;
  for (let index = 0; index < escaped.length; index++) {
    if (escaped[index] === title[at]) at++;
    else if (escaped[index] !== '\\' || !'[('.includes(escaped[index + 1] ?? '')) return false;
  }
  return at === title.length;
}

/**
 * D-153: on nested field-like text each pass of the escaping undid one layer, so `escapeTitle` took
 * 8 s at 50,000 characters (`[ a :: ` repeated before `[priority:: high]`), and the writer the
 * same on a title that needed it. After 16 passes that still change something, the title gets the
 * last resort (escapeEverything): each shape below now takes 30 to 70 ms (16 linear passes, the
 * writer two sets of them). The limit leaves about 20 times that for a slow runner under the
 * suite's load, while the old escaping (6 to 9 s on each) still fails every one.
 */
describe('nested field-like titles: the escaping stays fast (D-153)', () => {
  const size = 50_000;
  const LIMIT_MS = 1_000;
  const chain = (piece: string, last = '[priority:: high]'): string =>
    `${piece.repeat(Math.ceil(size / piece.length))}${last}`;

  it.each([
    ['[ a :: repeated before a Flint field', chain('[ a :: ')],
    ['( a :: repeated before a Flint field', chain('( a :: ', '(priority:: high)')],
    ['both brackets, nested', chain('[ a :: ( b :: ')],
    ['before an unknown field', chain('[ a :: ', '[due:: 2026-11-02]')],
  ])(
    '%s',
    (_, title) => {
      escapeTitle(title.slice(-1000)); // Warms the JIT.
      expect(elapsed(() => escapeTitle(title))).toBeLessThan(LIMIT_MS);
      const content: TaskContent = { title, fields: {}, unknown: [], blockId: null };
      expect(elapsed(() => formatTaskContent(content))).toBeLessThan(LIMIT_MS);
      // Still nothing in it reads as a field, and the writer's line reads back as the same task.
      expect(readsBackAsTitle(escapeTitle(title))).toBe(true);
      const line = formatTaskContent({ ...content, fields: { completion: COMPLETION } });
      const reread = parseTaskContent(line);
      expect(reread.fields.completion?.value).toEqual(COMPLETED_AT);
      expect(reread.unknown).toEqual([]);
      expect(Object.keys(reread.fields)).toEqual(['completion']);
    },
    10_000,
  );

  it('keeps the old output while 16 passes do (15 layers), and escapes more only beyond', () => {
    for (const layers of [1, 2, 3, 8, 15, 16]) {
      const title = `${'[ a :: '.repeat(layers)}[priority:: high]`;
      expect(oldEscapePasses(title, false)).toBe(layers + 1);
      if (layers + 1 <= 16) expect(escapeTitle(title)).toBe(oldEscapeTitle(title));
    }
    for (const layers of [16, 17, 40]) {
      const title = `${'[ a :: '.repeat(layers)}[priority:: high]`;
      const escaped = escapeTitle(title);
      expect(readsBackAsTitle(escaped)).toBe(true);
      // Every opener escaped (the last resort), and nothing else changed: \[ renders as [.
      expect(escaped.replaceAll('\\[', '[')).toBe(title);
      expect(onlyOpenersEscaped(title, escaped)).toBe(true);
    }
  });

  // Titles over 16 passes deep (a 17-layer chain first), then random pieces with backticks,
  // backslashes, Flint fields and a block ID: the fallback escapes only brackets.
  const deep = fc
    .array(
      fc.constantFrom(
        '[ a :: ',
        '( a :: ',
        '[priority:: high]',
        '[due:: x]',
        ']',
        ')',
        '`',
        '``',
        '`code`',
        '\\',
        ' ',
        'x',
        ' ^abc',
      ),
      { maxLength: 40 },
    )
    .map((pieces) => `${'[ a :: '.repeat(17)}${pieces.join('')}[priority:: high]`);

  it(
    'over 16 passes: only brackets are escaped, and the title reads back',
    () => {
      fc.assert(
        fc.property(deep, (title) => {
          const typed = escapeTitle(title);
          expect(onlyOpenersEscaped(title, typed)).toBe(true);
          expect(readsBackAsTitle(typed)).toBe(true);
          const done: TaskContent = {
            title,
            fields: { completion: COMPLETION },
            unknown: [],
            blockId: null,
          };
          const reread = parseTaskContent(formatTaskContent(done));
          expect(Object.keys(reread.fields)).toEqual(['completion']);
          expect(reread.unknown).toEqual([]);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  // Titles built from nested field-like pieces, often many passes deep.
  const nested = fc
    .array(
      fc.constantFrom(
        '[ a :: ',
        '( a :: ',
        '[ a :: ',
        '[b:: ',
        '[priority:: high]',
        '(priority::low)',
        '[id:: abcd]',
        '[due:: x]',
        ']',
        ')',
        ' ',
        '\\',
        '`',
        'x',
      ),
      { maxLength: 60 },
    )
    .map((pieces) => pieces.join(''));

  it(
    'matches the old escaping wherever it took 16 passes or fewer, and always reads back',
    () => {
      fc.assert(
        fc.property(nested, (title) => {
          const typed = escapeTitle(title);
          if (oldEscapePasses(title, false) <= 16) expect(typed).toBe(oldEscapeTitle(title));
          expect(readsBackAsTitle(typed)).toBe(true);
          const content: TaskContent = { title, fields: {}, unknown: [], blockId: null };
          const flintPasses = oldEscapePasses(title, true);
          const allPasses = oldEscapePasses(title, false);
          if (flintPasses <= 16 && allPasses <= 16)
            expect(formatTaskContent(content)).toBe(oldFormatTaskContent(content));
          const done = { ...content, fields: { completion: COMPLETION } };
          const reread = parseTaskContent(formatTaskContent(done));
          expect(Object.keys(reread.fields)).toEqual(['completion']);
          expect(reread.unknown).toEqual([]);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});
