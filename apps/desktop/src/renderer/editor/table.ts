import { syntaxTree } from '@codemirror/language';
import { ChangeSet, type ChangeSpec, type EditorState, Text } from '@codemirror/state';
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
  /** What comes before its first cell: indentation, and in a quote the quote's marks (`> `). */
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

/**
 * A line's container prefix: its indentation and, in a quote, the quote's marks (`> `, `>> `). A
 * table's rows start after it (a line starting with `>` is never a row of a table outside a quote).
 * One pass, no regular expression (a nested quantifier would be flagged as polynomial, D-143).
 */
export function containerPrefix(line: string): string {
  let at = 0;
  for (;;) {
    while (line[at] === ' ' || line[at] === '\t') at++;
    if (line[at] !== '>') return line.slice(0, at);
    at++;
  }
}

/** A table row's line split into cells at its unescaped pipes. */
function readRow(doc: Text, lineNumber: number): TableRow {
  const line = doc.line(lineNumber);
  const text = line.text;
  const indent = containerPrefix(text);
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

/** The table around a position (or null), as the editor's parser sees it (or `tree`, a fuller
 * parse of the same state). A position in its line's container prefix (a quote's `> `) counts as
 * the line's: a table in a quote starts at its first line's start, as other tables do (D-144). */
export function tableAt(
  state: EditorState,
  at: number,
  tree = syntaxTree(state),
): ParsedTable | null {
  const line = state.doc.lineAt(at);
  const from = Math.max(at, line.from + containerPrefix(line.text).length);
  for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent)
    if (node.name === 'Table') return parseTable(state.doc, node.from, node.to);
  return null;
}

/** A row's line written with a pipe that isn't escaped (`\|`): a line meant as a table row. */
export const hasRowPipe = (line: string): boolean => /(?:^|[^\\])\|/.test(line);

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
  state: { readonly doc: Text },
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
    : `${opensCell(target) ? '' : ' |'}${'  |'.repeat(missing)} ${written}`;
  return [{ from: target.to, insert }];
}

/**
 * An empty row in the style of `template`: its indent and cell widths, and always both edge pipes
 * (D-144, Proposed): GFM can't write an empty first or last cell without its edge pipe (`  |  `
 * reads as a leading pipe and no cells), as `setCell` says.
 */
function emptyRow(template: TableRow, columns: number): string {
  const cells: string[] = [];
  for (let at = 0; at < columns; at++) {
    const model = template.cells[at];
    cells.push(' '.repeat(Math.max(2, model ? model.to - model.from : 2)));
  }
  return `${template.indent}|${cells.join('|')}|`;
}

/** Before a cell added at a row's end: a pipe, unless the row's leading pipe opens it (no cells). */
const opensCell = (row: TableRow): boolean =>
  row.trailing || (row.leading && row.cells.length === 0);

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

/**
 * Q11: a new column before column `at` (`columns`: at the end), in the table's style. With `count`,
 * that many (D-144: a pasted block's), in one pass: the same bytes as adding them one at a time.
 */
export function addColumn(table: ParsedTable, at: number, count = 1): ChangeSpec[] {
  if (at < 0 || at > table.columns || count < 1) return [];
  // The delimiter row's style: `| --- |` or `|---|`.
  const spaced = table.delimiter.cells.some((cell) => cell.textFrom > cell.from);
  const changes: ChangeSpec[] = [];
  for (const row of [table.rows[0], table.delimiter, ...table.rows.slice(1)]) {
    if (!row) continue;
    const content = row === table.delimiter ? (spaced ? ' --- ' : '---') : '  ';
    const cell = row.cells[at];
    const more = `${content}|`.repeat(count);
    if (cell) changes.push({ from: cell.from, insert: more });
    else if (at === row.cells.length)
      changes.push({ from: row.to, insert: opensCell(row) ? more : ` |${more}` });
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

/** A rectangle of cells: its first and last row (the header is 0) and column. */
export interface CellRect {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/**
 * D-144: one row's cells from `column` on set to `cells` (up to the table's `columns`), worked out
 * on the row's line alone: the changes, from the line's start. The cells the row hasn't got come
 * first, left to right, and only for text (an empty one would add bytes for nothing); then the
 * cells it has, right to left, so each change leaves the cells before it where they were and one
 * reading of the line serves them all.
 */
function rowCells(
  table: ParsedTable,
  line: string,
  column: number,
  cells: readonly string[],
  columns: number,
): { from: number; to: number; insert: string }[] {
  let doc = Text.of([line]);
  let set = ChangeSet.empty(doc.length);
  const write = (row: TableRow, at: number, text: string): void => {
    const specs = setCell({ doc }, { ...table, rows: [row] }, 0, at, text);
    if (specs.length === 0) return;
    const next = ChangeSet.of(specs, doc.length);
    set = set.compose(next);
    doc = next.apply(doc);
  };
  const end = Math.min(cells.length, columns - column);
  let read = readRow(doc, 1);
  const had = read.cells.length;
  for (let dx = Math.max(0, had - column); dx < end; dx++) {
    const text = cells[dx] ?? '';
    if (text.trim() === '') continue;
    write(read, column + dx, text);
    read = readRow(doc, 1);
  }
  for (let dx = Math.min(end, had - column) - 1; dx >= 0; dx--)
    write(read, column + dx, cells[dx] ?? '');
  const changes: { from: number; to: number; insert: string }[] = [];
  set.iterChanges((from, to, _fromB, _toB, inserted) =>
    changes.push({ from, to, insert: inserted.toString() }),
  );
  return changes;
}

/**
 * D-144: cells from (`row`, `column`) on set to `values` (rows of cells), as one change: each cell
 * written as `setCell` writes it, so only those cells' bytes change (a cell a short row hasn't got
 * is written only for text). With `grow` (a pasted block larger than the table, Proposed), the
 * columns and rows it needs are added at the end first, each in the table's style (`addColumn`,
 * `addRow`), in one pass each; without it, what falls outside the table is left out. Each row is
 * worked out on its own line and the rows' changes are put together once, in order: linear in
 * the number of rows (a large paste from Excel), whatever the table's length.
 */
export function setCells(
  state: { readonly doc: Text },
  table: ParsedTable,
  row: number,
  column: number,
  values: readonly (readonly string[])[],
  grow = false,
): ChangeSpec[] {
  if (row < 0 || column < 0) return [];
  let doc = state.doc;
  let set = ChangeSet.empty(doc.length);
  let from = table.from;
  let to = table.to;
  let current: ParsedTable | null = table;
  const apply = (specs: readonly ChangeSpec[]): void => {
    const next = ChangeSet.of(specs, doc.length);
    set = set.compose(next);
    from = next.mapPos(from, -1);
    to = next.mapPos(to, 1);
    doc = next.apply(doc);
    current = parseTable(doc, from, to);
  };
  const width = Math.max(0, ...values.map((cells) => cells.length));
  if (grow) {
    const more = current ? column + width - current.columns : 0;
    if (current && more > 0) {
      const specs = addColumn(current, current.columns, more);
      if (specs.length > 0) apply(specs);
    }
    const missing = current ? row + values.length - current.rows.length : 0;
    if (current && missing > 0) {
      // The new rows in one insertion, each as `addRow` writes one after the last row.
      const [one] = addRow(current, current.rows.length - 1) as { from: number; insert: string }[];
      if (one) apply([{ from: one.from, insert: one.insert.repeat(missing) }]);
    }
  }
  const base: ParsedTable | null = current;
  if (!base) return set.empty ? [] : [set];
  // Rows touch their own lines only: each row's changes, in order, then one change set of them.
  const specs: ChangeSpec[] = [];
  values.forEach((cells, dy) => {
    const target = base.rows[row + dy];
    if (!target) return;
    const line = doc.sliceString(target.from, target.to);
    for (const change of rowCells(base, line, column, cells, base.columns))
      specs.push({
        from: target.from + change.from,
        to: target.from + change.to,
        insert: change.insert,
      });
  });
  if (specs.length > 0) set = set.compose(ChangeSet.of(specs, doc.length));
  return set.empty ? [] : [set];
}

/** D-144: the cells of a rectangle emptied, as one change (only their bytes change). */
export function clearCells(
  state: { readonly doc: Text },
  table: ParsedTable,
  rect: CellRect,
): ChangeSpec[] {
  const values = Array.from({ length: rect.bottom - rect.top + 1 }, () =>
    Array.from({ length: rect.right - rect.left + 1 }, () => ''),
  );
  return setCells(state, table, rect.top, rect.left, values);
}

/** The shown text of a rectangle's cells (an empty string for a cell a short row hasn't got). */
export function cellTexts(table: ParsedTable, rect: CellRect): string[][] {
  const rows: string[][] = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    const cells: string[] = [];
    for (let column = rect.left; column <= rect.right; column++)
      cells.push(table.rows[row]?.cells[column]?.text ?? '');
    rows.push(cells);
  }
  return rows;
}

/**
 * D-144: cells as tab-separated text, the clipboard format Excel and Sheets read: rows by `\n`,
 * cells by `\t`. A tab or line break in a cell is a space; a cell starting with `"` is quoted (its
 * quotes doubled), since Excel reads a field starting with one as quoted.
 */
export function toTsv(rows: readonly (readonly string[])[]): string {
  const field = (text: string): string => {
    const flat = text.replace(/[\t\r\n]/g, ' ');
    return flat.startsWith('"') ? `"${flat.replace(/"/g, '""')}"` : flat;
  };
  return rows.map((cells) => cells.map(field).join('\t')).join('\n');
}

/**
 * D-144: tab-separated text (copied from Excel, Sheets or a Flint table) read into rows of cells,
 * or null when the text has neither a tab nor a line break (a paste into one cell, as text). Rows
 * end at `\n` or `\r\n`, one line break at the end is dropped, cells end at `\t`. A field that
 * starts with `"` is read as Excel reads one: quoted up to the next lone `"` (`""` is a `"`; tabs
 * and line breaks inside it are the cell's), then as written up to the next tab or line break.
 * One pass over the text, never going back: linear time whatever it holds.
 */
export function parseTsv(text: string): string[][] | null {
  let source = text.replace(/\r\n?/g, '\n');
  if (source.endsWith('\n')) source = source.slice(0, -1);
  if (!source.includes('\t') && !source.includes('\n')) return null;
  const rows: string[][] = [[]];
  let at = 0;
  for (;;) {
    let field = '';
    if (source[at] === '"') {
      at++;
      while (at < source.length) {
        if (source[at] !== '"') field += source.charAt(at++);
        else if (source[at + 1] === '"') {
          field += '"';
          at += 2;
        } else {
          at++;
          break;
        }
      }
    }
    let end = at;
    while (end < source.length && source[end] !== '\t' && source[end] !== '\n') end++;
    field += source.slice(at, end);
    at = end;
    rows[rows.length - 1]?.push(field);
    if (at >= source.length) break;
    if (source[at] === '\n') rows.push([]);
    at++;
  }
  return rows;
}

/**
 * D-144: cells as a GFM table, its first row the header (Ctrl+C's markdown, beside the
 * tab-separated text): every cell escaped as `setCell` writes one, a `---` under each column.
 */
export function cellsMarkdown(rows: readonly (readonly string[])[]): string {
  const width = Math.max(1, ...rows.map((cells) => cells.length));
  const line = (cells: readonly string[]): string =>
    `|${Array.from({ length: width }, (_, at) => ` ${escapeCell((cells[at] ?? '').trim())} `).join('|')}|`;
  const [header = [], ...body] = rows;
  return [line(header), `|${' --- |'.repeat(width)}`, ...body.map(line)].join('\n');
}

/** D-144: markdown that is a table as `cellsMarkdown` writes one (a row, then `| --- |…`). */
export function isCellsMarkdown(text: string): boolean {
  const [header = '', delimiter = ''] = text.split('\n', 2);
  return hasRowPipe(header) && /^[|:\- ]+$/.test(delimiter) && delimiter.includes('-');
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
