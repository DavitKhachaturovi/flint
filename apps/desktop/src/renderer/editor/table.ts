import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState, Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * GFM tables in the note editor (NOTE-10; D-141 Q9–Q11): a table's lines read into rows and cells
 * with their exact positions, and the edits Flint makes to them. Every edit writes back only the
 * bytes that change (Q10): a cell's text between its padding, a new row in the style of the row
 * above, a new column in the table's style; nothing is re-padded except by Align table, on
 * request. Pure on the document, so Vitest checks it.
 */

export type Align = 'left' | 'center' | 'right' | null;

export interface TableCell {
  /** The cell between its pipes (padding included). */
  readonly from: number;
  readonly to: number;
  /** Its text without the padding (equal, at `from`, for an empty cell). */
  readonly textFrom: number;
  readonly textTo: number;
  /** What the cell shows: `\|` read as `|`. */
  readonly text: string;
}

export interface TableRow {
  /** The line, without its line break. */
  readonly from: number;
  readonly to: number;
  readonly indent: string;
  /** Written with a pipe before the first cell / after the last. */
  readonly leading: boolean;
  readonly trailing: boolean;
  readonly cells: readonly TableCell[];
}

export interface ParsedTable {
  readonly from: number;
  readonly to: number;
  /** The header and the body rows, in order (the delimiter row apart). */
  readonly rows: readonly TableRow[];
  readonly delimiter: TableRow;
  /** The header's cell count: GFM's number of columns. */
  readonly columns: number;
  readonly align: readonly Align[];
}

/** A table row's line split into cells at its unescaped pipes. */
function readRow(doc: Text, lineNumber: number): TableRow {
  const line = doc.line(lineNumber);
  const text = line.text;
  const indent = /^[ \t]*/.exec(text)?.[0] ?? '';
  const end = text.replace(/[ \t]+$/, '').length;
  const pipes: number[] = [];
  for (let at = indent.length; at < end; at++) {
    if (text[at] === '\\') at++;
    else if (text[at] === '|') pipes.push(at);
  }
  const leading = pipes[0] === indent.length;
  const trailing = pipes.length > (leading ? 1 : 0) && pipes[pipes.length - 1] === end - 1;
  const bounds: [number, number][] = [];
  let start = leading ? indent.length + 1 : indent.length;
  for (const pipe of pipes.slice(leading ? 1 : 0)) {
    bounds.push([start, pipe]);
    start = pipe + 1;
  }
  if (!trailing && (start < end || pipes.length === 0)) bounds.push([start, text.length]);
  const cells = bounds.map(([from, to]): TableCell => {
    const raw = text.slice(from, to);
    const before = /^[ \t]*/.exec(raw)?.[0].length ?? 0;
    const after = /[ \t]*$/.exec(raw)?.[0].length ?? 0;
    const empty = before === raw.length;
    const textFrom = empty ? from : from + before;
    const textTo = empty ? from : to - after;
    return {
      from: line.from + from,
      to: line.from + to,
      textFrom: line.from + textFrom,
      textTo: line.from + textTo,
      text: text.slice(textFrom, textTo).replace(/\\\|/g, '|'),
    };
  });
  return { from: line.from, to: line.to, indent, leading, trailing, cells };
}

/** The table whose lines run from `from` to `to` (a GFM `Table` node's range). */
export function parseTable(doc: Text, from: number, to: number): ParsedTable | null {
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  if (last - first < 1) return null;
  const header = readRow(doc, first);
  const delimiter = readRow(doc, first + 1);
  const align = delimiter.cells.map((cell): Align => {
    const mark = cell.text.trim();
    const left = mark.startsWith(':');
    const right = mark.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
  const rows = [header];
  for (let at = first + 2; at <= last; at++) rows.push(readRow(doc, at));
  return {
    from: doc.line(first).from,
    to: doc.line(last).to,
    rows,
    delimiter,
    columns: header.cells.length,
    align,
  };
}

/** The table around a position (or null), as the editor's parser sees it. */
export function tableAt(state: EditorState, at: number): ParsedTable | null {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1);
    node;
    node = node.parent
  )
    if (node.name === 'Table') return parseTable(state.doc, node.from, node.to);
  return null;
}

/** Every table in the document (or in a range of it). */
export function tablesIn(state: EditorState, from = 0, to = state.doc.length): ParsedTable[] {
  const found: ParsedTable[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'Table') return undefined;
      const table = parseTable(state.doc, node.from, node.to);
      if (table) found.push(table);
      return false;
    },
  });
  return found;
}

/**
 * A cell's text as written: line breaks as spaces (a cell holds none, Q9) and every `|` escaped.
 * Backslashes right before a pipe, or at the end, are doubled, so no pipe ends up unescaped and
 * the table keeps its shape whatever is typed.
 */
export const escapeCell = (text: string): string =>
  text
    .replace(/\r\n?|\n/g, ' ')
    .replace(/(\\*)\|/g, (_match, slashes: string) => `${slashes}${slashes}\\|`)
    .replace(/\\+$/, (slashes) => slashes + slashes);

/** Text that would start a block (a list, a heading, a quote, a fence…) at the start of a line. */
const BLOCK_START = /^(?:[*+\->#=]|\d{1,9}[.)]|`{3}|~{3})/;

/**
 * Q10: a cell's text set, only its bytes changed: its padding kept; an empty cell gets one space on
 * each side; a short row grows up to the cell in its own style. `row` counts the header as 0.
 */
export function setCell(
  state: EditorState,
  table: ParsedTable,
  row: number,
  column: number,
  text: string,
): ChangeSpec[] {
  const target = table.rows[row];
  if (!target || column < 0) return [];
  // Spaces at the edges are padding, not text.
  const written = escapeCell(text.replace(/\r\n?|\n/g, ' ').trim());
  const cell = target.cells[column];
  if (cell) {
    if (cell.textFrom === cell.textTo) {
      // Empty: the whole cell, one space on each side.
      if (written === '') return [];
      return [{ from: cell.from, to: cell.to, insert: ` ${written} ` }];
    }
    if (state.doc.sliceString(cell.textFrom, cell.textTo) === written) return [];
    const changes: ChangeSpec[] = [{ from: cell.textFrom, to: cell.textTo, insert: written }];
    // Without its edge pipe, GFM can't write an empty first or last cell (the row would lose a
    // cell), nor a first cell that starts like a block (`* `, `- `, `# `, `1. `… would end the
    // table). There the row gets that pipe: the smallest change that keeps the table.
    if (column === 0 && !target.leading && (written === '' || BLOCK_START.test(written)))
      changes.push({ from: target.from + target.indent.length, insert: '|' });
    if (written === '' && column === target.cells.length - 1 && !target.trailing)
      changes.push({ from: target.to, insert: '|' });
    return changes;
  }
  const missing = column - target.cells.length;
  const insert = target.trailing
    ? `${'  |'.repeat(missing)} ${written} |`
    : ` |${'  |'.repeat(missing)} ${written}`;
  return [{ from: target.to, insert }];
}

/** An empty row in the style of `template`: its indent, pipes and cell widths. */
function emptyRow(template: TableRow, columns: number): string {
  const cells: string[] = [];
  for (let at = 0; at < columns; at++) {
    const model = template.cells[at];
    cells.push(' '.repeat(Math.max(2, model ? model.to - model.from : 2)));
  }
  const trailing = template.trailing || columns === 1 ? '|' : '';
  return `${template.indent}${template.leading ? '|' : ''}${cells.join('|')}${trailing}`;
}

/** Q11: a new body row after row `after` (0: right below the header), in the style of that row. */
export function addRow(table: ParsedTable, after: number): ChangeSpec[] {
  const template = table.rows[after];
  if (!template) return [];
  const at = after === 0 ? table.delimiter.to : template.to;
  return [{ from: at, insert: `\n${emptyRow(template, table.columns)}` }];
}

/** Q11: a body row deleted (never the header: `row` ≥ 1). */
export function deleteRow(table: ParsedTable, row: number): ChangeSpec[] {
  const target = table.rows[row];
  if (row < 1 || !target) return [];
  return [{ from: target.from - 1, to: target.to }];
}

/** Q11: a new column before column `at` (`columns`: at the end), in the table's style. */
export function addColumn(table: ParsedTable, at: number): ChangeSpec[] {
  if (at < 0 || at > table.columns) return [];
  // The delimiter row's style: `| --- |` or `|---|`.
  const spaced = table.delimiter.cells.some((cell) => cell.textFrom > cell.from);
  const changes: ChangeSpec[] = [];
  for (const row of [table.rows[0], table.delimiter, ...table.rows.slice(1)]) {
    if (!row) continue;
    const content = row === table.delimiter ? (spaced ? ' --- ' : '---') : '  ';
    const cell = row.cells[at];
    if (cell) changes.push({ from: cell.from, insert: `${content}|` });
    else if (at === row.cells.length)
      changes.push(
        row.trailing
          ? { from: row.to, insert: `${content}|` }
          : { from: row.to, insert: ` |${content}|` },
      );
  }
  return changes;
}

/** Q11: a column deleted, with one of its pipes (never the last column left). */
export function deleteColumn(table: ParsedTable, column: number): ChangeSpec[] {
  if (table.columns <= 1 || column < 0 || column >= table.columns) return [];
  const changes: ChangeSpec[] = [];
  for (const row of [table.rows[0], table.delimiter, ...table.rows.slice(1)]) {
    const cell = row?.cells[column];
    if (!row || !cell) continue;
    const next = row.cells[column + 1];
    if (next) changes.push({ from: cell.from, to: next.from });
    else changes.push({ from: cell.from - 1, to: cell.to });
  }
  return changes;
}

/** Q11: the whole table deleted, with one line break. */
export function deleteTable(state: EditorState, table: ParsedTable): ChangeSpec[] {
  if (table.to < state.doc.length) return [{ from: table.from, to: table.to + 1 }];
  return [{ from: Math.max(0, table.from - 1), to: table.to }];
}

/** East Asian wide characters and emoji take two columns in a monospace view. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;

/** A string's width in a monospace view (Align table pads to it). */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 2 : 1;
  return width;
}

/**
 * Q10: Align table, on request: every column padded to its widest cell, the delimiters' dashes to
 * match (`:---:` and `---:` columns padded on that side), the pipes as they were; no cell added or
 * removed, cells beyond the header kept as written. One change for the whole table, or none.
 */
export function alignTable(state: EditorState, table: ParsedTable): ChangeSpec[] {
  const doc = state.doc;
  const written = (cell: TableCell): string => doc.sliceString(cell.textFrom, cell.textTo);
  const widths: number[] = [];
  for (let column = 0; column < table.columns; column++) {
    let width = 3;
    for (const row of table.rows) {
      const cell = row.cells[column];
      if (cell) width = Math.max(width, displayWidth(written(cell)));
    }
    widths.push(width);
  }
  const pad = (text: string, column: number): string => {
    const space = Math.max(0, (widths[column] ?? 3) - displayWidth(text));
    const align = table.align[column] ?? null;
    if (align === 'right') return ' '.repeat(space) + text;
    if (align === 'center') {
      const left = Math.floor(space / 2);
      return ' '.repeat(left) + text + ' '.repeat(space - left);
    }
    return text + ' '.repeat(space);
  };
  const dashes = (column: number): string => {
    const width = widths[column] ?? 3;
    const align = table.align[column] ?? null;
    if (align === 'center') return `:${'-'.repeat(width - 2)}:`;
    if (align === 'right') return `${'-'.repeat(width - 1)}:`;
    if (align === 'left') return `:${'-'.repeat(width - 1)}`;
    return '-'.repeat(width);
  };
  const line = (row: TableRow, content: (cell: TableCell, column: number) => string): string => {
    const cells = row.cells.map((cell, column) =>
      column < table.columns ? ` ${content(cell, column)} ` : doc.sliceString(cell.from, cell.to),
    );
    return `${row.indent}${row.leading ? '|' : ''}${cells.join('|')}${row.trailing ? '|' : ''}`;
  };
  const [header, ...body] = table.rows;
  if (!header) return [];
  const lines = [
    line(header, (cell, column) => pad(written(cell), column)),
    line(table.delimiter, (_cell, column) => dashes(column)),
    ...body.map((row) => line(row, (cell, column) => pad(written(cell), column))),
  ];
  const next = lines.join('\n');
  if (next === doc.sliceString(table.from, table.to)) return [];
  return [{ from: table.from, to: table.to, insert: next }];
}
