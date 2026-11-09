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
