import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  editDistance,
  isValidListName,
  listToken,
  normalizeListName,
  resolveList,
  suggestLists,
  type ListInfo,
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
    expect(capture('x ##unis').target).toEqual({
      kind: 'close-match',
      list: unicorn,
      name: 'unis',
    });
    expect(capture('x ##unis', { chooseNewList: true }).target).toEqual({
      kind: 'new',
      name: 'unis',
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
});

describe('list helpers', () => {
  it('normalizes and tokenizes names', () => {
    expect(normalizeListName('Meeting  notes_2')).toBe('meetingnotes2');
    expect(listToken('Meeting notes')).toBe('Meeting-notes');
  });

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
    expect(suggestLists('in', lists).map((list) => list.name)).toEqual(['Inbox', 'Infra']);
    expect(suggestLists('stream', lists).map((list) => list.name)).toEqual(['Unicorn']);
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
    '##unis',
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
});
