/**
 * The conflict card in notes (SYNC-01, D-161 Q5, docs/04 §7): a `> [!conflict]` callout that sync
 * wrote shows as a card with the other version and three buttons, Use <device>'s, Keep mine and
 * Keep both, named from this PC's side. Each is one edit (one undo step). With the caret inside the
 * callout its raw lines show, as any markdown does on the caret's line.
 */
import { EditorState, StateField, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import {
  findConflicts,
  resolveConflict,
  type ConflictBlock,
  type Resolution,
} from '@flint/core/sync';

/** This PC's name (Windows computer name), from sync's status: the buttons' "mine". */
let thisDevice = '';
export function setConflictDevice(name: string): void {
  thisDevice = name;
}

function docLines(doc: Text): string[] {
  const lines: string[] = [];
  for (let at = 1; at <= doc.lines; at++) lines.push(doc.line(at).text);
  return lines;
}

/** The buttons, from this PC's side (D-161: they name the source). */
export function conflictButtons(
  block: ConflictBlock,
  device: string,
): { readonly how: Resolution; readonly label: string }[] {
  const theirsIsMe = block.theirs.toUpperCase() === device.toUpperCase();
  const mineIsMe = block.mine === null || block.mine.toUpperCase() === device.toUpperCase();
  const use = theirsIsMe ? 'Use mine' : `Use ${block.theirs}'s`;
  const keep = mineIsMe && !theirsIsMe ? 'Keep mine' : `Keep ${block.mine ?? 'this'}'s`;
  return [
    ...(block.mineCount !== null ? [{ how: 'theirs' as const, label: use }] : []),
    { how: 'mine', label: keep },
    { how: 'both', label: 'Keep both' },
  ];
}

class ConflictWidget extends WidgetType {
  readonly block: ConflictBlock;
  readonly index: number;

  constructor(block: ConflictBlock, index: number) {
    super();
    this.block = block;
    this.index = index;
  }

  override eq(other: ConflictWidget): boolean {
    return (
      other.index === this.index &&
      other.block.theirs === this.block.theirs &&
      other.block.when === this.block.when &&
      other.block.lines.join('\n') === this.block.lines.join('\n')
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement('div');
    card.className = 'cm-fl-conflict';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `Also changed on ${this.block.theirs}`);
    const head = document.createElement('div');
    head.className = 'cm-fl-conflict-head';
    head.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3"/></svg>';
    head.append(`Also changed on ${this.block.theirs} · ${this.block.when}`);
    const text = document.createElement('div');
    text.className = 'cm-fl-conflict-text';
    text.textContent =
      this.block.lines.length > 0 ? this.block.lines.join('\n') : 'Deleted these lines.';
    const buttons = document.createElement('div');
    buttons.className = 'cm-fl-conflict-buttons';
    for (const { how, label } of conflictButtons(this.block, thisDevice)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = how === 'both' ? 'quiet-button small' : 'secondary-button small';
      button.textContent = label;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => resolve(view, this.index, how));
      buttons.append(button);
    }
    card.append(head, text, buttons);
    return card;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** Resolves the `index`-th conflict as one change: only the lines that differ are replaced. */
export function resolve(view: EditorView, index: number, how: Resolution): void {
  const before = view.state.doc.toString();
  const after = resolveConflict(before, index, how);
  if (after === before) return;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  view.dispatch({
    changes: { from: start, to: endBefore, insert: after.slice(start, endAfter) },
    selection: { anchor: start },
    userEvent: 'input.conflict',
  });
}

function decorate(state: EditorState): DecorationSet {
  const doc = state.doc;
  const blocks = findConflicts(docLines(doc));
  if (blocks.length === 0) return Decoration.none;
  const head = state.selection.main.head;
  const ranges: Range<Decoration>[] = [];
  blocks.forEach((block, index) => {
    const from = doc.line(block.start + 1).from;
    const to = doc.line(block.end).to;
    // The caret inside: the raw callout, to edit by hand.
    if (head >= from && head <= to) return;
    ranges.push(
      Decoration.replace({ widget: new ConflictWidget(block, index), block: true }).range(from, to),
    );
  });
  return Decoration.set(ranges);
}

/** The conflict cards (a StateField: block decorations that replace line breaks need one). */
export const conflictView = StateField.define<DecorationSet>({
  create: (state) => decorate(state),
  update: (value, tr) => (tr.docChanged || tr.selection ? decorate(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});
