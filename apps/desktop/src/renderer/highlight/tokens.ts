/**
 * The highlighter's matchers (D-38, D-65), in linear time and without the DOM. They replaced two
 * regexes that took time quadratic in a line's length (the CodeQL js/polynomial-redos shape, found
 * next to the alerts fixed in D-143): a long pasted stack-trace line or a long line in a task's
 * ```json block froze the capture popup or the main window for seconds. Each function returns
 * exactly what the regex named in its comment found; `tokens.test.ts` checks them against it.
 */

const SPACE = /\s/;

function isSpace(char: string): boolean {
  return char !== '' && SPACE.test(char);
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

/** `\w` without the `u` flag. */
function isWord(char: string): boolean {
  return (
    (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || isDigit(char) || char === '_'
  );
}

/** `[\\/\w.-]`: the characters of a file path. */
function isPathChar(char: string): boolean {
  return isWord(char) || char === '.' || char === '-' || char === '/' || char === '\\';
}

/** Where `.` (no `s` flag) stops: the line ends. */
function isLineEnd(char: string): boolean {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
}

/** The end of the digit run that starts at `at` (`at` itself when there is none). */
function digitsEnd(line: string, at: number): number {
  let end = at;
  while (isDigit(line.charAt(end))) end += 1;
  return end;
}

export interface Location {
  readonly index: number;
  readonly text: string;
}

/**
 * The file and line in a stack-trace frame, as
 * `/((?:[A-Za-z]:)?[\\/\w.-]+\.\w+(?::line)?[:\s]\d+(?::\d+)?)|(line \d+)/` finds it: the first
 * place where a path (with a drive, maybe) whose last part is `.<word>` is followed by `:line`
 * or not, a colon or space, and a line number with maybe a column; or `line <number>`.
 *
 * The regex retried the whole path from every character of it. Here a path is read once: the
 * regex can only end its `[\\/\w.-]+` at the path's last `.`, when only word characters follow it
 * to the path's end (the next character must be a colon or a space, which a path can't hold).
 */
export function traceLocation(line: string): Location | null {
  // `[:\s]\d+(?::\d+)?` at `at`: the end of the match, or -1.
  const numberAt = (at: number): number => {
    const char = line.charAt(at);
    if (char !== ':' && !isSpace(char)) return -1;
    let end = digitsEnd(line, at + 1);
    if (end === at + 1) return -1;
    if (line.charAt(end) === ':' && isDigit(line.charAt(end + 1))) end = digitsEnd(line, end + 1);
    return end;
  };
  // The path that starts at `from` (and runs to `end`): its last character that is no word
  // character, and where the match ends after it. Worked out once per path, not per character.
  let path = { from: -1, end: -1, lastNonWord: -1, matchEnd: -1 };
  const pathAt = (start: number): typeof path => {
    if (start >= path.from && start < path.end) return path;
    let end = start;
    let lastNonWord = -1;
    while (isPathChar(line.charAt(end))) {
      if (!isWord(line.charAt(end))) lastNonWord = end;
      end += 1;
    }
    let matchEnd = -1;
    if (line.startsWith(':line', end)) matchEnd = numberAt(end + 5);
    if (matchEnd === -1) matchEnd = numberAt(end);
    path = { from: start, end, lastNonWord, matchEnd };
    return path;
  };
  // `[\\/\w.-]+\.\w+(?::line)?[:\s]\d+(?::\d+)?` at `start`: the end of the match, or -1.
  const fileAt = (start: number): number => {
    if (!isPathChar(line.charAt(start))) return -1;
    const { end, lastNonWord, matchEnd } = pathAt(start);
    const dot = lastNonWord >= start ? lastNonWord : -1;
    if (dot < start + 1 || line.charAt(dot) !== '.' || dot > end - 2) return -1;
    return matchEnd;
  };
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (/[A-Za-z]/.test(char) && line.charAt(index + 1) === ':') {
      const end = fileAt(index + 2);
      if (end !== -1) return { index, text: line.slice(index, end) };
    }
    const end = fileAt(index);
    if (end !== -1) return { index, text: line.slice(index, end) };
    if (line.startsWith('line ', index)) {
      const digits = digitsEnd(line, index + 5);
      if (digits > index + 5) return { index, text: line.slice(index, digits) };
    }
  }
  return null;
}

/** One match of the JSON token regex, with its groups. */
export interface JsonToken {
  readonly index: number;
  readonly text: string;
  readonly string?: string;
  readonly colon?: string;
  readonly number?: string;
  readonly literal?: string;
}

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL = /true|false|null/y;

/**
 * The JSON tokens of a line, as
 * `/("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g` finds
 * them: strings (with the colon after a key), numbers and literals.
 *
 * The regex read an unclosed string to the end of the line again from every `"` inside it
 * (`"\"\"\"…`). A `"` inside a string that doesn't close is escaped, so the string read from it
 * fails at the same place: once one fails, every `"` before that place is skipped.
 */
export function jsonTokens(line: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let failsBefore = -1;
  let index = 0;
  while (index < line.length) {
    const char = line.charAt(index);
    if (char === '"') {
      if (index >= failsBefore) {
        let at = index + 1;
        let closed = false;
        while (at < line.length) {
          const next = line.charAt(at);
          if (next === '"') {
            closed = true;
            break;
          }
          if (next === '\\') {
            // `\\.`: a backslash escapes anything but a line end.
            if (at + 1 >= line.length || isLineEnd(line.charAt(at + 1))) break;
            at += 2;
          } else at += 1;
        }
        if (closed) {
          const string = line.slice(index, at + 1);
          let space = at + 1;
          while (isSpace(line.charAt(space))) space += 1;
          const colon = line.charAt(space) === ':' ? line.slice(at + 1, space + 1) : undefined;
          const text = string + (colon ?? '');
          tokens.push(
            colon === undefined ? { index, text, string } : { index, text, string, colon },
          );
          index += text.length;
          continue;
        }
        failsBefore = at;
      }
      index += 1;
      continue;
    }
    NUMBER.lastIndex = index;
    const number = NUMBER.exec(line)?.[0];
    if (number !== undefined) {
      tokens.push({ index, text: number, number });
      index += number.length;
      continue;
    }
    LITERAL.lastIndex = index;
    const literal = LITERAL.exec(line)?.[0];
    if (literal !== undefined) {
      tokens.push({ index, text: literal, literal });
      index += literal.length;
      continue;
    }
    index += 1;
  }
  return tokens;
}
