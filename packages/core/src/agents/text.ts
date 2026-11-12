import type { LineRange } from './protocol.js';

/**
 * AGENT-01 (D-185 Q10, large content): agents never get a whole long note by default. Without a
 * range a read returns at most `DEFAULT_LINES` lines or `DEFAULT_CHARS` characters, saying so.
 */
export const DEFAULT_LINES = 200;
export const DEFAULT_CHARS = 8000;
/** A snippet around a match. */
const SNIPPET_CHARS = 120;

export interface TextSlice {
  readonly text: string;
  /** 1-based, inclusive; 0 and 0 for an empty text. */
  readonly from: number;
  readonly to: number;
  readonly totalLines: number;
  readonly totalChars: number;
  readonly truncated: boolean;
  readonly hint?: string;
}

/** The lines of a text (a final newline doesn't make an empty last line). */
export function textLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * The lines asked for, or from the start up to the default cut. A range is still cut at
 * `DEFAULT_CHARS` × 4 characters, so one read can't return megabytes.
 */
export function sliceText(text: string, range?: LineRange, what = 'note'): TextSlice {
  const lines = textLines(text);
  const totalLines = lines.length;
  const totalChars = text.length;
  if (totalLines === 0)
    return { text: '', from: 0, to: 0, totalLines, totalChars, truncated: false };
  const from = Math.min(Math.max(1, Math.floor(range?.from ?? 1)), totalLines);
  const wanted = range ? Math.max(from, Math.floor(range.to)) : from + DEFAULT_LINES - 1;
  const last = Math.min(wanted, totalLines);
  const budget = range ? DEFAULT_CHARS * 4 : DEFAULT_CHARS;
  const taken: string[] = [];
  let chars = 0;
  for (let index = from - 1; index < last; index += 1) {
    const line = lines[index] ?? '';
    if (taken.length > 0 && chars + line.length + 1 > budget) break;
    taken.push(line.length > budget ? line.slice(0, budget) : line);
    chars += line.length + 1;
  }
  const to = from + taken.length - 1;
  const truncated = from > 1 || to < totalLines;
  return {
    text: taken.join('\n'),
    from,
    to,
    totalLines,
    totalChars,
    truncated,
    ...(to < totalLines && {
      hint: `Lines ${from}–${to} of ${totalLines}. Read on with lines {from: ${to + 1}, to: ${Math.min(totalLines, to + DEFAULT_LINES)}}, or ask for this ${what}'s outline.`,
    }),
  };
}

export interface OutlineEntry {
  readonly line: number;
  readonly level: number;
  readonly text: string;
}

/** A note's markdown headings (ATX, outside fenced code), with their line numbers. */
export function outline(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let fence: string | null = null;
  textLines(text).forEach((line, index) => {
    const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (opening?.[1]) {
      const marker = opening[1];
      if (fence === null) fence = marker[0]!.repeat(marker.length);
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;
    const heading = /^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (heading?.[1])
      entries.push({ line: index + 1, level: heading[1].length, text: heading[2] ?? '' });
  });
  return entries;
}

/** The first line containing every word of `query` (ignoring case), as a short snippet. */
export function findInText(
  text: string,
  query: string,
): { readonly line: number; readonly snippet: string } | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const lines = textLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lower = line.toLowerCase();
    if (!words.every((word) => lower.includes(word))) continue;
    const at = lower.indexOf(words[0] ?? '');
    const start = Math.max(0, at - SNIPPET_CHARS / 3);
    const piece = line.slice(start, start + SNIPPET_CHARS).trim();
    return {
      line: index + 1,
      snippet: `${start > 0 ? '…' : ''}${piece}${start + SNIPPET_CHARS < line.length ? '…' : ''}`,
    };
  }
  return null;
}

/** Replaces `find` (which must occur exactly once) in `text`; how many times it occurs otherwise. */
export function replaceOnce(
  text: string,
  find: string,
  replacement: string,
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly count: number } {
  if (find === '') return { ok: false, count: 0 };
  const first = text.indexOf(find);
  if (first < 0) return { ok: false, count: 0 };
  if (text.indexOf(find, first + 1) >= 0) {
    let count = 0;
    for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + 1)) count += 1;
    return { ok: false, count };
  }
  return { ok: true, text: text.slice(0, first) + replacement + text.slice(first + find.length) };
}

/** `text` with `addition` at its end, on a new line. */
export function appendText(text: string, addition: string): string {
  if (text === '' || text.endsWith('\n')) return text + addition;
  return `${text}\n${addition}`;
}
