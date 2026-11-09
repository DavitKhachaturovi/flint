import { describe, expect, it } from 'vitest';
import { type ListInfo } from './lists.js';
import { parseCapture, type ShorthandContext } from './parse.js';
import { expectLinear } from '../../test/scaling.js';

const inbox: ListInfo = { id: 'inbox', name: 'Inbox', mode: 'tasks' };
const unicorn: ListInfo = { id: 'u1', name: 'Unicorn', mode: 'tasks' };
const infra: ListInfo = { id: 'i1', name: 'Infra', mode: 'tasks' };
const units: ListInfo = { id: 'u2', name: 'Units', mode: 'tasks', recentRank: 0 };
const meeting: ListInfo = { id: 'n1', name: 'Meeting notes', mode: 'note' };
const georgian: ListInfo = { id: 'g1', name: 'სამუშაო', mode: 'tasks' };
const lists = [inbox, unicorn, infra, units, meeting, georgian];

// Thursday 29 October 2026, 14:30.
const context: ShorthandContext = { now: new Date(2026, 9, 29, 14, 30), lists };

function capture(input: string, extra: Partial<ShorthandContext> = {}) {
  return parseCapture(input, { ...context, ...extra });
}

/**
 * CodeQL js/polynomial-redos: the scanner runs on every keystroke in the capture popup (docs/05 §4:
 * shorthand parse < 1 ms per keystroke), and a pasted line can be long. Each shape below took time
 * quadratic in its length before (0.45 s to 16 s, and up to 7 s with hundreds of lists); now it is
 * linear. D-156: judged by how the time grows from 20,000 to 80,000 characters (`expectLinear`),
 * not by a wall-clock limit, which a slow or busy runner failed (357 ms against 250 ms, 9 Nov
 * 2026) though nothing was wrong.
 */
describe('parseCapture: long pasted lines stay fast', () => {
  const size = 50_000;
  const MEASURED = 20_000;
  const many: ListInfo[] = [
    ...lists,
    { id: 'n1l', name: 'new list 1', mode: 'tasks' },
    { id: 'n2l', name: 'new list 2', mode: 'tasks' },
  ];
  // Hundreds of lists, with names of every length up to Windows' limit: each name after `##` is
  // compared with all of them (D-25), so their number must not multiply the cost of a long name.
  const crowded: ListInfo[] = [
    ...many,
    ...Array.from({ length: 200 }, (_, index): ListInfo => {
      const base = `Project ${String(index)} ${'release planning '.repeat(index % 12)}`.trim();
      return { id: `p${String(index)}`, name: base, mode: index % 7 === 0 ? 'note' : 'tasks' };
    }),
  ];
  /** `piece` repeated to at least `n` characters. */
  const repeat =
    (piece: string) =>
    (n: number): string =>
      piece.repeat(Math.ceil(n / piece.length));

  it.each<[string, (n: number) => string]>([
    ['## then dots then a letter', (n) => `##${'.'.repeat(n)}x`],
    ['## a name, dots, then a hyphen', (n) => `fix ##a${'.'.repeat(n)}-`],
    ['## then only dots', (n) => `fix ##${'.'.repeat(n)}`],
    ['many ## tokens with dots inside', repeat(`##${'.'.repeat(60)}x `)],
    ['many ## tokens', repeat('##a ')],
    ['many lone @', repeat('@ ')],
    ['many @ before words', repeat('@x ')],
    ['many @ before numbers', repeat('@10 ')],
    ['many @ before six numbers each', repeat('@1 1 1 1 1 1 ')],
    ['many @ before a full time', repeat('@tomorrow 10 ')],
    ['many inline code spans', repeat('`a` ')],
    ['code spans between tokens', repeat('`a` ##b @c !h ')],
    ['many escapes', repeat('\\##a ')],
    ['many ! tokens', repeat('!x ')],
    ['## then dots and hyphens', (n) => `##${'.-'.repeat(n / 2)}x`],
    ['## then one long word', (n) => `##${'a'.repeat(n)}`],
    [
      'many different ## names',
      (n) => Array.from({ length: Math.ceil(n / 6) }, (_, at) => `##t${at}`).join(' '),
    ],
    ['many ## names close to a list', repeat('##project-1-releas ##projet-2 ')],
  ])(
    '%s',
    (_, make) => {
      expect(make(size).length).toBeGreaterThanOrEqual(size);
      for (const lists of [undefined, many, crowded])
        expectLinear(make, (input) => capture(input, lists ? { lists } : {}), MEASURED);
    },
    30_000,
  );

  it('still reads the tokens of a long line correctly', () => {
    const words = 'word '.repeat(size / 5);
    const result = capture(`${words}##infra${'.'.repeat(size)} !h @tomorrow 10`);
    expect(result.target).toEqual({ kind: 'existing', list: infra });
    expect(result.priority).toBe('high');
    expect(result.reminderLabel).toBe('Tomorrow 10:00');
    expect(result.title).toBe(`${words.trimEnd()}${'.'.repeat(size)}`);
    expect(capture(`x ##${'.'.repeat(size)}x`).tokens).toEqual([
      { kind: 'list', start: 2, end: size + 5, role: 'ignored' },
    ]);
    const spans = capture(`${'`##infra` '.repeat(size / 10)}##unicorn`);
    expect(spans.target).toEqual({ kind: 'existing', list: unicorn });
    expect(spans.counts.list).toBe(1);
  });
});
