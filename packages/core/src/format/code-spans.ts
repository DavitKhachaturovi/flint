/** A half-open range `[start, end)` of character indexes. */
export type Range = readonly [start: number, end: number];

/**
 * Ranges covered by inline code spans, backticks included (CommonMark: a run of N backticks closes
 * at the next run of exactly N). Nothing inside them is a field (D-21) or a shorthand token (CAP-03).
 *
 * Linear in the text's length (D-146): an opener that never closes used to read the rest of the
 * text for a run of its length, so `\``` repeated (every opener one backtick, every later run two)
 * took time quadratic in the length. The runs are now listed once by length, and each length keeps
 * where its next run is as the scan moves forward; the spans found are the same.
 */
export function codeSpanRanges(text: string): Range[] {
  const ranges: Range[] = [];
  if (!text.includes('`')) return ranges;
  let runs: RunsByLength | undefined;
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
    const openEnd = runEnd(text, index);
    const length = openEnd - index;
    runs ??= runsByLength(text);
    // The closing run is a whole run of exactly `length` backticks starting after the opener; a
    // backslash doesn't escape a backtick there (the closing search never skipped one).
    const close = runs.get(length)?.nextFrom(openEnd) ?? -1;
    if (close === -1) {
      index = openEnd;
      continue;
    }
    ranges.push([index, close + length]);
    index = close + length;
  }
  return ranges;
}

/** The starts of the text's whole backtick runs of one length, in order, with a forward cursor. */
class RunStarts {
  readonly starts: number[] = [];
  private next = 0;

  /** The first start at or after `position`; `position` never decreases between calls. */
  nextFrom(position: number): number {
    while (this.next < this.starts.length && (this.starts[this.next] ?? 0) < position) this.next++;
    return this.starts[this.next] ?? -1;
  }
}

type RunsByLength = Map<number, RunStarts>;

function runsByLength(text: string): RunsByLength {
  const runs: RunsByLength = new Map();
  let index = text.indexOf('`');
  while (index !== -1) {
    const end = runEnd(text, index);
    let starts = runs.get(end - index);
    if (!starts) {
      starts = new RunStarts();
      runs.set(end - index, starts);
    }
    starts.starts.push(index);
    index = text.indexOf('`', end);
  }
  return runs;
}

function runEnd(text: string, start: number): number {
  let end = start;
  while (text[end] === '`') end++;
  return end;
}

export function rangeContaining(index: number, ranges: readonly Range[]): Range | undefined {
  return ranges.find(([start, end]) => index >= start && index < end);
}
