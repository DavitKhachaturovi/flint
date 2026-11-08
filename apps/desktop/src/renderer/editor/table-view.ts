import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  Annotation,
  ChangeSet,
  type ChangeSpec,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Range,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
} from '@codemirror/view';
import { titleHtml } from '../../shared/inline-markdown.js';
import { durationMs, nudgeElement, reducedMotion } from '../ui/motion.js';
import { announceConfirm, announceUndo } from '../media/media.js';
import { openMenu, type MenuEntry } from '../menu/menu.js';
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
  hasRowPipe,
  parseTable,
  parseTsv,
  setCell,
  setCells,
  tableAt,
  tablesIn,
  toTsv,
  type CellRect,
  type ParsedTable,
  type TableCell,
} from './table.js';

/**
 * Tables drawn and edited in the note editor (NOTE-10; D-141 Q9). A table is a block widget; the
 * cell the note's caret is in is the active one and gets a small editor of its own, whose every
 * keystroke is a change to the note's text (`setCell`), so undo, find and copy work on the note.
 * The note's selection is the truth: moving it into a cell (a click, Tab, ↑ from below, a match of
 * Ctrl+F) makes that cell active. Edit markdown (Q9) shows a table raw until the caret leaves it.
 */

/** Where a caret is in a table: the row (the header is 0) and the column. */
export interface CellAt {
  readonly table: ParsedTable;
  readonly row: number;
  readonly column: number;
}

/** The cell around a position, if the position is in a table. */
export function cellAt(state: EditorState, at: number): CellAt | null {
  const table = tableAt(state, at);
  if (!table || at < table.from || at > table.to) return null;
  const lineFrom = state.doc.lineAt(at).from;
  let row = table.rows.findIndex((each) => each.from === lineFrom);
  // On the delimiter row: the first body row, else the header.
  if (row < 0) row = table.rows.length > 1 ? 1 : 0;
  const cells = table.rows[row]?.cells ?? [];
  let column = cells.findIndex((cell) => at >= cell.from && at <= cell.to);
  if (column < 0) column = at < (cells[0]?.from ?? 0) ? 0 : Math.max(0, cells.length - 1);
  return { table, row, column: Math.min(column, Math.max(0, table.columns - 1)) };
}

/** The position in the note for an offset into a cell's shown text (`\|` counts as one). */
export function cellPosition(
  state: { readonly doc: Text },
  cell: TableCell | undefined,
  row: number,
  table: ParsedTable,
  offset: number | 'end',
): number {
  if (!cell) return table.rows[row]?.to ?? table.to;
  if (cell.textFrom === cell.textTo) return Math.min(cell.from + 1, cell.to);
  const raw = state.doc.sliceString(cell.textFrom, cell.textTo);
  if (offset === 'end') return cell.textTo;
  let shown = 0;
  let at = 0;
  while (at < raw.length && shown < offset) {
    at += raw[at] === '\\' && raw[at + 1] === '|' ? 2 : 1;
    shown++;
  }
  return cell.textFrom + at;
}

/** The offset into a cell's shown text for a position in the note. */
function cellOffset(state: EditorState, cell: TableCell, at: number): number {
  if (at <= cell.textFrom) return 0;
  const raw = state.doc.sliceString(cell.textFrom, Math.min(at, cell.textTo));
  return raw.replace(/\\\|/g, '|').length;
}

/** Q9: Edit markdown shows this table raw (its position) until the caret leaves it. */
export const showTableMarkdown = StateEffect.define<number>();

/**
 * D-144 (Proposed): typing in the note that puts its caret into a table it wasn't in (a row typed
 * under a table, `|` first) shows that table raw, as Edit markdown does, until the caret leaves:
 * the caret stays where the keys go and no cell takes the focus mid-word. Not a table Flint just
 * made (Insert ▸ Table, drawn at once), nor the table's own edits (the caret was in it already).
 */
function typedIntoTable(tr: Transaction): number | null {
  if (!tr.docChanged || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return null;
  if (tr.isUserEvent('input.format') || tr.isUserEvent('input.table')) return null;
  if (tr.isUserEvent('delete.table')) return null;
  if (cellAt(tr.startState, tr.startState.selection.main.head)) return null;
  const head = tr.state.selection.main.head;
  // From its line's start: a caret at the table's very end is in it too.
  const lineFrom = tr.state.doc.lineAt(head).from;
  const table = tableAt(tr.state, lineFrom);
  if (!table || head < table.from || head > table.to) return null;
  const before = tr.changes.invert(tr.startState.doc).mapPos(table.from);
  return tableAt(tr.startState, before)?.from === before ? lineFrom : null;
}

const rawTable = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let raw = value === null ? null : tr.changes.mapPos(value);
    for (const effect of tr.effects) if (effect.is(showTableMarkdown)) raw = effect.value;
    raw ??= typedIntoTable(tr);
    if (raw === null) return null;
    const table = tableAt(tr.state, raw);
    const head = tr.state.selection.main.head;
    return table && head >= table.from && head <= table.to ? raw : null;
  },
});

/** A cell's place in a table: its row (the header is 0) and column. */
export interface CellPlace {
  readonly row: number;
  readonly column: number;
}

/**
 * D-144: a rectangle of cells selected in a table: from its anchor, the active cell (which keeps
 * the ring and the focus), to its head. `from` is the table's start.
 */
export interface CellRange {
  readonly from: number;
  readonly anchor: CellPlace;
  readonly head: CellPlace;
}

/** Sets (or, with null, clears) the selected cells. */
const setCellRange = StateEffect.define<CellRange | null>();

/** A change made on the selected cells themselves (cleared, filled by a paste): they stay. */
const onRange = Annotation.define<boolean>();

const samePlace = (a: CellPlace, b: CellPlace): boolean => a.row === b.row && a.column === b.column;

/** The rectangle a range covers. */
export const rectOf = (range: CellRange): CellRect => ({
  top: Math.min(range.anchor.row, range.head.row),
  bottom: Math.max(range.anchor.row, range.head.row),
  left: Math.min(range.anchor.column, range.head.column),
  right: Math.max(range.anchor.column, range.head.column),
});

/**
 * D-144: the selected cells. They last while the note's caret stays in the anchor cell and the
 * note's text changes only through them (Delete, a paste): a click elsewhere, a key that moves the
 * caret, typing or an undo clears them. A range of one cell is none.
 */
const cellRange = StateField.define<CellRange | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    let set = false;
    for (const effect of tr.effects)
      if (effect.is(setCellRange)) {
        next = effect.value;
        set = true;
      }
    if (!next) return null;
    if (!set && tr.docChanged && !tr.annotation(onRange)) return null;
    if (!set && !tr.docChanged && !tr.selection) return next;
    const selection = tr.state.selection.main;
    const here = selection.empty ? cellAt(tr.state, selection.head) : null;
    const from = set ? next.from : tr.changes.mapPos(next.from, -1);
    if (!here || here.table.from !== from || !samePlace(here, next.anchor)) return null;
    const head = {
      row: Math.max(0, Math.min(next.head.row, here.table.rows.length - 1)),
      column: Math.max(0, Math.min(next.head.column, here.table.columns - 1)),
    };
    if (samePlace(head, next.anchor)) return null;
    return { from, anchor: next.anchor, head };
  },
});

/** The selected cells in a view, with their table as it is now. */
function selectedCells(view: EditorView): { range: CellRange; table: ParsedTable } | null {
  const range = view.state.field(cellRange, false) ?? null;
  const table = range ? tableAt(view.state, range.from) : null;
  return range && table && table.from === range.from ? { range, table } : null;
}

/** Selects the cells from the active one (`anchor`) to `head`; the same cell: none. */
function selectCells(view: EditorView, from: number, anchor: CellPlace, head: CellPlace): void {
  const now = view.state.field(cellRange, false) ?? null;
  const next = samePlace(anchor, head) ? null : { from, anchor, head };
  if (now === null && next === null) return;
  if (
    now &&
    next &&
    now.from === from &&
    samePlace(now.anchor, anchor) &&
    samePlace(now.head, head)
  )
    return;
  view.dispatch({ effects: setCellRange.of(next) });
}

/** Clears the selection of cells (not their text); false if there was none. */
function dropCells(view: EditorView): boolean {
  if (!view.state.field(cellRange, false)) return false;
  view.dispatch({ effects: setCellRange.of(null) });
  return true;
}

/**
 * D-144: Delete (and Backspace, Ctrl+X, the palette) on selected cells: their text cleared in one
 * change (one undo step), at once, with an Undo toast as the table's other deletes (Q11). The
 * cells stay selected. False if no cells are selected.
 */
export function clearSelectedCells(view: EditorView): boolean {
  const selected = selectedCells(view);
  if (!selected) return false;
  const changes = clearCells(view.state, selected.table, rectOf(selected.range));
  if (changes.length === 0) return true;
  // Its own undo step: never joined with typing just before (a `delete` event would be).
  view.dispatch({
    changes,
    userEvent: 'delete.table',
    annotations: [onRange.of(true), isolateHistory.of('full')],
  });
  offerUndo(view, 'Cells cleared');
  return true;
}

/** D-144: the table's Undo toast still up, if any: the editor it is for, the way to take it away. */
let undoToast: { readonly view: EditorView; readonly hide: () => void } | null = null;

/**
 * Q11, D-144: a table's delete with the window's Undo toast. Its Undo takes back the note's last
 * step, so the toast goes as soon as the note changes again (Proposed: it would take back
 * something else); after it, the note has the keys again (the active cell's editor, if any).
 */
function offerUndo(view: EditorView, text: string): void {
  undoToast?.hide();
  const hide = announceUndo(text, () => {
    undoToast = null;
    view.focus();
    undo(view);
    requestAnimationFrame(() => {
      const cell = view.dom.querySelector<HTMLElement>('.cm-fl-cell-active .cm-content');
      if (cell && !cell.contains(document.activeElement)) cell.focus();
    });
  });
  undoToast = { view, hide };
}

/** D-144: the note changed again (typing, an undo, a change from outside): its Undo toast goes. */
const closeUndoToast = EditorView.updateListener.of((update) => {
  if (!update.docChanged || undoToast?.view !== update.view) return;
  undoToast.hide();
  undoToast = null;
});

/**
 * D-144 (Proposed): Ctrl+C on selected cells: tab-separated text as the plain text (Excel and
 * Sheets paste it as cells; a Flint cell fills cells from it), and the same cells as a GFM table
 * in `text/markdown` (a Flint note pastes it as a table). No `text/html`: Excel would take it
 * over the plain text, with its own idea of the look. False if no cells are selected.
 */
function copySelectedCells(view: EditorView, data: DataTransfer): boolean {
  const selected = selectedCells(view);
  if (!selected) return false;
  const cells = cellTexts(selected.table, rectOf(selected.range));
  data.clearData();
  data.setData('text/plain', toTsv(cells));
  data.setData('text/markdown', cellsMarkdown(cells));
  return true;
}

/**
 * D-144: tab-separated text (rows by line breaks, cells by tabs) pasted into a cell fills the
 * cells from there (from the selected cells' top left corner, if any), in one change; a block
 * larger than the table grows it (Proposed). The filled cells are selected afterwards, the caret
 * in the first. False for text that isn't a block (no tab, no line break): it goes into the cell.
 */
function pasteCells(view: EditorView, here: CellAt, text: string): boolean {
  const grid = parseTsv(text);
  if (!grid) return false;
  const selected = selectedCells(view);
  const rect = selected ? rectOf(selected.range) : null;
  const start = rect
    ? { row: rect.top, column: rect.left }
    : { row: here.row, column: here.column };
  const table = selected?.table ?? here.table;
  const width = Math.max(...grid.map((cells) => cells.length));
  const changes = setCells(view.state, table, start.row, start.column, grid, true);
  const set = view.state.changes(changes);
  const from = set.mapPos(table.from, -1);
  const doc = set.apply(view.state.doc);
  const after = parseTable(doc, from, set.mapPos(table.to, 1));
  if (!after) return true;
  const wider = after.columns > table.columns;
  if (after.rows.length > table.rows.length)
    added = {
      from,
      axis: 'rows',
      first: table.rows.length,
      last: after.rows.length - 1,
      ...(wider ? { columns: { first: table.columns, last: after.columns - 1 } } : {}),
    };
  else if (wider) added = { from, axis: 'columns', first: table.columns, last: after.columns - 1 };
  const end = {
    row: Math.min(after.rows.length - 1, start.row + grid.length - 1),
    column: Math.min(after.columns - 1, start.column + width - 1),
  };
  // The caret goes into a corner of the filled cells that its row has (a short row gets only the
  // cells it needs for text, D-144): the top left one if it can, the far corner the selection's
  // head, so the same cells are selected.
  const corners: [CellPlace, CellPlace][] = [
    [start, end],
    [
      { row: start.row, column: end.column },
      { row: end.row, column: start.column },
    ],
    [
      { row: end.row, column: start.column },
      { row: start.row, column: end.column },
    ],
    [end, start],
  ];
  const [anchor, head] = corners.find(
    ([place]) => after.rows[place.row]?.cells[place.column] !== undefined,
  ) ?? [start, end];
  const cell = after.rows[anchor.row]?.cells[anchor.column];
  view.dispatch({
    changes: set,
    selection: { anchor: cellPosition({ doc }, cell, anchor.row, after, 'end') },
    effects: setCellRange.of(samePlace(anchor, head) ? null : { from, anchor, head }),
    // One undo step of its own, never joined with typing before or after it.
    annotations: [onRange.of(true), isolateHistory.of('full')],
    userEvent: 'input.table',
    scrollIntoView: true,
  });
  return true;
}

/** Changes made by the table itself (a cell's editor following the note), not by typing. */
const fromNote = Annotation.define<boolean>();

/** Set when a key in a cell moves to another cell, so the new cell's editor takes the focus. */
let focusNextCell = false;

/** The table's widget: its cells, and the active cell's editor. */
class TableWidget extends WidgetType {
  readonly table: ParsedTable;
  readonly source: string;
  readonly active: { readonly row: number; readonly column: number; readonly caret: number } | null;
  /** D-144: the selected cells, if any (the anchor is the active cell). */
  readonly range: CellRect | null;
  constructor(
    table: ParsedTable,
    source: string,
    active: { row: number; column: number; caret: number } | null,
    range: CellRect | null = null,
  ) {
    super();
    this.table = table;
    this.source = source;
    this.active = active;
    this.range = range;
  }
  override eq(other: TableWidget): boolean {
    return (
      other.source === this.source &&
      other.table.from === this.table.from &&
      other.active?.row === this.active?.row &&
      other.active?.column === this.active?.column &&
      other.active?.caret === this.active?.caret &&
      JSON.stringify(other.range) === JSON.stringify(this.range)
    );
  }
  override get estimatedHeight(): number {
    return this.table.rows.length * 31 + 2;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-fl-table-wrap';
    wrap.addEventListener('mousedown', (event) => this.pressed(event, view, wrap));
    // Q11: the table's own right-click menu, on the cell under the pointer.
    wrap.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const holder = holders.get(wrap);
      const table = holder ? tableAt(view.state, holder.from) : null;
      if (!table) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
      const row = target ? Number(target.dataset['row']) : 0;
      const column = target ? Number(target.dataset['column']) : 0;
      openMenu(menuEntries(view, { table, row, column }), { x: event.clientX, y: event.clientY });
    });
    this.fill(wrap, view);
    return wrap;
  }
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    this.fill(dom, view);
    return true;
  }
  override destroy(dom: HTMLElement): void {
    holders.get(dom)?.editor?.destroy();
    holders.delete(dom);
  }
  // Clicks, keys and the menu inside a table are the table's (D-141 Q9).
  override ignoreEvent(): boolean {
    return true;
  }

  /** A click on a cell makes it active, the caret where the click was. */
  private pressed(event: MouseEvent, view: EditorView, wrap: HTMLElement): void {
    if (event.button !== 0) return;
    const pressedOn = event.target as HTMLElement;
    const holder = holders.get(wrap);
    if (!holder || pressedOn.closest('.cm-fl-table-edge')) return;
    const target = pressedOn.closest<HTMLElement>('[data-row]');
    if (!target && !pressedOn.closest('.cm-fl-table')) {
      // D-144 (Proposed): a press beside or under the table, off its cells and handles (the
      // handles' gutter, the space right of a narrow table), puts the caret on the line after it,
      // as ↓ from its last row does; at the note's end that line is made, as Esc makes it. The
      // widget takes its own events, so without this the press would leave no caret at all.
      event.preventDefault();
      const live = tableAt(view.state, holder.from);
      if (live) leave(view, live, 'below', true);
      return;
    }
    if (!target) return;
    const row = Number(target.dataset['row']);
    const column = Number(target.dataset['column']);
    const live = tableAt(view.state, holder.from);
    if (!live) return;
    // D-144: Shift+click selects the cells from the active one to the one clicked.
    if (event.shiftKey && holder.key) {
      event.preventDefault();
      const [anchorRow, anchorColumn] = holder.key.split(':').map(Number) as [number, number];
      selectCells(view, live.from, { row: anchorRow, column: anchorColumn }, { row, column });
      return;
    }
    // A plain press clears the selected cells; a drag from it across cells selects them.
    dropCells(view);
    dragCells(view, wrap, { row, column });
    if (holder.key === `${row}:${column}`) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    const cell = live.rows[row]?.cells[column];
    focusNextCell = true;
    pendingClick = point;
    view.dispatch({
      selection: { anchor: cellPosition(view.state, cell, row, live, 'end') },
      userEvent: 'select.pointer',
    });
  }

  private fill(wrap: HTMLElement, view: EditorView): void {
    const { table } = this;
    wrap.dataset['from'] = String(table.from);
    let holder = holders.get(wrap);
    const shape = `${table.rows.length}x${table.columns}:${table.align.join(',')}`;
    // Typing was going on in a cell: whatever moves the active cell (a key, an undo, a new row),
    // the next cell's editor takes the focus, so no key goes astray.
    const cellHadFocus = holder?.editor?.hasFocus ?? false;
    // Q12: the ring follows the active cell once the table is drawn.
    requestAnimationFrame(() => placeRing(wrap));
    if (!holder || holder.shape !== shape) {
      const before = holder
        ? wrap.querySelector('.cm-fl-table-box')?.getBoundingClientRect()
        : null;
      holder?.editor?.destroy();
      holder = build(wrap, table, shape, view);
      holders.set(wrap, holder);
      if (before) reshaped(wrap, holder, table, before);
    }
    holder.from = table.from;
    const key = this.active ? `${this.active.row}:${this.active.column}` : null;
    // A cell that stops being active shows its text again.
    if (holder.editor && holder.key !== key) {
      const old = holder.key ? holder.cells.get(holder.key) : undefined;
      holder.editor.destroy();
      holder.editor = null;
      if (old) {
        old.classList.remove('cm-fl-cell-active');
        old.dataset['html'] = '';
      }
      holder.key = null;
    }
    // D-144: the selected cells' soft fill (not the anchor's: it has the ring and the caret).
    const range = this.range;
    for (const [cellKey, element] of holder.cells) {
      const [row, column] = cellKey.split(':').map(Number) as [number, number];
      const inside =
        range !== null &&
        cellKey !== key &&
        row >= range.top &&
        row <= range.bottom &&
        column >= range.left &&
        column <= range.right;
      element.classList.toggle('cm-fl-cell-selected', inside);
    }
    // A range starting in a cell being edited: its text selection collapses to the caret.
    if (range && holder.editor && holder.key === key && !holder.editor.state.selection.main.empty)
      holder.editor.dispatch({
        selection: { anchor: holder.editor.state.selection.main.head },
        annotations: fromNote.of(true),
      });
    for (const [cellKey, element] of holder.cells) {
      if (cellKey === key && holder.editor) continue;
      const [row, column] = cellKey.split(':').map(Number) as [number, number];
      const html = titleHtml(table.rows[row]?.cells[column]?.text ?? '');
      if (element.dataset['html'] !== html) {
        element.innerHTML = html;
        element.dataset['html'] = html;
      }
    }
    if (!this.active || key === null) return;
    const element = holder.cells.get(key);
    if (!element) return;
    const text = table.rows[this.active.row]?.cells[this.active.column]?.text ?? '';
    if (!holder.editor) {
      element.textContent = '';
      element.dataset['html'] = '';
      element.classList.add('cm-fl-cell-active');
      holder.key = key;
      const editor = cellEditor(view, wrap, element, text, this.active.caret);
      holder.editor = editor;
      // A key move from another cell takes the focus at once; a click, or coming from the note's
      // own editor, after the note's update.
      const fromNoteEditor = view.hasFocus || pendingClick !== null;
      const focus = focusNextCell || fromNoteEditor || cellHadFocus;
      focusNextCell = false;
      const click = pendingClick;
      pendingClick = null;
      // From another cell the focus moves at once, so no key typed meanwhile is lost; from the
      // note's own editor, after its update (its blur would start another update inside this one).
      if (focus && !fromNoteEditor) editor.focus();
      requestAnimationFrame(() => {
        if (!editor.dom.isConnected) return;
        if (focus && fromNoteEditor) editor.focus();
        const at = click ? editor.posAtCoords(click) : null;
        if (at !== null)
          editor.dispatch({ selection: { anchor: at }, annotations: fromNote.of(true) });
      });
      return;
    }
    // The same cell: follow the note when it changed from elsewhere (undo, a change from outside).
    const editor = holder.editor;
    if (editor.state.doc.toString().trim() !== text) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
        selection: { anchor: Math.min(this.active.caret, text.length) },
        annotations: [fromNote.of(true), Transaction.addToHistory.of(false)],
      });
    }
    if (focusNextCell) {
      focusNextCell = false;
      requestAnimationFrame(() => {
        if (editor.dom.isConnected) editor.focus();
      });
    }
  }
}

/** Where the last click on an inactive cell was: its editor puts the caret there. */
let pendingClick: { x: number; y: number } | null = null;

/**
 * D-144: a press on a cell that moves, with the button held, onto other cells of the table selects
 * the cells from the pressed one (the active cell) to the one under the pointer. Once it has left
 * the pressed cell, the moves are the table's: no text selection is drawn in the cell's editor.
 */
function dragCells(view: EditorView, wrap: HTMLElement, start: CellPlace): void {
  let ranging = false;
  const move = (event: MouseEvent): void => {
    if ((event.buttons & 1) === 0) {
      done();
      return;
    }
    const over =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row]') : null;
    const inTable = over !== null && wrap.contains(over);
    const head = inTable
      ? { row: Number(over.dataset['row']), column: Number(over.dataset['column']) }
      : null;
    if (!ranging && (!head || samePlace(head, start))) return;
    ranging = true;
    event.preventDefault();
    event.stopPropagation();
    const holder = holders.get(wrap);
    if (!head || !holder) return;
    selectCells(view, holder.from, start, head);
  };
  const done = (): void => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', done, true);
  };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', done, true);
}

interface Holder {
  from: number;
  shape: string;
  cells: Map<string, HTMLElement>;
  editor: EditorView | null;
  key: string | null;
}
const holders = new WeakMap<HTMLElement, Holder>();

function build(wrap: HTMLElement, table: ParsedTable, shape: string, view: EditorView): Holder {
  wrap.textContent = '';
  const element = document.createElement('table');
  element.className = 'cm-fl-table';
  const cells = new Map<string, HTMLElement>();
  table.rows.forEach((_row, row) => {
    const line = document.createElement('tr');
    for (let column = 0; column < table.columns; column++) {
      const cell = document.createElement(row === 0 ? 'th' : 'td');
      cell.dataset['row'] = String(row);
      cell.dataset['column'] = String(column);
      const align = table.align[column];
      if (align) cell.style.textAlign = align;
      cells.set(`${row}:${column}`, cell);
      line.append(cell);
    }
    if (row === 0) {
      const head = document.createElement('thead');
      head.append(line);
      element.append(head);
    } else {
      let body = element.tBodies[0];
      if (!body) {
        body = document.createElement('tbody');
        element.append(body);
      }
      body.append(line);
    }
  });
  // Q11, D-144: the handles a drag adds or removes columns and rows with (a small "+" chip beside
  // the right and bottom edges, outside the cells), and the count of what it adds.
  const box = document.createElement('div');
  box.className = 'cm-fl-table-box';
  const right = edgeHandle('right', 'Drag to add or remove columns');
  const bottom = edgeHandle('bottom', 'Drag to add or remove rows');
  const badge = document.createElement('div');
  badge.className = 'cm-fl-table-badge';
  badge.hidden = true;
  right.addEventListener('pointerdown', (event) => dragEdge(view, wrap, 'columns', event));
  bottom.addEventListener('pointerdown', (event) => dragEdge(view, wrap, 'rows', event));
  box.append(element, right, bottom, badge);
  wrap.append(box);
  return { from: table.from, shape, cells, editor: null, key: null };
}

/** D-144: an edge's handle: a small chip with a "+" (stroke-drawn, as Flint's icons are). */
function edgeHandle(edge: 'right' | 'bottom', title: string): HTMLElement {
  const handle = document.createElement('div');
  handle.className = `cm-fl-table-edge cm-fl-table-edge-${edge}`;
  handle.title = title;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.25',
    'stroke-linecap': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(name, value);
  // The bar folds away while a drag takes columns or rows away: the "+" becomes a "−".
  const across = document.createElementNS(ns, 'path');
  across.setAttribute('d', 'M6 12h12');
  const bar = document.createElementNS(ns, 'path');
  bar.setAttribute('d', 'M12 6v12');
  bar.setAttribute('class', 'cm-fl-edge-bar');
  svg.append(across, bar);
  handle.append(svg);
  return handle;
}

/** Rows or columns just added (Q12: they fade in), set by the edit that adds them; `columns`, the
 * columns too when a paste grew the table both ways (D-144). */
let added: {
  from: number;
  axis: 'rows' | 'columns';
  first: number;
  last: number;
  columns?: { first: number; last: number };
} | null = null;

/** Q12: a table that changed shape eases from its old size to its new one; new rows or columns
 * fade in. Off with reduce-motion; nothing waits for it (D-75). */
function reshaped(wrap: HTMLElement, holder: Holder, table: ParsedTable, before: DOMRect): void {
  const hint = added && added.from === table.from ? added : null;
  added = null;
  if (reducedMotion()) return;
  const timing = {
    duration: durationMs('--fl-dur-base', 200),
    easing: 'cubic-bezier(.2, .9, .3, 1)',
  };
  if (hint)
    for (const [key, cell] of holder.cells) {
      const [row, column] = key.split(':').map(Number) as [number, number];
      const index = hint.axis === 'rows' ? row : column;
      const also = hint.columns;
      if (
        (index >= hint.first && index <= hint.last) ||
        (also && column >= also.first && column <= also.last)
      )
        cell.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    }
  requestAnimationFrame(() => {
    const box = wrap.querySelector<HTMLElement>('.cm-fl-table-box');
    if (!box) return;
    const after = box.getBoundingClientRect();
    if (Math.abs(after.width - before.width) < 1 && Math.abs(after.height - before.height) < 1)
      return;
    box.style.overflow = 'clip';
    box
      .animate(
        [
          { width: `${before.width}px`, height: `${before.height}px` },
          { width: `${after.width}px`, height: `${after.height}px` },
        ],
        timing,
      )
      .finished.finally(() => {
        box.style.overflow = '';
      })
      .catch(() => undefined);
  });
}

/** Q12: the active cell's ring, an overlay that moves from cell to cell (and fades in and out). */
function placeRing(wrap: HTMLElement): void {
  const holder = holders.get(wrap);
  const box = wrap.querySelector<HTMLElement>('.cm-fl-table-box');
  const element = box?.querySelector<HTMLElement>('.cm-fl-table');
  if (!holder || !box || !element) return;
  let ring = box.querySelector<HTMLElement>('.cm-fl-cell-ring');
  if (!ring) {
    ring = document.createElement('div');
    ring.className = 'cm-fl-cell-ring off';
    box.append(ring);
  }
  const cell = holder.key ? holder.cells.get(holder.key) : undefined;
  if (!cell) {
    ring.classList.add('off');
    return;
  }
  const place = (target: HTMLElement): void => {
    target.style.left = `${element.offsetLeft + cell.offsetLeft}px`;
    target.style.top = `${element.offsetTop + cell.offsetTop}px`;
    target.style.width = `${cell.offsetWidth}px`;
    target.style.height = `${cell.offsetHeight}px`;
  };
  if (ring.classList.contains('off')) {
    // Appearing: in place at once, then it fades in.
    ring.classList.add('placing');
    place(ring);
    void ring.offsetWidth;
    ring.classList.remove('placing', 'off');
  } else place(ring);
}

/** Several of a table's edits in a row as one change (one undo step): each on the table as the
 * edit before it left it. */
function composed(
  view: EditorView,
  from: number,
  times: number,
  edit: (table: ParsedTable, state: EditorState) => ChangeSpec[],
): ChangeSet | null {
  let state = view.state;
  let set = ChangeSet.empty(state.doc.length);
  let at = from;
  for (let step = 0; step < times; step++) {
    ensureSyntaxTree(state, state.doc.length, 200);
    const table = tableAt(state, at);
    if (!table) break;
    const next = state.changes(edit(table, state));
    set = set.compose(next);
    at = next.mapPos(at);
    state = state.update({ changes: next }).state;
  }
  return set.empty ? null : set;
}

/** The cells a drag would take away (the columns from `target` on, or the rows), with text. */
function goingWithText(table: ParsedTable, axis: 'columns' | 'rows', target: number): number {
  let count = 0;
  table.rows.forEach((row, index) =>
    row.cells.forEach((cell, column) => {
      const going =
        axis === 'columns' ? column >= target && column < table.columns : index >= target;
      if (going && cell.text !== '') count++;
    }),
  );
  return count;
}

/** Applies a drag's result: columns or rows added or taken away at the end, in one step. */
function resize(
  view: EditorView,
  from: number,
  axis: 'columns' | 'rows',
  count: number,
  target: number,
): void {
  const more = target > count;
  if (more) added = { from, axis, first: count, last: target - 1 };
  const changes = composed(view, from, Math.abs(target - count), (table) => {
    if (axis === 'columns')
      return more ? addColumn(table, table.columns) : deleteColumn(table, table.columns - 1);
    const last = table.rows.length - 1;
    return more ? addRow(table, last) : deleteRow(table, last);
  });
  if (changes)
    view.dispatch({
      changes,
      userEvent: more ? 'input.table' : 'delete.table',
      scrollIntoView: true,
    });
}

/** D-144: the edge drag's warning still up, if any: the editor it is for, and the way to cancel it. */
let warning: { readonly view: EditorView; readonly cancel: () => void } | null = null;

/** Layers above the note that take Esc themselves: a menu, a picker, the palette, the viewer. */
const ABOVE = '.fl-menu, .fl-picker, .palette-layer, .lightbox';

/**
 * Q11, D-144: the warning before a drag takes away cells with text, as the window's toast (Delete /
 * Cancel), never in the note. Esc in the note (or its cell), the toast's time running out, another
 * toast, a new drag or the note's editor going away cancel it.
 */
function warn(view: EditorView, cells: number, done: (apply: boolean) => void): void {
  let open = true;
  let cancel: (() => void) | null = null;
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !cancel) return;
    // Esc goes to the topmost layer first: a palette, menu or picker opened over the note keeps it.
    const target = event.target instanceof Node ? event.target : null;
    const here =
      target !== null &&
      (view.dom.contains(target) ||
        (target instanceof Element && target.closest('.toast') !== null));
    // So does a layer inside the note's editor: its find bar, the slash menu (a completion list).
    const inside =
      (target instanceof Element && target.closest('.fl-find') !== null) ||
      view.dom.querySelector('.cm-tooltip-autocomplete:not(.fl-slash-ghost)') !== null;
    if (!here || inside || document.querySelector(ABOVE)) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };
  const close = (apply: boolean): void => {
    open = false;
    window.removeEventListener('keydown', onKey, true);
    if (warning?.cancel === cancel) warning = null;
    done(apply);
  };
  window.addEventListener('keydown', onKey, true);
  cancel = announceConfirm(
    `This deletes content in ${cells} ${cells === 1 ? 'cell' : 'cells'}`,
    'Delete',
    { confirm: () => close(true), cancel: () => close(false) },
  );
  // With no window to show it, it was cancelled at once: nothing is up.
  if (open) warning = { view, cancel };
}

/**
 * D-144: the warning goes with its note's editor (another note opened, mini mode's tab changed): a
 * Delete left on the toast would change nothing, so it is cancelled and the toast taken away. The
 * Undo toast goes too: its Undo would run on an editor that is gone, and do nothing.
 */
const cancelWarningWithEditor = ViewPlugin.define((view) => ({
  destroy(): void {
    if (warning?.view === view) warning.cancel();
    if (undoToast?.view === view) {
      undoToast.hide();
      undoToast = null;
    }
  },
}));

/**
 * Q11: dragging the right edge adds or removes columns, the bottom edge rows, one per step of the
 * average column width (row height); at least one column and the header row stay. During the
 * drag what would go is dimmed and what would come is counted; Esc cancels. Taking away cells
 * with text asks first, in the window's toast (D-144).
 */
function dragEdge(
  view: EditorView,
  wrap: HTMLElement,
  axis: 'columns' | 'rows',
  start: PointerEvent,
): void {
  if (start.button !== 0) return;
  const holder = holders.get(wrap);
  const table = holder ? tableAt(view.state, holder.from) : null;
  const element = wrap.querySelector<HTMLTableElement>('.cm-fl-table');
  const box = wrap.querySelector<HTMLElement>('.cm-fl-table-box');
  const badge = wrap.querySelector<HTMLElement>('.cm-fl-table-badge');
  if (!holder || !table || !element || !box || !badge) return;
  start.preventDefault();
  start.stopPropagation();
  // D-144: a new drag answers the last one's warning still up: Cancel (its cells undimmed).
  warning?.cancel();
  const handle = start.currentTarget as HTMLElement;
  handle.setPointerCapture(start.pointerId);
  const rect = element.getBoundingClientRect();
  const count = axis === 'columns' ? table.columns : table.rows.length;
  const step = Math.max(24, (axis === 'columns' ? rect.width : rect.height) / count);
  let target = count;
  wrap.classList.add('cm-fl-table-dragging');
  handle.classList.add('on');
  // D-144 (Proposed): what the drag would do, drawn faintly: the new columns or rows as a dashed
  // ghost extending the table (the box grows to make room, so the text below moves as it will),
  // the ones that would go dimmed inside a dashed outline. The handle rides the grown edge when
  // adding and stays put, its "+" turned "−", when taking away (over the cells it would hide text).
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const heights = Array.from(element.rows, (row) => row.offsetHeight);
  const widths = Array.from(element.rows[0]?.cells ?? [], (cell) => cell.offsetWidth);
  const ghost = document.createElement('div');
  ghost.className = 'cm-fl-table-ghost off';
  ghost.setAttribute('aria-hidden', 'true');
  box.append(ghost);
  let drawn = 0;
  const grow = axis === 'columns' ? '--fl-table-grow-x' : '--fl-table-grow-y';
  const drawGhost = (): void => {
    const more = target - count;
    let x = 0;
    let y = 0;
    let across = width;
    let down = height;
    if (more > 0 && axis === 'columns') [x, across] = [width, more * step];
    else if (more > 0) [y, down] = [height, more * step];
    else if (more < 0 && axis === 'columns') {
      x = holder.cells.get(`0:${target}`)?.offsetLeft ?? width;
      across = width - x;
    } else if (more < 0) {
      y = holder.cells.get(`${target}:0`)?.offsetTop ?? height;
      down = height - y;
    }
    const left = element.offsetLeft + x;
    const top = element.offsetTop + y;
    // The count sits in the middle of the ghost.
    badge.style.left = `${left + across / 2}px`;
    badge.style.top = `${top + down / 2}px`;
    if (more !== 0) {
      // Appearing: in place at once, then it fades in; after that it glides from step to step.
      const appearing = ghost.classList.contains('off');
      if (appearing) ghost.classList.add('placing');
      ghost.style.left = `${left}px`;
      ghost.style.top = `${top}px`;
      ghost.style.width = `${across}px`;
      ghost.style.height = `${down}px`;
      if (appearing) void ghost.offsetWidth;
      ghost.classList.remove('placing');
    }
    ghost.classList.toggle('off', more === 0);
    ghost.classList.toggle('adding', more > 0);
    ghost.classList.toggle('going', more < 0);
    box.style.setProperty(grow, `${Math.max(0, more) * step}px`);
    handle.classList.toggle('removing', more < 0);
    if (more === drawn) return;
    drawn = more;
    ghost.textContent = '';
    if (more <= 0) return;
    // The new cells, lined up with the table's rows (columns): one dashed cell each.
    const lines = axis === 'columns' ? heights : widths;
    const template = lines.map((size) => `${size}px`).join(' ');
    ghost.style.gridTemplateColumns = axis === 'columns' ? `repeat(${more}, 1fr)` : template;
    ghost.style.gridTemplateRows = axis === 'columns' ? template : `repeat(${more}, 1fr)`;
    for (let index = 0; index < more * lines.length; index++) {
      const ghostCell = document.createElement('div');
      ghostCell.className = 'cm-fl-ghost-cell';
      ghost.append(ghostCell);
    }
  };
  const show = (): void => {
    for (const [key, cell] of holder.cells) {
      const [row, column] = key.split(':').map(Number) as [number, number];
      cell.classList.toggle('cm-fl-cell-going', (axis === 'columns' ? column : row) >= target);
    }
    drawGhost();
    badge.hidden = target <= count;
    badge.textContent = `+${target - count} ${axis === 'columns' ? (target - count === 1 ? 'column' : 'columns') : target - count === 1 ? 'row' : 'rows'}`;
    badge.dataset['axis'] = axis;
  };
  /** The handle back at rest ("+") and the box at its size (a drag let go of). */
  const settle = (): void => {
    handle.classList.remove('on', 'removing');
    box.style.removeProperty(grow);
  };
  const clear = (): void => {
    for (const cell of holder.cells.values()) cell.classList.remove('cm-fl-cell-going');
    badge.hidden = true;
    settle();
    // The ghost fades out (D-75: nothing waits for it).
    ghost.classList.add('off');
    if (reducedMotion()) ghost.remove();
    else setTimeout(() => ghost.remove(), durationMs('--fl-dur-fast', 120) + 40);
  };
  const move = (event: PointerEvent): void => {
    const distance =
      axis === 'columns' ? event.clientX - start.clientX : event.clientY - start.clientY;
    target = Math.max(1, count + Math.round(distance / step));
    show();
  };
  const finish = (apply: boolean): void => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', escape, true);
    wrap.classList.remove('cm-fl-table-dragging');
    // D-144: the drag's press takes no focus; the note's editor gets it, so Ctrl+Z undoes the
    // drag (a note just opened from the sidebar had it on the sidebar). A cell keeps it.
    if (!view.dom.contains(document.activeElement)) view.focus();
    if (!apply || target === count) {
      clear();
      return;
    }
    const live = tableAt(view.state, holder.from);
    if (!live) return clear();
    const withText = target < count ? goingWithText(live, axis, target) : 0;
    if (withText === 0) {
      clear();
      resize(view, live.from, axis, count, target);
      return;
    }
    // While the warning is up, what would go stays dimmed and outlined; the handle goes back.
    badge.hidden = true;
    settle();
    warn(view, withText, (yes) => {
      clear();
      if (!yes) return;
      // The note may have changed while the card was up: the table as it is now, or nothing.
      const now = tableAt(view.state, holder.from);
      const size = now && (axis === 'columns' ? now.columns : now.rows.length);
      if (now && size === count) resize(view, now.from, axis, count, target);
    });
  };
  const up = (): void => finish(true);
  const cancel = (): void => finish(false);
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(false);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', escape, true);
}

/** The live table and the active cell's place in it, from the note's state. */
function activeOf(view: EditorView, wrap: HTMLElement): CellAt | null {
  const holder = holders.get(wrap);
  if (!holder?.key) return null;
  const table = tableAt(view.state, holder.from);
  if (!table) return null;
  const [row, column] = holder.key.split(':').map(Number) as [number, number];
  return { table, row, column };
}

/** Moves the note's caret into a cell (its start or end), which makes that cell active. */
function goTo(
  view: EditorView,
  table: ParsedTable,
  row: number,
  column: number,
  at: 'start' | 'end',
): void {
  const cell = table.rows[row]?.cells[column];
  focusNextCell = true;
  view.dispatch({
    selection: { anchor: cellPosition(view.state, cell, row, table, at === 'start' ? 0 : 'end') },
    scrollIntoView: true,
    userEvent: 'select',
  });
}

/**
 * Leaves the table for the line above or below it (Esc: below, making one if there is none).
 * Below, the caret goes after that line's quote marks and indentation (a table in a quote: the
 * text stays in the quote); where the line under the table isn't empty (a heading right under it)
 * or there is none and `make` is set, an empty line is made for it, in a quote the quote's `>`
 * (D-144, Proposed). A read-only note is never written: the caret only moves.
 */
function leave(
  view: EditorView,
  table: ParsedTable,
  where: 'above' | 'below',
  make = false,
): boolean {
  const doc = view.state.doc;
  view.focus();
  if (where === 'above') {
    if (table.from === 0) return false;
    view.dispatch({
      selection: { anchor: table.from - 1 },
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  }
  const next = table.to < doc.length ? doc.lineAt(table.to + 1) : null;
  const indent = table.rows[table.rows.length - 1]?.indent ?? '';
  const prefix = next ? containerPrefix(next.text) : '';
  if (next && next.text.slice(prefix.length).trim() === '') {
    view.dispatch({
      selection: { anchor: next.from + prefix.length },
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  }
  if (!next && !make) return false;
  if (view.state.readOnly) {
    // Read-only (a newer format, or another window editing it, D-109): nothing is written. The
    // caret goes to the line under the table as it is; at the note's end it stays where it was.
    if (next) view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
    return true;
  }
  const blank = `\n${indent.trimEnd()}`;
  view.dispatch({
    changes: { from: table.to, insert: blank },
    selection: { anchor: table.to + blank.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/** The active cell's editor: plain text (the cell's markdown), its keys, its changes to the note. */
function cellEditor(
  view: EditorView,
  wrap: HTMLElement,
  parent: HTMLElement,
  text: string,
  caret: number,
): EditorView {
  const keys =
    (run: (here: CellAt, cell: EditorView) => boolean) =>
    (cell: EditorView): boolean => {
      const here = activeOf(view, wrap);
      return here ? run(here, cell) : false;
    };
  const next = (here: CellAt): boolean => {
    const { table, row, column } = here;
    if (column + 1 < table.columns) goTo(view, table, row, column + 1, 'start');
    else if (row + 1 < table.rows.length) goTo(view, table, row + 1, 0, 'start');
    else {
      // Tab in the last cell adds a row (Q9).
      added = { from: table.from, axis: 'rows', first: row + 1, last: row + 1 };
      view.dispatch({ changes: addRow(table, row), userEvent: 'input' });
      const grown = tableAt(view.state, table.from);
      if (grown) goTo(view, grown, row + 1, 0, 'start');
    }
    return true;
  };
  const previous = (here: CellAt): boolean => {
    const { table, row, column } = here;
    if (column > 0) goTo(view, table, row, column - 1, 'end');
    else if (row > 0) goTo(view, table, row - 1, table.columns - 1, 'end');
    return true;
  };
  /**
   * D-144: Shift+arrow extends the selected cells by one cell; with none selected, only from the
   * cell's text edge that way (else it selects text in the cell, as before).
   */
  const extend =
    (rows: number, columns: number) =>
    (cell: EditorView): boolean => {
      const here = activeOf(view, wrap);
      if (!here) return false;
      const range = view.state.field(cellRange, false) ?? null;
      if (!range) {
        const head = cell.state.selection.main.head;
        const length = cell.state.doc.length;
        const line = (at: number): number => cell.coordsAtPos(at)?.top ?? 0;
        const edge =
          columns < 0
            ? head === 0
            : columns > 0
              ? head === length
              : rows < 0
                ? Math.abs(line(head) - line(0)) < 2
                : Math.abs(line(head) - line(length)) < 2;
        if (!edge) return false;
      }
      const anchor = range?.anchor ?? { row: here.row, column: here.column };
      const from = range?.head ?? anchor;
      const head = {
        row: Math.max(0, Math.min(here.table.rows.length - 1, from.row + rows)),
        column: Math.max(0, Math.min(here.table.columns - 1, from.column + columns)),
      };
      if (!samePlace(head, from)) selectCells(view, here.table.from, anchor, head);
      // No cell that way (Shift+↑ in the header, Shift+↓ in the last row…) and none selected:
      // the key selects the cell's text, as before.
      else if (!range) return false;
      return true;
    };
  const below = (here: CellAt): boolean => {
    const { table, row, column } = here;
    if (row + 1 < table.rows.length) goTo(view, table, row + 1, column, 'end');
    else {
      // Enter on the last row adds a row (Q9).
      added = { from: table.from, axis: 'rows', first: row + 1, last: row + 1 };
      view.dispatch({ changes: addRow(table, row), userEvent: 'input' });
      const grown = tableAt(view.state, table.from);
      if (grown) goTo(view, grown, row + 1, column, 'start');
    }
    return true;
  };
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      selection: { anchor: Math.min(caret, text.length) },
      extensions: [
        history(),
        keymap.of([
          { key: 'Tab', run: keys((here) => next(here)), shift: keys((here) => previous(here)) },
          { key: 'Enter', run: keys((here) => below(here)) },
          {
            // A cell holds no line break (Q9): a nudge.
            key: 'Shift-Enter',
            run: () => {
              nudgeElement(parent, 'down');
              return true;
            },
          },
          // D-144: the selected cells: Shift+arrows extend them, Delete and Backspace clear them.
          { key: 'Shift-ArrowLeft', run: extend(0, -1) },
          { key: 'Shift-ArrowRight', run: extend(0, 1) },
          { key: 'Shift-ArrowUp', run: extend(-1, 0) },
          { key: 'Shift-ArrowDown', run: extend(1, 0) },
          { key: 'Delete', run: () => clearSelectedCells(view) },
          { key: 'Backspace', run: () => clearSelectedCells(view) },
          {
            key: 'ArrowUp',
            run: keys((here) => {
              dropCells(view);
              if (here.row > 0) goTo(view, here.table, here.row - 1, here.column, 'end');
              else leave(view, here.table, 'above');
              return true;
            }),
          },
          {
            key: 'ArrowDown',
            run: keys((here) => {
              dropCells(view);
              if (here.row + 1 < here.table.rows.length)
                goTo(view, here.table, here.row + 1, here.column, 'end');
              else leave(view, here.table, 'below');
              return true;
            }),
          },
          {
            key: 'ArrowLeft',
            run: keys((here, cell) => {
              dropCells(view);
              const head = cell.state.selection.main;
              if (!head.empty || head.head > 0) return false;
              return previous(here);
            }),
          },
          {
            key: 'ArrowRight',
            run: keys((here, cell) => {
              dropCells(view);
              const head = cell.state.selection.main;
              if (!head.empty || head.head < cell.state.doc.length) return false;
              return next(here);
            }),
          },
          {
            // Esc clears the selected cells first, then leaves the table.
            key: 'Escape',
            run: keys((here) => dropCells(view) || leave(view, here.table, 'below', true)),
          },
          // The note's own history (Q9): undo and redo there; the cell follows.
          { key: 'Mod-z', run: () => undo(view) },
          { key: 'Mod-y', run: () => redo(view) },
          { key: 'Mod-Shift-z', run: () => redo(view) },
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Table cell' }),
        // D-144: Ctrl+C / Ctrl+X on the selected cells copy them (Ctrl+X clears them too); a
        // block of tab-separated text pasted fills cells.
        EditorView.domEventHandlers({
          copy: (event) => {
            if (!event.clipboardData || !copySelectedCells(view, event.clipboardData)) return false;
            event.preventDefault();
            return true;
          },
          cut: (event) => {
            if (!event.clipboardData || !copySelectedCells(view, event.clipboardData)) return false;
            event.preventDefault();
            clearSelectedCells(view);
            return true;
          },
          paste: (event) => {
            const here = activeOf(view, wrap);
            const text = event.clipboardData?.getData('text/plain') ?? '';
            if (!here || !pasteCells(view, here, text)) return false;
            event.preventDefault();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(fromNote))) return;
          const here = activeOf(view, wrap);
          if (!here) return;
          const typed = update.state.doc.toString();
          const changes = setCell(view.state, here.table, here.row, here.column, typed);
          if (changes.length === 0) return;
          const event = update.transactions
            .find((tr) => tr.annotation(Transaction.userEvent))
            ?.annotation(Transaction.userEvent);
          const set = view.state.changes(changes);
          const cell = here.table.rows[here.row]?.cells[here.column];
          const start = cell
            ? set.mapPos(cell.textFrom === cell.textTo ? cell.from : cell.textFrom, 1)
            : set.mapPos(here.table.rows[here.row]?.to ?? here.table.to, 1);
          const lead = typed.length - typed.trimStart().length;
          const shown = typed
            .trimStart()
            .slice(0, Math.max(0, update.state.selection.main.head - lead));
          const offset =
            shown.replace(/\|/g, '\\|').length + (cell && cell.textFrom === cell.textTo ? 1 : 0);
          view.dispatch({
            changes: set,
            selection: { anchor: Math.min(start + offset, set.newLength) },
            userEvent: event ?? 'input',
          });
        }),
      ],
    }),
  });
}

/** The tables' widgets for the whole note (block widgets come from a state field). */
function decorate(state: EditorState): DecorationSet {
  const raw = state.field(rawTable, false) ?? null;
  const selected = state.field(cellRange, false) ?? null;
  const selection = state.selection.main;
  const at = selection.empty ? cellAt(state, selection.head) : null;
  const ranges: Range<Decoration>[] = [];
  for (const table of tablesIn(state)) {
    if (raw !== null && raw >= table.from && raw <= table.to) continue;
    let active: { row: number; column: number; caret: number } | null = null;
    if (at && at.table.from === table.from) {
      const cell = table.rows[at.row]?.cells[at.column];
      active = {
        row: at.row,
        column: at.column,
        caret: cell ? cellOffset(state, cell, selection.head) : 0,
      };
    }
    const source = state.doc.sliceString(table.from, table.to);
    const range = selected && selected.from === table.from && active ? rectOf(selected) : null;
    ranges.push(
      Decoration.replace({
        widget: new TableWidget(table, source, active, range),
        block: true,
      }).range(table.from, table.to),
    );
  }
  return Decoration.set(ranges);
}

const tableDecorations = StateField.define<DecorationSet>({
  create: (state) => decorate(state),
  update: (value, tr) =>
    tr.docChanged || tr.selection || tr.effects.length > 0 ? decorate(tr.state) : value,
  provide: (field) => EditorView.decorations.from(field),
});

/** Q9: a selection that crosses a table takes the whole table. */
const wholeTables = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged) return tr;
  const ranges = tr.selection.ranges;
  if (ranges.every((range) => range.empty)) return tr;
  const tables = tablesIn(tr.startState);
  let changed = false;
  const next = ranges.map((range) => {
    let { anchor, head } = range;
    for (const table of tables) {
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      if (to <= table.from || from >= table.to) continue;
      if (from >= table.from && to <= table.to) continue;
      changed = true;
      if (anchor <= head) {
        anchor = Math.min(anchor, table.from);
        head = Math.max(head, table.to);
      } else {
        head = Math.min(head, table.from);
        anchor = Math.max(anchor, table.to);
      }
    }
    return EditorSelection.range(anchor, head);
  });
  if (!changed) return tr;
  return [
    tr,
    { selection: EditorSelection.create(next, tr.selection.mainIndex), sequential: true },
  ];
});

/** A table near an edit, and whether it stands in a list item (its rows indented into it). */
interface NearTable {
  readonly table: ParsedTable;
  readonly inList: boolean;
}

/** The tables whose last line ends between `from` and `to` (the note parsed that far). */
function tablesEndingIn(state: EditorState, from: number, to: number): NearTable[] {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, to + 1), 50) ?? syntaxTree(state);
  const found: NearTable[] = [];
  tree.iterate({
    from: Math.max(0, from - 1),
    to,
    enter: (node) => {
      if (node.name !== 'Table') return undefined;
      const table = parseTable(state.doc, node.from, node.to);
      if (table && table.to >= from && table.to <= to) {
        let inList = false;
        for (let up = node.node.parent; up; up = up.parent)
          if (up.name === 'ListItem') inList = true;
        found.push({ table, inList });
      }
      return false;
    },
  });
  return found;
}

/**
 * D-144 (Proposed): text written right below a table stays a paragraph. GFM continues a table on
 * every following line until a blank line ("lazy" rows), so a word typed on the blank line under a
 * table, a Backspace or Delete that removes that blank line, or a line moved up to it would pull
 * that line and the ones after it (a picture, a paragraph) into the table. Where an edit in the
 * note (not an undo; in Source mode too) would make a line without a pipe a new row of a table, or
 * join it onto the table's last row, Flint writes the blank line that ends the table before it, in
 * the same change (one undo step). A deletion that would only remove that blank line moves the
 * caret instead (Backspace on it: into the end of the table's last cell). A line written with a
 * pipe is a row, as GFM says. In a quote the blank line keeps the quote's mark (`>`); in a list item
 * a line typed there keeps the item's indent. A line under the table read as a heading's underline
 * (`---`, which would take the table in as the heading's text) gets the blank line too. The file
 * stays plain GFM: other apps read it the way Flint shows it.
 */
export const keepTextOutOfTables = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(Transaction.userEvent) === undefined) return tr;
  if (tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;
  const start = tr.startState;
  // Cheap first: only edits from the line right below a table's last line, or that reach to a
  // table's end (the line break after it deleted).
  const near = new Map<number, NearTable>();
  tr.changes.iterChangedRanges((fromA, toA) => {
    const lo = Math.max(0, start.doc.lineAt(fromA).from - 1);
    for (const each of tablesEndingIn(start, lo, start.doc.lineAt(toA).to))
      near.set(each.table.from, each);
  });
  if (near.size === 0) return tr;
  const next = tr.state;
  // Parsed far enough to see the rows the edit would add.
  const last = Math.max(...[...near.values()].map(({ table }) => tr.changes.mapPos(table.to)));
  const tree =
    ensureSyntaxTree(next, Math.min(next.doc.length, last + 4000), 50) ?? syntaxTree(next);
  const breaks: { from: number; insert: string }[] = [];
  for (const { table: old, inList } of near.values()) {
    const from = tr.changes.mapPos(old.from, 1);
    const end = tr.changes.mapPos(old.to, -1);
    const lastRow = old.rows[old.rows.length - 1];
    // The blank line that ends the table: in a quote, the quote's mark.
    const prefix = lastRow?.indent ?? '';
    const blank = prefix.trimEnd();
    // The line break after the table deleted (from its last line on): what came after it, now on
    // the table's last line (where it would be cells, or end the table), goes back below it.
    let tail = -1;
    let whole = false;
    tr.changes.iterChanges((fromA, toA, _fromB, toB) => {
      if (fromA >= (lastRow?.from ?? old.to) && fromA <= old.to && old.to < toA) {
        tail = toB;
        // Only the line break: the line after it is whole again with it back (it never joined).
        whole = fromA === old.to && toA === old.to + 1;
      }
    });
    const table = tableAt(next, from, tree);
    const stands = table !== null && table.from === from;
    // Its text as it was (the edit below it): then a table gone is one the edit broke from below.
    const intact = next.doc.sliceString(from, end) === start.doc.sliceString(old.from, old.to);
    if (tail >= end) {
      const line = next.doc.lineAt(tail);
      const rest = next.doc.sliceString(tail, line.to);
      // Text without a pipe (cells nobody wrote), or any that broke the table (a table without
      // body rows: joined onto its delimiter row).
      if (line.from <= end && rest !== '' && (!hasRowPipe(rest) || (!stands && intact))) {
        // Text joined (not a blank line, nor only a quote's blank line): a blank line before it.
        const content = rest.slice(containerPrefix(rest).length).trim() !== '';
        breaks.push({ from: tail, insert: content && !whole ? `\n${blank}\n` : '\n' });
        continue;
      }
      // Only the line break after a table that ends the note (Backspace on the empty line under
      // it): the text as it was, the caret into the last cell, as documented (docs/02 NOTE-10).
      if (whole && rest === '' && tail === next.doc.length) {
        breaks.push({ from: tail, insert: '\n' });
        continue;
      }
    }
    if (!table || !stands) {
      // Gone, its text as it was: the line now under it reads as a heading's underline (`-`,
      // `---`) and takes the table in as its heading's text. The blank line back between them.
      if (!intact) continue;
      const last = next.doc.lineAt(end);
      if (last.to !== end) continue;
      // Past the lines written with a pipe (rows), to the first that isn't one.
      for (let number = last.number + 1; number <= next.doc.lines; number++) {
        const below = next.doc.line(number);
        if (below.text.trim() === '') break;
        if (hasRowPipe(below.text)) continue;
        breaks.push({ from: below.from, insert: `${blank}\n` });
        break;
      }
      continue;
    }
    const joined = table.rows.find(
      (row) => row.from > end && !hasRowPipe(next.doc.sliceString(row.from, row.to)),
    );
    if (!joined) continue;
    // In a list item, a line typed at the margin under its table keeps to the item.
    let pad = '';
    if (inList && prefix.trim() === '') {
      const lead = /^[ \t]*/.exec(next.doc.sliceString(joined.from, joined.to))?.[0] ?? '';
      let typed = false;
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (toB > fromB && toB > joined.from && fromB <= joined.to) typed = true;
      });
      if (typed && lead.length < prefix.length && prefix.startsWith(lead))
        pad = prefix.slice(lead.length);
    }
    breaks.push({ from: joined.from, insert: `${blank}\n${pad}` });
  }
  if (breaks.length === 0) return tr;
  const extra = next.changes(breaks);
  const selection = next.selection.map(extra);
  if (tr.changes.compose(extra).apply(start.doc).eq(start.doc)) {
    // The text as it was: only the caret moves. Left at a table's very end (Backspace on the
    // blank line under it), it goes into the end of the last cell, as ↑ from below goes in (Q9).
    let head = selection.main.head;
    for (const { table } of near.values()) {
      const row = table.rows.length - 1;
      const cells = table.rows[row]?.cells ?? [];
      const cell = cells[Math.min(cells.length, table.columns) - 1];
      if (selection.main.empty && head === table.to)
        head = cellPosition(start, cell, row, table, 'end');
    }
    return {
      selection: head === selection.main.head ? selection : EditorSelection.cursor(head),
      scrollIntoView: true,
      userEvent: 'select',
    };
  }
  return [tr, { changes: extra, selection, sequential: true }];
});

/** Q9: ↓ from the line above a table and ↑ from the line below go into its nearest cell. */
function intoTable(direction: 1 | -1): (view: EditorView) => boolean {
  return (view) => {
    const { state } = view;
    const selection = state.selection.main;
    if (!selection.empty) return false;
    const line = state.doc.lineAt(selection.head);
    const target = line.number + direction;
    if (target < 1 || target > state.doc.lines) return false;
    // Not when the caret's line wraps onto more lines below (or above): ↓ moves within it.
    const there = state.doc.line(target);
    const table = tableAt(state, direction > 0 ? there.from : there.to);
    if (!table || (direction > 0 ? table.from !== there.from : table.to !== there.to)) return false;
    if (state.field(rawTable, false) !== null) return false;
    const x = view.coordsAtPos(selection.head)?.left ?? 0;
    const wrap = view.dom.querySelector<HTMLElement>(
      `.cm-fl-table-wrap[data-from="${table.from}"]`,
    );
    const row = direction > 0 ? 0 : table.rows.length - 1;
    let column = 0;
    let best = Number.POSITIVE_INFINITY;
    wrap?.querySelectorAll<HTMLElement>(`[data-row="${row}"]`).forEach((cell) => {
      const box = cell.getBoundingClientRect();
      const distance = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
      if (distance < best) {
        best = distance;
        column = Number(cell.dataset['column']);
      }
    });
    goTo(view, table, row, column, 'end');
    return true;
  };
}

/** One of a table's commands (Q11), for its right-click menu and the palette. */
export interface TableCommand {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly run: () => void;
}

/**
 * Q11: Add row above / below, Add column left / right, Delete row / column / table, Align table and
 * Edit markdown, on a cell. Deletes act at once with an Undo toast (the note's own undo); Align
 * table says so too, since the drawn table looks the same (Q10, Proposed).
 */
export function tableCommands(view: EditorView, here: CellAt): TableCommand[] {
  const { table, row, column } = here;
  const change = (changes: ReturnType<typeof addRow>, event: string, notice?: string): void => {
    if (changes.length === 0) return;
    // A delete with an Undo toast is its own undo step: the toast's Undo takes back only it.
    const annotations = notice ? isolateHistory.of('full') : [];
    view.dispatch({ changes, userEvent: event, scrollIntoView: true, annotations });
    if (notice) offerUndo(view, notice);
  };
  const live = (): ParsedTable => tableAt(view.state, table.from) ?? table;
  return [
    {
      id: 'table:row-above',
      label: 'Add row above',
      disabled: row === 0,
      run: () => {
        added = { from: table.from, axis: 'rows', first: row, last: row };
        change(addRow(live(), row - 1), 'input.table');
      },
    },
    {
      id: 'table:row-below',
      label: 'Add row below',
      disabled: false,
      run: () => {
        added = { from: table.from, axis: 'rows', first: row + 1, last: row + 1 };
        change(addRow(live(), row), 'input.table');
      },
    },
    {
      id: 'table:column-left',
      label: 'Add column left',
      disabled: false,
      run: () => {
        added = { from: table.from, axis: 'columns', first: column, last: column };
        change(addColumn(live(), column), 'input.table');
      },
    },
    {
      id: 'table:column-right',
      label: 'Add column right',
      disabled: false,
      run: () => {
        added = { from: table.from, axis: 'columns', first: column + 1, last: column + 1 };
        change(addColumn(live(), column + 1), 'input.table');
      },
    },
    {
      id: 'table:delete-row',
      label: 'Delete row',
      disabled: row === 0,
      run: () => change(deleteRow(live(), row), 'delete.table', 'Row deleted'),
    },
    {
      id: 'table:delete-column',
      label: 'Delete column',
      disabled: table.columns <= 1,
      run: () => change(deleteColumn(live(), column), 'delete.table', 'Column deleted'),
    },
    {
      id: 'table:delete',
      label: 'Delete table',
      disabled: false,
      run: () => change(deleteTable(view.state, live()), 'delete.table', 'Table deleted'),
    },
    {
      id: 'table:align',
      label: 'Align table',
      disabled: false,
      run: () => change(alignTable(view.state, live()), 'input.table', 'Table aligned'),
    },
    {
      id: 'table:markdown',
      label: 'Edit markdown',
      disabled: false,
      run: () => {
        // Q9: the raw table, the caret at the start of the cell it was on.
        const cell = table.rows[row]?.cells[column];
        view.focus();
        view.dispatch({
          effects: showTableMarkdown.of(table.from),
          selection: { anchor: cellPosition(view.state, cell, row, table, 0) },
          scrollIntoView: true,
        });
      },
    },
    // D-144 (D-106): while cells are selected, clearing them (Delete) is a command too.
    ...(selectedCells(view)?.table.from === table.from
      ? [
          {
            id: 'table:clear-cells',
            label: 'Clear selected cells',
            disabled: false,
            run: () => {
              clearSelectedCells(view);
            },
          },
        ]
      : []),
  ];
}

/** The menu: the commands in groups (adding, deleting, the table as a whole). */
function menuEntries(view: EditorView, here: CellAt): MenuEntry[] {
  const commands = tableCommands(view, here);
  const entry = (command: TableCommand): MenuEntry => ({
    label: command.label,
    disabled: command.disabled,
    action: command.run,
  });
  const [above, below, left, right, row, column, table, align, markdown, ...more] = commands.map(
    entry,
  ) as [
    MenuEntry,
    MenuEntry,
    MenuEntry,
    MenuEntry,
    MenuEntry,
    MenuEntry,
    MenuEntry,
    MenuEntry,
    MenuEntry,
    ...MenuEntry[],
  ];
  // D-144: Clear selected cells, while cells are selected, first in the deleting group.
  return [
    above,
    below,
    left,
    right,
    'divider',
    ...more,
    row,
    column,
    table,
    'divider',
    align,
    markdown,
  ];
}

/** The editor and cell the caret was last in a table of (the palette acts there, Q11). */
let lastInTable: { view: EditorView; at: number } | null = null;

/** The palette's table commands, while the caret is in a table (D-106, Q11); none otherwise. */
export function tablePaletteCommands(): TableCommand[] {
  const last = lastInTable;
  if (!last || !last.view.dom.isConnected) return [];
  const here = cellAt(last.view.state, last.at);
  return here ? tableCommands(last.view, here) : [];
}

/** Keeps `lastInTable` up to date. */
const trackCaret = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.docChanged && !update.focusChanged) return;
  const head = update.state.selection.main.head;
  if (cellAt(update.state, head)) lastInTable = { view: update.view, at: head };
  else if (lastInTable?.view === update.view) lastInTable = null;
});

/** Tables in the note editor: drawn, edited in place, kept whole by selections (NOTE-10). */
export function tables(): Extension {
  return [
    rawTable,
    cellRange,
    tableDecorations,
    wholeTables,
    keepTextOutOfTables,
    trackCaret,
    cancelWarningWithEditor,
    closeUndoToast,
    // Before the editor's own ↑ / ↓ (which would skip over the table).
    Prec.high(
      keymap.of([
        { key: 'ArrowDown', run: intoTable(1) },
        { key: 'ArrowUp', run: intoTable(-1) },
      ]),
    ),
  ];
}
