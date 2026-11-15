/**
 * Enter in a list keeps it tight (D-165, Davit 15 Nov 2026): no blank lines between items, on the
 * desktop and the phone. CodeMirror's markdown Enter continues lists, but by default (1) Enter on
 * an empty second item of a tight list inserts a blank line above it, making the list loose, and
 * (2) a loose list goes on with a blank line before each new item. The first is switched off
 * (`nonTightLists: false`); the second is undone in the same step: a blank line Enter left between
 * the previous item and the new one is taken out.
 */
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import {
  EditorSelection,
  type ChangeSpec,
  type StateCommand,
  type Transaction,
} from '@codemirror/state';

const continueList = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** A list item's start: indentation, quote markers, then `-`, `*`, `+` or `1.` / `1)`. */
const ITEM = /^[\t >]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** Enter that continues lists without blank lines between their items. */
export const tightListEnter: StateCommand = ({ state, dispatch }) =>
  continueList({
    state,
    dispatch: (tr: Transaction) => {
      const after = tr.state;
      const head = after.selection.main.head;
      const line = after.doc.lineAt(head);
      if (line.number < 3 || !ITEM.test(line.text)) {
        dispatch(tr);
        return;
      }
      const blank = after.doc.line(line.number - 1);
      const previous = after.doc.line(line.number - 2);
      // Only the blank line Enter itself added: it is inside what this transaction inserted.
      const inserted = { from: 0, to: 0 };
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (fromB <= blank.from && toB >= blank.to) {
          inserted.from = fromB;
          inserted.to = toB;
        }
      });
      if (blank.text.trim() !== '' || !ITEM.test(previous.text) || inserted.to === inserted.from) {
        dispatch(tr);
        return;
      }
      const drop: ChangeSpec = { from: blank.from, to: blank.to + 1 };
      const removal = after.changes(drop);
      dispatch(
        state.update({
          changes: tr.changes.compose(removal),
          selection: EditorSelection.create(
            after.selection.ranges.map((range) => range.map(removal)),
            after.selection.mainIndex,
          ),
          scrollIntoView: true,
          userEvent: 'input',
        }),
      );
    },
  });
