import {
  history,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
  redo,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { noteState, problems } from './preview-checks.js';
import { buildPreview } from './preview.js';
import { tablesIn } from './table.js';
import { tables } from './table-view.js';

/**
 * Randomised editing (D-141 Q13): typing, deleting, Enter, Backspace, Tab / Shift+Tab, Alt+↑/↓,
 * undo and redo on markdown made of the shapes notes use, tables and pictures together among them
 * (D-144). After every step the live preview stays
 * drawable with and without focus; undoing everything gives back the exact text. Runs from
 * `FLINT_EDITOR_FUZZ_RUNS` (multi-step sequences, so fewer than core's `FLINT_FUZZ_RUNS`);
 * `npm run fuzz` runs it long, fast-check prints the seed of a failure.
 */

const RUNS = Number(process.env['FLINT_EDITOR_FUZZ_RUNS'] ?? 300);

const INSERTED = '| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |';
const PICTURE = '![](attachments/pic.png)';
const LINES = [
  '',
  'Plain text with **bold**, *italic*, `code`, ==mark== and ~~gone~~.',
  '- item',
  '- [ ] task',
  '- [x] done [id:: a1b2]',
  '  - nested',
  '1. one',
  '2) two',
  '10. ten',
  '   1. nested number',
  '# Heading',
  '### Small heading',
  '> quoted **text**',
  '```ts',
  'const a = 1;',
  '```',
  '---',
  'A [link](https://acme.example/path) and <https://acme.example>',
  '![picture](attachments/image-01.png)',
  '| a | b |',
  '| --- | :-: |',
  '| 1 | 2 |',
  'ქართული ტექსტი **მუქი**',
  // Pieces that join across lines (a link's address on the next line, CommonMark example 510).
  '[split](',
  '/address)',
  '![split](',
  'attachments/image-02.png "title")',
  '**open',
  'close**',
  // D-144: tables (Insert ▸ Table's shape) and pictures together, with and without blank lines.
  `${INSERTED}\n${PICTURE}`,
  `${INSERTED}\n\n${PICTURE}\nabove`,
  `${INSERTED}\n\n${PICTURE}\n\nabove`,
  `${PICTURE}\n${INSERTED}`,
  `${INSERTED}\n\nabove`,
  '| test |  |  |',
];
/** Typed text that can't make or break a table by itself (no pipe, fence, quote or list mark). */
const PLAIN = /^[aბ \n]+$/;
const CHARS = [
  'a',
  'ბ',
  ' ',
  '\n',
  '-',
  '*',
  '_',
  '`',
  '[',
  ']',
  '(',
  ')',
  '|',
  '#',
  '>',
  '1',
  '.',
  '=',
  '~',
  '!',
  '\t',
];

type Step =
  | { readonly kind: 'type'; readonly at: number; readonly text: string }
  | { readonly kind: 'delete'; readonly at: number; readonly length: number }
  | { readonly kind: 'command'; readonly at: number; readonly name: keyof typeof COMMANDS };

const COMMANDS = {
  enter: insertNewlineContinueMarkup,
  backspace: deleteMarkupBackward,
  tab: indentMore,
  shiftTab: indentLess,
  altUp: moveLineUp,
  altDown: moveLineDown,
  undo,
  redo,
} satisfies Record<string, StateCommand>;

const fraction = fc.double({ min: 0, max: 1, noNaN: true });
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('type' as const),
    at: fraction,
    text: fc.string({ unit: fc.constantFrom(...CHARS), minLength: 1, maxLength: 6 }),
  }),
  fc.record({
    kind: fc.constant('delete' as const),
    at: fraction,
    length: fc.integer({ min: 1, max: 8 }),
  }),
  fc.record({
    kind: fc.constant('command' as const),
    at: fraction,
    name: fc.constantFrom(...(Object.keys(COMMANDS) as (keyof typeof COMMANDS)[])),
  }),
);

const sources = (state: EditorState): string[] =>
  tablesIn(state).map((table) => state.doc.sliceString(table.from, table.to));

function run(command: StateCommand, state: EditorState): EditorState {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

function apply(state: EditorState, each: Step): EditorState {
  const at = Math.round(each.at * state.doc.length);
  const placed = state.update({ selection: EditorSelection.cursor(at) }).state;
  let next: EditorState;
  if (each.kind === 'type')
    next = placed.update({
      changes: { from: at, insert: each.text },
      selection: EditorSelection.cursor(at + each.text.length),
      userEvent: 'input.type',
    }).state;
  else if (each.kind === 'delete')
    next = placed.update({
      changes: { from: at, to: Math.min(state.doc.length, at + each.length) },
      userEvent: 'delete',
    }).state;
  else next = run(COMMANDS[each.name], placed);
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next;
}

describe('randomised editing in the note editor (D-141 Q13)', () => {
  it('keeps the live preview drawable and undo exact', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...LINES), { minLength: 1, maxLength: 12 }),
        fc.array(step, { minLength: 1, maxLength: 25 }),
        (lines, steps) => {
          const text = lines.join('\n');
          let state = noteState(text, 0, 0, [history(), tables()]);
          for (const each of steps) {
            const before = state;
            state = apply(state, each);
            // D-144: plain text typed outside every table never changes a table's bytes (it may
            // end a code block that held one, which then is a table of its own).
            if (each.kind === 'type' && PLAIN.test(each.text)) {
              const at = Math.round(each.at * before.doc.length);
              const there = tablesIn(before);
              if (there.every((table) => at < table.from || at > table.to)) {
                const after = sources(state);
                for (const source of sources(before)) expect(after).toContain(source);
              }
            }
            for (const focused of [true, false]) {
              const found = problems(state, buildPreview({ state, focused, patterns: [] }));
              expect(found).toEqual([]);
            }
          }
          while (undoDepth(state) > 0) state = run(undo, state);
          expect(state.doc.toString()).toBe(text);
        },
      ),
      { numRuns: RUNS },
    );
  }, 60_000);
});
