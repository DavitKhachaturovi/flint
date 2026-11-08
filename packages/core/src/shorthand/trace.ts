/**
 * The lines of a stack trace, for the grayscale highlighter (UI-06, D-63, D-65): the exception
 * bright, frames dimmed, `file:line` underlined. Covers .NET, Java, JavaScript/Node, Python and Go,
 * with or without the frames' indentation (log viewers often strip it).
 */

export type TraceLineKind =
  /** The exception or error message (also Java's `Caused by:`, Python's last line, Go's `panic:`). */
  | 'exception'
  /** A frame, or the source line Python prints under one: dimmed. */
  | 'frame'
  /** `Traceback (most recent call last):`, `goroutine 1 [running]:`, `... 5 more`: dimmed. */
  | 'header'
  | 'plain';

/** Something that recognises a line: a regular expression, or a function where a regex is too slow. */
export interface LinePattern {
  test(line: string): boolean;
}

/** What `.` in a regular expression doesn't match. */
const LINE_BREAK = /[\n\r\u2028\u2029]/;
/** One character of `\s`. */
const SPACE = /\s/;

/** Where the run of digits that ends at `end` starts (`end` itself when there is none). */
function digitsBefore(text: string, end: number): number {
  let start = end;
  while (start > 0 && text.charCodeAt(start - 1) >= 48 && text.charCodeAt(start - 1) <= 57) start--;
  return start;
}

/** Where the run of whitespace that ends at `end` starts. */
function spaceBefore(text: string, end: number): number {
  let start = end;
  while (start > 0 && SPACE.test(text.charAt(start - 1))) start--;
  return start;
}

/** Where the run of whitespace that starts at `start` ends. */
function spaceAfter(text: string, start: number): number {
  let end = start;
  while (end < text.length && SPACE.test(text.charAt(end))) end++;
  return end;
}

/** `…:N`, `…:N:N`, `…(…:N)` or `…(…:N:N)` (JS, Java), on the text after `at x`, trimmed. */
function endsWithLineNumber(body: string): boolean {
  if (LINE_BREAK.test(body)) return false;
  const closed = body.endsWith(')');
  const end = closed ? body.length - 1 : body.length;
  const digits = digitsBefore(body, end);
  const colon = digits - 1;
  if (digits === end || colon < 0 || body[colon] !== ':') return false;
  if (!closed) return true;
  const open = body.indexOf('(');
  return open !== -1 && open < colon;
}

/** `…) in File.cs:line N` (.NET), on the text after `at x`, trimmed. */
function endsWithDotNetLine(body: string): boolean {
  const digits = digitsBefore(body, body.length);
  if (digits === body.length) return false;
  const space = spaceBefore(body, digits);
  const label = space - ':line'.length;
  if (space === digits || label < 0 || !body.startsWith(':line', label)) return false;
  // `<before>)<space>in<space><file>`, where neither <before> nor <file> may cross a line break (a
  // break can only sit in the spaces). Each `)` owns the spaces after it, so this loop is linear.
  const head = body.slice(0, label);
  const firstBreak = head.search(LINE_BREAK);
  let lastBreak = head.length - 1;
  while (lastBreak > firstBreak && !LINE_BREAK.test(head.charAt(lastBreak))) lastBreak--;
  for (let close = head.indexOf(')'); close !== -1; close = head.indexOf(')', close + 1)) {
    if (firstBreak !== -1 && close > firstBreak) return false;
    const word = spaceAfter(head, close + 1);
    if (word === close + 1 || !head.startsWith('in', word)) continue;
    const file = Math.max(word + 3, lastBreak + 1);
    if (file <= spaceAfter(head, word + 2) && file < head.length) return true;
  }
  return false;
}

const AT = /^\s*at\s+\S/;

/**
 * A JS, Java or .NET frame with its location: the same lines as
 * `/^\s*at\s+\S.*(?:\(.*:\d+(?::\d+)?\)|:\d+(?::\d+)?|\)\s+in\s+.+:line\s+\d+)\s*$/`, which took
 * time quadratic in the line's length on a long paste (CodeQL js/polynomial-redos). This reads the
 * line's end once instead.
 */
function locatedFrame(line: string): boolean {
  const head = AT.exec(line);
  if (!head) return false;
  // Each ending above ends in a digit or `)`, so the trailing `\s*` is exactly the trimmed end.
  const body = line.slice(head[0].length).trimEnd();
  return endsWithLineNumber(body) || endsWithDotNetLine(body);
}

/** A frame line (JS, Java, .NET, Python, Go). */
export const FRAME_LINE: readonly LinePattern[] = [
  { test: locatedFrame }, // JS, Java, .NET
  /^\s*at\s+[\w$.<>`]+\(.*\)\s*$/, // Java/.NET frames without a location
  /^\s*File\s+".+",\s+line\s+\d+/, // Python
  /^\s*\S+\.go:\d+(?:\s+\+0x[0-9a-f]+)?\s*$/, // Go: the file line under each function
];

/**
 * Go's function line above its file line, `main.resolve(0x0)`: the same lines as `/^\S.*\(.*\)$/`,
 * but the first run can't take a `(`, so a line of many `(` no longer takes quadratic time.
 */
const GO_FUNCTION = /^\S[^(\n\r\u2028\u2029]*\(.*\)$/;

/** The first line of a trace that has a header instead of the exception (Python, Go). */
export const TRACE_HEADER =
  /^(?:Traceback \(most recent call last\):|goroutine \d+ \[[^\]]+\]:)\s*$/;

const HEADER = [
  TRACE_HEADER,
  /^\s*\.\.\. \d+ more\s*$/, // Java
  /^\s*--- End of (?:inner exception )?stack trace(?: from previous location)? ---\s*$/, // .NET
  /^\s*During handling of the above exception, another exception occurred:\s*$/, // Python
  /^\s*The above exception was the direct cause of the following exception:\s*$/, // Python
];

const EXCEPTION =
  /^\s*(?:Caused by:\s*|Unhandled exception\.\s*)?(?:[\w$]+\.)*[\w$]*(?:Error|Exception|Throwable|Fault|Interrupt|Exit)\b|^\s*panic:/;

/** What each line of a stack trace is. */
export function traceLineKinds(lines: readonly string[]): TraceLineKind[] {
  const kinds: TraceLineKind[] = [];
  let underPythonFrame = false;
  lines.forEach((line, index) => {
    let kind: TraceLineKind;
    if (HEADER.some((pattern) => pattern.test(line))) kind = 'header';
    else if (FRAME_LINE.some((pattern) => pattern.test(line))) kind = 'frame';
    // Python prints the source line, indented, under each `File "…", line N` frame.
    else if (underPythonFrame && /^\s+\S/.test(line)) kind = 'frame';
    else if (EXCEPTION.test(line)) kind = 'exception';
    // A trace that starts with neither a header nor a frame starts with its message.
    else if (index === 0) kind = 'exception';
    // After the frames, an unindented `Name: message` line is the exception (Python's last line).
    else if (kinds.at(-1) === 'frame' && /^[A-Za-z_][\w.]*: /.test(line)) kind = 'exception';
    // Go: the function line above each file line.
    else if (GO_FUNCTION.test(line) && /\.go:\d+/.test(lines[index + 1] ?? '')) kind = 'frame';
    else kind = 'plain';
    underPythonFrame = /^\s*File\s+".+",\s+line\s+\d+/.test(line);
    kinds.push(kind);
  });
  return kinds;
}
