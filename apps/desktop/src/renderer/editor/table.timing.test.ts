import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { describe, it } from 'vitest';
import { expectLinear } from '../../../../../packages/core/test/scaling.js';
import { parseFully } from './preview-checks.js';
import { NOTE_SYNTAX } from './syntax.js';
import {
  clearCells,
  containerPrefix,
  parseTsv,
  setCells,
  tablesIn,
  type ParsedTable,
} from './table.js';

/**
 * D-156: the table model's linear-time checks, in the timing pass (`npm test` runs it after the
 * other tests, one file at a time, so no other test takes the CPU while these measure), each
 * judged by how its time grows from n to 4n (`expectLinear`), not by a wall-clock limit.
 */

function table(doc: string): { state: EditorState; table: ParsedTable } {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [...NOTE_SYNTAX] })],
  });
  parseFully(state);
  const found = tablesIn(state)[0];
  if (!found) throw new Error('no table');
  return { state, table: found };
}
const apply = (s: EditorState, changes: ChangeSpec[]): string =>
  s.update({ changes }).state.doc.toString();

describe('the table model in linear time (NOTE-10, D-144)', () => {
  it('reads a line’s container prefix in one pass', () => {
    expectLinear((n) => `${' \t>'.repeat(n / 3)}x`, containerPrefix, 200_000);
    expectLinear((n) => ' '.repeat(n), containerPrefix, 200_000);
  });

  it('sets, grows and clears thousands of rows (an Excel paste)', () => {
    const { state: s, table: t } = table('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    const rows = (n: number): string[][] =>
      Array.from({ length: n }, (_, at) => [`r${at}`, 'x', 'y']);
    expectLinear(rows, (block) => apply(s, setCells(s, t, 1, 0, block, true)), 1250);
    expectLinear(
      (n) => Array.from({ length: n }, () => ['p', 'q', 'r', 's', 't']),
      (wide) => apply(s, setCells(s, t, 1, 1, wide, true)),
      750,
    );
    expectLinear(
      (n) => table(apply(s, setCells(s, t, 1, 0, rows(n), true))),
      (big) =>
        clearCells(big.state, big.table, {
          top: 1,
          left: 0,
          bottom: big.table.rows.length - 1,
          right: 2,
        }),
      1250,
    );
  }, 60_000);

  it('reads pathological tab-separated text', () => {
    const shapes: ((n: number) => string)[] = [
      (n) => '"'.repeat(n),
      (n) => '"\t'.repeat(n / 2),
      // D-156: one quoted cell holding nearly all the text: built a character at a time, it grew
      // superlinearly (5, 7, then 26 times from n to 4n as n grew); now in pieces, joined once.
      (n) => `"${'\t""'.repeat(Math.ceil(n / 3))}x`,
      (n) => '\t'.repeat(n),
    ];
    for (const shape of shapes) expectLinear(shape, parseTsv, 40_000);
    // A row for every line: compared with a loop that only builds those rows (the garbage
    // collector's share grows faster than the text either way).
    const rowsOnly = (text: string): string[][] => {
      const rows: string[][] = [[]];
      for (let at = 0; at < text.length; at++)
        if (text[at] === '\n') {
          rows[rows.length - 1]?.push('');
          rows.push([]);
        }
      return rows;
    };
    for (const shape of [
      (n: number) => `${'"a\t"b\n'.repeat(Math.ceil(n / 5))}"`,
      (n: number) => '\r\n'.repeat(n / 2) + 'x',
    ])
      expectLinear(shape, parseTsv, 40_000, { baseline: rowsOnly });
  }, 120_000);
});
