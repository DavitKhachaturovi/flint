import { formatTaskContent, parseTaskContent, type TaskContent } from './fields.js';

/** `[ ]` is open; `[x]` and `[X]` are completed. Other status characters are not Flint tasks. */
export type TaskStatus = ' ' | 'x' | 'X';

/** A parsed task line: `- [ ] title [field:: value] ^block` (docs/04 §3). */
export interface TaskLine extends TaskContent {
  readonly indent: string;
  readonly marker: '-' | '*' | '+';
  /** Whitespace between the list marker and `[`. */
  readonly gap: string;
  readonly status: TaskStatus;
}

// Bullet marker, checkbox with a space or x, then whitespace or the end of the line (GFM).
const TASK_LINE = /^([ \t]*)([-*+])([ \t]+)\[([ xX])\](?:[ \t]+(.*))?$/s;

export function parseTaskLine(text: string): TaskLine | null {
  const match = TASK_LINE.exec(text);
  if (!match) return null;
  const [, indent = '', marker = '-', gap = ' ', status = ' ', rest = ''] = match;
  return {
    indent,
    marker: marker as TaskLine['marker'],
    gap,
    status: status as TaskStatus,
    ...parseTaskContent(rest),
  };
}

export function formatTaskLine(line: TaskLine): string {
  const content = formatTaskContent(line);
  return `${line.indent}${line.marker}${line.gap}[${line.status}]${content === '' ? '' : ` ${content}`}`;
}

export function isCompletedStatus(status: TaskStatus): boolean {
  return status !== ' ';
}
