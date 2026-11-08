import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nestItems, renumberAfterEdits } from './lists.js';
import { NOTE_SYNTAX } from './syntax.js';

/** D-141 Q6 (renumbering) and Q7 (nesting) on editor states, as the note editor has them. */

function note(doc: string, anchor = 0, head = anchor): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      markdown({ base: markdownLanguage, extensions: [...NOTE_SYNTAX] }),
      history(),
      renumberAfterEdits,
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}
const edit = (state: EditorState, spec: TransactionSpec): EditorState => {
  const next = state.update(spec).state;
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next;
};
/** Tab (1) or Shift+Tab (-1) with the caret at `caret`, as the editor does it. */
function tab(doc: string, caret: number, direction: 1 | -1): string {
  const state = note(doc, caret);
  const nesting = nestItems(state, direction);
  if (nesting.kind !== 'move') return nesting.kind;
  return edit(state, {
    changes: nesting.changes,
    userEvent: direction > 0 ? 'input.indent' : 'delete.dedent',
  }).doc.toString();
}

describe('renumbering after structural edits (D-141 Q6)', () => {
  it('renumbers the list after an item is deleted, its first number kept', () => {
    const doc = '3. a\n4. b\n5. c';
    const state = edit(note(doc), {
      changes: { from: 4, to: 9 },
      userEvent: 'delete.backward',
    });
    expect(state.doc.toString()).toBe('3. a\n4. c');
  });

  it('keeps a number typed by hand until the next structural edit', () => {
    let state = edit(note('1. a\n2. b\n3. c'), {
      changes: { from: 5, to: 6, insert: '7' },
      userEvent: 'input.type',
    });
    expect(state.doc.toString()).toBe('1. a\n7. b\n3. c');
    // Enter at the end of `c`: the list's next structural edit puts it in order.
    state = edit(state, { changes: { from: 14, insert: '\n4. ' }, userEvent: 'input' });
    expect(state.doc.toString()).toBe('1. a\n2. b\n3. c\n4. ');
  });

  it('keeps the delimiter and touches no other list', () => {
    const doc = '1) a\n1) b\n\nText between.\n\n5. x\n9. y';
    const state = edit(note(doc), { changes: { from: 4, insert: '\n1) new' }, userEvent: 'input' });
    expect(state.doc.toString()).toBe('1) a\n2) new\n3) b\n\nText between.\n\n5. x\n9. y');
  });

  it('moves the lines nested under an item when its number gets wider (9. → 10.)', () => {
    const doc = '8. a\n9. b\n   - child\n   more';
    const state = edit(note(doc), { changes: { from: 4, insert: '\n9. new' }, userEvent: 'input' });
    expect(state.doc.toString()).toBe('8. a\n9. new\n10. b\n    - child\n    more');
  });

  it('keeps the number the list started at when a line moves to its top (Alt+↑)', () => {
    // `2. b` moved above `1. a`, as moveLineUp writes it.
    const state = edit(note('1. a\n2. b'), {
      changes: { from: 0, to: 9, insert: '2. b\n1. a' },
      userEvent: 'move.line',
    });
    expect(state.doc.toString()).toBe('1. b\n2. a');
    const three = edit(note('3. a\n4. b'), {
      changes: { from: 0, to: 9, insert: '4. b\n3. a' },
      userEvent: 'move.line',
    });
    expect(three.doc.toString()).toBe('3. b\n4. a');
  });

  it('is one undo step with the edit, and never runs for a change from outside', () => {
    const doc = '1. a\n2. b\n3. c';
    const edited = edit(note(doc), { changes: { from: 4, to: 9 }, userEvent: 'delete.backward' });
    expect(edited.doc.toString()).toBe('1. a\n2. c');
    let undone = edited;
    undo({ state: edited, dispatch: (tr) => (undone = tr.state) });
    expect(undone.doc.toString()).toBe(doc);
    const outside = edit(note(doc), { changes: { from: 4, to: 9 } });
    expect(outside.doc.toString()).toBe('1. a\n3. c');
  });
});

describe('nesting list items (D-141 Q7)', () => {
  it("nests at the parent's text column; a numbered item starts a nested list at 1", () => {
    expect(tab('1. a\n2. b', 6, 1)).toBe('1. a\n   1. b');
    expect(tab('- a\n- b', 5, 1)).toBe('- a\n  - b');
    expect(tab('10. a\n11. b', 9, 1)).toBe('10. a\n    1. b');
    expect(tab('1.  a\n2.  b', 8, 1)).toBe('1.  a\n    1.  b');
  });

  it('moves the item with everything nested under it; the list it left is renumbered', () => {
    expect(tab('1. a\n2. b\n   - c\n3. d', 6, 1)).toBe('1. a\n   1. b\n      - c\n2. d');
  });

  it("joins the parent's numbered children as the next number", () => {
    expect(tab('1. a\n   1. x\n2. b', 16, 1)).toBe('1. a\n   1. x\n   2. b');
  });

  it("Shift+Tab puts an item back at its parent's marker column", () => {
    expect(tab('1. a\n   1. b\n2. c', 9, -1)).toBe('1. a\n2. b\n3. c');
    expect(tab('- a\n  - b', 7, -1)).toBe('- a\n- b');
  });

  it("can't nest a list's first item or outdent a top-level one (a nudge)", () => {
    expect(tab('1. a\n2. b', 2, 1)).toBe('impossible');
    expect(tab('- a', 2, -1)).toBe('impossible');
  });

  it('writes a tab where the list already uses tabs', () => {
    expect(tab('- a\n\t- b\n\t- c', 13, 1)).toBe('- a\n\t- b\n\t\t- c');
  });

  it('leaves lines outside lists to the usual indent', () => {
    expect(tab('Plain text', 3, 1)).toBe('none');
    expect(tab('```\n- not a list\n```', 6, 1)).toBe('none');
  });
});

describe('renumbering, randomised (D-141 Q6, Q13)', () => {
  const RUNS = Number(process.env['FLINT_EDITOR_FUZZ_RUNS'] ?? 300);
  const item = fc.record({
    number: fc.integer({ min: 0, max: 120 }),
    delimiter: fc.constantFrom('.', ')'),
    text: fc.string({ unit: fc.constantFrom('a', 'b', ' ', '*', '1', '.'), maxLength: 6 }),
    child: fc.option(fc.constantFrom('- child', 'more text', '1. nested'), { nil: undefined }),
  });
  const list = fc.array(item, { minLength: 1, maxLength: 12 }).map((items) => {
    const delimiter = items[0]?.delimiter ?? '.';
    return items
      .map((each) => {
        const head = `${each.number}${delimiter} x${each.text}`;
        const pad = ' '.repeat(`${each.number}${delimiter} `.length);
        return each.child ? `${head}\n${pad}${each.child}` : head;
      })
      .join('\n');
  });
  /** The text without list numbers and leading spaces: what renumbering may never change. */
  const rest = (text: string): string =>
    text
      .split('\n')
      .map((line) => line.replace(/^\s*/, '').replace(/^\d{1,9}(?=[.)] )/, ''))
      .join('\n');

  it('changes only numbers and indentation, and nothing in another list', () => {
    fc.assert(
      fc.property(list, list, fc.nat(), (first, second, pick) => {
        const doc = `${first}\n\nBetween the lists.\n\n${second}`;
        const state = note(doc);
        // Delete one whole line of the first list (a structural edit).
        const lines = first.split('\n').length;
        const line = state.doc.line(1 + (pick % lines));
        const to = Math.min(line.to + 1, state.doc.length);
        const edited = edit(state, {
          changes: { from: line.from, to },
          userEvent: 'delete.backward',
        });
        const plain = state.update({ changes: { from: line.from, to } }).state.doc.toString();
        const text = edited.doc.toString();
        expect(rest(text)).toBe(rest(plain));
        expect(text.endsWith(`Between the lists.\n\n${second}`)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});
