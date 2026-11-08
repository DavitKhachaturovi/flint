import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NOTE_SYNTAX } from './syntax.js';
import { cellAt, tables } from './table-view.js';

/** NOTE-10, D-141 Q9: the cell a caret is in, and selections that take a table whole. */

const DOC = 'Before\n\n| Name | Age |\n| ---- | --- |\n| Alex | 30  |\n\nAfter';

function state(doc = DOC): EditorState {
  const result = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [...NOTE_SYNTAX] }), tables()],
  });
  ensureSyntaxTree(result, doc.length, 5000);
  return result;
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
