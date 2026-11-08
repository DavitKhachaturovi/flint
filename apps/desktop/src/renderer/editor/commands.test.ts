import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { EDITOR_COMMANDS, inCode, type CommandHost } from './commands.js';

/**
 * NOTE-02, NOTE-03 (D-82): the formatting commands change the markdown text as the menus promise.
 * They run on an editor state through a minimal view (no DOM): what they dispatch is applied.
 */
function editor(
  doc: string,
  anchor: number,
  head = anchor,
): { view: EditorView; text: () => string } {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      const first = specs[0];
      state =
        first instanceof Transaction
          ? first.state
          : state.update(...(specs as TransactionSpec[])).state;
      ensureSyntaxTree(state, state.doc.length, 1000);
    },
    focus() {},
  } as unknown as EditorView;
  return { view, text: () => state.doc.toString() };
}

const host: CommandHost = { pickImage: () => Promise.resolve('attachments/a.png') };

function run(id: string, doc: string, anchor: number, head = anchor): string {
  const command = EDITOR_COMMANDS.find((each) => each.id === id);
  if (!command) throw new Error(`no command ${id}`);
  const { view, text } = editor(doc, anchor, head);
  command.run(view, host);
  return text();
}

describe('the note editor commands (NOTE-02, NOTE-03, D-82)', () => {
  it('wraps the selection or the word at the cursor, and unwraps it again', () => {
    expect(run('bold', 'fix the cache', 4, 7)).toBe('fix **the** cache');
    expect(run('bold', 'fix **the** cache', 6, 9)).toBe('fix the cache');
    expect(run('italic', 'fix the cache', 5)).toBe('fix *the* cache');
    expect(run('code', 'run npm test', 4, 12)).toBe('run `npm test`');
    expect(run('highlight', 'a b', 2, 3)).toBe('a ==b==');
    expect(run('strike', 'old', 0, 3)).toBe('~~old~~');
    // Nothing there: the marks, with the cursor between them.
    expect(run('bold', 'x ', 2)).toBe('x ****');
  });

  it("clears inline formatting, keeping a link's text", () => {
    expect(run('clear', '**bold** and *it* and `code` and [link](https://x.y)', 0, 51)).toBe(
      'bold and it and code and link',
    );
  });

  it('sets the kind of the selected lines, replacing what they were', () => {
    expect(run('bullet', 'one\ntwo', 0, 7)).toBe('- one\n- two');
    expect(run('number', '- one\n- two', 0, 11)).toBe('1. one\n2. two');
    expect(run('task', '1. one', 0)).toBe('- [ ] one');
    expect(run('h2', '# Title', 0)).toBe('## Title');
    expect(run('body', '> quoted', 0)).toBe('quoted');
    expect(run('quote', '- [x] done', 0)).toBe('> done');
    expect(run('h1', '    indented', 0)).toBe('# indented');
    // A cursor at the line's start ends up after the new prefix, ready to type.
    const { view, text } = editor('', 0);
    EDITOR_COMMANDS.find((each) => each.id === 'h2')?.run(view, host);
    view.dispatch({ changes: { from: view.state.selection.main.head, insert: 'Next' } });
    expect(text()).toBe('## Next');
  });

  it('inserts links, tables, code blocks and rules on lines of their own', () => {
    expect(run('link', 'see docs', 4, 8)).toBe('see [docs]()');
    expect(run('codeblock', 'text', 4)).toBe('text\n\n```\n\n```');
    expect(run('rule', '', 0)).toBe('---');
    expect(run('table', '', 0)).toBe(
      '| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |',
    );
  });

  it('leaves a blank line after an inserted table, so the text after it is no row of it (D-144)', () => {
    const table = '| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |';
    expect(run('table', 'above', 0)).toBe(`${table}\n\nabove`);
    expect(run('table', 'a\n\nb', 2)).toBe(`a\n\n${table}\n\nb`);
    expect(run('table', 'a\n\n\nb', 2)).toBe(`a\n\n${table}\n\nb`);
    expect(run('table', 'a\n', 2)).toBe(`a\n\n${table}`);
    expect(run('table', 'ab', 1)).toBe(`a\n\n${table}\n\nb`);
  });

  it('knows code, where the slash menu never opens', () => {
    const { view } = editor('text `a/b` and\n```\nx / y\n```\n', 0);
    expect(inCode(view.state, 7)).toBe(true);
    expect(inCode(view.state, 21)).toBe(true);
    expect(inCode(view.state, 2)).toBe(false);
  });
});
