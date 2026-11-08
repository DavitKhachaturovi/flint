import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { syntaxTree } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { fromEditor, lineEndingOf, toEditor } from './line-endings.js';
import { noteState, problems, treeProblems } from './preview-checks.js';
import { buildPreview } from './preview.js';

/**
 * The live preview on real-world notes (D-141 Q2, Q13): on this machine only, a real notes folder
 * when `FLINT_CORPUS` points at it (read-only; skipped on CI). Nothing derived from real notes is
 * in the repository (Davit, after the 1.1.0 preview). Failures name a note by its number and give
 * offsets and node kinds only, never its name or text.
 */

function notesIn(folder: string): string[] {
  if (!existsSync(folder)) return [];
  const found: string[] = [];
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'attachments') continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...notesIn(path));
    else if (entry.name.toLowerCase().endsWith('.md')) found.push(path);
  }
  return found;
}

/** Everything wrong with one note, without its text. */
function noteProblems(text: string): string[] {
  const found: string[] = [];
  // Byte-exact: what the editor gives back is the file, when it uses one line ending throughout.
  const mixed = /\r\n/.test(text) && /(^|[^\r])\n/.test(text);
  if (!mixed && !/\r(?!\n)/.test(text) && fromEditor(toEditor(text), lineEndingOf(text)) !== text)
    found.push('line endings not kept');
  const state = noteState(toEditor(text));
  const { doc } = state;
  const items = buildPreview({ state, focused: false, patterns: [] });
  found.push(...problems(state, items), ...treeProblems(state, items));
  // With focus, the caret at every syntax node's edges, drawing a viewport around it as the
  // editor does.
  const carets = new Set<number>();
  syntaxTree(state).iterate({
    enter: (node) => {
      for (const at of [node.from - 1, node.from, node.from + 1, node.to - 1, node.to, node.to + 1])
        if (at >= 0 && at <= doc.length) carets.add(at);
    },
  });
  for (const at of carets) {
    const caret = state.update({ selection: { anchor: at } }).state;
    const line = doc.lineAt(at).number;
    const visible = [
      {
        from: doc.line(Math.max(1, line - 40)).from,
        to: doc.line(Math.min(doc.lines, line + 40)).to,
      },
    ];
    const near = buildPreview({ state: caret, focused: true, visible, patterns: [] });
    for (const problem of problems(caret, near)) found.push(`caret ${at}: ${problem}`);
  }
  return [...new Set(found)];
}

function checkAll(files: readonly string[]): string[] {
  return files.flatMap((file, index) =>
    noteProblems(readFileSync(file, 'utf8')).map((problem) => `note ${index + 1}: ${problem}`),
  );
}

const CORPUS = process.env['FLINT_CORPUS'];

describe('the live preview on real-world notes (D-141 Q2, Q13)', () => {
  it.skipIf(!CORPUS)(
    'the notes folder in FLINT_CORPUS (local only, read-only)',
    () => {
      const files = notesIn(CORPUS ?? '');
      expect(files.length).toBeGreaterThan(0);
      expect(checkAll(files)).toEqual([]);
    },
    120_000,
  );
});
