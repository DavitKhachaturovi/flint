/**
 * Paste-to-capture (CAP-06, also used for capture-selection, CAP-07): a pasted stack trace, JSON or
 * other code goes into the task body as a fenced code block, so it is kept verbatim and never read
 * as shorthand (D-29: shorthand is read on the first line only). The title is what the user typed,
 * or else the first meaningful line of the paste (**Proposed**).
 */

export type PasteKind = 'json' | 'stack-trace' | 'code' | 'text';

const FRAME_LINES = [
  /^\s+at\s+\S.*(?:\(.*:\d+(?::\d+)?\)|:\d+(?::\d+)?|\)\s+in\s+.+:line\s+\d+)\s*$/, // JS, Java, .NET
  /^\s+at\s+[\w$.<>`]+\(.*\)\s*$/, // Java/.NET frames without a location
  /^\s*File\s+".+",\s+line\s+\d+/, // Python
];
const TRACEBACK = /^Traceback \(most recent call last\):\s*$/m;

function lines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export function classifyPaste(text: string): PasteKind {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value === 'object' && value !== null) return 'json';
    } catch {
      // Not JSON; maybe code.
    }
  }
  const all = lines(trimmed).filter((line) => line.trim() !== '');
  if (TRACEBACK.test(trimmed)) return 'stack-trace';
  const frames = all.filter((line) => FRAME_LINES.some((pattern) => pattern.test(line))).length;
  if (frames >= 2) return 'stack-trace';
  if (all.length >= 3) {
    const codeLike = all.filter(
      (line) => /^(\t| {2,})\S/.test(line) || /[;{}()]\s*$/.test(line) || /^\s*[}\])]/.test(line),
    ).length;
    if (codeLike / all.length >= 0.5) return 'code';
  }
  return 'text';
}

/** A fence longer than any backtick run in the text, so the block can't end early. */
export function fencedBlock(text: string, language = ''): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text.replace(/\s+$/, '')}\n${fence}`;
}

/** Shorthand-looking text from a paste stays text: `\##`, `\!`, `\@` (CAP-03 escapes). */
function escapeShorthand(text: string): string {
  return text.replace(/(^|\s)(##|!|@)/g, '$1\\$2');
}

/**
 * The first meaningful line of a paste, as a task title: the exception message of a stack trace
 * (the last line of a Python traceback), otherwise the first line with words in it.
 */
export function titleFromPaste(text: string, maxLength = 80): string {
  if (classifyPaste(text) === 'json') {
    // JSON: its first text field, e.g. `error: token expired`.
    const value: unknown = JSON.parse(text.trim());
    const field = Object.entries(value as object).find(
      ([, item]) => typeof item === 'string' && item.trim() !== '',
    );
    const title = field ? `${field[0]}: ${String(field[1])}` : 'JSON';
    return escapeShorthand(title.length > maxLength ? `${title.slice(0, maxLength - 1)}…` : title);
  }
  const candidates = lines(text)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !FRAME_LINES.some((pattern) => pattern.test(` ${line}`)));
  const pick = TRACEBACK.test(text)
    ? candidates.filter((line) => !/^Traceback /.test(line)).at(-1)
    : candidates.find((line) => /\p{L}{3}/u.test(line));
  const title = (pick ?? '').replace(/^[\s{}[\],"]+|[\s{}[\],"]+$/g, '');
  const short = title.length > maxLength ? `${title.slice(0, maxLength - 1).trimEnd()}…` : title;
  return escapeShorthand(short);
}

/**
 * What the capture box holds after a paste, or null when the paste should go in as typed text.
 * Code is appended to the body as a fenced block; the box's first line stays the title.
 */
export function capturePaste(current: string, pasted: string): string | null {
  const kind = classifyPaste(pasted);
  if (kind === 'text') return null;
  const lineBreak = /\r\n|\r|\n/.exec(current);
  const typedTitle = (lineBreak ? current.slice(0, lineBreak.index) : current).trim();
  const body = lineBreak ? current.slice(lineBreak.index + lineBreak[0].length) : '';
  const title = typedTitle !== '' ? typedTitle : titleFromPaste(pasted);
  const block = fencedBlock(pasted.trim(), kind === 'json' ? 'json' : '');
  return `${title}\n${body.trim() !== '' ? `${body.replace(/\s+$/, '')}\n` : ''}${block}`;
}
