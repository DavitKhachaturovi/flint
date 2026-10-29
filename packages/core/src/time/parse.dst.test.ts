import { describe, expect, it } from 'vitest';
import { parseTime } from './parse.js';

// A zone with daylight saving. Set before any date is created in this file.
process.env.TZ = 'Europe/Berlin';

describe('parseTime across daylight-saving changes (Europe/Berlin)', () => {
  it('runs in a daylight-saving zone', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-60);
  });

  it('days count calendar days when clocks go back (25 Oct 2026, 03:00 → 02:00)', () => {
    const now = new Date(2026, 9, 24, 12, 0);
    expect(parseTime('tomorrow 10', { now })).toEqual({
      year: 2026,
      month: 10,
      day: 25,
      hour: 10,
      minute: 0,
      second: 0,
    });
  });

  it('hours count real elapsed time when clocks go back', () => {
    const now = new Date(2026, 9, 24, 12, 0);
    // 24 hours later the wall clock shows 11:00, because an hour repeated in the night.
    expect(parseTime('24h', { now })).toMatchObject({ day: 25, hour: 11 });
  });

  it('keeps a wall-clock time the spring-forward jump skips (28 Mar 2027, 02:00 → 03:00)', () => {
    const now = new Date(2027, 2, 27, 12, 0);
    expect(parseTime('tomorrow 2:30', { now })).toMatchObject({ day: 28, hour: 2, minute: 30 });
  });
});
