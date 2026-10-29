import { fromDate, toDate, type LocalDateTime } from './local-datetime.js';

/**
 * Natural-language reminder times (REM-02), used by the capture shorthand (`@…`, CAP-03) and the
 * reminder picker. English only, case-insensitive. Proposed grammar (docs/02 REM-02):
 *
 * - relative: `20m`, `2h`, `1h30m`, `in 20m`, `in 2 hours`, `3d` (3 days from now, default time)
 * - clock: `15:00`, `at 15:00`, `9`, `3pm`, `9:30am` (next occurrence)
 * - days: `today`, `tomorrow`, `mon`…`sun` and full names, `next fri`, each with an optional time
 * - dates: `2026-11-02`, `2.11`, `02.11.2026` (day.month), `2 nov`, `nov 2`, with an optional time
 *
 * A day without a time means the default time, 09:00 (Q-02). Anything in the past is not a time.
 */
export interface TimeContext {
  readonly now: Date;
  /** Hour used when only a day is given (Q-02: 09:00). */
  readonly defaultHour?: number;
}

export interface TimeMatch {
  readonly at: LocalDateTime;
  /** Characters of the input that make up the expression (for the shorthand parser). */
  readonly length: number;
}

const MAX_WORDS = 6;

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 1440 };

interface Clock {
  readonly hour: number;
  readonly minute: number;
}

interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function unitOf(word: string): string | null {
  if (/^(m|mins?|minutes?)$/.test(word)) return 'm';
  if (/^(h|hrs?|hours?)$/.test(word)) return 'h';
  if (/^(d|days?)$/.test(word)) return 'd';
  return null;
}

function parseClock(text: string): Clock | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function addDays(day: Day, days: number): Day {
  const date = new Date(day.year, day.month - 1, day.day + days);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function validDay(year: number, month: number, day: number): Day | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  return { year, month, day };
}

/** A date without a year: this year if it hasn't passed, otherwise next year. */
function nextDate(month: number, day: number, today: Day): Day | null {
  const thisYear = validDay(today.year, month, day);
  if (thisYear && (month > today.month || (month === today.month && day >= today.day)))
    return thisYear;
  return validDay(today.year + 1, month, day);
}

function parseDay(text: string, today: Day): Day | null {
  if (text === 'today') return today;
  if (text === 'tomorrow' || text === 'tmrw') return addDays(today, 1);

  const weekday = /^(?:next\s+)?([a-z]+)$/.exec(text);
  const target = weekday ? WEEKDAYS[weekday[1] ?? ''] : undefined;
  if (target !== undefined) {
    // A weekday never means today: today is "today".
    const current = new Date(today.year, today.month - 1, today.day).getDay();
    return addDays(today, ((target - current + 6) % 7) + 1);
  }

  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return validDay(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(text);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    return match[3] ? validDay(Number(match[3]), month, day) : nextDate(month, day, today);
  }

  match = /^(\d{1,2})\s+([a-z]+)$/.exec(text) ?? null;
  let month = match ? MONTHS[match[2] ?? ''] : undefined;
  if (match && month !== undefined) return nextDate(month, Number(match[1]), today);

  match = /^([a-z]+)\s+(\d{1,2})$/.exec(text);
  month = match ? MONTHS[match[1] ?? ''] : undefined;
  if (match && month !== undefined) return nextDate(month, Number(match[2]), today);

  return null;
}

function at(day: Day, clock: Clock): LocalDateTime {
  return {
    year: day.year,
    month: day.month,
    day: day.day,
    hour: clock.hour,
    minute: clock.minute,
    second: 0,
  };
}

/** Parses a whole phrase (lowercase, single spaces). */
function parsePhrase(phrase: string, context: TimeContext): LocalDateTime | null {
  const now = context.now;
  const nowLocal = fromDate(now);
  const today: Day = { year: nowLocal.year, month: nowLocal.month, day: nowLocal.day };
  const defaultClock: Clock = { hour: context.defaultHour ?? 9, minute: 0 };

  // Relative: 20m, 2h, 3d, 1h30m, in 20m, in 2 hours.
  const relative = /^(?:in\s+)?(\d+)\s*([a-z]+)(?:\s*(\d+)\s*([a-z]+))?$/.exec(phrase);
  if (relative) {
    const first = unitOf(relative[2] ?? '');
    const second = relative[4] === undefined ? null : unitOf(relative[4]);
    if (
      first &&
      (relative[3] === undefined || (second && UNIT_MINUTES[second]! < UNIT_MINUTES[first]!))
    ) {
      const amount = Number(relative[1]);
      if (first === 'd' && relative[3] === undefined) {
        return amount > 0 ? at(addDays(today, amount), defaultClock) : null;
      }
      const minutes =
        amount * UNIT_MINUTES[first]! + (second ? Number(relative[3]) * UNIT_MINUTES[second]! : 0);
      if (minutes <= 0) return null;
      const result = fromDate(new Date(now.getTime() + minutes * 60_000));
      return { ...result, second: 0 };
    }
  }

  // Clock alone: the next time the clock shows it.
  const clockOnly = /^(?:at\s+)?(.+)$/.exec(phrase);
  const clock = clockOnly ? parseClock(clockOnly[1] ?? '') : null;
  if (clock) {
    const todayAt = at(today, clock);
    return toDate(todayAt) > now ? todayAt : at(addDays(today, 1), clock);
  }

  // Day, optionally with a time (either order).
  const candidates: [string, string | null][] = [[phrase, null]];
  const dayThenTime = /^(.+?)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/.exec(phrase);
  if (dayThenTime) candidates.push([dayThenTime[1] ?? '', dayThenTime[2] ?? '']);
  const timeThenDay = /^(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(.+)$/.exec(phrase);
  if (timeThenDay) candidates.push([timeThenDay[2] ?? '', timeThenDay[1] ?? '']);

  for (const [dayText, clockText] of candidates) {
    const day = parseDay(dayText, today);
    if (!day) continue;
    const time = clockText === null ? defaultClock : parseClock(clockText);
    if (!time) continue;
    const result = at(day, time);
    return toDate(result) > now ? result : null;
  }
  return null;
}

/**
 * The longest time expression at the start of `text`, up to 6 words: `tomorrow 10 deploy` reads
 * `tomorrow 10`. Null if the text doesn't start with one, or it names a time that has passed.
 */
export function matchTime(text: string, context: TimeContext): TimeMatch | null {
  const words = [...text.matchAll(/\S+/g)];
  const first = words[0];
  if (!first || first.index !== 0) return null;
  for (let count = Math.min(MAX_WORDS, words.length); count >= 1; count--) {
    const last = words[count - 1];
    if (!last) continue;
    const phrase = words
      .slice(0, count)
      .map((word) => word[0].toLowerCase())
      .join(' ');
    const result = parsePhrase(phrase, context);
    if (result) return { at: result, length: last.index + last[0].length };
  }
  return null;
}

/** A whole string as a time expression (the reminder picker), or null. */
export function parseTime(text: string, context: TimeContext): LocalDateTime | null {
  const trimmed = text.trim();
  const match = matchTime(trimmed, context);
  return match && match.length === trimmed.length ? match.at : null;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * The absolute time as the chip and picker show it (CAP-04): `Today 15:00`, `Tomorrow 10:00`,
 * `Fri 09:00` within a week, `2 Nov 09:00` later, `2 Nov 2027 09:00` in another year.
 */
export function describeTime(value: LocalDateTime, now: Date): string {
  const time = `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(value.year, value.month - 1, value.day);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAY_NAMES[target.getDay()]} ${time}`;
  const date = `${value.day} ${MONTH_NAMES[value.month - 1]}`;
  return value.year === now.getFullYear() ? `${date} ${time}` : `${date} ${value.year} ${time}`;
}
