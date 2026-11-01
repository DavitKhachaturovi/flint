/**
 * A wall-clock date and time with no time zone: what Flint writes in `reminder` and `completion`
 * fields (`YYYY-MM-DDTHH:MM`, local time, docs/04 §3).
 */
export interface LocalDateTime {
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface ParsedLocalDateTime {
  readonly value: LocalDateTime;
  /** The text had no time part (`2026-11-02`), as Dataview and Obsidian Tasks write `completion`. */
  readonly dateOnly: boolean;
}

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function isValidLocalDateTime(value: LocalDateTime): boolean {
  return (
    Number.isInteger(value.year) &&
    value.year >= 1 &&
    value.year <= 9999 &&
    value.month >= 1 &&
    value.month <= 12 &&
    value.day >= 1 &&
    value.day <= daysInMonth(value.year, value.month) &&
    value.hour >= 0 &&
    value.hour <= 23 &&
    value.minute >= 0 &&
    value.minute <= 59 &&
    value.second >= 0 &&
    value.second <= 59
  );
}

/** Reads `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`; anything else is null. */
export function parseLocalDateTime(text: string): ParsedLocalDateTime | null {
  const match = ISO_LOCAL.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value: LocalDateTime = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hour === undefined ? 0 : Number(hour),
    minute: minute === undefined ? 0 : Number(minute),
    second: second === undefined ? 0 : Number(second),
  };
  if (!isValidLocalDateTime(value)) return null;
  return { value, dateOnly: hour === undefined };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** The time of a reminder that gives only a day, typed (`tomorrow`) or read (`2026-11-02`): 10:00 (D-69, Q-02). */
export const DEFAULT_HOUR = 10;

/** A read date-time as a moment: a date-only reminder means its day at the default time (04 §3). */
export function atDefaultTime(parsed: ParsedLocalDateTime): LocalDateTime {
  return parsed.dateOnly
    ? { ...parsed.value, hour: DEFAULT_HOUR, minute: 0, second: 0 }
    : parsed.value;
}

/** Writes `YYYY-MM-DDTHH:MM`, the form Flint always writes (seconds are dropped). */
export function formatLocalDateTime(value: LocalDateTime): string {
  return `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}`;
}

export function fromDate(date: Date): LocalDateTime {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

/**
 * The instant this wall-clock time names in the current zone. A time skipped by a daylight-saving
 * jump resolves forward, as the platform does.
 */
export function toDate(value: LocalDateTime): Date {
  return new Date(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
}

export function compareLocalDateTime(a: LocalDateTime, b: LocalDateTime): number {
  return (
    a.year - b.year ||
    a.month - b.month ||
    a.day - b.day ||
    a.hour - b.hour ||
    a.minute - b.minute ||
    a.second - b.second
  );
}
