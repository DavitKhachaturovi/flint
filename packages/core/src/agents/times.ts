import {
  compareLocalDateTime,
  formatLocalDateTime,
  fromDate,
  isValidLocalDateTime,
  type LocalDateTime,
} from '../time/local-datetime.js';
import { parseTime } from '../time/parse.js';
import type { NowInfo } from './protocol.js';

/**
 * AGENT-01 (D-185 Q7): reminder times from agents: Flint's own phrases (the capture parser, REM-02)
 * or ISO 8601 (`2026-11-14T09:00` local; with an offset or `Z`, converted to this PC's local time),
 * or `none` to clear. Past times are refused as capture refuses them. A day alone is 10:00 (D-69).
 */

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

export type AgentTime =
  | { readonly kind: 'none' }
  | { readonly kind: 'at'; readonly at: LocalDateTime }
  | { readonly kind: 'bad'; readonly message: string };

/** Examples shown with `bad_time`. */
export const TIME_EXAMPLES = ['tomorrow 9:00', 'fri 14:30', 'in 2h', '2026-11-14T09:00'] as const;

const badTime = (text: string, why: string): AgentTime => ({
  kind: 'bad',
  message: `${why}: "${text}". Try ${TIME_EXAMPLES.map((each) => `"${each}"`).join(', ')}.`,
});

/** Reads an agent's `remind` value at `now` (local time of this PC). */
export function parseAgentTime(text: string, now: Date): AgentTime {
  const trimmed = text.trim();
  if (/^(none|off|clear)$/i.test(trimmed)) return { kind: 'none' };
  if (trimmed === '') return badTime(text, 'No time given');
  const iso = ISO.exec(trimmed);
  let at: LocalDateTime | null;
  if (iso) {
    const [, y, mo, d, h, mi, s, zone] = iso;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    const hour = h === undefined ? 10 : Number(h);
    const minute = mi === undefined ? 0 : Number(mi);
    const second = s === undefined ? 0 : Number(s);
    if (zone) {
      const offsetMinutes =
        zone.toUpperCase() === 'Z'
          ? 0
          : (zone.startsWith('-') ? -1 : 1) *
            (Number(zone.slice(1, 3)) * 60 + Number(zone.replace(':', '').slice(3, 5)));
      const utc = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
      const candidate: LocalDateTime = { year, month, day, hour, minute, second };
      if (!isValidLocalDateTime(candidate)) return badTime(text, 'Not a real date');
      at = { ...fromDate(new Date(utc)), second: 0 };
    } else {
      const candidate: LocalDateTime = { year, month, day, hour, minute, second: 0 };
      if (!isValidLocalDateTime(candidate)) return badTime(text, 'Not a real date');
      at = candidate;
    }
  } else {
    at = parseTime(trimmed, { now });
    if (!at) return badTime(text, 'Flint can’t read this time, or it has passed');
  }
  if (compareLocalDateTime(at, fromDate(now)) <= 0) return badTime(text, 'That time has passed');
  return { kind: 'at', at: { ...at, second: 0 } };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (value: number): string => String(value).padStart(2, '0');

/** `Sat 14 Nov, 09:00`; another year adds it: `Sat 14 Nov 2027, 09:00`. */
export function timeText(at: LocalDateTime, now: Date): string {
  const date = new Date(at.year, at.month - 1, at.day);
  const year = at.year === now.getFullYear() ? '' : ` ${at.year}`;
  return `${WEEKDAYS[date.getDay()]} ${at.day} ${MONTHS[at.month - 1]}${year}, ${two(at.hour)}:${two(at.minute)}`;
}

/** `YYYY-MM-DDTHH:MM`. */
export function timeValue(at: LocalDateTime): string {
  return formatLocalDateTime(at).slice(0, 16);
}

/** What every answer carries (D-185 Q7). */
export function nowInfo(now: Date, timeZone: string): NowInfo {
  const minutes = -now.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const offset = `${sign}${two(Math.floor(Math.abs(minutes) / 60))}:${two(Math.abs(minutes) % 60)}`;
  const local = fromDate(now);
  return {
    local: timeValue(local),
    text: `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}, ${two(now.getHours())}:${two(now.getMinutes())}`,
    offset,
    timeZone,
  };
}
