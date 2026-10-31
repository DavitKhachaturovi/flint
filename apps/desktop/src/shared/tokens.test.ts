import { describe, expect, it } from 'vitest';
import { parseCapture } from '@flint/core/shorthand';
import { listShorthand, PRIORITY_TOKENS, timeShorthand } from './tokens.js';

describe('what the pickers insert reads back as the same shorthand (CAP-11, D-57)', () => {
  const now = new Date(2026, 9, 31, 15, 0);
  const lists = [{ id: 'm1', name: 'Meeting notes', mode: 'tasks' as const }];

  it('a time from the date/time picker', () => {
    const at = { year: 2026, month: 11, day: 2, hour: 15, minute: 30, second: 0 };
    const parsed = parseCapture(`call Alex ${timeShorthand(at)}`, { now, lists });
    expect(parsed.reminder).toEqual(at);
    expect(parsed.title).toBe('call Alex');
    expect(parsed.reminderLabel).toBe('Mon 15:30');
  });

  it('a list and a priority', () => {
    const parsed = parseCapture(`notes ${listShorthand('Meeting notes')} ${PRIORITY_TOKENS.high}`, {
      now,
      lists,
    });
    expect(parsed.target).toMatchObject({ kind: 'existing', list: { id: 'm1' } });
    expect(parsed.priority).toBe('high');
    expect(parsed.title).toBe('notes');
  });
});
