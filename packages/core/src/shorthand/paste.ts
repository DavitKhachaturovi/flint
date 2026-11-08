/**
 * Paste-to-capture (CAP-06, also used for capture-selection, CAP-07): a pasted stack trace, JSON or
 * other code goes into the task body as a fenced code block, so it is kept verbatim and never read
 * as shorthand (D-29: shorthand is read on the first line only). The title is what the user typed,
 * or else the first meaningful line of the paste (**Proposed**).
 */

import {
  firstFence,
  hasImageLink,
  isBareUrl,
  isSpace,
  removeFields,
  stripEnds,
  trimBlankLines,
} from './paste-scan.js';
import { FRAME_LINE, TRACE_HEADER } from './trace.js';

export type PasteKind = 'json' | 'stack-trace' | 'code' | 'text';

/** Frames, also without their indentation: log viewers often strip it (D-65). */
const FRAME_LINES = FRAME_LINE;
const TRACEBACK = /^Traceback \(most recent call last\):\s*$/m;

const MARKDOWN_FENCE = /^ {0,3}(`{3,}|~{3,})/m;

/** A markdown list item, heading or quote: never code on its own (D-76). */
const MARKDOWN_LINE = /^ {0,3}(?:[-*+] |\d{1,3}[.)] |#{1,6} |>)/;

function lines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** D-91: pasted text with Windows (or old Mac) line endings, as the editors keep it: `\n` only. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * D-91 (CAP-06): one or two lines of code (a config copied as one line, a call, a declaration),
 * too few lines to judge by their endings: a line that starts like code (a keyword, a comment)
 * with code punctuation and a code-only mark (`=>`, `({`, `});`, `===`, `a::b`, `x = 1`…), or
 * with two such marks. Prose with a bracket or a semicolon has neither (**Proposed**).
 */
const CODE_START =
  /^\s*(?:\/\*|\/\/|(?:export|import|const|let|var|function|class|interface|type|enum|return|async|await|def|public|private|protected|static|package|using|namespace|fn|impl|struct|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b)/;
const CODE_MARK = /=>|\(\{|\}\)|\);|\};|===|!==|\w::\w|&&|\|\||\w\s*=\s*[\w'"`[{(]/g;

function shortCode(line: string): boolean {
  // Dataview fields (`[id::x]`) are Flint's own text, not code; a bare URL is not code either.
  const text = removeFields(line);
  if (text.trim().length < 12 || isBareUrl(text)) return false;
  const marks = text.match(CODE_MARK)?.length ?? 0;
  return marks >= 2 || (marks >= 1 && CODE_START.test(text) && /[{}()[\];=]/.test(text));
}

export function classifyPaste(text: string): PasteKind {
  const trimmed = normalizeNewlines(text).trim();
  // D-79: markdown already (a fenced block, an image link) stays markdown; only raw code is fenced.
  if (MARKDOWN_FENCE.test(trimmed) || hasImageLink(trimmed, true)) return 'text';
  if (/^[[{]/.test(trimmed)) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value === 'object' && value !== null) return 'json';
    } catch {
      // Not JSON; maybe code.
    }
  }
  const all = lines(trimmed).filter((line) => line.trim() !== '');
  if (all.some((line) => TRACE_HEADER.test(line))) return 'stack-trace';
  const frames = all.filter((line) => FRAME_LINES.some((pattern) => pattern.test(line))).length;
  if (frames >= 2) return 'stack-trace';
  // D-76: markdown (lists, headings, quotes) stays text, even with lines ending in a link's `)`.
  const markdown = all.filter((line) => MARKDOWN_LINE.test(line)).length;
  if (markdown / all.length >= 0.5) return 'text';
  if (all.length >= 3) {
    const codeLike = all.filter(
      (line) => /^(\t| {2,})\S/.test(line) || /[;{}()]\s*$/.test(line) || /^\s*[}\])]/.test(line),
    ).length;
    if (codeLike / all.length >= 0.5) return 'code';
  } else if (all.length > 0 && all.every(shortCode)) return 'code';
  return 'text';
}

/** A fence longer than any backtick run in the text, so the block can't end early. */
export function fencedBlock(raw: string, language = ''): string {
  const text = normalizeNewlines(raw);
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text.trimEnd()}\n${fence}`;
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
  // Without the spaces, brackets, commas and quotes around it (a JSON-ish line).
  const title = stripEnds(pick ?? '', (char) => isSpace(char) || '{}[],"'.includes(char));
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
export function blockFor(raw: string): CaptureBlock {
  const text = normalizeNewlines(raw);
  const kind = classifyPaste(text);
  return { kind, text: kind === 'text' ? text.trim() : trimBlankLines(text) };
}

/**
 * The capture text to save (D-45: the selection itself is the task; no title is ever generated):
 * - what was typed is the task line, and every block is the body;
 * - with nothing typed, a plain text block (or note) gives its first line as the task line and the
 *   rest as body; a code block leaves the task line empty and is the body, fenced and verbatim.
 */
export function composeCapture(title: string, blocks: readonly CaptureBlock[]): string {
  const usable = blocks.filter((block) => block.text.trim() !== '');
  const typed = title.trim();
  let head = typed;
  let rest = usable;
  const first = usable[0];
  if (typed === '' && first && !isCodeBlock(first.kind)) {
    const [line = '', ...more] = first.text.trim().split(/\r\n|\r|\n/);
    head = line.trim();
    const remainder = more.join('\n').trim();
    rest = remainder === '' ? usable.slice(1) : [{ ...first, text: remainder }, ...usable.slice(1)];
  }
  const parts = rest.map((block) =>
    isCodeBlock(block.kind)
      ? fencedBlock(block.text.trim(), block.kind === 'json' ? 'json' : '')
      : block.text.trimEnd(),
  );
  return [head, ...parts].join('\n');
}

const KIND_LABEL = { json: 'JSON', 'stack-trace': 'Stack trace', code: 'Code' } as const;

/**
 * A short label for a task, made when it is shown and never written to the file (D-45): its title,
 * or for an untitled task the kind of its body and a peek (`JSON · died_at…`), for reminder toasts,
 * Today's reminder cards and search results.
 */
export function taskLabel(title: string, body: string, maxLength = 48): string {
  const short = (text: string): string =>
    text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
  if (title.trim() !== '') return short(title.trim());
  const fence = firstFence(body.trim());
  if (fence) {
    const { content } = fence;
    const kind = fence.info === 'json' ? 'json' : classifyPaste(content);
    const label = kind === 'text' ? KIND_LABEL.code : KIND_LABEL[kind];
    const peek =
      kind === 'json'
        ? (/"([^"]+)"\s*:/.exec(content)?.[1] ?? '')
        : titleFromPaste(content).replace(/\\(##|!|@)/g, '$1');
    return short(peek === '' ? label : `${label} · ${peek}`);
  }
  if (hasImageLink(body, false)) return 'Screenshot';
  const line = body
    .split(/\r\n|\r|\n/)
    .map((text) => text.trim())
    .find((text) => text !== '');
  return short(line ?? 'Untitled task');
}
