import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addColumn,
  addRow,
  alignTable,
  cellsMarkdown,
  cellTexts,
  clearCells,
  containerPrefix,
  deleteColumn,
  deleteRow,
  deleteTable,
  escapeCell,
  hasRowPipe,
  parseTsv,
  setCell,
  setCells,
  toTsv,
  tableAt,
  tablesIn,
  type ParsedTable,
} from './table.js';
import { NOTE_SYNTAX } from './syntax.js';

/** NOTE-10, D-141 Q10–Q11: the table model and its byte-minimal edits. */

function state(doc: string): EditorState {
  const result = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [...NOTE_SYNTAX] })],
  });
  ensureSyntaxTree(result, doc.length, 5000);
  return result;
}
function table(doc: string): { state: EditorState; table: ParsedTable } {
  const s = state(doc);
  const found = tablesIn(s)[0];
  if (!found) throw new Error('no table');
  return { state: s, table: found };
}
const apply = (s: EditorState, changes: ChangeSpec[]): string =>
  s.update({ changes }).state.doc.toString();
const texts = (doc: string): string[][] =>
  table(doc).table.rows.map((row) => row.cells.map((cell) => cell.text));

const INSERTED = '| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |';

describe('reading a table (NOTE-10)', () => {
  it('reads cells, escaped pipes, alignment and the pipe style', () => {
    const { table: t } = table('| a | b \\| c |\n| :-- | :-: |\n| 1 | `x\\|y` |\n| 2 |');
    expect(t.columns).toBe(2);
    expect(t.align).toEqual(['left', 'center']);
    expect(t.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['a', 'b | c'],
      ['1', '`x|y`'],
      ['2'],
    ]);
    expect(t.rows[0]?.leading && t.rows[0]?.trailing).toBe(true);
    const plain = table('a | b\n--- | ---\n1 | 2').table;
    expect(plain.rows[0]?.leading || plain.rows[0]?.trailing).toBe(false);
    expect(plain.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a line’s container prefix (indent and quote marks) in one pass, as the old pattern did', () => {
    expect(containerPrefix('> | a |')).toBe('> ');
    expect(containerPrefix('  >> > | a')).toBe('  >> > ');
    expect(containerPrefix('\t| a |')).toBe('\t');
    expect(containerPrefix('a > b')).toBe('');
    const old = /^(?:[ \t]*>)*[ \t]*/;
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(' ', '\t', '>', 'a', '|'), maxLength: 12 }),
        (line) => {
          expect(containerPrefix(line)).toBe(old.exec(line)?.[0] ?? '');
        },
      ),
      { numRuns: 2000 },
    );
    const started = performance.now();
    containerPrefix(`${' \t>'.repeat(100_000)}x`);
    containerPrefix(' '.repeat(200_000));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('finds the table around a position, and none outside it', () => {
    const doc = `Before\n\n${INSERTED}\n\nAfter`;
    const s = state(doc);
    expect(tableAt(s, doc.indexOf('Column'))?.columns).toBe(3);
    expect(tableAt(s, doc.indexOf('After'))).toBeNull();
  });
});

describe('writing a table back (D-141 Q10)', () => {
  it('changes only the edited cell, its padding kept', () => {
    const doc = '| Name    | Age |\n| ------- | --- |\n| Alex    | 30  |';
    const { state: s, table: t } = table(doc);
    expect(apply(s, setCell(s, t, 1, 0, 'Sam'))).toBe(
      '| Name    | Age |\n| ------- | --- |\n| Sam    | 30  |',
    );
  });

  it('gives an empty cell one space on each side; escapes pipes; line breaks become spaces', () => {
    const { state: s, table: t } = table(INSERTED);
    expect(apply(s, setCell(s, t, 1, 1, 'a|b\nc'))).toBe(
      '| Column | Column | Column |\n| --- | --- | --- |\n|  | a\\|b c |  |',
    );
  });

  it('grows a short row only up to the edited cell, in its style', () => {
    const { state: s, table: t } = table('| a | b | c |\n| - | - | - |\n| 1 |');
    expect(apply(s, setCell(s, t, 1, 2, 'z'))).toBe('| a | b | c |\n| - | - | - |\n| 1 |  | z |');
    const plain = table('a | b\n--- | ---\n1');
    expect(apply(plain.state, setCell(plain.state, plain.table, 1, 1, 'z'))).toBe(
      'a | b\n--- | ---\n1 | z',
    );
  });

  it('keeps cells beyond the header untouched', () => {
    const doc = '| a |\n| - |\n| 1 | extra |';
    const { state: s, table: t } = table(doc);
    expect(apply(s, setCell(s, t, 1, 0, 'one'))).toBe('| a |\n| - |\n| one | extra |');
  });

  it('copies the row above for a new row, and the table style for a new column', () => {
    const { state: s, table: t } = table('| Name    | Age |\n| ------- | --- |\n| Alex    | 30  |');
    expect(apply(s, addRow(t, 1))).toBe(
      '| Name    | Age |\n| ------- | --- |\n| Alex    | 30  |\n|         |     |',
    );
    expect(apply(s, addRow(t, 0))).toBe(
      '| Name    | Age |\n| ------- | --- |\n|         |     |\n| Alex    | 30  |',
    );
    expect(apply(s, addColumn(t, 2))).toBe(
      '| Name    | Age |  |\n| ------- | --- | --- |\n| Alex    | 30  |  |',
    );
    expect(apply(s, addColumn(t, 0))).toBe(
      '|  | Name    | Age |\n| --- | ------- | --- |\n|  | Alex    | 30  |',
    );
    expect(texts(apply(s, addColumn(t, 1)))).toEqual([
      ['Name', '', 'Age'],
      ['Alex', '', '30'],
    ]);
    // Without edge pipes, a new last column still counts.
    const plain = table('a | b\n--- | ---\n1 | 2');
    expect(table(apply(plain.state, addColumn(plain.table, 2))).table.columns).toBe(3);
  });

  it('deletes a row, a column (with one pipe) or the table', () => {
    const doc = 'Before\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nAfter';
    const { state: s, table: t } = table(doc);
    expect(apply(s, deleteRow(t, 1))).toBe('Before\n\n| a | b |\n| - | - |\n| 3 | 4 |\n\nAfter');
    expect(deleteRow(t, 0)).toEqual([]);
    expect(apply(s, deleteColumn(t, 1))).toBe('Before\n\n| a |\n| - |\n| 1 |\n| 3 |\n\nAfter');
    expect(apply(s, deleteColumn(t, 0))).toBe('Before\n\n| b |\n| - |\n| 2 |\n| 4 |\n\nAfter');
    expect(apply(s, deleteTable(s, t))).toBe('Before\n\n\nAfter');
    const single = table('| a |\n| - |\n| 1 |');
    expect(deleteColumn(single.table, 0)).toEqual([]);
  });

  it('aligns a table on request, by alignment, and is then stable', () => {
    const doc = '| a | Middle | r |\n|---|:-:|--:|\n| long text | x | 1 |';
    const { state: s, table: t } = table(doc);
    const aligned = apply(s, alignTable(s, t));
    expect(aligned).toBe(
      '| a         | Middle |   r |\n| --------- | :----: | --: |\n| long text |   x    |   1 |',
    );
    const again = table(aligned);
    expect(alignTable(again.state, again.table)).toEqual([]);
    expect(texts(aligned)).toEqual(texts(doc));
  });
});

describe('blocks of cells: set, cleared, copied and pasted (D-144)', () => {
  const DOC = '| Name    | Age |\n| ------- | --: |\n| Alex    | 30  |\n| Sam     | 41  |';

  it('sets a block of cells, only their bytes changed', () => {
    const { state: s, table: t } = table(DOC);
    expect(
      apply(
        s,
        setCells(s, t, 1, 0, [
          ['Ann', '7'],
          ['Bo', ''],
        ]),
      ),
    ).toBe('| Name    | Age |\n| ------- | --: |\n| Ann    | 7  |\n| Bo     |   |');
    // Beyond the table, without growing: left out.
    expect(apply(s, setCells(s, t, 2, 1, [['x', 'y', 'z'], ['w']]))).toBe(
      '| Name    | Age |\n| ------- | --: |\n| Alex    | 30  |\n| Sam     | x  |',
    );
  });

  it('clears a rectangle of cells in one change', () => {
    const { state: s, table: t } = table(DOC);
    expect(apply(s, clearCells(s, t, { top: 1, left: 0, bottom: 2, right: 1 }))).toBe(
      '| Name    | Age |\n| ------- | --: |\n|     |   |\n|      |   |',
    );
    expect(texts(apply(s, clearCells(s, t, { top: 0, left: 1, bottom: 2, right: 1 })))).toEqual([
      ['Name', ''],
      ['Alex', ''],
      ['Sam', ''],
    ]);
  });

  it('grows the table for a block larger than it, rows and columns in its style', () => {
    const { state: s, table: t } = table(DOC);
    const grown = apply(
      s,
      setCells(
        s,
        t,
        2,
        1,
        [
          ['a', 'b', 'c'],
          ['d', 'e', 'f'],
        ],
        true,
      ),
    );
    expect(texts(grown)).toEqual([
      ['Name', 'Age', '', ''],
      ['Alex', '30', '', ''],
      ['Sam', 'a', 'b', 'c'],
      ['', 'd', 'e', 'f'],
    ]);
    expect(grown.split('\n')[1]).toBe('| ------- | --: | --- | --- |');
    // Without edge pipes, and a short row filled past its end.
    const plain = table('a | b\n--- | ---\n1');
    expect(
      texts(apply(plain.state, setCells(plain.state, plain.table, 1, 0, [['x', 'y', 'z']], true))),
    ).toEqual([
      ['a', 'b', ''],
      ['x', 'y', 'z'],
    ]);
  });

  it('gives a short row only the cells it needs for text: clearing never lengthens it', () => {
    const { state: s, table: t } = table('| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 |');
    expect(apply(s, clearCells(s, t, { top: 1, left: 0, bottom: 2, right: 2 }))).toBe(
      '| a | b | c |\n| - | - | - |\n|  |\n|  |  |',
    );
    expect(
      apply(
        s,
        setCells(s, t, 1, 0, [
          ['x', '', 'z'],
          ['', ''],
        ]),
      ),
    ).toBe('| a | b | c |\n| - | - | - |\n| x |  | z |\n|  |  |');
  });

  it('writes an empty row with its edge pipes, so a table without them keeps its cells', () => {
    // `  |  ` would read as a leading pipe and no cells (GFM, and Lezer): a cell lost on a paste.
    const plain = table('a | b\n--- | ---\n1 | 2');
    const added = apply(plain.state, addRow(plain.table, 1));
    expect(added).toBe('a | b\n--- | ---\n1 | 2\n|  |  |');
    expect(texts(added)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['', ''],
    ]);
    expect(
      texts(
        apply(
          plain.state,
          setCells(
            plain.state,
            plain.table,
            1,
            0,
            [
              ['p', 'q'],
              ['r', 's'],
            ],
            true,
          ),
        ),
      ),
    ).toEqual([
      ['a', 'b'],
      ['p', 'q'],
      ['r', 's'],
    ]);
    const leadOnly = table('| a | b\n| - | -\n| 1 | 2');
    expect(texts(apply(leadOnly.state, addRow(leadOnly.table, 1)))[2]).toEqual(['', '']);
    // A row that is only its leading pipe (no cells): its first cell right after that pipe.
    const bare = table('| a | b |\n| - | - |\n|');
    expect(apply(bare.state, setCell(bare.state, bare.table, 1, 0, 'x'))).toBe(
      '| a | b |\n| - | - |\n| x',
    );
    expect(texts(apply(bare.state, addColumn(bare.table, 0)))[1]).toEqual(['']);
  });

  it('adds several columns in one pass, as adding them one at a time would', () => {
    const docs = [DOC, 'a | b\n--- | ---\n1 | 2\n3 |', '| a |\n|---|\n| 1 | extra |\n| 2 |'];
    for (const doc of docs) {
      const { state: s, table: t } = table(doc);
      for (const at of [1, t.columns]) {
        let one = doc;
        for (let step = 0; step < 3; step++) {
          const now = table(one);
          one = apply(now.state, addColumn(now.table, at));
        }
        expect(apply(s, addColumn(t, at, 3))).toBe(one);
      }
    }
  });

  it('sets, grows and clears thousands of rows in linear time (an Excel paste)', () => {
    const { state: s, table: t } = table('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    const block = Array.from({ length: 5000 }, (_, at) => [`r${at}`, 'x', 'y']);
    let started = performance.now();
    const grown = apply(s, setCells(s, t, 1, 0, block, true));
    expect(performance.now() - started).toBeLessThan(500);
    expect(grown.split('\n')).toHaveLength(5002);
    const wide = Array.from({ length: 3000 }, () => ['p', 'q', 'r', 's', 't']);
    started = performance.now();
    apply(s, setCells(s, t, 1, 1, wide, true));
    expect(performance.now() - started).toBeLessThan(500);
    const big = table(grown);
    started = performance.now();
    clearCells(big.state, big.table, { top: 1, left: 0, bottom: 5000, right: 2 });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('reads and writes tab-separated text as Excel and Sheets do', () => {
    expect(
      toTsv([
        ['a', 'b|c'],
        ['', 'd\te'],
      ]),
    ).toBe('a\tb|c\n\td e');
    expect(toTsv([['"quoted"', 'x']])).toBe('"""quoted"""\tx');
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseTsv('a\t\n\tb')).toEqual([
      ['a', ''],
      ['', 'b'],
    ]);
    expect(parseTsv('one\ntwo')).toEqual([['one'], ['two']]);
    // Excel quotes a cell with a line break, a tab or a leading quote.
    expect(parseTsv('"two\nlines"\t"say ""hi"""\tx')).toEqual([['two\nlines', 'say "hi"', 'x']]);
    expect(parseTsv(toTsv([['"quoted"', 'x']]))).toEqual([['"quoted"', 'x']]);
    // No tab and no line break: not a block (a paste into the cell as text).
    expect(parseTsv('just text')).toBeNull();
    expect(parseTsv('just text\r\n')).toBeNull();
  });

  it('reads pathological tab-separated text in linear time', () => {
    const inputs = [
      '"'.repeat(200_000),
      '"\t'.repeat(100_000),
      `"${'\t""'.repeat(70_000)}x`,
      `${'"a\t"b\n'.repeat(40_000)}"`,
      '\t'.repeat(200_000),
      '\r\n'.repeat(100_000) + 'x',
    ];
    for (const input of inputs) {
      const started = performance.now();
      parseTsv(input);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });

  it('writes cells as a GFM table, the first row its header', () => {
    expect(
      cellsMarkdown([
        ['a', 'b|c'],
        ['1', ''],
      ]),
    ).toBe('| a | b\\|c |\n| --- | --- |\n| 1 |  |');
    expect(cellTexts(table(DOC).table, { top: 1, left: 1, bottom: 2, right: 1 })).toEqual([
      ['30'],
      ['41'],
    ]);
  });
});

/**
 * D-154: what a cell set to `text` reads back as: trimmed, line breaks as spaces, and nothing else
 * changed, backslashes included, except that a `|` the text already escaped (after an odd run of
 * backslashes) reads as a plain `|`, as GFM shows it.
 */
function readsAs(text: string): string {
  let read = '';
  let backslashes = 0;
  for (const char of text.replace(/\r\n?|\n/g, ' ').trim()) {
    if (char === '|' && backslashes % 2 === 1) read = read.slice(0, -1);
    read += char;
    backslashes = char === '\\' ? backslashes + 1 : 0;
  }
  return read;
}

describe('backslashes and pipes in a cell (D-154)', () => {
  const DOC = '| a | b |\n| - | - |\n| x | y |';
  const write = (doc: string, text: string, row = 1, column = 0): string => {
    const { state: s, table: t } = table(doc);
    return apply(s, setCell(s, t, row, column, text));
  };

  it('writes backslashes as typed, and reads them back so, however often written', () => {
    for (const typed of ['C:\\', 'C:\\dir\\', '\\', 'x\\\\', 'a\\b', '\\\\server\\share']) {
      let doc = write(DOC, typed);
      expect(doc.split('\n')[2]).toBe(`| ${typed} | y |`);
      for (let again = 0; again < 3; again++) {
        const shown = table(doc).table.rows[1]?.cells[0]?.text ?? '';
        expect(shown).toBe(typed);
        doc = write(doc, shown);
      }
      expect(doc.split('\n')[2]).toBe(`| ${typed} | y |`);
    }
  });

  it('escapes a pipe once, after any backslashes; an escaped one stays escaped', () => {
    const cases: [typed: string, line: string, shown: string][] = [
      ['a|b', '| a\\|b | y |', 'a|b'],
      ['a\\\\|b', '| a\\\\\\|b | y |', 'a\\\\|b'],
      ['C:\\dir\\\\|x', '| C:\\dir\\\\\\|x | y |', 'C:\\dir\\\\|x'],
      // Already escaped: written as it is, read as a plain pipe (as GFM shows it).
      ['a\\|b', '| a\\|b | y |', 'a|b'],
      ['|', '| \\| | y |', '|'],
    ];
    for (const [typed, line, shown] of cases) {
      const doc = write(DOC, typed);
      expect(doc.split('\n')[2]).toBe(line);
      const read = table(doc).table;
      expect(read.rows[1]?.cells.map((cell) => cell.text)).toEqual([shown, 'y']);
      expect(write(doc, shown)).toBe(doc);
    }
  });

  it('puts a space between a trailing backslash and a pipe right after it', () => {
    expect(write('|a|b|\n|-|-|\n|x|y|', 'C:\\')).toBe('|a|b|\n|-|-|\n|C:\\ |y|');
    expect(write('|a|b|\n|-|-|\n|x|y|', 'C:\\\\')).toBe('|a|b|\n|-|-|\n|C:\\\\|y|');
    // The last cell of a row without its edge pipe has no pipe after it.
    expect(write('a | b\n--- | ---\nx | y', 'C:\\', 1, 1)).toBe('a | b\n--- | ---\nx | C:\\');
    expect(table('|a|b|\n|-|-|\n|C:\\ |y|').table.rows[1]?.cells.map((cell) => cell.text)).toEqual([
      'C:\\',
      'y',
    ]);
  });

  it('knows a real pipe from an escaped one, as a row reads it', () => {
    expect(hasRowPipe('a | b')).toBe(true);
    expect(hasRowPipe('a \\| b')).toBe(false);
    // An even run: the backslashes are text, the pipe is real (a cell ending in `C:\\`).
    expect(hasRowPipe('C:\\\\|y')).toBe(true);
    expect(hasRowPipe('a \\\\\\| b')).toBe(false);
    expect(hasRowPipe('|')).toBe(true);
    expect(hasRowPipe('no pipe')).toBe(false);
    expect(table('x|y\n---|---\nC:\\\\|y').table.rows[1]?.cells.map((c) => c.text)).toEqual([
      'C:\\\\',
      'y',
    ]);
  });

  it('copies cells as markdown that reads back as they are', () => {
    const markdown = cellsMarkdown([
      ['C:\\dir\\', 'a|b'],
      ['x\\\\|y', '\\'],
    ]);
    const read = table(markdown).table;
    expect(read.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['C:\\dir\\', 'a|b'],
      ['x\\\\|y', '\\'],
    ]);
  });
});

describe('writing a table back, randomised (D-141 Q10, Q13)', () => {
  const RUNS = Number(process.env['FLINT_EDITOR_FUZZ_RUNS'] ?? 300);
  const cellText = fc.string({
    unit: fc.constantFrom('a', 'ბ', ' ', '|', '*', '`', '1', '\\'),
    maxLength: 6,
  });
  const padding = fc.constantFrom('', ' ', '  ', '   ');
  const tableDoc = fc
    .record({
      columns: fc.integer({ min: 1, max: 4 }),
      rows: fc.integer({ min: 0, max: 4 }),
      edges: fc.boolean(),
      cells: fc.array(fc.tuple(padding, cellText, padding), { minLength: 30, maxLength: 30 }),
      // How many cells each body row lacks (a short row; only with edge pipes, D-144).
      short: fc.array(fc.nat({ max: 3 }), { minLength: 4, maxLength: 4 }),
    })
    .map(({ columns, rows, edges, cells, short }) => {
      let next = 0;
      const cell = (): string => {
        const [before, text, after] = cells[next++ % cells.length] ?? ['', '', ''];
        // D-154: written as Flint writes a cell, backslashes and all.
        const safe = escapeCell(text.trim());
        return `${before}${safe || 'x'}${after || ' '}`;
      };
      // A single column needs its edge pipes to be a table at all (else it is a heading).
      const piped = edges || columns === 1;
      const line = (parts: string[]): string => (piped ? `|${parts.join('|')}|` : parts.join('|'));
      const header = line(Array.from({ length: columns }, () => ` h${cell()}`));
      const delimiter = line(Array.from({ length: columns }, () => ' --- '));
      const body = Array.from({ length: rows }, (_, at) => {
        const count = piped ? columns - ((short[at] ?? 0) % columns) : columns;
        // A letter first, so no generated row starts like a block (the table would end there).
        return line(Array.from({ length: count }, () => ` b${cell()}`));
      });
      return [header, delimiter, ...body].join('\n');
    });

  it('a block of cells set or cleared: only those cells change, the shape stays (D-144)', () => {
    fc.assert(
      fc.property(
        tableDoc,
        fc.nat(),
        fc.nat(),
        fc.array(fc.array(cellText, { minLength: 1, maxLength: 4 }), {
          minLength: 1,
          maxLength: 4,
        }),
        fc.boolean(),
        (doc, rowPick, columnPick, block, clear) => {
          const { state: s, table: t } = table(doc);
          const row = rowPick % t.rows.length;
          const column = columnPick % t.columns;
          const width = Math.max(...block.map((cells) => cells.length));
          const rect = {
            top: row,
            left: column,
            bottom: Math.min(t.rows.length - 1, row + block.length - 1),
            right: Math.min(t.columns - 1, column + width - 1),
          };
          const inside = (r: number, c: number): boolean =>
            r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right;
          const result = apply(
            s,
            clear ? clearCells(s, t, rect) : setCells(s, t, row, column, block),
          );
          const after = table(result).table;
          // The shape stays: as many rows and columns.
          expect(after.columns).toBe(t.columns);
          expect(after.rows.length).toBe(t.rows.length);
          t.rows.forEach((before, r) =>
            before.cells.forEach((cell, c) => {
              const now = after.rows[r]?.cells[c];
              if (!now) throw new Error(`cell ${r}:${c} gone`);
              if (!inside(r, c)) {
                // Every other cell's bytes exactly as they were.
                expect(result.slice(now.from, now.to)).toBe(doc.slice(cell.from, cell.to));
                return;
              }
              const wanted = clear ? '' : (block[r - row]?.[c - column] ?? cell.text);
              // D-154: exactly as set, backslashes included.
              expect(now.text).toBe(readsAs(wanted));
            }),
          );
          // A short row gets only the cells it needs for text: clearing never lengthens it.
          t.rows.forEach((before, r) => {
            let needs = before.cells.length;
            for (let c = before.cells.length; c < t.columns; c++) {
              const wanted = clear || !inside(r, c) ? '' : (block[r - row]?.[c - column] ?? '');
              if (wanted.trim() !== '') needs = c + 1;
            }
            expect(after.rows[r]?.cells.length).toBe(needs);
          });
          // The delimiter row as it was.
          expect(result.slice(after.delimiter.from, after.delimiter.to)).toBe(
            doc.slice(t.delimiter.from, t.delimiter.to),
          );
        },
      ),
      { numRuns: RUNS },
    );
  }, 60_000);

  /** Any table: with or without edge pipes, short rows, in a quote or not, text around it or not. */
  const anyTableDoc = fc
    .record({
      columns: fc.integer({ min: 1, max: 4 }),
      rows: fc.integer({ min: 0, max: 4 }),
      edges: fc.boolean(),
      quote: fc.boolean(),
      around: fc.boolean(),
      cells: fc.array(fc.tuple(padding, cellText, padding), { minLength: 30, maxLength: 30 }),
      short: fc.array(fc.nat({ max: 3 }), { minLength: 4, maxLength: 4 }),
    })
    .map(({ columns, rows, edges, quote, around, cells, short }) => {
      let next = 0;
      const cell = (): string => {
        const [before, text, after] = cells[next++ % cells.length] ?? ['', '', ''];
        // D-154: written as Flint writes a cell, backslashes and all.
        const safe = escapeCell(text.trim());
        return `${before}${safe || 'x'}${after || ' '}`;
      };
      const piped = edges || columns === 1;
      const line = (parts: string[]): string => (piped ? `|${parts.join('|')}|` : parts.join('|'));
      const header = line(Array.from({ length: columns }, () => ` h${cell()}`));
      const delimiter = line(Array.from({ length: columns }, () => ' --- '));
      // A short row without edge pipes still has a pipe (a line without one would be read as a
      // row too, but as a paragraph's continuation where the table starts).
      const body = Array.from({ length: rows }, (_, at) => {
        const count = columns - ((short[at] ?? 0) % columns);
        return line(
          Array.from({ length: piped ? count : Math.max(2, count) }, () => ` b${cell()}`),
        );
      });
      const prefix = quote ? '> ' : '';
      const lines = [header, delimiter, ...body].map((each) => prefix + each).join('\n');
      return around ? `Before.\n\n${lines}\n\nAfter.\n` : lines;
    });

  it('a pasted block grows any table: every cell lands where it should, nothing else changes (D-144)', () => {
    fc.assert(
      fc.property(
        anyTableDoc,
        fc.nat(),
        fc.nat(),
        fc.array(fc.array(cellText, { minLength: 1, maxLength: 4 }), {
          minLength: 1,
          maxLength: 4,
        }),
        (doc, rowPick, columnPick, block) => {
          const { state: s, table: t } = table(doc);
          const row = rowPick % t.rows.length;
          const column = columnPick % t.columns;
          const width = Math.max(...block.map((cells) => cells.length));
          const result = apply(s, setCells(s, t, row, column, block, true));
          const after = table(result).table;
          // The text around the table as it was.
          expect(result.slice(0, after.from)).toBe(doc.slice(0, t.from));
          expect(result.slice(after.to)).toBe(doc.slice(t.to));
          expect(after.columns).toBe(Math.max(t.columns, column + width));
          expect(after.rows.length).toBe(Math.max(t.rows.length, row + block.length));
          for (let r = 0; r < after.rows.length; r++)
            for (let c = 0; c < after.columns; c++) {
              const inBlock = r >= row && r - row < block.length && c >= column;
              const given = inBlock ? block[r - row]?.[c - column] : undefined;
              const wanted = given ?? t.rows[r]?.cells[c]?.text ?? '';
              const now = after.rows[r]?.cells[c]?.text ?? '';
              if (!wanted.includes('\\') && !now.includes('\\')) expect(now).toBe(wanted.trim());
            }
        },
      ),
      { numRuns: RUNS },
    );
  }, 60_000);

  it('a cell set to the text it shows changes nothing, in any table (D-154)', () => {
    fc.assert(
      fc.property(anyTableDoc, (doc) => {
        const { state: s, table: t } = table(doc);
        t.rows.forEach((row, r) =>
          row.cells.forEach((cell, c) => {
            expect(apply(s, setCell(s, t, r, c, cell.text))).toBe(doc);
          }),
        );
      }),
      { numRuns: RUNS },
    );
  }, 60_000);

  it('changes only the edited cell: every other cell and byte stays as it was', () => {
    fc.assert(
      fc.property(tableDoc, fc.nat(), fc.nat(), cellText, (doc, rowPick, columnPick, text) => {
        const { state: s, table: t } = table(doc);
        const row = rowPick % t.rows.length;
        const column = columnPick % t.columns;
        const cell = t.rows[row]?.cells[column];
        if (!cell) return;
        const result = apply(s, setCell(s, t, row, column, text));
        // Outside the cell's range nothing changed.
        expect(result.slice(0, cell.from)).toBe(doc.slice(0, cell.from));
        expect(result.slice(result.length - (doc.length - cell.to))).toBe(doc.slice(cell.to));
        // The cell reads back as set (trimmed, line breaks as spaces); the others as before.
        // The table keeps its shape whatever is typed (also `\|` or a trailing backslash).
        expect(table(result).table.columns).toBe(t.columns);
        const before = texts(doc);
        const after = texts(result);
        // D-154: the cell reads back exactly as set (trimmed), backslashes included; set again to
        // what it reads, nothing changes (backslashes never double from one write to the next).
        expect(after[row]?.[column]).toBe(readsAs(text));
        const again = table(result);
        const rewritten = again.table.rows[row]?.cells[column];
        if (rewritten)
          expect(
            apply(again.state, setCell(again.state, again.table, row, column, rewritten.text)),
          ).toBe(result);
        after[row]?.splice(column, 1);
        before[row]?.splice(column, 1);
        expect(after).toEqual(before);
      }),
      { numRuns: RUNS },
    );
  }, 60_000);
});
