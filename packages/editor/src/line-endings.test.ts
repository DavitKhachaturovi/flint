import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromEditor, lineEndingOf, toEditor } from './line-endings.js';

/** D-141 (Q1, byte-exact files): a note's line endings survive the editor. */
describe('line endings in the note editor (D-141)', () => {
  it('keeps a note with Windows line endings as it is', () => {
    const text = '# Plan\r\n\r\n- one\r\n- two\r\n';
    expect(toEditor(text)).toBe('# Plan\n\n- one\n- two\n');
    expect(fromEditor(toEditor(text), lineEndingOf(text))).toBe(text);
  });

  it('keeps a note with Unix line endings as it is', () => {
    const text = 'one\ntwo';
    expect(lineEndingOf(text)).toBe('\n');
    expect(fromEditor(toEditor(text), lineEndingOf(text))).toBe(text);
  });

  it('gives a mixed note its dominant line ending', () => {
    expect(lineEndingOf('a\r\nb\r\nc\nd')).toBe('\r\n');
    expect(lineEndingOf('a\nb\nc\r\nd')).toBe('\n');
    expect(lineEndingOf('')).toBe('\n');
  });

  it('round-trips any text that uses one line ending throughout', () => {
    const line = fc.string({ unit: fc.constantFrom('a', 'ბ', ' ', '-', '|', '#', '\t') });
    fc.assert(
      fc.property(fc.array(line), fc.constantFrom('\n', '\r\n'), (lines, eol) => {
        const text = lines.join(eol);
        const back = fromEditor(toEditor(text), lines.length > 1 ? lineEndingOf(text) : '\n');
        expect(back).toBe(lines.length > 1 ? text : toEditor(text));
      }),
    );
  });
});
