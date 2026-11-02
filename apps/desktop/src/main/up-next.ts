import { toDate, type LocalDateTime } from '@flint/core/time';
import type { UpNextItem } from '../shared/ipc.js';
import type { ReminderTask } from './reminders.js';

/** A task the panel lists by itself, without a time: a pin or a recent capture (D-85). */
export interface PanelTask {
  readonly id: string;
  readonly listId: string;
  readonly listName: string;
  readonly title: string;
  readonly done: boolean;
}

export interface UpNextInput {
  readonly reminders: readonly ReminderTask[];
  /** TODAY-01, D-85: pinned tasks, in list order (done ones until the day changes). */
  readonly pinned: readonly PanelTask[];
  /** D-85: the last popup captures, newest first. */
  readonly captured: readonly PanelTask[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How many recent captures the panel lists (D-85). */
export const RECENT_CAPTURES = 5;

/**
 * The context panel's "Up next" (NAV-07, D-83, D-85) when nothing is selected: pinned tasks, then
 * today's and tomorrow's reminders by time, then overdue ones (a quieter section), then the recent
 * captures (collapsed in the panel). Reminders: open tasks with a reminder that is on (not muted).
 */
export function upNext(input: UpNextInput, now: Date): UpNextItem[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const after = new Date(tomorrow.getTime() + 86_400_000);
  const time = (at: LocalDateTime): string =>
    `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`;
  const plain = (task: PanelTask, group: 'pinned' | 'captured'): UpNextItem => ({
    group,
    key: task.id,
    listId: task.listId,
    listName: task.listName,
    title: task.title,
    when: '',
    ...(task.done && { done: true }),
  });
  const timed: { readonly item: UpNextItem; readonly sort: number }[] = [];
  for (const task of input.reminders) {
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
            : `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''}`;
    timed.push({
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
  const rank = { today: 0, tomorrow: 1, overdue: 2 } as const;
  const reminders = timed
    .sort(
      (a, b) =>
        rank[a.item.group as keyof typeof rank] - rank[b.item.group as keyof typeof rank] ||
        a.sort - b.sort,
    )
    .map(({ item }) => item);
  return [
    ...input.pinned.map((task) => plain(task, 'pinned')),
    ...reminders,
    ...input.captured.slice(0, RECENT_CAPTURES).map((task) => plain(task, 'captured')),
  ];
}
