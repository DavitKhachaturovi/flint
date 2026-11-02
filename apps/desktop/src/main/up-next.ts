import { toDate, type LocalDateTime } from '@flint/core/time';
import type { UpNextItem } from '../shared/ipc.js';
import type { ReminderTask } from './reminders.js';

/**
 * The context panel's "Up next" (NAV-07, D-83) when nothing is selected: overdue reminders first,
 * then today's and tomorrow's by time. Open tasks with a reminder that is on (not muted). "Starred
 * for today" joins once Today exists (M6).
 */
export function upNext(tasks: readonly ReminderTask[], now: Date): UpNextItem[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const after = new Date(tomorrow.getTime() + 86_400_000);
  const time = (at: LocalDateTime): string =>
    `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`;
  const items: { readonly item: UpNextItem; readonly sort: number }[] = [];
  for (const task of tasks) {
    if (task.done || task.muted) continue;
    const at = toDate(task.at);
    const group =
      at.getTime() <= now.getTime()
        ? 'overdue'
        : at < tomorrow
          ? 'today'
          : at < after
            ? 'tomorrow'
            : null;
    if (!group) continue;
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const when =
      group !== 'overdue'
        ? time(task.at)
        : day.getTime() === today.getTime()
          ? time(task.at)
          : day.getTime() === today.getTime() - 86_400_000
            ? `Yest ${time(task.at)}`
            : `${at.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][at.getMonth()] ?? ''}`;
    items.push({
      item: {
        group,
        key: task.id,
        listId: task.listId,
        listName: task.listName,
        title: task.title,
        when,
      },
      sort: at.getTime(),
    });
  }
  const rank = { overdue: 0, today: 1, tomorrow: 2 } as const;
  return items
    .sort((a, b) => rank[a.item.group] - rank[b.item.group] || a.sort - b.sort)
    .map(({ item }) => item);
}
