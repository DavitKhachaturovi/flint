/**
 * Auto-closing brackets and quotes with overtype (UI-09, D-57), like Obsidian: typing `(` gives
 * `()` with the cursor inside; typing `)` right before a `)` Flint inserted steps over it. Same for
 * `[]`, `{}`, `""`, `''` and backticks. Pure: the DOM glue is renderer/auto-pair.ts.
 *
 * - Quotes pair only when not directly after a letter or digit, so "don't" works.
 * - **Proposed:** nothing pairs directly before a letter or digit (typing `(` in front of a word
 *   doesn't add a stray `)`); with text selected, an opening character wraps it; Backspace right
 *   after an opener whose closer Flint inserted removes both.
 */

export interface PairState {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  /** Positions of closers Flint inserted (only these are stepped over or removed with Backspace). */
  readonly auto: readonly number[];
}

const PAIRS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
};
const CLOSERS = new Set(Object.values(PAIRS));
const WORD = /[\p{L}\p{N}_]/u;

/** What typing `key` does, or null to let the field handle it as usual. */
export function typePair(state: PairState, key: string): PairState | null {
  const { value, start, end, auto } = state;
  const next = value[end];
  // Overtype: the closer Flint inserted right after the cursor.
  if (CLOSERS.has(key) && start === end && next === key && auto.includes(start))
    return { value, start: start + 1, end: start + 1, auto: auto.filter((at) => at !== start) };

  const close = PAIRS[key];
  if (close === undefined) return null;
  if (start !== end) {
    // Wrap the selection, keeping it selected inside the pair.
    const wrapped = `${value.slice(0, start)}${key}${value.slice(start, end)}${close}${value.slice(end)}`;
    return { value: wrapped, start: start + 1, end: end + 1, auto: shift(auto, start, 0, 2) };
  }
  const quote = key === close;
  if (quote && start > 0 && WORD.test(value[start - 1] ?? '')) return null;
  if (next !== undefined && WORD.test(next)) return null;
  const paired = `${value.slice(0, start)}${key}${close}${value.slice(end)}`;
  return {
    value: paired,
    start: start + 1,
    end: start + 1,
    auto: [...shift(auto, start, 0, 2), start + 1],
  };
}

/** Backspace between an opener and the closer Flint inserted for it removes both. */
export function backspacePair(state: PairState): PairState | null {
  const { value, start, end, auto } = state;
  if (start !== end || start === 0) return null;
  const open = value[start - 1] ?? '';
  if (PAIRS[open] === undefined || value[start] !== PAIRS[open] || !auto.includes(start))
    return null;
  return {
    value: value.slice(0, start - 1) + value.slice(start + 1),
    start: start - 1,
    end: start - 1,
    auto: shift(
      auto.filter((at) => at !== start),
      start - 1,
      2,
      0,
    ),
  };
}

/** Moves the remembered closer positions along with an edit somewhere else in the text. */
export function followEdit(auto: readonly number[], before: string, after: string): number[] {
  if (before === after || auto.length === 0) return [...auto];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return shift(auto, prefix, before.length - suffix - prefix, after.length - suffix - prefix);
}

/** Positions after an edit at `at` that removed `removed` characters and inserted `inserted`. */
function shift(auto: readonly number[], at: number, removed: number, inserted: number): number[] {
  return auto
    .filter((position) => position < at || position >= at + removed)
    .map((position) => (position >= at + removed ? position - removed + inserted : position));
}
