import { describe, expect, it } from 'vitest';
import { backspacePair, followEdit, typePair, type PairState } from './auto-pair.js';

/** `|` marks the cursor, `[…]` would be a selection: here a helper that types a string key by key. */
function type(text: string, keys: string): PairState {
  let state: PairState = { value: text, start: text.length, end: text.length, auto: [] };
  for (const key of keys) {
    const next = typePair(state, key);
    if (next) state = next;
    else {
      const value = state.value.slice(0, state.start) + key + state.value.slice(state.end);
      state = {
        value,
        start: state.start + 1,
        end: state.start + 1,
        auto: followEdit(state.auto, state.value, value),
      };
    }
  }
  return state;
}

describe('auto-closing brackets and quotes (UI-09, D-57)', () => {
  it('pairs brackets and quotes, and steps over the closers it inserted', () => {
    expect(type('', 'fn(').value).toBe('fn()');
    expect(type('', 'fn(x)').value).toBe('fn(x)');
    expect(type('', 'a[1]{2}').value).toBe('a[1]{2}');
    expect(type('say ', '"hi"').value).toBe('say "hi"');
    expect(type('run ', '`npm test`').value).toBe('run `npm test`');
    const nested = type('', '((');
    expect(nested.value).toBe('(())');
    expect(nested.start).toBe(2);
    expect(type('', '(())').value).toBe('(())');
  });

  it("doesn't pair a quote after a letter, so contractions work", () => {
    expect(type('', "don't").value).toBe("don't");
    expect(type('it', "'").value).toBe("it'");
  });

  it('only steps over closers it inserted itself', () => {
    const typed: PairState = { value: 'a)', start: 1, end: 1, auto: [] };
    expect(typePair(typed, ')')).toBeNull();
  });

  it('wraps a selection', () => {
    expect(typePair({ value: 'see docs here', start: 4, end: 8, auto: [] }, '[')).toEqual({
      value: 'see [docs] here',
      start: 5,
      end: 9,
      auto: [],
    });
  });

  it("doesn't pair right before a word", () => {
    expect(typePair({ value: 'word', start: 0, end: 0, auto: [] }, '(')).toBeNull();
  });

  it('Backspace inside an empty pair it inserted removes both', () => {
    const state = type('fn', '(');
    expect(backspacePair(state)).toMatchObject({ value: 'fn', start: 2 });
    expect(backspacePair({ value: 'fn()', start: 3, end: 3, auto: [] })).toBeNull();
  });

  it('keeps track of its closers when text is typed before them', () => {
    const state = type('', '(');
    const edited = 'x()';
    expect(followEdit(state.auto, state.value, edited)).toEqual([2]);
  });
});
