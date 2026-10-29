/** A half-open range `[start, end)` of character indexes. */
export type Range = readonly [start: number, end: number];

/**
 * Ranges covered by inline code spans, backticks included (CommonMark: a run of N backticks closes
 * at the next run of exactly N). Nothing inside them is a field (D-21) or a shorthand token (CAP-03).
 */
export function codeSpanRanges(text: string): Range[] {
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
    const openEnd = runEnd(text, index);
    const length = openEnd - index;
    let cursor = openEnd;
    let close = -1;
    while (cursor < text.length) {
      if (text[cursor] !== '`') {
        cursor++;
        continue;
      }
      const end = runEnd(text, cursor);
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

function runEnd(text: string, start: number): number {
  let end = start;
  while (text[end] === '`') end++;
  return end;
}

export function rangeContaining(index: number, ranges: readonly Range[]): Range | undefined {
  return ranges.find(([start, end]) => index >= start && index < end);
}
