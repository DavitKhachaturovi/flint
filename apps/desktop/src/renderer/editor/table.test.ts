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
  deleteColumn,
  deleteRow,
  deleteTable,
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
    })
    .map(({ columns, rows, edges, cells }) => {
      let next = 0;
      const cell = (): string => {
        const [before, text, after] = cells[next++ % cells.length] ?? ['', '', ''];
        const safe = text.replace(/\\/g, '').replace(/\|/g, '\\|');
        return `${before}${safe || 'x'}${after || ' '}`;
      };
      // A single column needs its edge pipes to be a table at all (else it is a heading).
      const piped = edges || columns === 1;
      const line = (parts: string[]): string => (piped ? `|${parts.join('|')}|` : parts.join('|'));
      const header = line(Array.from({ length: columns }, () => ` h${cell()}`));
      const delimiter = line(Array.from({ length: columns }, () => ' --- '));
      const body = Array.from({ length: rows }, () =>
        // A letter first, so no generated row starts like a block (the table would end there).
        line(Array.from({ length: columns }, () => ` b${cell()}`)),
      );
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
              if (!wanted.includes('\\') && !cell.text.includes('\\'))
                expect(now.text).toBe(wanted.trim());
            }),
          );
          // The delimiter row as it was.
          expect(result.slice(after.delimiter.from, after.delimiter.to)).toBe(
            doc.slice(t.delimiter.from, t.delimiter.to),
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

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
        // Without backslashes the cell reads back exactly as set (trimmed).
        if (!text.includes('\\')) expect(after[row]?.[column]).toBe(text.trim());
        after[row]?.splice(column, 1);
        before[row]?.splice(column, 1);
        expect(after).toEqual(before);
      }),
      { numRuns: RUNS },
    );
  });
});
