import { describe, expect, it } from 'vitest';
import type { LocalDateTime } from './local-datetime.js';
import { describeTime, matchTime, parseTime } from './parse.js';

// Thursday 29 October 2026, 14:30 in Tbilisi (the test zone, vitest.config.ts).
const now = new Date(2026, 9, 29, 14, 30, 45);
const context = { now };

function local(month: number, day: number, hour: number, minute = 0, year = 2026): LocalDateTime {
  return { year, month, day, hour, minute, second: 0 };
}

function parsed(text: string): string | null {
  const result = parseTime(text, context);
  return result ? describeTime(result, now) : null;
}

describe('parseTime: relative (REM-02)', () => {
  it.each([
    ['20m', local(10, 29, 14, 50)],
    ['in 20m', local(10, 29, 14, 50)],
    ['in 20 min', local(10, 29, 14, 50)],
    ['2h', local(10, 29, 16, 30)],
    ['in 2 hours', local(10, 29, 16, 30)],
    ['1h30m', local(10, 29, 16, 0)],
    ['1h 30m', local(10, 29, 16, 0)],
    ['3d', local(11, 1, 9)],
    ['in 3 days', local(11, 1, 9)],
  ])('%s', (text, expected) => {
    expect(parseTime(text, context)).toEqual(expected);
  });

  it('rejects zero and unknown units', () => {
    expect(parseTime('0m', context)).toBeNull();
    expect(parseTime('20x', context)).toBeNull();
    expect(parseTime('1m30h', context)).toBeNull();
  });
});

describe('parseTime: clock times take the next occurrence', () => {
  it.each([
    ['15:00', local(10, 29, 15)],
    ['at 15:00', local(10, 29, 15)],
    ['3pm', local(10, 29, 15)],
    ['3 PM', local(10, 29, 15)],
    ['14:00', local(10, 30, 14)],
    ['9', local(10, 30, 9)],
    ['9:30am', local(10, 30, 9, 30)],
    ['12am', local(10, 30, 0)],
    ['12pm', local(10, 30, 12)],
    ['23:59', local(10, 29, 23, 59)],
  ])('%s', (text, expected) => {
    expect(parseTime(text, context)).toEqual(expected);
  });

  it('rejects impossible clocks', () => {
    for (const text of ['25:00', '10:60', '13pm', '0am'])
      expect(parseTime(text, context)).toBeNull();
  });
});

describe('parseTime: days, with the default time 09:00 (Q-02)', () => {
  it.each([
    ['tomorrow', local(10, 30, 9)],
    ['Tomorrow 10', local(10, 30, 10)],
    ['tomorrow at 10:30', local(10, 30, 10, 30)],
    ['tmrw 3pm', local(10, 30, 15)],
    ['today 18:00', local(10, 29, 18)],
    ['fri', local(10, 30, 9)],
    ['friday 3pm', local(10, 30, 15)],
    ['3pm fri', local(10, 30, 15)],
    ['next fri', local(10, 30, 9)],
    ['next fri at 9:30 am', local(10, 30, 9, 30)],
    ['mon', local(11, 2, 9)],
  ])('%s', (text, expected) => {
    expect(parseTime(text, context)).toEqual(expected);
  });

  it('a weekday never means today', () => {
    expect(parseTime('thu', context)).toEqual(local(11, 5, 9));
  });

  it('a day whose time has passed is not a time', () => {
    expect(parseTime('today', context)).toBeNull();
    expect(parseTime('today 10', context)).toBeNull();
  });

  it('uses another default hour when given', () => {
    expect(parseTime('tomorrow', { now, defaultHour: 8 })).toEqual(local(10, 30, 8));
  });
});

describe('parseTime: dates', () => {
  it.each([
    ['2026-11-02', local(11, 2, 9)],
    ['2026-11-02 10:00', local(11, 2, 10)],
    ['2.11', local(11, 2, 9)],
    ['02.11.2026 10:00', local(11, 2, 10)],
    ['2 nov', local(11, 2, 9)],
    ['nov 2 15:00', local(11, 2, 15)],
    ['2 November at 3pm', local(11, 2, 15)],
    ['28.10', local(10, 28, 9, 0, 2027)],
    ['1 jan', local(1, 1, 9, 0, 2027)],
  ])('%s', (text, expected) => {
    expect(parseTime(text, context)).toEqual(expected);
  });

  it('rejects past and impossible dates', () => {
    for (const text of ['29.10', '2025-01-01', '28.10.2026', '30.02', '31.11', '2026-13-01']) {
      expect(parseTime(text, context)).toBeNull();
    }
  });
});

describe('parseTime: not times', () => {
  it.each(['alex', '', 'mon tue', 'in', 'at', 'may', 'tomorrow tomorrow'])('%j', (text) => {
    expect(parseTime(text, context)).toBeNull();
  });
});

describe('matchTime: the longest expression at the start (CAP-03)', () => {
  it('stops where the time ends', () => {
    expect(matchTime('tomorrow 10 deploy hotfix', context)).toEqual({
      at: local(10, 30, 10),
      length: 'tomorrow 10'.length,
    });
    expect(matchTime('fri review PR', context)?.length).toBe(3);
    expect(matchTime('30m', context)?.length).toBe(3);
    expect(matchTime('2 nov at 3pm sharp', context)?.length).toBe('2 nov at 3pm'.length);
  });

  it('reads a bare number after a day as its time (the chip shows it)', () => {
    expect(matchTime('tomorrow 10 people', context)?.length).toBe('tomorrow 10'.length);
  });

  it('needs the expression right at the start', () => {
    expect(matchTime(' 30m', context)).toBeNull();
    expect(matchTime('alex tomorrow', context)).toBeNull();
  });
});

describe('describeTime: chip labels (CAP-04)', () => {
  it.each([
    ['15:00', 'Today 15:00'],
    ['tomorrow 10', 'Tomorrow 10:00'],
    ['3d', 'Sun 09:00'],
    ['thu', '5 Nov 09:00'],
    ['28.10', '28 Oct 2027 09:00'],
  ])('%s → %s', (text, label) => {
    expect(parsed(text)).toBe(label);
  });
});
