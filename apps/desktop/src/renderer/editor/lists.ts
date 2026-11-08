import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorState,
  Transaction,
  type ChangeSpec,
  type Line,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * Numbered lists in the note editor (D-141 Q6, Q7; docs/04 §4). Pure on an editor state, so Vitest
 * checks them without a window.
 *
 * Renumbering (Q6): only the list Flint's own structural edit touched, in the same undo step; the
 * list's first number and delimiter kept; when a number's width changes (`9.` → `10.`), the lines
 * nested under that item move by as many spaces, so they stay nested. Never on opening a file,
 * while typing inside an item, in other lists, or for a change from outside Flint.
 *
 * Nesting (Q7): Tab nests a list item under the one above at that item's text column, with
 * everything nested under it; Shift+Tab puts it back at its parent's marker column. A nested
 * numbered item joins the parent's numbered children, or starts a nested list at 1.
 */

/** The user events of Flint's structural edits that need not add or remove a line break. */
const STRUCTURAL = new Set([
  'delete',
  'move.line',
  'input.indent',
  'delete.dedent',
  'input.format.line',
]);

/** Indentation events: the list an item left is renumbered too. */
const INDENTING = new Set(['input.indent', 'delete.dedent']);

/** The column where a list item's text starts (its marker, then 1–4 spaces). */
function contentColumn(doc: EditorState['doc'], mark: SyntaxNode): number {
  const line = doc.lineAt(mark.from);
  const after = /^[ \t]*/.exec(doc.sliceString(mark.to, line.to))?.[0] ?? '';
  const spaces = after.length === 0 || after.length > 4 ? 1 : after.length;
  return mark.to - line.from + spaces;
}

/** `n` spaces in or out at a line's start (out only as far as it is indented with spaces). */
function shiftLine(line: Line, by: number): ChangeSpec | null {
  if (by === 0 || line.text.trim() === '') return null;
  if (by > 0) return { from: line.from, insert: ' '.repeat(by) };
  const spaces = /^ */.exec(line.text)?.[0].length ?? 0;
  const take = Math.min(spaces, -by);
  return take > 0 ? { from: line.from, to: line.from + take } : null;
}

/** The innermost ordered list around a position. */
function orderedListAt(state: EditorState, at: number): SyntaxNode | null {
  for (const side of [1, -1] as const)
    for (
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, side);
      node;
      node = node.parent
    )
      if (node.name === 'OrderedList') return node;
  return null;
}

/** How deeply a list is nested (the list items around it). */
function depth(node: SyntaxNode): number {
  let count = 0;
  for (let up = node.parent; up; up = up.parent) if (up.name === 'ListItem') count++;
  return count;
}

/** The number an ordered list starts at (its first item's). */
function startOf(state: EditorState, list: SyntaxNode): number | null {
  for (let item = list.firstChild; item; item = item.nextSibling) {
    const mark = item.name === 'ListItem' ? item.getChild('ListMark') : null;
    const digits = mark ? /^\d+/.exec(state.doc.sliceString(mark.from, mark.to))?.[0] : undefined;
    if (digits !== undefined) return Number(digits);
  }
  return null;
}

/** Changes that put one ordered list's numbers in order, from `start` (else its first number). */
export function renumberList(state: EditorState, list: SyntaxNode, start?: number): ChangeSpec[] {
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  let next: number | null = start ?? null;
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.name !== 'ListItem') continue;
    const mark = item.getChild('ListMark');
    if (!mark) continue;
    const digits = /^\d+/.exec(doc.sliceString(mark.from, mark.to))?.[0];
    if (digits === undefined) continue;
    if (next === null) {
      next = Number(digits) + 1;
      continue;
    }
    const want = String(next++);
    if (want === digits) continue;
    changes.push({ from: mark.from, to: mark.from + digits.length, insert: want });
    // Q6: a wider or narrower number moves the lines nested under it by as much.
    const by = want.length - digits.length;
    if (by === 0) continue;
    const column = contentColumn(doc, mark);
    const first = doc.lineAt(mark.from).number;
    for (let at = first + 1; at <= doc.lineAt(item.to).number; at++) {
      const line = doc.line(at);
      const indent = /^[ \t]*/.exec(line.text)?.[0] ?? '';
      // Lazy continuation lines (less indented than the text) and tab indents stay as they are.
      if (indent.includes('\t') || indent.length < column) continue;
      const change = shiftLine(line, by);
      if (change) changes.push(change);
    }
  }
  return changes;
}

/** Does this transaction come from one of Flint's structural edits of a list? */
function structural(tr: Transaction): boolean {
  const event = tr.annotation(Transaction.userEvent);
  // A change from outside Flint carries no user event; undo and redo restore exact text.
  if (!event || event.startsWith('undo') || event.startsWith('redo')) return false;
  if (STRUCTURAL.has(event)) return true;
  let lineBreak = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.lines > 1 || tr.startState.doc.sliceString(fromA, toA).includes('\n'))
      lineBreak = true;
  });
  return lineBreak;
}

/** The ordered lists a transaction's changes touched, in its new state. */
function touchedLists(tr: Transaction, state: EditorState): SyntaxNode[] {
  const indenting = INDENTING.has(tr.annotation(Transaction.userEvent) ?? '');
  const lists = new Map<number, SyntaxNode>();
  const add = (list: SyntaxNode | null): void => {
    if (list) lists.set(list.from, list);
  };
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (const at of [fromB, toB]) {
      const list = orderedListAt(state, Math.min(at, state.doc.length));
      add(list);
      // Tab / Shift+Tab: the list the item left (or joined) one level up as well.
      if (indenting && list)
        for (let up = list.parent; up; up = up.parent)
          if (up.name === 'OrderedList') {
            add(up);
            break;
          }
    }
  });
  return [...lists.values()];
}

/** Q6: after Flint's structural edit of a numbered list, renumber it in the same undo step. */
export const renumberAfterEdits = EditorState.transactionFilter.of(
  (tr): TransactionSpec | readonly TransactionSpec[] => {
    if (!tr.docChanged || !structural(tr)) return tr;
    const state = tr.state;
    let end = 0;
    tr.changes.iterChangedRanges((_a, _b, _fromB, toB) => {
      end = Math.max(end, toB);
    });
    ensureSyntaxTree(state, Math.min(state.doc.length, end + 20_000), 50);
    // Q6: the list keeps the number it started at before the edit (a moved line doesn't bring its
    // own); a list the edit made starts where its first item says.
    const before = tr.changes.invertedDesc;
    const changes = touchedLists(tr, state).flatMap((list) => {
      const old = orderedListAt(tr.startState, before.mapPos(list.from, 1));
      // The same list only at the same depth (Tab's new nested list isn't the one above it).
      const same = old !== null && depth(old) === depth(list);
      return renumberList(state, list, (same && startOf(tr.startState, old)) || undefined);
    });
    if (changes.length === 0) return tr;
    return [tr, { changes, sequential: true }];
  },
);

/** The list item a line belongs to (innermost), unless the line is code. */
function itemOfLine(state: EditorState, line: Line): SyntaxNode | null {
  const indent = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from + indent, 1);
    node;
    node = node.parent
  ) {
    if (['FencedCode', 'CodeBlock', 'CodeText'].includes(node.name)) return null;
    if (node.name === 'ListItem') return node;
  }
  return null;
}

/** What Tab or Shift+Tab does to the selected list items. */
export type Nesting =
  /** Not in a list: Tab and Shift+Tab indent as elsewhere. */
  | { readonly kind: 'none' }
  /** In a list, but nothing can move (the first item, a top-level item): a nudge. */
  | { readonly kind: 'impossible' }
  | {
      readonly kind: 'move';
      readonly changes: ChangeSpec[];
      /** Where each moved item's marker starts and the item ends (old document). */
      readonly starts: readonly number[];
      readonly ends: readonly number[];
    };

/** Q7: Tab (`1`) nests the selected items under the item above, Shift+Tab (`-1`) undoes it. */
export function nestItems(state: EditorState, direction: 1 | -1): Nesting {
  const doc = state.doc;
  ensureSyntaxTree(state, doc.length, 200);
  // The selected items, outermost first (a selected child moves with its parent).
  const items: SyntaxNode[] = [];
  for (const range of state.selection.ranges)
    for (let at = doc.lineAt(range.from).number; at <= doc.lineAt(range.to).number; at++) {
      const item = itemOfLine(state, doc.line(at));
      if (!item) continue;
      if (items.some((each) => each.from <= item.from && each.to >= item.to)) continue;
      items.push(item);
    }
  if (items.length === 0) return { kind: 'none' };
  const changes: ChangeSpec[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (const item of items) {
    const mark = item.getChild('ListMark');
    if (!mark) continue;
    const first = doc.lineAt(mark.from);
    const column = mark.from - first.from;
    const tabbed = (line: Line): boolean => /^[ \t]*/.exec(line.text)?.[0].includes('\t') ?? false;
    let by: number;
    let useTab: boolean;
    let renumberTo: string | null = null;
    if (direction > 0) {
      const above = item.prevSibling;
      if (!above || above.name !== 'ListItem') continue;
      const aboveMark = above.getChild('ListMark');
      if (!aboveMark) continue;
      by = contentColumn(doc, aboveMark) - column;
      useTab = tabbed(first) || tabbed(doc.lineAt(aboveMark.from));
      // A numbered item joins the numbered children of the item above, or starts a list at 1.
      const digits = /^\d+/.exec(doc.sliceString(mark.from, mark.to))?.[0];
      const children = above.lastChild;
      if (digits !== undefined && children?.name !== 'OrderedList' && digits !== '1')
        renumberTo = '1';
    } else {
      const parentItem = item.parent?.parent;
      if (!parentItem || parentItem.name !== 'ListItem') continue;
      const parentMark = parentItem.getChild('ListMark');
      if (!parentMark) continue;
      by = parentMark.from - doc.lineAt(parentMark.from).from - column;
      useTab = tabbed(first);
    }
    if (by === 0) continue;
    starts.push(mark.from);
    ends.push(item.to);
    const digits = /^\d+/.exec(doc.sliceString(mark.from, mark.to))?.[0] ?? '';
    if (renumberTo !== null)
      changes.push({ from: mark.from, to: mark.from + digits.length, insert: renumberTo });
    const narrower = renumberTo === null ? 0 : renumberTo.length - digits.length;
    for (let at = first.number; at <= doc.lineAt(item.to).number; at++) {
      const line = doc.line(at);
      if (useTab) {
        if (line.text.trim() === '') continue;
        if (direction > 0) changes.push({ from: line.from, insert: '\t' });
        else if (line.text.startsWith('\t')) changes.push({ from: line.from, to: line.from + 1 });
        else {
          const change = shiftLine(line, -4);
          if (change) changes.push(change);
        }
        continue;
      }
      // The item's own line moves by `by`; the lines under it also follow its narrower number.
      const change = shiftLine(line, at === first.number ? by : by + narrower);
      if (change) changes.push(change);
    }
  }
  if (starts.length === 0) return { kind: 'impossible' };
  return { kind: 'move', changes, starts, ends };
}
