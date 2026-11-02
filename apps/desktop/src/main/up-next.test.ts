import { describe, expect, it } from 'vitest';
import type { ReminderTask } from './reminders.js';
import { upNext } from './up-next.js';

const at = (day: number, hour: number, minute = 0) => ({
  year: 2026,
  month: 11,
  day,
  hour,
  minute,
  second: 0,
});
const task = (
  id: string,
  when: ReturnType<typeof at>,
  extra: Partial<ReminderTask> = {},
): ReminderTask => ({
  id,
  listId: 'inbox',
  listName: 'Inbox',
  title: id,
  at: when,
  done: false,
  muted: false,
  ...extra,
});

describe('Up next in the context panel (NAV-07, D-83)', () => {
  it('lists overdue first, then today and tomorrow by time; skips done, muted and later ones', () => {
    const now = new Date(2026, 10, 2, 14, 0);
    expect(
      upNext(
        [
          task('later', at(5, 9)),
          task('tomorrow', at(3, 10)),
          task('today-late', at(2, 17, 30)),
          task('today', at(2, 15)),
          task('yesterday', at(1, 17)),
          task('done', at(2, 16), { done: true }),
          task('muted', at(2, 16), { muted: true }),
        ],
        now,
      ).map((item) => `${item.group} ${item.when} ${item.key}`),
    ).toEqual([
      'overdue Yest 17:00 yesterday',
      'today 15:00 today',
      'today 17:30 today-late',
      'tomorrow 10:00 tomorrow',
    ]);
  });
});
