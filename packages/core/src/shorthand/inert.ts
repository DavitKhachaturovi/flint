/**
 * Shorthand only from what the user types (D-45, CAP-03): text that came from a selection or a
 * paste is placed in the task line as plain text, so a selected Teams message like
 * `deploy hotfix @15:00, see ##infra` never sets a reminder or a list. The popup tracks those
 * stretches of the task line as inert ranges; before parsing, every token marker in them gets the
 * shorthand escape (`\##`, `\!`, `\@`), which the parser turns back into the plain text.
 */

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Moves inert ranges along with an edit of the text (`before` → `after`). Text typed inside a range
 * stays inert (editing a selected message doesn't make it live); text at its edges or outside it is
 * live. With `live`, the inserted text is live even inside a range (Flint itself inserted it, e.g.
 * a token from the toolbar or the `##` menu), which splits the range.
 */
export function shiftRanges(
  ranges: readonly TextRange[],
  before: string,
  after: string,
  live = false,
): TextRange[] {
  if (before === after) return [...ranges];
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
  const removedEnd = before.length - suffix;
  const inserted = after.length - suffix - prefix;
  const delta = after.length - before.length;
  const result: TextRange[] = [];
  for (const range of ranges) {
    if (removedEnd <= range.start) {
      // The edit is entirely before the range (an insertion at its start is outside it).
      result.push({ start: range.start + delta, end: range.end + delta });
    } else if (prefix >= range.end) {
      // Entirely after it (an insertion at its end is outside it).
      result.push(range);
    } else if (live && inserted > 0) {
      // Flint's own insertion inside the range: the range is split around it.
      const left = { start: range.start, end: Math.max(range.start, prefix) };
      const right = {
        start: prefix + inserted,
        end: Math.max(prefix + inserted, range.end + delta),
      };
      for (const part of [left, right]) if (part.end > part.start) result.push(part);
    } else {
      // Typed or deleted inside it: it stays one range, grown or shrunk by the edit.
      const start = Math.min(range.start, prefix);
      const end = Math.max(start, range.end + delta);
      if (end > start) result.push({ start, end });
    }
  }
  return result;
}

const MARKER = /(?<=^|\s)(##|!|@)/g;

/**
 * The text with every token marker inside an inert range escaped, and a way to map a position in
 * the escaped text back to the original (for chips and the `##` menu, which work on what is shown).
 */
export function escapeInert(
  text: string,
  ranges: readonly TextRange[],
): { readonly text: string; readonly toOriginal: (index: number) => number } {
  const escapes: number[] = [];
  for (const match of text.matchAll(MARKER)) {
    const at = match.index;
    if (ranges.some((range) => at >= range.start && at < range.end)) escapes.push(at);
  }
  let escaped = '';
  let last = 0;
  for (const at of escapes) {
    escaped += `${text.slice(last, at)}\\`;
    last = at;
  }
  escaped += text.slice(last);
  // In the escaped text, the escape before the i-th marker sits at `at + i`.
  const inEscaped = escapes.map((at, index) => at + index);
  return {
    text: escaped,
    toOriginal: (index) => index - inEscaped.filter((position) => position < index).length,
  };
}
