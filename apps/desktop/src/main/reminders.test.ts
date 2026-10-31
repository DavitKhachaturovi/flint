import { describe, expect, it } from 'vitest';
import { fromDate } from '@flint/core/time';
import {
  dueReminders,
  MAX_SEPARATE_MISSED,
  nextReminderAt,
  planToasts,
  type ReminderTask,
} from './reminders.js';

const now = new Date(2026, 9, 31, 15, 0, 30);
const minutes = (offset: number): Date => new Date(now.getTime() + offset * 60_000);
const task = (id: string, at: Date, extra: Partial<ReminderTask> = {}): ReminderTask => ({
  id,
  listId: 'inbox',
  listName: 'Inbox',
  title: `task ${id}`,
  at: fromDate(at),
  done: false,
  muted: false,
  ...extra,
});

describe('due reminders (REM-01, REM-05, REM-07; D-64)', () => {
  it('shows a due reminder once, and again only when its time changes', () => {
    const tasks = [task('a1', minutes(-0.5)), task('b2', minutes(10))];
    const first = dueReminders(tasks, {}, now);
    expect(first.due.map((entry) => [entry.task.id, entry.missed])).toEqual([['a1', false]]);
    expect(first.fired).toEqual({ a1: '2026-10-31T15:00' });

    // The next check, or a restart with the saved record: nothing new.
    expect(dueReminders(tasks, first.fired, minutes(1)).due).toEqual([]);

    // Snoozed: the new time is due again when it comes.
    const snoozed = [task('a1', minutes(10)), tasks[1]!];
    expect(dueReminders(snoozed, first.fired, minutes(5)).due).toEqual([]);
    expect(dueReminders(snoozed, first.fired, minutes(11)).due.map((e) => e.task.id)).toEqual([
      'a1',
      'b2',
    ]);
  });

  it('marks reminders from before Flint could show them as missed, oldest first', () => {
    const tasks = [task('late', minutes(-60)), task('later', minutes(-180)), task('now', now)];
    const { due } = dueReminders(tasks, {}, now);
    expect(due.map((entry) => [entry.task.id, entry.missed])).toEqual([
      ['later', true],
      ['late', true],
      ['now', false],
    ]);
  });

  it('never shows completed tasks, and keeps their record so reopening does not repeat it', () => {
    const fired = { a1: '2026-10-31T14:00' };
    const done = [
      task('a1', minutes(-60), { done: true }),
      task('b2', minutes(-60), { done: true }),
    ];
    const result = dueReminders(done, fired, now);
    expect(result.due).toEqual([]);
    expect(result.fired).toEqual(fired);
    const reopened = [task('a1', minutes(-60))];
    expect(dueReminders(reopened, result.fired, now).due).toEqual([]);
  });

  it('never shows a turned-off reminder, nor its time later when it is turned back on (D-66)', () => {
    const muted = [
      task('m1', minutes(-0.5), { muted: true }),
      task('m2', minutes(5), { muted: true }),
    ];
    const result = dueReminders(muted, {}, now);
    expect(result.due).toEqual([]);
    // The time that passed while off is used up; the future one is not.
    expect(result.fired).toEqual({ m1: '2026-10-31T15:00' });
    expect(nextReminderAt(muted, {}, now)).toBeNull();
    const back = [task('m1', minutes(-0.5)), task('m2', minutes(5))];
    expect(dueReminders(back, result.fired, minutes(1)).due).toEqual([]);
    expect(dueReminders(back, result.fired, minutes(6)).due.map((entry) => entry.task.id)).toEqual([
      'm2',
    ]);
  });

  it('forgets tasks that are gone', () => {
    expect(dueReminders([], { gone: '2026-10-31T14:00' }, now).fired).toEqual({});
  });

  it('finds the next reminder to wait for', () => {
    const tasks = [
      task('a1', minutes(30)),
      task('b2', minutes(5)),
      task('c3', minutes(1), { done: true }),
      task('d4', minutes(-5)),
    ];
    expect(nextReminderAt(tasks, {}, now)).toEqual(new Date(fromDateMs(minutes(5))));
    expect(nextReminderAt([], {}, now)).toBeNull();
  });
});

/** The minute a reminder names (reminders have no seconds). */
function fromDateMs(date: Date): number {
  const at = fromDate(date);
  return new Date(at.year, at.month - 1, at.day, at.hour, at.minute, at.second).getTime();
}

describe('toasts for due reminders', () => {
  it('labels on-time and missed reminders, with nothing else than the task (D-68)', () => {
    const plan = planToasts([
      { task: task('a1', now), missed: false },
      { task: task('b2', minutes(-120), { listId: 'u1', listName: 'Unicorn' }), missed: true },
    ]);
    expect(plan.separate).toEqual([
      { id: 'a1', title: 'task a1', label: 'Reminder' },
      { id: 'b2', title: 'task b2', label: 'Missed reminder' },
    ]);
    expect(plan.summary).toBeNull();
  });

  it(`summarizes more than ${MAX_SEPARATE_MISSED} missed reminders in one toast`, () => {
    const missed = [1, 2, 3, 4].map((n) => ({
      task: task(`m${n}`, minutes(-60 * n)),
      missed: true,
    }));
    const plan = planToasts([...missed, { task: task('a1', now), missed: false }]);
    expect(plan.separate.map((toast) => toast.id)).toEqual(['a1']);
    expect(plan.summary).toEqual({
      count: 4,
      titles: ['task m1', 'task m2', 'task m3', 'task m4'],
    });
  });
});
