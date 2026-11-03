import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';

/**
 * Today's bookkeeping in `.flint/today.json` (TODAY-01, TODAY-02, docs/04 §3, D-89): Today's
 * manual order (task IDs), the day each task was pinned (`pinnedOn`, for the rollover prompt), and
 * the day the prompt was last answered. Membership itself is the `pinned` field in the task's line
 * (D-85), so losing this file only loses the order and the prompt's memory. Tolerant: a missing or
 * broken file starts empty, unknown keys are kept. Days are local `YYYY-MM-DD`.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const two = (value: number): string => String(value).padStart(2, '0');
export const dayStamp = (now: Date): string =>
  `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;

export class TodayFile {
  private orderIds: string[] = [];
  private pinned = new Map<string, string>();
  private answeredOn: string | null = null;
  private extra: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | undefined;
  readonly path: string;

  constructor(folder: string) {
    this.path = join(folder, '.flint', 'today.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      const { order, pinnedOn, answered, ...extra } =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      this.extra = extra;
      this.orderIds = Array.isArray(order)
        ? order.filter((id): id is string => typeof id === 'string')
        : [];
      if (typeof pinnedOn === 'object' && pinnedOn !== null)
        for (const [id, day] of Object.entries(pinnedOn as Record<string, unknown>))
          if (typeof day === 'string' && DAY.test(day)) this.pinned.set(id, day);
      this.answeredOn = typeof answered === 'string' && DAY.test(answered) ? answered : null;
    } catch {
      this.orderIds = [];
    }
  }

  /** Today's manual order, task IDs; tasks not in it come first, newest pin first. */
  order(): readonly string[] {
    return this.orderIds;
  }

  setOrder(ids: readonly string[]): void {
    this.orderIds = [...ids];
    this.schedule();
  }

  /** A task pinned now (by Flint): at the top of Today, or right after `after`; pinned today. */
  pinnedNow(id: string, now: Date, after?: string): void {
    const rest = this.orderIds.filter((other) => other !== id);
    const at = after === undefined ? -1 : rest.indexOf(after);
    rest.splice(at < 0 ? 0 : at + 1, 0, id);
    this.orderIds = rest;
    this.pinned.set(id, dayStamp(now));
    this.schedule();
  }

  /** The day a task was pinned; one Flint sees pinned for the first time counts as today. */
  pinnedDay(id: string, now: Date): string {
    const known = this.pinned.get(id);
    if (known) return known;
    const today = dayStamp(now);
    this.pinned.set(id, today);
    this.schedule();
    return today;
  }

  /** TODAY-02: kept pinned for another day (Roll over). */
  keep(ids: Iterable<string>, now: Date): void {
    for (const id of ids) this.pinned.set(id, dayStamp(now));
    this.schedule();
  }

  answered(): string | null {
    return this.answeredOn;
  }

  answer(now: Date): void {
    this.answeredOn = dayStamp(now);
    this.schedule();
  }

  /** Writes soon (several changes in a row are one write). */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const pinnedOn = Object.fromEntries([...this.pinned].sort(([a], [b]) => a.localeCompare(b)));
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(
      this.path,
      `${JSON.stringify(
        { ...this.extra, flint: 1, order: this.orderIds, pinnedOn, answered: this.answeredOn },
        null,
        2,
      )}\n`,
      { tempDirectory: join(dirname(this.path), 'tmp') },
    ).catch(() => undefined);
  }
}
