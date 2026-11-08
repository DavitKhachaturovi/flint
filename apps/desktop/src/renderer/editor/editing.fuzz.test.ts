import {
  deleteCharBackward,
  deleteCharForward,
  deleteGroupBackward,
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
import type { Command } from '@codemirror/view';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { noteState, problems } from './preview-checks.js';
import { buildPreview } from './preview.js';
import { tablesIn, type ParsedTable } from './table.js';
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
  // In a quote and in a list item (the blank line a `>`, the rows indented).
  `> | a | b |\n> | - | - |\n> | c | d |\n>\n> ${PICTURE}`,
  '- item\n\n  | a | b |\n  | - | - |\n  | c | d |\n\n  after',
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

/**
 * Where a step acts: `at` of the way through the note, or (`edge` 0 to 2) that many characters after
 * the end of the table `at` of the way through the note's tables, where text joins a table (D-144).
 */
interface Place {
  readonly at: number;
  readonly edge: number;
}

/** A view command that reads only the state and dispatches (the delete commands), on a state. */
const onState = (command: Command): StateCommand => command as unknown as StateCommand;

type Step = Place &
  (
    | { readonly kind: 'type'; readonly text: string }
    | { readonly kind: 'delete'; readonly length: number }
    | { readonly kind: 'command'; readonly name: keyof typeof COMMANDS }
  );

const COMMANDS = {
  enter: insertNewlineContinueMarkup,
  backspace: deleteMarkupBackward,
  tab: indentMore,
  shiftTab: indentLess,
  altUp: moveLineUp,
  altDown: moveLineDown,
  undo,
  redo,
  // Backspace, Ctrl+Backspace and Delete as the editor's keys run them (D-144).
  backspaceChar: onState(deleteCharBackward),
  backspaceWord: onState(deleteGroupBackward),
  deleteChar: onState(deleteCharForward),
} satisfies Record<string, StateCommand>;

const DELETES: readonly (keyof typeof COMMANDS)[] = [
  'backspaceChar',
  'backspaceWord',
  'deleteChar',
];

const fraction = fc.double({ min: 0, max: 1, noNaN: true });
const edge = fc.oneof(
  { weight: 3, arbitrary: fc.constant(-1) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 2 }) },
);
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('type' as const),
    at: fraction,
    edge,
    text: fc.string({ unit: fc.constantFrom(...CHARS), minLength: 1, maxLength: 6 }),
  }),
  fc.record({
    kind: fc.constant('delete' as const),
    at: fraction,
    edge,
    length: fc.integer({ min: 1, max: 8 }),
  }),
  fc.record({
    kind: fc.constant('command' as const),
    at: fraction,
    edge,
    name: fc.constantFrom(...(Object.keys(COMMANDS) as (keyof typeof COMMANDS)[])),
  }),
);

/**
 * D-144: a table of `before` still stands where it was in `after`, its text as it was, and only
 * text written with a pipe (rows, another table) joined onto its last row or after it. Both read
 * by a fresh parse (an incremental one can differ on a table right under a paragraph).
 */
const fresh = (state: EditorState): ParsedTable[] => tablesIn(noteState(state.doc.toString()));

function keptClosed(before: EditorState, after: EditorState, table: ParsedTable): void {
  const source = before.doc.sliceString(table.from, table.to);
  const now = fresh(after).find((each) => each.from === table.from);
  expect(now && after.doc.sliceString(now.from, now.from + source.length)).toBe(source);
  if (!now) return;
  // Joined onto its last row, or after it: only text written with a pipe (as GFM reads it).
  const [joined = '', ...rows] = after.doc
    .sliceString(now.from + source.length, now.to)
    .split('\n');
  for (const row of [...(joined === '' ? [] : [joined]), ...rows])
    expect(row).toMatch(/(?:^|[^\\])\|/);
}

function position(state: EditorState, each: Place): number {
  const uniform = Math.round(each.at * state.doc.length);
  if (each.edge < 0) return uniform;
  const there = tablesIn(state);
  const table = there[Math.min(there.length - 1, Math.floor(each.at * there.length))];
  return table ? Math.min(state.doc.length, table.to + each.edge) : uniform;
}

function run(command: StateCommand, state: EditorState): EditorState {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

/** The ranges a step asks to delete (as the bare command would, before the editor's filters). */
function deletes(state: EditorState, each: Step): [number, number][] {
  const at = position(state, each);
  if (each.kind === 'delete') return [[at, Math.min(state.doc.length, at + each.length)]];
  if (each.kind !== 'command' || !DELETES.includes(each.name)) return [];
  const ranges: [number, number][] = [];
  const bare = EditorState.create({ doc: state.doc, selection: EditorSelection.cursor(at) });
  COMMANDS[each.name]({
    state: bare,
    dispatch: (tr) => tr.changes.iterChangedRanges((from, to) => ranges.push([from, to])),
  });
  return ranges;
}

function apply(state: EditorState, each: Step): EditorState {
  const at = position(state, each);
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
            // D-144: plain text typed below a table never joins it. (Typed above one, it may end
            // a code block that held it, or turn indented code above its header into a paragraph
            // that takes the header in, as markdown says.)
            if (each.kind === 'type' && PLAIN.test(each.text)) {
              const at = position(before, each);
              const tables = fresh(before);
              for (const table of tables) if (table.to < at) keptClosed(before, state, table);
              // D-144: plain text typed outside every table never changes a table's bytes. Except,
              // as markdown says, a table under a fence (typing can open or close a code block
              // around it) or right under a line (a line with a pipe can take its header in).
              if (tables.every((table) => at < table.from || at > table.to)) {
                const after = fresh(state).map((table) =>
                  state.doc.sliceString(table.from, table.to),
                );
                for (const table of tables) {
                  const first = before.doc.lineAt(table.from).number;
                  const above = first > 1 ? before.doc.line(first - 1).text : '';
                  if (above.trim() !== '' || /```|~~~/.test(before.doc.sliceString(0, table.from)))
                    continue;
                  expect(after).toContain(before.doc.sliceString(table.from, table.to));
                }
              }
            }
            // D-144: nor does deleting plain text below a table, Backspace or Delete on the blank
            // line under it included. (Text deleted above a table may open a code block that
            // takes it in, as markdown says.)
            const deleted = deletes(before, each);
            if (
              deleted.length > 0 &&
              deleted.every(([from, to]) => /^[\p{L} \n]*$/u.test(before.doc.sliceString(from, to)))
            ) {
              const first = Math.min(...deleted.map(([from]) => from));
              for (const table of fresh(before))
                if (table.to <= first) keptClosed(before, state, table);
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
