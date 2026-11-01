import { describe, expect, it } from 'vitest';
import { atDefaultTime, parseLocalDateTime } from './local-datetime.js';

describe('atDefaultTime: a date-only reminder (04 §3, D-69)', () => {
  it('means its day at 10:00', () => {
    const parsed = parseLocalDateTime('2026-11-02');
    expect(parsed && atDefaultTime(parsed)).toEqual({
      year: 2026,
      month: 11,
      day: 2,
      hour: 10,
      minute: 0,
      second: 0,
    });
  });

  it('keeps a time that is given', () => {
    const parsed = parseLocalDateTime('2026-11-02T08:15');
    expect(parsed && atDefaultTime(parsed)).toMatchObject({ hour: 8, minute: 15 });
  });
});
