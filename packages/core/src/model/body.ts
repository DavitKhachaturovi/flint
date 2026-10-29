import type { FlintDocument, TaskNode, TextChunk } from '../format/document.js';
import { indentWidth, isBlank, stripColumns } from '../format/lines.js';
import { childIndent } from './tree.js';

/**
 * A task's body (TASK-05) as plain markdown: its text lines without the indentation that makes them
 * part of the task, and without leading or trailing blank lines. Subtasks are not part of it.
 */
export function getBody(node: TaskNode): string {
  const lines = node.children.flatMap((child) => (child.kind === 'text' ? child.lines : []));
  const widths = lines
    .filter((line) => !isBlank(line.text) && indentWidth(line.text) >= node.contentColumn)
    .map((line) => indentWidth(line.text));
  const base = widths.length > 0 ? Math.min(...widths) : node.contentColumn;
  const texts = lines.map((line) => {
    if (isBlank(line.text)) return '';
    return indentWidth(line.text) >= base
      ? stripColumns(line.text, base)
      : line.text.replace(/^[ \t]+/, '');
  });
  while (texts[0] === '') texts.shift();
  while (texts.at(-1) === '') texts.pop();
  return texts.join('\n');
}

/**
 * The task with a new body, written directly under the task line and before its subtasks. Body
 * lines get the indentation the task's children already use (one level deeper otherwise). Note: a
 * checklist line in a top-level task's body is, by the file format, a subtask (docs/04 §3).
 */
export function withBody(document: FlintDocument, node: TaskNode, body: string): TaskNode {
  const prefix = childIndent(document, node);
  const lines =
    body === ''
      ? []
      : body
          .split(/\r\n|\r|\n/)
          .map((text) => ({ text: text === '' ? '' : prefix + text, eol: document.eol }));
  const text: TextChunk[] = lines.length > 0 ? [{ kind: 'text', lines }] : [];
  return {
    ...node,
    children: [...text, ...node.children.filter((child) => child.kind === 'task')],
  };
}
