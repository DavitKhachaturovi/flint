/**
 * SPACE-09 (D-190 Q10, Q14, Q22; docs/04 §9): `<Space name>.flintmine`, your fields on a syncing
 * space's tasks, kept in your own Drive (never shared) so your other devices get them:
 * `{ "flint": 1, "space": "<space id>", "tasks": { "<task ID>": { "pinned": { "value": true,
 * "at": "<ISO time>" }, "reminder": { "value": "2026-03-10T15:00", "at": "…" }, "muted": { … },
 * "gone": "<ISO time>" } } }`.
 *
 * - **A time per field (Q22):** changes to different fields on two devices both survive; per field
 *   the later change wins, a clear included (a field set to none is kept with its time).
 * - **D-161 Q4's clock rule:** a time later than the file's upload counts as the upload, and a
 *   change always comes after the one it replaces, so a device whose clock is ahead can't win
 *   forever. `notAfter` when reading is **always the provider's upload time of that copy**, also
 *   for this device's own last copy (never this device's clock, which may be the one ahead).
 * - **Gone:** an entry for a task missing from the space waits (it may not have arrived yet) and
 *   says since when (`gone`); found back, it says so (`seen`, later than `gone`); 90 days after the
 *   last device noticed it missing it is dropped (Proposed).
 * - **Read tolerantly** (it comes back from a provider): a malformed entry or field is left out. A
 *   file a newer Flint wrote (`newer`) is never overwritten; one that can't be read at all
 *   (`unreadable`: cut short, not JSON) isn't overwritten either: the space needs attention, so
 *   another device's changes in it aren't lost.
 *
 * The order on a device, each round: first record the local state (`recordMine`) against the file
 * last applied to the local files, so what differs from it is this device's own change since; then
 * merge that with the provider's copy (`mergeMine`), drop what has been gone for 90 days
 * (`pruneMine`), and apply the result to the local files (`mineFields`, `applyPersonal`). That file
 * is the one uploaded, and the next `previous`.
 */
import { ID_PATTERN } from '../format/fields.js';
import {
  formatLocalDateTime,
  parseLocalDateTime,
  type ParsedLocalDateTime,
} from '../time/local-datetime.js';
import type { PersonalFields } from './personal.js';

export interface MineField<T> {
  readonly value: T;
  /** When it was last changed, an ISO time with its offset; the later wins. */
  readonly at: string;
}

export interface MineEntry {
  readonly pinned?: MineField<boolean>;
  /** `YYYY-MM-DDTHH:MM`, a day alone as `YYYY-MM-DD`; null: no reminder. */
  readonly reminder?: MineField<string | null>;
  readonly muted?: MineField<boolean>;
  /**
   * Since when a device has found the task missing from the space. It counts only when later than
   * `seen`; per copy the later wins (so it is dropped 90 days after the last device noticed).
   */
  readonly gone?: string;
  /** When a device found the task back after it had been missing (it then isn't gone). */
  readonly seen?: string;
}

export interface MineFile {
  readonly space: string;
  readonly tasks: ReadonlyMap<string, MineEntry>;
}

export type MineRead =
  | { readonly kind: 'ok'; readonly file: MineFile }
  /** A newer Flint wrote it: read nothing from it, never overwrite it. */
  | { readonly kind: 'newer' }
  /** Another space's file. */
  | { readonly kind: 'other-space' }
  | { readonly kind: 'unreadable' };

/** Entries for tasks gone from the space are kept this long after they went (Proposed). */
export const MINE_KEEP_DAYS = 90;
/** More entries than this and the file isn't read (it isn't one Flint wrote). */
export const MINE_MAX_TASKS = 100_000;

const DAY_MS = 86_400_000;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
type FieldKey = 'pinned' | 'reminder' | 'muted';
const FIELDS: readonly FieldKey[] = ['pinned', 'reminder', 'muted'];

/** A reminder's text as `.flintmine` keeps it: Flint's form, a day alone kept as a day. */
function reminderText(parsed: ParsedLocalDateTime): string {
  const text = formatLocalDateTime(parsed.value);
  if (parsed.dateOnly) return text.slice(0, 10);
  const { second } = parsed.value;
  return second === 0 ? text : `${text}:${String(second).padStart(2, '0')}`;
}

/** An ISO time, no later than `notAfter`; null when it isn't one. */
function readTime(value: unknown, notAfter: Date): string | null {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return time > notAfter.getTime() ? notAfter.toISOString() : value;
}

function readField(value: unknown, key: FieldKey, notAfter: Date): MineField<never> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const field = value as Record<string, unknown>;
  const at = readTime(field['at'], notAfter);
  if (at === null) return null;
  const raw = field['value'];
  if (key === 'reminder') {
    if (raw === null) return { value: null as never, at };
    if (typeof raw !== 'string') return null;
    const parsed = parseLocalDateTime(raw);
    return parsed ? { value: reminderText(parsed) as never, at } : null;
  }
  return typeof raw === 'boolean' ? { value: raw as never, at } : null;
}

function readEntry(value: unknown, notAfter: Date): MineEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const entry: { -readonly [K in keyof MineEntry]: MineEntry[K] } = {};
  for (const key of FIELDS) {
    const field = readField(raw[key], key, notAfter);
    if (field) (entry as Record<string, unknown>)[key] = field;
  }
  const gone = readTime(raw['gone'], notAfter);
  if (gone !== null) entry.gone = gone;
  const seen = readTime(raw['seen'], notAfter);
  if (seen !== null) entry.seen = seen;
  return Object.keys(entry).length > 0 ? entry : null;
}

/**
 * Reads a `.flintmine` (`notAfter`: when it was uploaded, or now; a later time counts as that).
 */
export function readMineFile(text: string, space: string, notAfter: Date): MineRead {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: 'unreadable' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return { kind: 'unreadable' };
  const file = data as Record<string, unknown>;
  const version = file['flint'];
  if (typeof version === 'number' && Number.isInteger(version) && version > 1)
    return { kind: 'newer' };
  if (version !== 1) return { kind: 'unreadable' };
  if (file['space'] !== space)
    return typeof file['space'] === 'string' ? { kind: 'other-space' } : { kind: 'unreadable' };
  const raw = file['tasks'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'unreadable' };
  const ids = Object.keys(raw);
  if (ids.length > MINE_MAX_TASKS) return { kind: 'unreadable' };
  const tasks = new Map<string, MineEntry>();
  for (const id of ids) {
    if (!ID_PATTERN.test(id)) continue;
    const entry = readEntry((raw as Record<string, unknown>)[id], notAfter);
    if (entry) tasks.set(id, entry);
  }
  return { kind: 'ok', file: { space, tasks } };
}

/** The canonical text: tasks by ID, each entry's keys in one order. */
export function writeMineFile(file: MineFile): string {
  // No prototype: a task ID such as `__proto__` is an ordinary key.
  const tasks = Object.create(null) as Record<string, unknown>;
  for (const id of [...file.tasks.keys()].sort()) {
    const entry = file.tasks.get(id);
    if (!entry) continue;
    const out: Record<string, unknown> = {};
    for (const key of FIELDS) {
      const field = entry[key];
      if (field) out[key] = { value: field.value, at: field.at };
    }
    if (entry.gone !== undefined) out['gone'] = entry.gone;
    if (entry.seen !== undefined) out['seen'] = entry.seen;
    tasks[id] = out;
  }
  return `${JSON.stringify({ flint: 1, space: file.space, tasks }, null, 2)}\n`;
}

/** The later of two values of a field; at the same time, the one whose value sorts later. */
function laterField<T>(a: MineField<T>, b: MineField<T>): MineField<T> {
  const diff = Date.parse(a.at) - Date.parse(b.at);
  if (diff !== 0) return diff > 0 ? a : b;
  return String(a.value) >= String(b.value) ? a : b;
}

function mergeEntry(a: MineEntry, b: MineEntry): MineEntry {
  const entry: { -readonly [K in keyof MineEntry]: MineEntry[K] } = {};
  for (const key of FIELDS) {
    const x = a[key] as MineField<unknown> | undefined;
    const y = b[key] as MineField<unknown> | undefined;
    const field = x && y ? laterField(x, y) : (x ?? y);
    if (field) (entry as Record<string, unknown>)[key] = field;
  }
  // Each time, the later of the two (the same on every device in any order).
  const gone = laterTime(a.gone, b.gone);
  if (gone !== undefined) entry.gone = gone;
  const seen = laterTime(a.seen, b.seen);
  if (seen !== undefined) entry.seen = seen;
  return entry;
}

function laterTime(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  const diff = Date.parse(a) - Date.parse(b);
  if (diff !== 0) return diff > 0 ? a : b;
  return a >= b ? a : b;
}

/** Since when the task counts as gone: its `gone`, when later than `seen`. */
function goneSince(entry: MineEntry): number | undefined {
  if (entry.gone === undefined) return undefined;
  const gone = Date.parse(entry.gone);
  return entry.seen === undefined || gone > Date.parse(entry.seen) ? gone : undefined;
}

/** Two copies of one space's file: per task and field, the later change wins. */
export function mergeMine(a: MineFile, b: MineFile): MineFile {
  if (a.space !== b.space) throw new Error('two different spaces’ .flintmine files');
  const tasks = new Map(a.tasks);
  for (const [id, entry] of b.tasks) {
    const own = tasks.get(id);
    tasks.set(id, own ? mergeEntry(own, entry) : entry);
  }
  return { space: a.space, tasks };
}

function valuesOf(fields: PersonalFields | undefined): {
  pinned: boolean;
  reminder: string | null;
  muted: boolean;
} {
  return {
    pinned: fields?.pinned !== undefined,
    reminder: fields?.reminder ? reminderText(fields.reminder.value) : null,
    muted: fields?.muted !== undefined,
  };
}

const isNone = (value: unknown): boolean => value === false || value === null;

/**
 * The file after this device's state of the space's tasks. `previous` is the file last applied to
 * the local files (see the order above); `present`: every task ID the space has now; `mine`: your
 * fields on them (`splitPersonal`'s). A field that differs from `previous` is this device's change,
 * at `now` (and after the change it replaces); a task missing from the space keeps its entry with
 * since when, until 90 days after.
 */
export function recordMine(
  previous: MineFile,
  mine: ReadonlyMap<string, PersonalFields>,
  present: ReadonlySet<string>,
  now: Date,
): MineFile {
  const tasks = new Map<string, MineEntry>();
  const after = (time: string | undefined): number =>
    Math.max(now.getTime(), time === undefined ? -Infinity : Date.parse(time) + 1);
  for (const [id, entry] of previous.tasks) {
    if (present.has(id)) continue;
    const since = goneSince(entry) ?? after(entry.seen);
    if (now.getTime() - since <= MINE_KEEP_DAYS * DAY_MS)
      tasks.set(id, { ...entry, gone: new Date(since).toISOString() });
  }
  for (const id of present) {
    const own = previous.tasks.get(id);
    const wanted = valuesOf(mine.get(id));
    const entry: Record<string, unknown> = {};
    for (const key of FIELDS) {
      const before = own?.[key] as MineField<unknown> | undefined;
      const value = wanted[key];
      if (before && before.value === value) entry[key] = before;
      else if (before || !isNone(value))
        entry[key] = { value, at: new Date(after(before?.at)).toISOString() };
    }
    // Found back after it had been missing: seen now, so the gone no longer counts anywhere.
    const gone = own ? goneSince(own) : undefined;
    if (gone !== undefined)
      entry['seen'] = new Date(Math.max(now.getTime(), gone + 1)).toISOString();
    else if (own?.seen !== undefined) entry['seen'] = own.seen;
    if (own?.gone !== undefined && gone === undefined) entry['gone'] = own.gone;
    if (FIELDS.some((key) => entry[key] !== undefined)) tasks.set(id, entry);
  }
  return { space: previous.space, tasks };
}

/**
 * The merged file without the entries gone from the space for more than 90 days. Done after every
 * merge: a copy that still holds such an entry also holds its `gone`, so it is dropped again
 * whichever copy brings it back.
 */
export function pruneMine(file: MineFile, now: Date): MineFile {
  const tasks = new Map<string, MineEntry>();
  for (const [id, entry] of file.tasks) {
    const since = goneSince(entry);
    if (since === undefined || now.getTime() - since <= MINE_KEEP_DAYS * DAY_MS)
      tasks.set(id, entry);
  }
  return { space: file.space, tasks };
}

/** Your fields from the file, for `applyPersonal` (fields set to none give none). */
export function mineFields(file: MineFile): Map<string, PersonalFields> {
  const out = new Map<string, PersonalFields>();
  for (const [id, entry] of file.tasks) {
    const reminder = entry.reminder?.value ?? null;
    const parsed = reminder === null ? null : parseLocalDateTime(reminder);
    const fields: PersonalFields = {
      // Written as kept: a day alone stays a day (the canonical form would add T00:00, moving a
      // reminder meant for 10:00 to midnight).
      ...(parsed &&
        reminder !== null && {
          reminder: { value: parsed, raw: { key: 'reminder', value: reminder } },
        }),
      ...(entry.muted?.value === true && { muted: { value: true as const, raw: null } }),
      ...(entry.pinned?.value === true && { pinned: { value: true as const, raw: null } }),
    };
    if (Object.keys(fields).length > 0) out.set(id, fields);
  }
  return out;
}
