import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  editDistance,
  isValidListName,
  listResolver,
  listToken,
  normalizeListName,
  resolveList,
  suggestLists,
  type ListInfo,
  type ListResolution,
} from './lists.js';
import { listTokenAt, parseCapture, type ShorthandContext } from './parse.js';

const RUNS = Number(process.env.FLINT_FUZZ_RUNS ?? 2000);

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

describe('parseCapture: the examples in CAP-03', () => {
  it('fix token refresh !h ##unicorn', () => {
    const result = capture('fix token refresh !h ##unicorn');
    expect(result.title).toBe('fix token refresh');
    expect(result.priority).toBe('high');
    expect(result.target).toEqual({ kind: 'existing', list: unicorn });
  });

  it('deploy hotfix !h @30m', () => {
    const result = capture('deploy hotfix !h @30m');
    expect(result.title).toBe('deploy hotfix');
    expect(result.reminder).toMatchObject({ day: 29, hour: 15, minute: 0 });
    expect(result.reminderLabel).toBe('Today 15:00');
    expect(result.target).toEqual({ kind: 'inbox' });
  });

  it('fix regression from #123 ##infra: a single # is text', () => {
    const result = capture('fix regression from #123 ##infra');
    expect(result.title).toBe('fix regression from #123');
    expect(result.target).toEqual({ kind: 'existing', list: infra });
  });

  it('reads tokens anywhere in the line', () => {
    const result = capture('!m ##infra rotate @tomorrow 10 the cert');
    expect(result.title).toBe('rotate the cert');
    expect(result.priority).toBe('medium');
    expect(result.reminderLabel).toBe('Tomorrow 10:00');
  });
});

describe('parseCapture: what is not a token', () => {
  it.each([
    ['email @alex about it', 'email @alex about it'],
    ['foo##bar stays', 'foo##bar stays'],
    ['alex@example.com', 'alex@example.com'],
    ['learn C# and #bug and #hotfix', 'learn C# and #bug and #hotfix'],
    ['this is !important', 'this is !important'],
    ['wow!h', 'wow!h'],
    ['run `##infra !h @30m` in a shell', 'run `##infra !h @30m` in a shell'],
    ['## heading-like', '## heading-like'],
    ['@yesterday', '@yesterday'],
  ])('%j', (input, title) => {
    const result = capture(input);
    expect(result.title).toBe(title);
    expect(result.priority).toBeNull();
    expect(result.reminder).toBeNull();
    expect(result.target).toEqual({ kind: 'inbox' });
  });

  it('a backslash escapes a token and is removed', () => {
    const result = capture('\\##infra \\!h \\@30m stay literal');
    expect(result.title).toBe('##infra !h @30m stay literal');
    expect(result.target).toEqual({ kind: 'inbox' });
  });
});

describe('parseCapture: several tokens of one kind (D-25)', () => {
  it('the last valid one wins; the others stay as text and are counted', () => {
    const result = capture('deploy !l ##infra ##unicorn !h');
    expect(result.title).toBe('deploy !l ##infra');
    expect(result.priority).toBe('high');
    expect(result.target).toEqual({ kind: 'existing', list: unicorn });
    expect(result.counts).toEqual({ priority: 2, list: 2, reminder: 0 });
    expect(result.tokens.map((token) => token.role)).toEqual([
      'extra',
      'extra',
      'winner',
      'winner',
    ]);
  });

  it('applies to reminders too (Proposed)', () => {
    const result = capture('call @15:00 then @16:00');
    expect(result.title).toBe('call @15:00 then');
    expect(result.reminderLabel).toBe('Today 16:00');
  });
});

describe('parseCapture: lists (CAP-05, D-25)', () => {
  it('matches ignoring case, spaces, hyphens and underscores', () => {
    expect(capture('x ##UNI_corn').target).toEqual({ kind: 'existing', list: unicorn });
  });

  it('a note stays as text and the task goes to Inbox', () => {
    const result = capture('agenda ##meeting-notes');
    expect(result.title).toBe('agenda ##meeting-notes');
    expect(result.target).toEqual({ kind: 'inbox' });
    expect(result.ignoredLists).toEqual([{ kind: 'note', list: meeting }]);
    expect(result.tokens[0]?.role).toBe('ignored');
  });

  it('a note token does not stop a later list from winning', () => {
    const result = capture('agenda ##meeting-notes ##infra');
    expect(result.title).toBe('agenda ##meeting-notes');
    expect(result.target).toEqual({ kind: 'existing', list: infra });
  });

  it('offers a close match for a prefix; Enter takes it, Tab makes a new list', () => {
    expect(capture('x ##unic').target).toEqual({
      kind: 'close-match',
      list: unicorn,
      name: 'unic',
    });
    expect(capture('x ##unic', { chooseNewList: true }).target).toEqual({
      kind: 'new',
      name: 'unic',
    });
  });

  it('creates a new list named as typed when nothing is close', () => {
    expect(capture('x ##Release-2026').target).toEqual({ kind: 'new', name: 'Release-2026' });
  });

  it('keeps a name Windows rejects as text', () => {
    const result = capture('x ##con');
    expect(result.title).toBe('x ##con');
    expect(result.target).toEqual({ kind: 'inbox' });
    expect(result.ignoredLists).toEqual([{ kind: 'invalid-name', name: 'con' }]);
  });

  it('takes Georgian list names, and trailing punctuation is not part of the token', () => {
    expect(capture('x ##სამუშაო').target).toEqual({ kind: 'existing', list: georgian });
    const result = capture('fix it ##infra, then deploy');
    expect(result.title).toBe('fix it, then deploy');
    expect(result.target).toEqual({ kind: 'existing', list: infra });
    expect(capture('x ##infra.').target).toEqual({ kind: 'existing', list: infra });
  });
});

describe('parseCapture: list names of several words (D-87)', () => {
  const one: ListInfo = { id: 'n1l', name: 'new list 1', mode: 'tasks' };
  const two: ListInfo = { id: 'n2l', name: 'new list 2', mode: 'tasks' };
  const many = [inbox, one, two, meeting];

  it('takes the longest existing name the words spell out', () => {
    const result = capture('ship it ##new list 2 today', { lists: many });
    expect(result.target).toEqual({ kind: 'existing', list: two });
    expect(result.title).toBe('ship it today');
    expect(capture('##New-List 1 notes', { lists: many }).target).toEqual({
      kind: 'existing',
      list: one,
    });
    // A note of several words is found too (and stays text, D-25).
    expect(capture('agenda ##meeting notes', { lists: many }).target).toEqual({ kind: 'inbox' });
    expect(capture('agenda ##meeting notes', { lists: many }).title).toBe('agenda ##meeting notes');
  });

  it('falls back to the one-word rules when no name of several words matches', () => {
    expect(capture('##new list 3', { lists: many }).target).toMatchObject({
      kind: 'close-match',
      name: 'new',
    });
    expect(capture('##new2 list', { lists: many }).target).toEqual({ kind: 'new', name: 'new2' });
  });
});

describe('parseCapture: lines', () => {
  it('reads shorthand on the first line only; the rest is the body, verbatim', () => {
    const result = capture('crash in importer !h\nat Foo(@30m) !l ##infra\n  at Bar');
    expect(result.title).toBe('crash in importer');
    expect(result.priority).toBe('high');
    expect(result.target).toEqual({ kind: 'inbox' });
    expect(result.body).toBe('at Foo(@30m) !l ##infra\n  at Bar');
  });

  it('keeps an empty title when only tokens were typed', () => {
    expect(capture('!h ##infra').title).toBe('');
  });
});

describe('resolveList (D-25)', () => {
  it('prefers an exact spelling among lists that normalize the same, then sidebar order', () => {
    const a: ListInfo = { id: 'a', name: 'Foo bar', mode: 'tasks' };
    const b: ListInfo = { id: 'b', name: 'foo-bar', mode: 'tasks' };
    expect(resolveList('foo-bar', [a, b])).toEqual({ kind: 'existing', list: b });
    expect(resolveList('FOOBAR', [a, b])).toEqual({ kind: 'existing', list: a });
  });

  it('a task list wins over a note with the same name', () => {
    const note: ListInfo = { id: 'n', name: 'Infra', mode: 'note' };
    expect(resolveList('infra', [note, infra])).toEqual({ kind: 'existing', list: infra });
  });

  it('several prefix matches: the most recently used one', () => {
    expect(resolveList('uni', lists)).toEqual({ kind: 'close-match', list: units, name: 'uni' });
  });

  it('typos within edit distance 2, or 1 for short names', () => {
    expect(resolveList('unicron', lists)).toMatchObject({ kind: 'close-match', list: unicorn });
    expect(resolveList('infar', lists)).toMatchObject({ kind: 'close-match', list: infra });
    expect(resolveList('inbx', lists)).toMatchObject({ kind: 'close-match', list: inbox });
    expect(resolveList('zzzz', lists)).toEqual({ kind: 'new', name: 'zzzz' });
    const ops: ListInfo = { id: 'o', name: 'Ops', mode: 'tasks' };
    expect(resolveList('opx', [ops])).toMatchObject({ kind: 'close-match', list: ops });
    expect(resolveList('oxx', [ops])).toEqual({ kind: 'new', name: 'oxx' });
  });

  it('a one-letter prefix is not a close match', () => {
    expect(resolveList('u', lists)).toEqual({ kind: 'new', name: 'u' });
  });

  it(
    'property: resolves every name as the original resolveList did (js/polynomial-redos fix)',
    () => {
      // The resolver before the fix: each list's name normalized for every name, the edit distance
      // worked out for every task list, and sidebar order found with indexOf.
      function reference(name: string, all: readonly ListInfo[]): ListResolution {
        const normalized = normalizeListName(name);
        const same = all.filter((list) => normalizeListName(list.name) === normalized);
        const sameTasks = same.filter((list) => list.mode === 'tasks');
        const exact = sameTasks.find((list) => list.name === name) ?? sameTasks[0];
        if (exact) return { kind: 'existing', list: exact };
        if (same[0]) return { kind: 'note', list: same[0] };
        const taskLists = all.filter((list) => list.mode === 'tasks');
        const order = (a: ListInfo, b: ListInfo): number =>
          (a.recentRank ?? Infinity) - (b.recentRank ?? Infinity) ||
          all.indexOf(a) - all.indexOf(b);
        if (normalized.length >= 2) {
          const first = taskLists
            .filter((list) => normalizeListName(list.name).startsWith(normalized))
            .sort(order)[0];
          if (first) return { kind: 'close-match', list: first, name };
        }
        const typo = taskLists
          .map((list) => {
            const candidate = normalizeListName(list.name);
            const limit = candidate.length <= 4 ? 1 : 2;
            return { list, distance: editDistance(normalized, candidate), limit };
          })
          .filter(({ distance, limit }) => distance <= limit)
          .sort((a, b) => a.distance - b.distance || order(a.list, b.list))[0];
        if (typo) return { kind: 'close-match', list: typo.list, name };
        return isValidListName(name) ? { kind: 'new', name } : { kind: 'invalid-name', name };
      }
      const word = fc
        .array(fc.constantFrom(...'abcab -_.ქ'), { maxLength: 9 })
        .map((chars) => chars.join(''));
      const list = fc.record({
        name: word,
        mode: fc.constantFrom<'tasks' | 'note'>('tasks', 'tasks', 'note'),
        recentRank: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
      });
      fc.assert(
        fc.property(
          fc.array(list, { maxLength: 8 }),
          fc.array(word, { maxLength: 6 }),
          (all, names) => {
            // Distinct ids, so a wrong pick among lists of the same name can't pass as equal.
            const own = all.map(({ recentRank, ...rest }, index): ListInfo => {
              const one = { ...rest, id: `l${index}` };
              return recentRank === undefined ? one : { ...one, recentRank };
            });
            // The same list object twice: its sidebar place is the first, as indexOf found it.
            const doubled = own[0] ? [...own, own[0]] : own;
            const resolve = listResolver(doubled);
            for (const name of names) expect(resolve(name)).toEqual(reference(name, doubled));
          },
        ),
        { numRuns: RUNS },
      );
    },
    Math.max(5_000, RUNS * 2),
  );
});

describe('list helpers', () => {
  it('normalizes and tokenizes names', () => {
    expect(normalizeListName('Meeting  notes_2')).toBe('meetingnotes2');
    expect(listToken('Meeting notes')).toBe('Meeting-notes');
  });

  it(
    'property: a run of words normalizes as its words one by one (D-87 lookups, D-143)',
    () => {
      // Letters that compose (NFC) or lowercase by context (the final sigma), and marks that could
      // attach across a space if spaces didn't stop them.
      const chars = [
        ...'aZΣσΑß_-.1ქ',
        ...[0x301, 0x345, 0x130, 0x212a, 0x1100, 0x1161, 0x11a8, 0x3099, 0x304b].map((code) =>
          String.fromCharCode(code),
        ),
      ];
      const word = fc.array(fc.constantFrom(...chars), { minLength: 1, maxLength: 6 });
      const gap = fc.array(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 2 });
      fc.assert(
        fc.property(fc.array(fc.tuple(word, gap), { minLength: 1, maxLength: 8 }), (parts) => {
          const words = parts.map(([letters]) => letters.join(''));
          const run = parts.map(([letters, space]) => letters.join('') + space.join('')).join('');
          expect(normalizeListName(run)).toBe(words.map(normalizeListName).join(''));
        }),
        { numRuns: RUNS * 5 },
      );
    },
    Math.max(5_000, RUNS * 5),
  );

  it('validates Windows names', () => {
    for (const name of ['Inbox', 'v1.2', 'სამუშაო']) expect(isValidListName(name)).toBe(true);
    for (const name of ['con', 'NUL.txt', 'com1', 'a.', 'a?', ''])
      expect(isValidListName(name)).toBe(false);
  });

  it('counts swaps as one edit', () => {
    expect(editDistance('infar', 'infra')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('suggests task lists by prefix, substring, then letters in order', () => {
    expect(suggestLists('in', lists).map((list) => list.name)).toEqual([
      'Inbox',
      'Infra',
      'Unicorn',
    ]);
    expect(suggestLists('corn', lists).map((list) => list.name)).toEqual(['Unicorn']);
    expect(suggestLists('', lists).map((list) => list.name)).toEqual([
      'Units',
      'Inbox',
      'Unicorn',
      'Infra',
      'სამუშაო',
    ]);
  });

  it('finds the ## token under the caret', () => {
    expect(listTokenAt('fix ##uni now', 9)).toEqual({ start: 4, end: 9, typed: 'uni' });
    expect(listTokenAt('fix ##uni now', 8)).toEqual({ start: 4, end: 9, typed: 'un' });
    expect(listTokenAt('fix ##uni now', 11)).toBeNull();
    expect(listTokenAt('fix ##', 6)).toEqual({ start: 4, end: 6, typed: '' });
    expect(listTokenAt('fix #1', 6)).toBeNull();
  });
});

describe('property: parseCapture', () => {
  const word = fc.constantFrom(
    'fix',
    'deploy',
    '!h',
    '!low',
    '##infra',
    '##unic',
    '##con',
    '##meeting-notes',
    '@30m',
    '@tomorrow',
    '10',
    '@alex',
    '#123',
    '\\##x',
    '`##infra`',
    'ქართული',
    '',
  );
  it(
    'never throws; whatever is not a winning token stays in the title',
    () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ maxLength: 60 }),
            fc.array(word, { maxLength: 8 }).map((w) => w.join(' ')),
          ),
          (input) => {
            const result = capture(input);
            const line = input.split(/\r\n|\r|\n/)[0] ?? '';
            const winners = result.tokens.filter((token) => token.role === 'winner').length;
            if (winners === 0 && !line.includes('\\')) expect(result.title).toBe(line.trim());
            expect(result.title.length).toBeLessThanOrEqual(line.length);
          },
        ),
        { numRuns: RUNS },
      );
    },
    Math.max(5_000, RUNS * 2),
  );

  it(
    'a one-word ## token is the name without its trailing dots (as with the old /\\.+$/)',
    () => {
      const char = fc.constantFrom(...'..# ai-_`@1ქ\\');
      fc.assert(
        fc.property(fc.array(char, { maxLength: 40 }), (chars) => {
          const input = chars.join('');
          for (const token of capture(input).tokens) {
            if (token.kind !== 'list') continue;
            // The reference: the regexes the scanner used before the CodeQL js/polynomial-redos fix.
            const rest = input.slice(token.start + 2);
            const expected = (/^[\p{L}\p{N}_.-]+/u.exec(rest)?.[0] ?? '').replace(/\.+$/, '');
            expect(input.slice(token.start + 2, token.end)).toBe(expected);
          }
        }),
        { numRuns: RUNS },
      );
    },
    Math.max(5_000, RUNS * 2),
  );
});

/**
 * CodeQL js/polynomial-redos: the scanner runs on every keystroke in the capture popup (docs/05 §4:
 * shorthand parse < 1 ms per keystroke), and a pasted line can be long. Each shape below took time
 * quadratic in its length before (0.45 s to 16 s, and up to 7 s with hundreds of lists); now it is
 * linear, so 50,000 characters take at most about 25 ms. The limit leaves room for a machine five
 * times slower under the whole suite's load, while a quadratic parse still fails it. The best of
 * three runs is measured, so a GC pause doesn't fail the test either.
 */
describe('parseCapture: long pasted lines stay fast', () => {
  const size = 50_000;
  const LIMIT_MS = 250;
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
  const repeat = (piece: string): string => piece.repeat(Math.ceil(size / piece.length));

  function elapsed(input: string, extra: Partial<ShorthandContext> = {}): number {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      capture(input, extra);
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  it.each([
    ['## then dots then a letter', `##${'.'.repeat(size)}x`],
    ['## a name, dots, then a hyphen', `fix ##a${'.'.repeat(size)}-`],
    ['## then only dots', `fix ##${'.'.repeat(size)}`],
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
    ['## then dots and hyphens', `##${'.-'.repeat(size / 2)}x`],
    ['## then one long word', `##${'a'.repeat(size)}`],
    ['many different ## names', Array.from({ length: size / 6 }, (_, n) => `##t${n}`).join(' ')],
    ['many ## names close to a list', repeat('##project-1-releas ##projet-2 ')],
  ])(
    '%s',
    (_, input) => {
      expect(input.length).toBeGreaterThanOrEqual(size);
      capture(input.slice(0, 1000)); // Warms the JIT, so the time measured is the parse itself.
      expect(elapsed(input)).toBeLessThan(LIMIT_MS);
      expect(elapsed(input, { lists: many })).toBeLessThan(LIMIT_MS);
      expect(elapsed(input, { lists: crowded })).toBeLessThan(LIMIT_MS);
    },
    10_000,
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
