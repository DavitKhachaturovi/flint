import { history, redo, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type Extension, type StateCommand } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { NOTE_SYNTAX } from './syntax.js';
import { tablesIn } from './table.js';
import { cellAt, tables } from './table-view.js';

/** NOTE-10, D-141 Q9: the cell a caret is in, and selections that take a table whole. */

const DOC = 'Before\n\n| Name | Age |\n| ---- | --- |\n| Alex | 30  |\n\nAfter';

function state(doc = DOC, extra: readonly Extension[] = []): EditorState {
  const result = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [...NOTE_SYNTAX] }),
      tables(),
      ...extra,
    ],
  });
  ensureSyntaxTree(result, doc.length, 5000);
  return result;
}

function run(command: StateCommand, s: EditorState): EditorState {
  let next = s;
  command({ state: s, dispatch: (tr) => (next = tr.state) });
  return next;
}

describe('tables in the note editor (NOTE-10, D-141 Q9)', () => {
  it('knows the cell a position is in, the delimiter row counting as the first body row', () => {
    const s = state();
    const at = (text: string): [number, number] | null => {
      const here = cellAt(s, DOC.indexOf(text));
      return here ? [here.row, here.column] : null;
    };
    expect(at('Name')).toEqual([0, 0]);
    expect(at('Age')).toEqual([0, 1]);
    expect(at('Alex')).toEqual([1, 0]);
    expect(at('30')).toEqual([1, 1]);
    expect(at('---- |')).toEqual([1, 0]);
    expect(at('Before')).toBeNull();
    expect(at('After')).toBeNull();
  });

  it('widens a selection that crosses a table to the whole table, and leaves others alone', () => {
    const s = state();
    const tableFrom = DOC.indexOf('| Name');
    const tableTo = DOC.indexOf('30  |') + '30  |'.length;
    const crossed = s.update({ selection: EditorSelection.single(2, DOC.indexOf('Alex')) }).state;
    expect(crossed.selection.main.from).toBe(2);
    expect(crossed.selection.main.to).toBe(tableTo);
    const backwards = s.update({
      selection: EditorSelection.single(DOC.indexOf('After') + 2, DOC.indexOf('Age')),
    }).state;
    expect(backwards.selection.main.from).toBe(tableFrom);
    const outside = s.update({ selection: EditorSelection.single(0, 4) }).state;
    expect(outside.selection.main.to).toBe(4);
    const caret = s.update({ selection: { anchor: DOC.indexOf('Alex') } }).state;
    expect(caret.selection.main.empty).toBe(true);
  });
});

/**
 * D-144: Davit's report after the first 1.2.0 preview. A word typed on the blank line under a table
 * became a row of it (GFM's lazy rows), and so did the picture and the paragraph after it; the
 * table's cell then took the focus mid-word.
 */
describe('text written below a table stays out of it (NOTE-10, D-144)', () => {
  const TABLE = '| Column | Column | Column |\n| --- | --- | --- |\n| test |  |  |';
  const PICTURE = '![](attachments/pic.png)';

  function edit(
    s: EditorState,
    change: { from: number; to?: number; insert?: string },
    userEvent: string,
  ): EditorState {
    const head = change.from + (change.insert?.length ?? 0);
    const next = s.update({ changes: change, selection: { anchor: head }, userEvent }).state;
    ensureSyntaxTree(next, next.doc.length, 5000);
    return next;
  }
  const drawn = (s: EditorState): number => {
    let count = 0;
    for (const source of s.facet(EditorView.decorations))
      if (typeof source !== 'function') count += source.size;
    return count;
  };
  const sources = (s: EditorState): string[] =>
    tablesIn(s).map((table) => s.doc.sliceString(table.from, table.to));

  it('keeps a word typed on the blank line under a table out of it, the picture after it too', () => {
    for (const after of [`${PICTURE}\n\nabove`, `${PICTURE}\nabove`, 'above', '']) {
      const doc = `Intro\n\n${TABLE}\n\n${after}`;
      const blank = doc.indexOf(TABLE) + TABLE.length + 1;
      let s = state(doc);
      s = edit(s, { from: blank, insert: 't' }, 'input.type');
      expect(s.doc.toString()).toBe(`Intro\n\n${TABLE}\n\nt\n${after}`);
      expect(s.selection.main.head).toBe(blank + 2);
      // The next key goes on as typed.
      s = edit(s, { from: s.selection.main.head, insert: 'est' }, 'input.type');
      expect(s.doc.toString()).toBe(`Intro\n\n${TABLE}\n\ntest\n${after}`);
      expect(sources(s)).toEqual([TABLE]);
      expect(cellAt(s, s.selection.main.head)).toBeNull();
    }
  });

  it('pastes lines under a table as paragraphs; a line with a pipe is a row, shown raw', () => {
    const doc = `${TABLE}\n\n${PICTURE}`;
    const blank = TABLE.length + 1;
    const pasted = edit(state(doc), { from: blank, insert: 'one\ntwo' }, 'input.paste');
    expect(pasted.doc.toString()).toBe(`${TABLE}\n\none\ntwo\n${PICTURE}`);
    // `|` first: a row, as GFM says; the picture after it stays out; the table shows raw while
    // the caret is in it (no cell takes the focus mid-word).
    const s = state(doc).update({ selection: { anchor: blank } }).state;
    expect(drawn(s)).toBe(1);
    const row = edit(s, { from: blank, insert: '|' }, 'input.type');
    expect(row.doc.toString()).toBe(`${TABLE}\n|\n\n${PICTURE}`);
    expect(sources(row)).toEqual([`${TABLE}\n|`]);
    expect(drawn(row)).toBe(0);
    const left = row.update({ selection: { anchor: row.doc.length } }).state;
    expect(drawn(left)).toBe(1);
  });

  it('never pulls a paragraph into a table with Backspace: the caret moves up instead', () => {
    const doc = `${TABLE}\n\nabove`;
    const at = doc.indexOf('above');
    const s = edit(state(doc), { from: at - 1, to: at }, 'delete.backward');
    expect(s.doc.toString()).toBe(doc);
    expect(s.selection.main.head).toBe(at - 1);
    // A list item right under a table is no row; text typed before its marker would be.
    const list = `${TABLE}\n- item`;
    const typed = edit(state(list), { from: TABLE.length + 1, insert: 'a' }, 'input.type');
    expect(typed.doc.toString()).toBe(`${TABLE}\n\na- item`);
  });

  it('is one undo step, and leaves undo, redo and the table’s own edits alone', () => {
    const doc = `${TABLE}\n\n${PICTURE}`;
    const blank = TABLE.length + 1;
    let s = state(doc, [history()]);
    s = edit(s, { from: blank, insert: 'x' }, 'input.type');
    expect(s.doc.toString()).toBe(`${TABLE}\n\nx\n${PICTURE}`);
    s = run(undo, s);
    expect(s.doc.toString()).toBe(doc);
    s = run(redo, s);
    expect(s.doc.toString()).toBe(`${TABLE}\n\nx\n${PICTURE}`);
    // A change with no user event (a file changed elsewhere) is the file's own.
    const outside = state(doc).update({ changes: { from: blank, insert: 'y' } }).state;
    expect(outside.doc.toString()).toBe(`${TABLE}\ny\n${PICTURE}`);
  });
});
