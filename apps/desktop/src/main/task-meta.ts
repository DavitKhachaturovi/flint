import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';

/**
 * Per-task bookkeeping in `.flint/meta.json` (docs/04 §3): when Flint first saw each task
 * (`created`) and when it last changed one (`lastTouched`: an edit, a move, a priority, a
 * completion), and, for a task from the capture popup, when it was captured (`captured`, D-85: the
 * panel's Recently captured). A note's entry (keyed by its list ID) gives it a created date.
 * User data, travelling with the Flint folder; keyed by task ID. Tolerant: a missing or
 * broken file starts empty, unknown keys are kept. The context panel's footer shows them (NAV-07).
 * Times are local `YYYY-MM-DDTHH:MM`.
 */

export interface TaskMeta {
  readonly created: string;
  readonly lastTouched: string;
  readonly captured?: string;
}

const two = (value: number): string => String(value).padStart(2, '0');
export const localStamp = (now: Date): string =>
  `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`;

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export class TaskMetaFile {
  private tasks = new Map<string, TaskMeta>();
  private extra: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | undefined;
  readonly path: string;

  constructor(folder: string) {
    this.path = join(folder, '.flint', 'meta.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      const { tasks, ...extra } =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      this.extra = extra;
      if (typeof tasks === 'object' && tasks !== null)
        for (const [id, value] of Object.entries(tasks as Record<string, unknown>)) {
          const { created, lastTouched, captured } = (value ?? {}) as Record<string, unknown>;
          if (typeof created === 'string' && STAMP.test(created))
            this.tasks.set(id, {
              created,
              lastTouched:
                typeof lastTouched === 'string' && STAMP.test(lastTouched) ? lastTouched : created,
              ...(typeof captured === 'string' && STAMP.test(captured) && { captured }),
            });
        }
    } catch {
      this.tasks = new Map();
    }
  }

  get(id: string): TaskMeta | undefined {
    return this.tasks.get(id);
  }

  /** Tasks Flint sees for the first time get their entry (docs/04: created on first sight). */
  seen(ids: Iterable<string>, now: Date): void {
    let changed = false;
    const stamp = localStamp(now);
    for (const id of ids) {
      if (id.startsWith('~') || this.tasks.has(id)) continue;
      this.tasks.set(id, { created: stamp, lastTouched: stamp });
      changed = true;
    }
    if (changed) this.schedule();
  }

  /** Tasks Flint just changed. */
  touch(ids: Iterable<string>, now: Date): void {
    let changed = false;
    const stamp = localStamp(now);
    for (const id of ids) {
      if (id.startsWith('~')) continue;
      const known = this.tasks.get(id);
      this.tasks.set(id, { ...known, created: known?.created ?? stamp, lastTouched: stamp });
      changed = true;
    }
    if (changed) this.schedule();
  }

  /** D-85: a task saved from the capture popup. */
  captured(id: string, now: Date): void {
    const stamp = localStamp(now);
    const known = this.tasks.get(id);
    this.tasks.set(id, {
      created: known?.created ?? stamp,
      lastTouched: known?.lastTouched ?? stamp,
      captured: stamp,
    });
    this.schedule();
  }

  /** D-85: the IDs of the tasks captured with the popup, newest first. */
  captures(): string[] {
    return [...this.tasks]
      .filter(([, meta]) => meta.captured !== undefined)
      .sort(
        ([a, x], [b, y]) =>
          (y.captured ?? '').localeCompare(x.captured ?? '') || b.localeCompare(a),
      )
      .map(([id]) => id);
  }

  /** Writes soon (several changes in a row are one write). */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }

  /** D-138: what is waiting to be written, written now; resolves once nothing is in flight. */
  settled(): Promise<void> {
    return this.timer === undefined ? this.writing : this.flush();
  }

  private writing: Promise<void> = Promise.resolve();

  async flush(): Promise<void> {
    const write = this.write();
    this.writing = write;
    return write;
  }

  private async write(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const tasks = Object.fromEntries([...this.tasks].sort(([a], [b]) => a.localeCompare(b)));
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(
      this.path,
      `${JSON.stringify({ ...this.extra, flint: 1, tasks }, null, 2)}\n`,
      {
        tempDirectory: join(dirname(this.path), '..', '.flint', 'tmp'),
      },
    ).catch(() => undefined);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stamp (`2026-11-04T15:30`) as a local date, or null. */
export const parseStamp = (stamp: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp);
  return match
    ? new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
      )
    : null;
};

/** A day as the panel shows it: `29 Oct` (with the year when it isn't this year's). */
export function dayLabel(stamp: string, now: Date): string {
  const date = parseStamp(stamp);
  if (!date) return '';
  const day = `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** How long ago: `just now`, `5 min ago`, `2 h ago`, `yesterday`, else the day. */
export function agoLabel(stamp: string, now: Date): string {
  const date = parseStamp(stamp);
  if (!date) return '';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date >= today) return `${Math.floor(minutes / 60)} h ago`;
  if (date >= new Date(today.getTime() - 86_400_000)) return 'yesterday';
  return dayLabel(stamp, now);
}
