import { describe, expect, it } from 'vitest';
import { escapeTitle, formatTaskContent, parseTaskContent } from './fields.js';

describe('parseTaskContent: Flint fields (D-21)', () => {
  it('reads Flint fields at the end of the line', () => {
    const content = parseTaskContent(
      'Fix null ref [reminder:: 2026-10-30T15:00] [priority:: high] [id:: k3f9]',
    );
    expect(content.title).toBe('Fix null ref');
    expect(content.fields.priority?.value).toBe('high');
    expect(content.fields.reminder?.value.value).toEqual({
      year: 2026,
      month: 10,
      day: 30,
      hour: 15,
      minute: 0,
      second: 0,
    });
    expect(content.fields.id?.value).toBe('k3f9');
  });

  it('reads Flint fields anywhere in the line, and closes the gap they leave', () => {
    const content = parseTaskContent('Fix [priority:: high] the bug');
    expect(content.title).toBe('Fix the bug');
    expect(content.fields.priority?.value).toBe('high');
  });

  it('separates words a glued field joined', () => {
    expect(parseTaskContent('glued[today:: true]text').title).toBe('glued text');
  });

  it('accepts parentheses, no space after ::, and any letter case for Flint keys', () => {
    const content = parseTaskContent('Call (Priority::HIGH) [TODAY:: True]');
    expect(content.title).toBe('Call');
    expect(content.fields.priority?.value).toBe('high');
    expect(content.fields.today?.value).toBe(true);
  });

  it('reads Obsidian Tasks lowest/highest as low/high but keeps the raw text', () => {
    const content = parseTaskContent('Review [priority:: highest]');
    expect(content.fields.priority).toEqual({
      value: 'high',
      raw: { key: 'priority', value: 'highest' },
    });
    expect(formatTaskContent(content)).toBe('Review [priority:: highest]');
  });

  it('accepts date-only and seconds forms of reminder and completion', () => {
    expect(parseTaskContent('a [completion:: 2026-10-27]').fields.completion?.value.dateOnly).toBe(
      true,
    );
    expect(
      parseTaskContent('a [reminder:: 2026-10-27T09:30:15]').fields.reminder?.value.value.second,
    ).toBe(15);
  });

  it('keeps a Flint key with an invalid value as visible title text', () => {
    const content = parseTaskContent('Deploy hotfix [priority:: urgent] [reminder:: tomorrow]');
    expect(content.title).toBe('Deploy hotfix [priority:: urgent] [reminder:: tomorrow]');
    expect(content.fields).toEqual({});
    expect(parseTaskContent('x [reminder:: 2026-02-30T10:00]').fields.reminder).toBeUndefined();
    expect(parseTaskContent('x [today:: false]').title).toBe('x [today:: false]');
    expect(parseTaskContent('x [id:: has space]').fields.id).toBeUndefined();
  });

  it('uses the first valid occurrence of a Flint key; repeats stay visible', () => {
    const content = parseTaskContent('Two [priority:: high] [priority:: low] [id:: two2]');
    expect(content.fields.priority?.value).toBe('high');
    expect(content.title).toBe('Two [priority:: low]');
    expect(content.fields.id?.value).toBe('two2');
  });
});

describe('parseTaskContent: unknown fields and developer text (D-21)', () => {
  it('reads unknown fields in the trailing run when spaced', () => {
    const content = parseTaskContent('Review design [due:: 2026-11-02] [id:: dcf64c]');
    expect(content.title).toBe('Review design');
    expect(content.unknown).toEqual([{ key: 'due', value: '2026-11-02' }]);
  });

  it('keeps `::` developer text in titles', () => {
    for (const title of [
      'Check [Vec::new] behaviour',
      'Profile (std::move) usage in the importer',
      'Profile the importer (std::move)',
      'Rename Foo::Bar',
    ]) {
      const content = parseTaskContent(title);
      expect(content.title).toBe(title);
      expect(content.unknown).toEqual([]);
    }
  });

  it('keeps unknown fields that are not in the trailing run as title text', () => {
    const content = parseTaskContent('a [note:: x] b [id:: abcd]');
    expect(content.title).toBe('a [note:: x] b');
    expect(content.unknown).toEqual([]);
  });

  it('stops the trailing run at an invalid Flint field', () => {
    const content = parseTaskContent('a [due:: x] [priority:: urgent] [id:: abcd]');
    expect(content.title).toBe('a [due:: x] [priority:: urgent]');
    expect(content.unknown).toEqual([]);
  });

  it('never reads fields inside inline code', () => {
    const content = parseTaskContent('Fix `[priority:: high]` example [id:: f1x2]');
    expect(content.title).toBe('Fix `[priority:: high]` example');
    expect(content.fields.priority).toBeUndefined();
    expect(content.fields.id?.value).toBe('f1x2');
  });

  it('allows inline code inside an unknown field value', () => {
    expect(parseTaskContent('a [cmd:: `npm test`]').unknown).toEqual([
      { key: 'cmd', value: '`npm test`' },
    ]);
  });

  it('reads nested brackets in values (wikilinks)', () => {
    const content = parseTaskContent('Read [source:: [[Tenant cache]]]');
    expect(content.unknown).toEqual([{ key: 'source', value: '[[Tenant cache]]' }]);
    expect(content.title).toBe('Read');
  });

  it('ignores escaped brackets', () => {
    expect(parseTaskContent('literal \\[priority:: high]').fields.priority).toBeUndefined();
  });

  it('keeps an Obsidian block ID last and lets the trailing run continue before it', () => {
    const content = parseTaskContent('Review [due:: 2026-11-02] [id:: dcf64c] ^cache-review');
    expect(content.blockId).toBe('cache-review');
    expect(content.unknown).toEqual([{ key: 'due', value: '2026-11-02' }]);
    expect(content.title).toBe('Review');
  });
});

describe('formatTaskContent (D-21 canonical order)', () => {
  it('writes reminder, today, completion, priority, id, unknown fields, block ID', () => {
    const content = parseTaskContent(
      '[id:: a1b2] Rotate secret [due:: 2026-11-01] [priority:: medium] [completion:: 2026-10-28T14:03] [today:: true] ^blk',
    );
    // `[due:: …]` sits in the trailing run, so it is a field; the mid-line id moves to the end.
    expect(formatTaskContent(content)).toBe(
      'Rotate secret [today:: true] [completion:: 2026-10-28T14:03] [priority:: medium] [id:: a1b2] [due:: 2026-11-01] ^blk',
    );
  });

  it('writes parentheses fields as brackets unless the value would not read back', () => {
    expect(formatTaskContent(parseTaskContent('a (due:: 2026-11-01)'))).toBe(
      'a [due:: 2026-11-01]',
    );
    expect(formatTaskContent(parseTaskContent('a (note:: x]y)'))).toBe('a (note:: x]y)');
  });
});

describe('muted reminders (REM-12, D-66)', () => {
  it('reads [muted:: true] in any case and position, written after the reminder', () => {
    const content = parseTaskContent(
      'Call Alex [MUTED:: True] [priority:: high] [reminder:: 2026-11-02T15:00] [id:: a1b2]',
    );
    expect(content.fields.muted?.value).toBe(true);
    expect(content.title).toBe('Call Alex');
    // Untouched values keep their raw text; the order is canonical.
    expect(formatTaskContent(content)).toBe(
      'Call Alex [reminder:: 2026-11-02T15:00] [MUTED:: True] [priority:: high] [id:: a1b2]',
    );
  });

  it('an invalid value stays visible as title text', () => {
    const content = parseTaskContent('Call Alex [muted:: yes] [id:: a1b2]');
    expect(content.fields.muted).toBeUndefined();
    expect(content.title).toBe('Call Alex [muted:: yes]');
  });
});

describe('escapeTitle', () => {
  it('escapes text that would read back as a field', () => {
    const title = escapeTitle('Document [id:: abcd] and [note:: x] and [Vec::new]');
    expect(title).toBe('Document \\[id:: abcd] and \\[note:: x] and [Vec::new]');
    const content = parseTaskContent(`${title} [id:: real]`);
    expect(content.title).toBe(title);
    expect(content.fields.id?.value).toBe('real');
  });

  it('escapes every occurrence, so a repeat cannot become the field', () => {
    const title = escapeTitle('[priority:: high] then [priority:: low]');
    expect(parseTaskContent(title).fields.priority).toBeUndefined();
  });

  it('turns line breaks into spaces', () => {
    expect(escapeTitle('one\ntwo')).toBe('one two');
  });
});
