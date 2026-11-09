import { describe, expect, it } from 'vitest';
import { matchTime } from './parse.js';
/**
 * CodeQL js/polynomial-redos: the capture shorthand calls matchTime at every `@` of a line, with
 * the rest of the line, so each call must cost no more than its first words, however long the text.
 * Each case takes at most about 15 ms; the limit leaves room for a machine five times slower under
 * the whole suite's load, while reading the whole text at each call takes seconds.
 */
describe('matchTime: long text', () => {
  const size = 50_000;
  const LIMIT_MS = 250;
  const now = new Date(2026, 9, 29, 14, 30);

  /** The best of three runs, so a busy machine or a GC pause doesn't fail the test. */
  function elapsed(run: () => void): number {
    let best = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  it.each([
    ['many words', 'x '.repeat(size / 2)],
    ['many short numbers', '1 '.repeat(size / 2)],
    ['many numbers after a word that can start one', `in ${'1 '.repeat(size / 2)}`],
    ['many spaces first', `${' '.repeat(size)}10`],
  ])(
    '%s: a call reads only the first words',
    (_, text) => {
      matchTime(text, { now }); // Warms the JIT.
      // A 50,000-character line holds about 4,000 `@` with six words after each (`@1 1 1 1 1 1 `),
      // and the capture shorthand calls matchTime at each of them.
      const calls = (): void => {
        for (let call = 0; call < 4_000; call++) matchTime(text, { now });
      };
      expect(elapsed(calls)).toBeLessThan(LIMIT_MS);
    },
    10_000,
  );

  it.each([
    ['one long number', '1'.repeat(size)],
    ['six long numbers', Array.from({ length: 6 }, () => '1'.repeat(size / 6)).join(' ')],
    ['a number then many letters', `1${'a'.repeat(size)}!`],
    ['in, then a long number', `in ${'1'.repeat(size)} ${'m'.repeat(size)}`],
    ['next, then many letters', `next ${'f'.repeat(size)}`],
    ['a long day then a time', `${'a'.repeat(size)} at 10`],
    ['a long number of digits and colons', `1${'1:'.repeat(size / 2)}x`],
    ['a long date of dots', `1${'.1'.repeat(size / 2)} at 10`],
  ])(
    '%s: linear in the first words',
    (_, text) => {
      matchTime(text.slice(0, 1000), { now }); // Warms the JIT.
      expect(elapsed(() => matchTime(text, { now }))).toBeLessThan(LIMIT_MS);
    },
    10_000,
  );
});
