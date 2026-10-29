/** A line ending as it appears in the file. The last line of a file may have none. */
export type LineEnding = '' | '\n' | '\r\n' | '\r';

/** One line of a file, with the line ending it had, so untouched lines are written back byte-for-byte. */
export interface Line {
  readonly text: string;
  readonly eol: LineEnding;
}

const LINE_BREAK = /\r\n|\n|\r/g;

/** Splits text into lines, keeping each line's own ending (files can mix CRLF and LF, docs/04 §6). */
export function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of text.matchAll(LINE_BREAK)) {
    lines.push({ text: text.slice(start, match.index), eol: match[0] as LineEnding });
    start = match.index + match[0].length;
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: '' });
  return lines;
}

export function joinLines(lines: readonly Line[]): string {
  let text = '';
  for (const line of lines) text += line.text + line.eol;
  return text;
}

/** The line ending new lines should use: the file's most common one, LF for new files. */
export function dominantEol(lines: readonly Line[]): '\n' | '\r\n' {
  let crlf = 0;
  let lf = 0;
  for (const line of lines) {
    if (line.eol === '\r\n') crlf++;
    else if (line.eol === '\n') lf++;
  }
  return crlf > lf ? '\r\n' : '\n';
}

export function isBlank(text: string): boolean {
  return /^[ \t]*$/.test(text);
}

/** Width of the leading whitespace in columns; a tab advances to the next multiple of 4 (CommonMark). */
export function indentWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === ' ') width++;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

export function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? '';
}

/**
 * Removes `columns` columns of leading whitespace. A tab that straddles the cut is replaced by the
 * spaces that remain of it, so relative indentation inside code blocks survives.
 */
export function stripColumns(text: string, columns: number): string {
  let width = 0;
  let index = 0;
  while (index < text.length && width < columns) {
    const char = text[index];
    if (char === ' ') width++;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
    index++;
  }
  const overshoot = Math.max(0, width - columns);
  return ' '.repeat(overshoot) + text.slice(index);
}
