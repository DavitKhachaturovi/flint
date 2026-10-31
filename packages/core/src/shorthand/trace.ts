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

/** A frame line (JS, Java, .NET, Python, Go). */
export const FRAME_LINE = [
  /^\s*at\s+\S.*(?:\(.*:\d+(?::\d+)?\)|:\d+(?::\d+)?|\)\s+in\s+.+:line\s+\d+)\s*$/, // JS, Java, .NET
  /^\s*at\s+[\w$.<>`]+\(.*\)\s*$/, // Java/.NET frames without a location
  /^\s*File\s+".+",\s+line\s+\d+/, // Python
  /^\s*\S+\.go:\d+(?:\s+\+0x[0-9a-f]+)?\s*$/, // Go: the file line under each function
];

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
    else if (/^\S.*\(.*\)$/.test(line) && /\.go:\d+/.test(lines[index + 1] ?? '')) kind = 'frame';
    else kind = 'plain';
    underPythonFrame = /^\s*File\s+".+",\s+line\s+\d+/.test(line);
    kinds.push(kind);
  });
  return kinds;
}
