import { history, redo, undo } from '@codemirror/commands';
import {
  Annotation,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Range,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { titleHtml } from '../../shared/inline-markdown.js';
import { nudgeElement } from '../ui/motion.js';
import { addRow, setCell, tableAt, tablesIn, type ParsedTable, type TableCell } from './table.js';

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
  state: EditorState,
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

const rawTable = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let raw = value === null ? null : tr.changes.mapPos(value);
    for (const effect of tr.effects) if (effect.is(showTableMarkdown)) raw = effect.value;
    if (raw === null) return null;
    const table = tableAt(tr.state, raw);
    const head = tr.state.selection.main.head;
    return table && head >= table.from && head <= table.to ? raw : null;
  },
});

/** Changes made by the table itself (a cell's editor following the note), not by typing. */
const fromNote = Annotation.define<boolean>();

/** Set when a key in a cell moves to another cell, so the new cell's editor takes the focus. */
let focusNextCell = false;

/** The table's widget: its cells, and the active cell's editor. */
class TableWidget extends WidgetType {
  readonly table: ParsedTable;
  readonly source: string;
  readonly active: { readonly row: number; readonly column: number; readonly caret: number } | null;
  constructor(
    table: ParsedTable,
    source: string,
    active: { row: number; column: number; caret: number } | null,
  ) {
    super();
    this.table = table;
    this.source = source;
    this.active = active;
  }
  override eq(other: TableWidget): boolean {
    return (
      other.source === this.source &&
      other.table.from === this.table.from &&
      other.active?.row === this.active?.row &&
      other.active?.column === this.active?.column &&
      other.active?.caret === this.active?.caret
    );
  }
  override get estimatedHeight(): number {
    return this.table.rows.length * 31 + 2;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-fl-table-wrap';
    wrap.addEventListener('mousedown', (event) => this.pressed(event, view, wrap));
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
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    const holder = holders.get(wrap);
    if (!target || !holder) return;
    const row = Number(target.dataset['row']);
    const column = Number(target.dataset['column']);
    if (holder.key === `${row}:${column}`) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    const live = tableAt(view.state, holder.from);
    if (!live) return;
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
    if (!holder || holder.shape !== shape) {
      holder?.editor?.destroy();
      holder = build(wrap, table, shape);
      holders.set(wrap, holder);
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

interface Holder {
  from: number;
  shape: string;
  cells: Map<string, HTMLElement>;
  editor: EditorView | null;
  key: string | null;
}
const holders = new WeakMap<HTMLElement, Holder>();

function build(wrap: HTMLElement, table: ParsedTable, shape: string): Holder {
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
  wrap.append(element);
  return { from: table.from, shape, cells, editor: null, key: null };
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

/** Leaves the table for the line above or below it (Esc: below, making one if there is none). */
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
  if (table.to < doc.length) {
    view.dispatch({
      selection: { anchor: table.to + 1 },
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  }
  if (!make) return false;
  view.dispatch({
    changes: { from: table.to, insert: '\n' },
    selection: { anchor: table.to + 1 },
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
  const below = (here: CellAt): boolean => {
    const { table, row, column } = here;
    if (row + 1 < table.rows.length) goTo(view, table, row + 1, column, 'end');
    else {
      // Enter on the last row adds a row (Q9).
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
          {
            key: 'ArrowUp',
            run: keys((here) => {
              if (here.row > 0) goTo(view, here.table, here.row - 1, here.column, 'end');
              else leave(view, here.table, 'above');
              return true;
            }),
          },
          {
            key: 'ArrowDown',
            run: keys((here) => {
              if (here.row + 1 < here.table.rows.length)
                goTo(view, here.table, here.row + 1, here.column, 'end');
              else leave(view, here.table, 'below');
              return true;
            }),
          },
          {
            key: 'ArrowLeft',
            run: keys((here, cell) => {
              const head = cell.state.selection.main;
              if (!head.empty || head.head > 0) return false;
              return previous(here);
            }),
          },
          {
            key: 'ArrowRight',
            run: keys((here, cell) => {
              const head = cell.state.selection.main;
              if (!head.empty || head.head < cell.state.doc.length) return false;
              return next(here);
            }),
          },
          { key: 'Escape', run: keys((here) => leave(view, here.table, 'below', true)) },
          // The note's own history (Q9): undo and redo there; the cell follows.
          { key: 'Mod-z', run: () => undo(view) },
          { key: 'Mod-y', run: () => redo(view) },
          { key: 'Mod-Shift-z', run: () => redo(view) },
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Table cell' }),
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
    ranges.push(
      Decoration.replace({ widget: new TableWidget(table, source, active), block: true }).range(
        table.from,
        table.to,
      ),
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

/** Tables in the note editor: drawn, edited in place, kept whole by selections (NOTE-10). */
export function tables(): Extension {
  return [
    rawTable,
    tableDecorations,
    wholeTables,
    // Before the editor's own ↑ / ↓ (which would skip over the table).
    Prec.high(
      keymap.of([
        { key: 'ArrowDown', run: intoTable(1) },
        { key: 'ArrowUp', run: intoTable(-1) },
      ]),
    ),
  ];
}
