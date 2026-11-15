/** Enter keeps lists tight (D-165, tight-lists.ts). */
import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { NOTE_SYNTAX } from './syntax.js';
import { tightListEnter } from './tight-lists.js';

function stateAt(doc: string, at = doc.length): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: at },
    extensions: [history(), markdown({ base: markdownLanguage, extensions: [...NOTE_SYNTAX] })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function run(command: StateCommand, state: EditorState): EditorState {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next;
}

const enter = (state: EditorState): EditorState => run(tightListEnter, state);

describe('Enter keeps lists tight (D-165)', () => {
  it('continues a checklist on the next line', () => {
    expect(enter(stateAt('- [ ] a\n- [ ] b')).doc.toString()).toBe('- [ ] a\n- [ ] b\n- [ ] ');
  });

  it('an empty second item ends the list instead of starting a loose one', () => {
    const doc = enter(stateAt('- [ ] a\n- [ ] ')).doc.toString();
    expect(doc).not.toMatch(/\n\n- /);
    expect(doc.startsWith('- [ ] a\n')).toBe(true);
  });

  it('a loose list goes on without a blank line', () => {
    expect(enter(stateAt('- a\n\n- b')).doc.toString()).toBe('- a\n\n- b\n- ');
  });

  it('a loose numbered list goes on without a blank line', () => {
    const doc = enter(stateAt('1. a\n\n2. b')).doc.toString();
    expect(doc).toMatch(/2\. b\n3\. $/);
  });

  it('typing after the new item and Enter again stays tight', () => {
    let state = enter(stateAt('- [ ] che'));
    state = run(({ state: s, dispatch }) => {
      dispatch(s.update({ changes: { from: s.doc.length, insert: 'ch' } }));
      return true;
    }, state);
    state = enter(stateAt(state.doc.toString()));
    expect(state.doc.toString()).toBe('- [ ] che\n- [ ] ch\n- [ ] ');
  });

  it('outside lists it leaves Enter to the editor’s plain line break', () => {
    const state = stateAt('Hello');
    expect(tightListEnter({ state, dispatch: () => undefined })).toBe(false);
  });

  it('is one undo step, and the caret is on the new item', () => {
    const before = stateAt('- a\n\n- b');
    const after = enter(before);
    expect(after.selection.main.head).toBe(after.doc.length);
    expect(run(undo, after).doc.toString()).toBe('- a\n\n- b');
  });
});
