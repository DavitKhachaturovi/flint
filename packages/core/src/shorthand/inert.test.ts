import { describe, expect, it } from 'vitest';
import { escapeInert, shiftRanges, type TextRange } from './inert.js';
import { parseCapture } from './parse.js';

const now = new Date(2026, 9, 30, 10);
const lists = [{ id: 'inf1', name: 'Infra', mode: 'tasks' as const }];
const parse = (text: string, ranges: readonly TextRange[]) =>
  parseCapture(escapeInert(text, ranges).text, { now, lists });

const message = 'deploy hotfix @15:00, see ##infra';
const all = [{ start: 0, end: message.length }];

describe('shorthand only from typed text (D-45, CAP-03)', () => {
  it('a selected message stays plain text: no reminder, no list, no priority', () => {
    const parsed = parse(`${message} !h`, all);
    expect(parsed.title).toBe(message);
    expect(parsed.reminder).toBeNull();
    expect(parsed.target).toEqual({ kind: 'inbox' });
    // `!h` was typed after the selection: it is live.
    expect(parsed.priority).toBe('high');
    expect(parsed.tokens.map((token) => token.kind)).toEqual(['priority']);
  });

  it('the same text typed by hand is shorthand', () => {
    const parsed = parse('deploy hotfix @15:00 see ##infra', []);
    expect(parsed.reminder).not.toBeNull();
    expect(parsed.target).toMatchObject({ kind: 'existing' });
  });

  it('maps positions in the escaped text back to what is shown', () => {
    const escaped = escapeInert(`${message} ##infra`, all);
    expect(escaped.text).toBe('deploy hotfix \\@15:00, see \\##infra ##infra');
    const live = parseCapture(escaped.text, { now, lists }).tokens.find((t) => t.role === 'winner');
    if (!live) throw new Error('no live token');
    expect(escaped.toOriginal(live.start)).toBe(message.length + 1);
    expect(escaped.toOriginal(live.end)).toBe(message.length + 8);
  });
});

describe('inert ranges follow edits', () => {
  it('typing inside a selected message keeps it inert', () => {
    const edited = 'deploy the hotfix @15:00, see ##infra';
    const ranges = shiftRanges(all, message, edited);
    expect(ranges).toEqual([{ start: 0, end: edited.length }]);
    expect(parse(edited, ranges).reminder).toBeNull();
  });

  it('typing before or after it is live', () => {
    const after = `${message} @16:00`;
    const ranges = shiftRanges(all, message, after);
    expect(ranges).toEqual(all);
    expect(parse(after, ranges).reminderLabel).toBe('Today 16:00');
    const before = `!h ${message}`;
    expect(shiftRanges(all, message, before)).toEqual([{ start: 3, end: 3 + message.length }]);
  });

  it("Flint's own insertion inside it is live and splits it", () => {
    const at = 'deploy hotfix '.length;
    const edited = `${message.slice(0, at)}!h ${message.slice(at)}`;
    const ranges = shiftRanges(all, message, edited, true);
    expect(ranges).toEqual([
      { start: 0, end: at },
      { start: at + 3, end: edited.length },
    ]);
    expect(parse(edited, ranges).priority).toBe('high');
    expect(parse(edited, ranges).reminder).toBeNull();
  });

  it('deleting it removes it', () => {
    expect(shiftRanges(all, message, '')).toEqual([]);
  });
});
