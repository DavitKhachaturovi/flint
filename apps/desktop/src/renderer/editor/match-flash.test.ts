import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { fuzzyMatch } from '../../shared/fuzzy.js';
import { litRanges, matchFlashForTests, matchRanges } from './match-flash.js';

/** NAV-01, D-143: what Ctrl+K found in a note's line, lit as find's current match. */

const found = (query: string, line: string, loose = false) => {
  const text = line.trim();
  const match = fuzzyMatch(query, text);
  if (!match) throw new Error(`no match for ${query}`);
  return { text, indices: match.indices, loose };
};

const pieces = (line: string, ranges: ReadonlyArray<readonly [number, number]>): string[] =>
  ranges.map(([from, to]) => line.slice(from, to));

describe('matchRanges (D-143)', () => {
  it('lights each word searched for, where it is in the line', () => {
    const line = 'The quick brown needle is here';
    expect(pieces(line, matchRanges(line, found('brown needle', line)))).toEqual([
      'brown',
      'needle',
    ]);
  });

  it('counts the line’s indent and list marker (the palette trims the line)', () => {
    const line = '    - [ ] Ship the brown box';
    expect(pieces(line, matchRanges(line, found('brown', line)))).toEqual(['brown']);
  });

  it('lights the line’s text when the search matched only loosely', () => {
    const line = '  Quick brown fox';
    expect(pieces(line, matchRanges(line, found('qbf', line, true)))).toEqual(['Quick brown fox']);
  });

  it('lights the line’s text when the line changed since the search', () => {
    const line = 'Something else now';
    expect(
      pieces(line, matchRanges(line, { text: 'The brown fox', indices: [4, 5], loose: false })),
    ).toEqual(['Something else now']);
  });

  it('takes a long line shown cut short, and words past the cut light the whole text', () => {
    const line = `${'word '.repeat(30)}needle`;
    const text = line.trim();
    const shown = `${text.slice(0, 119)}…`;
    const early = fuzzyMatch('word', text);
    expect(
      pieces(line, matchRanges(line, { text: shown, indices: early?.indices ?? [], loose: false })),
    ).toEqual(['word']);
    expect(matchRanges(line, { text: shown, indices: [], loose: false })).toEqual([
      [0, text.length],
    ]);
  });

  it('lights nothing on a blank line', () => {
    expect(matchRanges('   ', { text: '', indices: [], loose: false })).toEqual([]);
  });
});

describe('the light in the editor (D-143)', () => {
  const { setFlash, endFlash, field } = matchFlashForTests;
  const lit = (state: EditorState, id: number, from: number, to: number): EditorState =>
    state.update({
      effects: setFlash.of({ id, ranges: Decoration.set([Decoration.mark({}).range(from, to)]) }),
    }).state;

  it('goes at the first edit (D-75: interruptible)', () => {
    let state = EditorState.create({ doc: 'The quick brown fox', extensions: [field] });
    state = lit(state, 1, 10, 15);
    expect(litRanges(state)).toEqual([[10, 15]]);
    // Moving the caret keeps it; typing ends it.
    state = state.update({ selection: { anchor: 3 } }).state;
    expect(litRanges(state)).toEqual([[10, 15]]);
    state = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(litRanges(state)).toEqual([]);
  });

  it('goes when its fade ends, but not when an older one’s does', () => {
    let state = EditorState.create({ doc: 'The quick brown fox', extensions: [field] });
    state = lit(state, 1, 10, 15);
    state = lit(state, 2, 4, 9);
    state = state.update({ effects: endFlash.of(1) }).state;
    expect(litRanges(state)).toEqual([[4, 9]]);
    state = state.update({ effects: endFlash.of(2) }).state;
    expect(litRanges(state)).toEqual([]);
  });
});
