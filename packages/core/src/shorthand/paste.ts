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
 * The capture popup's selection area (D-38): pasted or selected content, kept apart from the title
 * line so that only the title is read as shorthand. Code shows as a compact preview; text and notes
 * (Shift+Enter) can be edited.
 */
export type BlockKind = 'json' | 'stack-trace' | 'code' | 'text' | 'note';

export interface CaptureBlock {
  readonly kind: BlockKind;
  readonly text: string;
}

export function isCodeBlock(kind: BlockKind): boolean {
  return kind === 'json' || kind === 'stack-trace' || kind === 'code';
}

/** A pasted or selected piece of text as a block (CAP-06, CAP-07). */
export function blockFor(text: string): CaptureBlock {
  const kind = classifyPaste(text);
  return { kind, text: kind === 'text' ? text.trim() : text.replace(/^\s*\n|\s+$/g, '') };
}

/**
 * The title used when the title line is left empty: the first meaningful line of the first block
 * (an exception message, a JSON text field), shown as the title line's placeholder.
 */
export function fallbackTitle(blocks: readonly CaptureBlock[], maxLength = 80): string {
  const first = blocks.find((block) => block.text.trim() !== '');
  if (!first) return '';
  const title = titleFromPaste(first.text, maxLength);
  if (title !== '') return title;
  const line = first.text.trim().split(/\r\n|\r|\n/)[0] ?? '';
  return escapeShorthand(line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line);
}

/**
 * The capture text to save: the title (or the fallback title) on the first line, the blocks below
 * it as the body, code fenced. A single one-line text block that became the title isn't repeated.
 * `titleHasWords`: whether the title says anything besides shorthand; a title of only `!h ##infra`
 * gets the fallback title in front, so the tokens still apply.
 */
export function composeCapture(
  title: string,
  blocks: readonly CaptureBlock[],
  titleHasWords = title.trim() !== '',
): string {
  const usable = blocks.filter((block) => block.text.trim() !== '');
  let head = title.trim();
  let body = usable;
  if (!titleHasWords) {
    head = [fallbackTitle(usable), head].filter((part) => part !== '').join(' ');
    const only = usable[0];
    if (usable.length === 1 && only?.kind === 'text' && !/[\r\n]/.test(only.text.trim())) body = [];
  }
  const parts = body.map((block) =>
    isCodeBlock(block.kind)
      ? fencedBlock(block.text.trim(), block.kind === 'json' ? 'json' : '')
      : block.text.replace(/\s+$/, ''),
  );
  return [head, ...parts].join('\n');
}
