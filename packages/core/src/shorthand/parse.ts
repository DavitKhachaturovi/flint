import { codeSpanRanges, rangeContaining } from '../format/code-spans.js';
import { readPriority, type Priority } from '../format/fields.js';
import type { LocalDateTime } from '../time/local-datetime.js';
import { describeTime, matchTime } from '../time/parse.js';
import { resolveList, type ListInfo, type ListResolution } from './lists.js';

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

/** Recognises shorthand tokens at word boundaries, outside inline code (CAP-03). */
function scan(line: string, context: ShorthandContext): { found: Found[]; escapes: number[] } {
  const code = codeSpanRanges(line);
  const found: Found[] = [];
  const escapes: number[] = [];
  let index = 0;
  while (index < line.length) {
    const span = rangeContaining(index, code);
    if (span) {
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
      const match = LIST_NAME.exec(line.slice(index + 2));
      const name = (match?.[0] ?? '').replace(/\.+$/, '');
      if (name !== '') {
        const end = index + 2 + name.length;
        found.push({ kind: 'list', start: index, end, list: resolveList(name, context.lists) });
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
