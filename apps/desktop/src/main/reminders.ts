import { formatLocalDateTime, toDate, type LocalDateTime } from '@flint/core/time';

/**
 * Which reminders to show now (REM-01, REM-05, REM-07 basic; D-64). Pure: the service around it
 * (reminder-service.ts) owns the clock, the timer and the toasts.
 *
 * A reminder is shown once: `fired` remembers the reminder value each task was shown for, so
 * changing the time (snooze, an edit) makes it due again, while a restart never repeats it.
 */

export interface ReminderTask {
  /** The task's ID (its key in the list). */
  readonly id: string;
  readonly listId: string;
  readonly listName: string;
  /** What the toast says: the title, or the display label of an untitled task (D-45). */
  readonly title: string;
  readonly at: LocalDateTime;
  readonly done: boolean;
  /** REM-12, D-66: turned off; never shown. */
  readonly muted: boolean;
}

/** Task ID → the reminder value (`YYYY-MM-DDTHH:MM`) it was shown for. */
export type FiredReminders = Readonly<Record<string, string>>;

export interface Due {
  readonly task: ReminderTask;
  /** Due before Flint could show it: Flint wasn't running, or the PC slept (REM-07). */
  readonly missed: boolean;
}

/** A reminder shown this much after its time counts as missed. */
export const LATE_MS = 2 * 60_000;
/** More missed reminders than this at once become one summary toast (D-64, Proposed). */
export const MAX_SEPARATE_MISSED = 3;

const firedKey = (at: LocalDateTime): string => formatLocalDateTime(at);

/**
 * The open tasks whose reminder time has come and that haven't been shown for that time, oldest
 * first, and the `fired` record to keep afterwards. Entries for tasks that are gone or whose
 * reminder changed are dropped; completed tasks keep theirs, so reopening one doesn't repeat it.
 */
export function dueReminders(
  tasks: readonly ReminderTask[],
  fired: FiredReminders,
  now: Date,
): { readonly due: Due[]; readonly fired: Record<string, string> } {
  const next: Record<string, string> = {};
  const due: Due[] = [];
  for (const task of tasks) {
    const key = firedKey(task.at);
    if (fired[task.id] === key) {
      next[task.id] = key;
      continue;
    }
    if (task.done) continue;
    const at = toDate(task.at).getTime();
    if (at > now.getTime()) continue;
    // D-66: a time that passes while the reminder is off is used up silently, so turning the
    // reminder back on later never pops a notification for a time already gone.
    if (!task.muted) due.push({ task, missed: now.getTime() - at > LATE_MS });
    next[task.id] = key;
  }
  due.sort((a, b) => toDate(a.task.at).getTime() - toDate(b.task.at).getTime());
  return { due, fired: next };
}

/** When the next not-yet-shown reminder of an open task comes due, if any. */
export function nextReminderAt(
  tasks: readonly ReminderTask[],
  fired: FiredReminders,
  now: Date,
): Date | null {
  let next: number | null = null;
  for (const task of tasks) {
    if (task.done || task.muted || fired[task.id] === firedKey(task.at)) continue;
    const at = toDate(task.at).getTime();
    if (at > now.getTime() && (next === null || at < next)) next = at;
  }
  return next === null ? null : new Date(next);
}

export interface ToastPlan {
  /** One toast each: Done / Snooze 10m / Open. */
  readonly separate: readonly {
    readonly id: string;
    readonly title: string;
    readonly label: string;
  }[];
  /** "N reminders you missed" with Open only, when too many were missed at once. */
  readonly summary: { readonly count: number; readonly titles: readonly string[] } | null;
}

/**
 * The toasts for what is due: every on-time reminder separately; missed ones separately too, unless
 * there are more than `MAX_SEPARATE_MISSED`, which become one summary (the full list is M6, REM-07).
 * The label says only what it is, `Reminder` or `Missed reminder`, above the task name: no time,
 * no list (D-68).
 */
export function planToasts(due: readonly Due[]): ToastPlan {
  const label = ({ missed }: Due): string => (missed ? 'Missed reminder' : 'Reminder');
  const missed = due.filter((entry) => entry.missed);
  const summarize = missed.length > MAX_SEPARATE_MISSED;
  const separate = (summarize ? due.filter((entry) => !entry.missed) : due).map((entry) => ({
    id: entry.task.id,
    title: entry.task.title,
    label: label(entry),
  }));
  return {
    separate,
    summary: summarize
      ? { count: missed.length, titles: missed.map((entry) => entry.task.title) }
      : null,
  };
}
