import { codeSpanRanges } from '../format/code-spans.js';
import { readPriority, type Priority } from '../format/fields.js';
import type { LocalDateTime } from '../time/local-datetime.js';
import { describeTime, matchTime } from '../time/parse.js';
import { listResolver, normalizeListName, type ListInfo, type ListResolution } from './lists.js';

/**
 * Capture shorthand (CAP-03): `!h` priority, `##list` list (D-25), `@<time>` reminder (REM-02).
 * The same parser serves the capture popup, the in-list composer and the CLI (docs/05 §2).
 */
export interface ShorthandContext {
  readonly now: Date;
  /** Lists in sidebar order. */
  readonly lists: readonly ListInfo[];
  /** Hour used when a reminder names only a day (Q-02: 9). */
  readonly defaultHour?: number;
  /** The user pressed Tab on the close-match card: create the typed list instead (D-25). */
  readonly chooseNewList?: boolean;
}

export type TokenKind = 'priority' | 'list' | 'reminder';

export interface Token {
  readonly kind: TokenKind;
  /** Position in the first line of the input, `@`/`!`/`##` included. */
  readonly start: number;
  readonly end: number;
  /**
   * `winner`: the last valid token of its kind, stripped from the title. `extra`: an earlier valid
   * one, kept as text (D-25). `ignored`: a `##` token that can't be used (a note, or a name Windows
   * rejects), kept as text.
   */
  readonly role: 'winner' | 'extra' | 'ignored';
}

/** Where the capture goes. `inbox` when there's no usable `##` token. */
export type CaptureTarget = { readonly kind: 'inbox' } | ListResolution;

export interface CaptureParse {
  /** The title with the winning tokens removed and token escapes resolved. Markdown, unescaped. */
  readonly title: string;
  /** Everything after the first line, verbatim (pasted code, Shift+Enter lines). */
  readonly body: string;
  readonly priority: Priority | null;
  readonly reminder: LocalDateTime | null;
  /** Chip label for the reminder: `Today 15:00` (CAP-04). */
  readonly reminderLabel: string | null;
  readonly target: CaptureTarget;
  /** How many valid tokens of each kind there were (`2 lists → Unicorn`). */
  readonly counts: Readonly<Record<TokenKind, number>>;
  /** `##` tokens that stayed as text: notes and names Windows can't use (chip notes). */
  readonly ignoredLists: readonly ListResolution[];
  readonly tokens: readonly Token[];
}

const PRIORITY_TOKEN = /^!(h|high|m|med|medium|l|low)(?=\s|$)/i;
const LIST_NAME = /^[\p{L}\p{N}_.-]+/u;

/** The most words a list name after `##` is looked for in (D-87). */
const MAX_NAME_WORDS = 8;

/** The normalized names of the lists (and notes) whose names have several words (D-87). */
function multiWordNames(lists: readonly ListInfo[]): ReadonlySet<string> {
  return new Set(
    lists.filter((list) => /\s/.test(list.name.trim())).map((list) => normalizeListName(list.name)),
  );
}

/**
 * D-87: the longest run of two or more words after `##` that spells an existing list's (or note's)
 * name exactly, ignoring case, spaces and hyphens (D-25), ending at a word boundary; its length in
 * `text`, or 0. `##new list 2` finds "new list 2" even when "new list 1" exists too.
 */
function multiWordName(text: string, names: ReadonlySet<string>): number {
  if (names.size === 0) return 0;
  // The first words, separated by spaces or tabs (not line breaks).
  const words = /^\S+(?:[ \t]+\S+){0,7}/.exec(text)?.[0] ?? '';
  // Word by word, each normalized once: the same as normalizing each run of words, because the
  // spaces and tabs between them are removed, never compose with a neighbour (NFC) and end a word
  // for lowercasing (the final sigma). A pasted line can hold thousands of `##` (D-143).
  let joined = '';
  let count = 0;
  let longest = 0;
  for (const match of words.matchAll(/\S+/g)) {
    joined += normalizeListName(match[0]);
    count += 1;
    if (count > MAX_NAME_WORDS) break;
    if (count >= 2 && names.has(joined)) longest = match.index + match[0].length;
  }
  return longest;
}

interface Found {
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
  readonly priority?: Priority;
  readonly reminder?: LocalDateTime;
  readonly list?: ListResolution;
}

function priorityOf(word: string): Priority | null {
  const short: Record<string, string> = { h: 'high', m: 'medium', med: 'medium', l: 'low' };
  return readPriority(short[word] ?? word);
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/**
 * `name` without its trailing dots (`##infra.` ends a sentence), in one pass from the end. Not
 * `/\.+$/`: that regex restarts at every dot, so a long run of dots not at the end of the name
 * (`##.....x`) took quadratic time on every keystroke (CodeQL js/polynomial-redos).
 */
function withoutTrailingDots(name: string): string {
  let end = name.length;
  while (end > 0 && name[end - 1] === '.') end--;
  return name.slice(0, end);
}

/**
 * Recognises shorthand tokens at word boundaries, outside inline code (CAP-03). Linear in the
 * line's length: it runs on every keystroke and a pasted line can be long (docs/05 §4).
 */
function scan(line: string, context: ShorthandContext): { found: Found[]; escapes: number[] } {
  const code = codeSpanRanges(line);
  const found: Found[] = [];
  const escapes: number[] = [];
  // Worked out once per line, not once per `##` token: a pasted line can repeat a token many times.
  const longNames = multiWordNames(context.lists);
  // The lists' normalized names are worked out on the first `##`, then each name once.
  let resolver: ((name: string) => ListResolution) | undefined;
  const resolved = new Map<string, ListResolution>();
  const resolve = (name: string): ListResolution => {
    let list = resolved.get(name);
    if (!list) {
      resolver ??= listResolver(context.lists);
      list = resolver(name);
      resolved.set(name, list);
    }
    return list;
  };
  // The code spans are sorted and don't overlap, and `index` only grows: `next` is the first span
  // that doesn't end at or before `index`, so each span is passed once.
  let next = 0;
  let index = 0;
  while (index < line.length) {
    let span = code[next];
    while (span && span[1] <= index) span = code[++next];
    if (span && span[0] <= index) {
      index = span[1];
      continue;
    }
    const atBoundary = index === 0 || isSpace(line[index - 1]);
    const char = line[index];
    if (!atBoundary || (char !== '\\' && char !== '!' && char !== '#' && char !== '@')) {
      index++;
      continue;
    }
    if (char === '\\') {
      const next = line[index + 1];
      if (next === '!' || next === '@' || line.startsWith('##', index + 1)) {
        // `\##infra` is stored as `##infra` and not read as a token.
        escapes.push(index);
        index += 2;
        while (index < line.length && !isSpace(line[index])) index++;
        continue;
      }
      index++;
      continue;
    }
    if (char === '!') {
      const match = PRIORITY_TOKEN.exec(line.slice(index));
      const priority = match ? priorityOf((match[1] ?? '').toLowerCase()) : null;
      if (match && priority) {
        found.push({ kind: 'priority', start: index, end: index + match[0].length, priority });
        index += match[0].length;
        continue;
      }
    } else if (char === '#' && line.startsWith('##', index)) {
      // D-87: an existing list's name of several words first, then the one-word rules (D-25).
      const long = multiWordName(line.slice(index + 2), longNames);
      if (long > 0) {
        const end = index + 2 + long;
        const name = line.slice(index + 2, end);
        found.push({ kind: 'list', start: index, end, list: resolve(name) });
        index = end;
        continue;
      }
      const match = LIST_NAME.exec(line.slice(index + 2));
      const name = withoutTrailingDots(match?.[0] ?? '');
      if (name !== '') {
        const end = index + 2 + name.length;
        found.push({ kind: 'list', start: index, end, list: resolve(name) });
        index = end;
        continue;
      }
    } else if (char === '@') {
      const options =
        context.defaultHour === undefined
          ? { now: context.now }
          : { now: context.now, defaultHour: context.defaultHour };
      const match = matchTime(line.slice(index + 1), options);
      if (match) {
        found.push({
          kind: 'reminder',
          start: index,
          end: index + 1 + match.length,
          reminder: match.at,
        });
        index += 1 + match.length;
        continue;
      }
    }
    index++;
  }
  return { found, escapes };
}

/** Removes the winning tokens, each with one neighbouring run of spaces, and resolves escapes. */
function buildTitle(line: string, winners: readonly Found[], escapes: readonly number[]): string {
  const ranges: [number, number][] = winners.map(({ start, end }) => {
    let from = start;
    let to = end;
    if (from > 0 && isSpace(line[from - 1])) {
      while (from > 0 && isSpace(line[from - 1])) from--;
    } else {
      while (to < line.length && isSpace(line[to])) to++;
    }
    return [from, to];
  });
  for (const index of escapes) ranges.push([index, index + 1]);
  ranges.sort((a, b) => a[0] - b[0]);
  let title = '';
  let position = 0;
  for (const [from, to] of ranges) {
    if (from > position) title += line.slice(position, from);
    position = Math.max(position, to);
  }
  title += line.slice(position);
  return title.trim();
}

/**
 * Parses what was typed in the capture box (CAP-03, CAP-04, CAP-05, D-25). Shorthand is read on
 * the first line only (**Proposed**): further lines are the body, kept verbatim, so pasted code is
 * never changed. A token is stripped only if it resolves to something valid; with several valid
 * tokens of one kind the last wins and the others stay as text.
 */
export function parseCapture(input: string, context: ShorthandContext): CaptureParse {
  const lineBreak = /\r\n|\r|\n/.exec(input);
  const line = lineBreak ? input.slice(0, lineBreak.index) : input;
  const body = lineBreak ? input.slice(lineBreak.index + lineBreak[0].length) : '';

  const { found, escapes } = scan(line, context);
  const usable = (token: Found): boolean =>
    token.kind !== 'list' || (token.list?.kind !== 'note' && token.list?.kind !== 'invalid-name');

  const winners: Found[] = [];
  const tokens: Token[] = [];
  const counts: Record<TokenKind, number> = { priority: 0, list: 0, reminder: 0 };
  for (const kind of ['priority', 'list', 'reminder'] as const) {
    const valid = found.filter((token) => token.kind === kind && usable(token));
    counts[kind] = valid.length;
    const winner = valid.at(-1);
    if (winner) winners.push(winner);
  }
  for (const token of found) {
    const role = winners.includes(token) ? 'winner' : usable(token) ? 'extra' : 'ignored';
    tokens.push({ kind: token.kind, start: token.start, end: token.end, role });
  }

  const priority = winners.find((token) => token.kind === 'priority')?.priority ?? null;
  const reminder = winners.find((token) => token.kind === 'reminder')?.reminder ?? null;
  let target: CaptureTarget = winners.find((token) => token.kind === 'list')?.list ?? {
    kind: 'inbox',
  };
  if (target.kind === 'close-match' && context.chooseNewList)
    target = { kind: 'new', name: target.name };

  return {
    title: buildTitle(line, winners, escapes),
    body,
    priority,
    reminder,
    reminderLabel: reminder ? describeTime(reminder, context.now) : null,
    target,
    counts,
    ignoredLists: found
      .filter((token) => !usable(token))
      .map((token) => token.list)
      .filter((list): list is ListResolution => list !== undefined),
    tokens: tokens.sort((a, b) => a.start - b.start),
  };
}

/** The `##` token the caret is in, for autocomplete (CAP-05): its range and the text typed so far. */
export function listTokenAt(
  text: string,
  caret: number,
): { readonly start: number; readonly end: number; readonly typed: string } | null {
  let start = caret;
  while (start > 0 && !isSpace(text[start - 1])) start--;
  if (!text.startsWith('##', start)) return null;
  const match = LIST_NAME.exec(text.slice(start + 2));
  const end = start + 2 + (match?.[0].length ?? 0);
  if (caret > end) return null;
  return { start, end, typed: text.slice(start + 2, caret) };
}
