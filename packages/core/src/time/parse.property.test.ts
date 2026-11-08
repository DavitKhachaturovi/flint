import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toDate } from './local-datetime.js';
import { matchTime } from './parse.js';

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);

const piece = fc.constantFrom(
  'in',
  'at',
  'next',
  'tomorrow',
  'today',
  'fri',
  'thu',
  'nov',
  '2',
  '10',
  '15:00',
  '3pm',
  '12am',
  '2h',
  '1h30m',
  '0m',
  '3d',
  '2.11',
  '29.10',
  '2026-11-02',
  'people',
  '99',
  '',
);

describe('property: matchTime', () => {
  it(
    'never throws, never returns a past time, never reads past the input',
    () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ maxLength: 40 }),
            fc.array(piece, { maxLength: 6 }).map((parts) => parts.join(' ')),
          ),
          fc.date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31), noInvalidDate: true }),
          (text, now) => {
            const match = matchTime(text, { now });
            if (!match) return;
            expect(match.length).toBeGreaterThan(0);
            expect(match.length).toBeLessThanOrEqual(text.length);
            expect(toDate(match.at).getTime()).toBeGreaterThan(now.getTime() - 60_000);
          },
        ),
        { numRuns: RUNS },
      );
    },
    Math.max(5_000, RUNS * 2),
  );

  it(
    'reads only the first six words: what follows them never changes the result',
    () => {
      const words = fc.array(
        piece.filter((word) => word !== ''),
        { minLength: 6, maxLength: 6 },
      );
      const space = fc.constantFrom(' ', '  ', '\t');
      fc.assert(
        fc.property(words, fc.string({ maxLength: 20 }), space, (six, tail, gap) => {
          const now = new Date(2026, 9, 29, 14, 30);
          const head = six.join(gap);
          expect(matchTime(`${head}${gap}${tail}`, { now })).toEqual(matchTime(head, { now }));
          expect(matchTime(`${head} 15:00 tomorrow`, { now })).toEqual(matchTime(head, { now }));
        }),
        { numRuns: RUNS },
      );
    },
    Math.max(5_000, RUNS * 2),
  );

  it(
    'a text whose first word no expression starts with is never a time',
    () => {
      const now = new Date(2026, 9, 29, 14, 30);
      const lead = fc.constantFrom('alex', 'x', '@', 'nextweek', 'friday,', 'in20m', 'at3pm', '#1');
      fc.assert(
        fc.property(lead, fc.array(piece, { maxLength: 5 }), (first, rest) => {
          expect(matchTime([first, ...rest].join(' '), { now })).toBeNull();
        }),
        { numRuns: RUNS },
      );
    },
    Math.max(5_000, RUNS * 2),
  );
});

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
