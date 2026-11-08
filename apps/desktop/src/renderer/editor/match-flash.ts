import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * NAV-01, D-107, D-143: a note's line reached from the Ctrl+K palette shows what was found as find
 * does: the words searched for in that line, lit like Ctrl+F's current match (editor.css), held
 * a moment, then fading. Gone at the first edit, when the fade ends, or with the next one.
 */

/** How long the light lasts (`fl-match-flash` in editor.css). */
export const MATCH_FLASH_MS = 1600;

/** What the palette found in a note's line. */
export interface LineMatch {
  /** The line as the palette showed it: trimmed, and cut short with "…" past 119 characters. */
  readonly text: string;
  /** The letters of `text` that matched. */
  readonly indices: readonly number[];
  /** Matched only loosely (a word's letters in order, not the word): the whole text lights. */
  readonly loose: boolean;
}

/**
 * Where to light in the line's text (from, to within the line): each run of matched letters (a
 * word searched for), or the whole of its text when the search matched only loosely, nothing of
 * it fell in what the palette showed, or the line is no longer what it found.
 */
export function matchRanges(line: string, match: LineMatch): Array<readonly [number, number]> {
  const text = line.trim();
  if (text === '') return [];
  const lead = line.length - line.trimStart().length;
  const shown = match.text.endsWith('…') ? match.text.slice(0, -1) : match.text;
  const whole: Array<readonly [number, number]> = [[lead, lead + text.length]];
  if (match.loose || match.indices.length === 0 || !text.startsWith(shown)) return whole;
  const runs: Array<readonly [number, number]> = [];
  let start = -1;
  let end = -1;
  for (const at of [...match.indices].sort((a, b) => a - b)) {
    if (at < 0 || at >= shown.length) continue;
    if (at === end) end = at + 1;
    else {
      if (start >= 0) runs.push([lead + start, lead + end]);
      start = at;
      end = at + 1;
    }
  }
  if (start >= 0) runs.push([lead + start, lead + end]);
  return runs.length > 0 ? runs : whole;
}

const lit = Decoration.mark({ class: 'fl-match-flash' });

const setFlash = StateEffect.define<{ readonly id: number; readonly ranges: DecorationSet }>();
const endFlash = StateEffect.define<number>();

interface Flash {
  readonly id: number;
  readonly ranges: DecorationSet;
}

const NONE: Flash = { id: 0, ranges: Decoration.none };

const flashField = StateField.define<Flash>({
  create: () => NONE,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setFlash)) next = effect.value;
      else if (effect.is(endFlash) && effect.value === next.id) next = NONE;
    }
    // D-75: interruptible: the first edit ends it.
    return tr.docChanged ? NONE : next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.ranges),
    // The fade runs on the editor, which its marks read (editor.css): a line drawn anew mid-fade
    // doesn't start it again. Two names, so one flash right after another starts afresh.
    EditorView.editorAttributes.from(field, (value) =>
      value.id === 0 ? {} : { class: value.id % 2 ? 'fl-match-flash-a' : 'fl-match-flash-b' },
    ),
  ],
});

/** The note editor's part of it. */
export function matchFlash(): Extension {
  return flashField;
}

let flashes = 0;

/** Lights these ranges of the note, then ends the light after the fade. */
export function flashMatches(
  view: EditorView,
  ranges: ReadonlyArray<{ readonly from: number; readonly to: number }>,
): void {
  const marks = ranges
    .filter((range) => range.to > range.from && range.to <= view.state.doc.length)
    .map((range) => lit.range(range.from, range.to));
  if (marks.length === 0) return;
  flashes += 1;
  const id = flashes;
  view.dispatch({ effects: setFlash.of({ id, ranges: Decoration.set(marks, true) }) });
  window.setTimeout(() => {
    if (view.dom.isConnected && view.state.field(flashField, false)?.id === id)
      view.dispatch({ effects: endFlash.of(id) });
  }, MATCH_FLASH_MS);
}

/** For tests: the ranges lit now. */
export function litRanges(state: EditorView['state']): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  state.field(flashField, false)?.ranges.between(0, state.doc.length, (from, to) => {
    out.push([from, to]);
  });
  return out;
}

export const matchFlashForTests = { setFlash, endFlash, field: flashField };
