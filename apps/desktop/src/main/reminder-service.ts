import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { powerMonitor } from 'electron';
import { writeFileAtomic } from './storage/atomic.js';
import {
  dueReminders,
  nextReminderAt,
  planToasts,
  type FiredReminders,
  type ReminderTask,
  type ToastPlan,
} from './reminders.js';

/**
 * The reminder scheduler (REM-01, REM-05, REM-07 basic; D-64, docs/05 §5). Not one long timer per
 * reminder, which sleep and clock changes break: it re-checks at the next due time but at least
 * every 30 seconds, after the PC wakes, and whenever a list changes. What was shown is kept in
 * `reminders-state.json` (docs/04 §2), so a reminder is shown once, also across restarts.
 */

const MAX_WAIT_MS = 30_000;

export interface ReminderServiceOptions {
  /** `reminders-state.json` in app data. */
  readonly statePath: string;
  readonly tasks: () => ReminderTask[];
  readonly show: (plan: ToastPlan) => void;
  readonly log: (message: string) => void;
}

export class ReminderService {
  private fired: FiredReminders;
  private timer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();
  private readonly options: ReminderServiceOptions;

  private constructor(options: ReminderServiceOptions, fired: FiredReminders) {
    this.options = options;
    this.fired = fired;
  }

  /** Loads what was shown before and checks at once: anything due meanwhile shows as missed. */
  static async start(options: ReminderServiceOptions): Promise<ReminderService> {
    let fired: FiredReminders = {};
    try {
      const state = JSON.parse(await readFile(options.statePath, 'utf8')) as {
        fired?: unknown;
      };
      if (typeof state.fired === 'object' && state.fired !== null)
        fired = state.fired as FiredReminders;
    } catch {
      // No state yet (first run) or unreadable: every reminder due now counts as missed once.
    }
    const service = new ReminderService(options, fired);
    powerMonitor.on('resume', () => service.check());
    service.check();
    return service;
  }

  /** Shows what is due and waits for the next one. Also called when a list changed. */
  check(now = new Date()): void {
    clearTimeout(this.timer);
    const tasks = this.options.tasks();
    const { due, fired } = dueReminders(tasks, this.fired, now);
    const changed = JSON.stringify(fired) !== JSON.stringify(this.fired);
    this.fired = fired;
    if (due.length > 0) {
      this.options.log(`reminders due: ${due.map((entry) => entry.task.id).join(', ')}`);
      this.options.show(planToasts(due));
    }
    if (changed) this.save();
    const next = nextReminderAt(tasks, this.fired, now);
    const wait = next
      ? Math.max(250, Math.min(MAX_WAIT_MS, next.getTime() - now.getTime()))
      : MAX_WAIT_MS;
    this.timer = setTimeout(() => this.check(), wait);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private save(): void {
    const text = `${JSON.stringify({ fired: this.fired }, null, 2)}\n`;
    const path = this.options.statePath;
    this.saving = this.saving
      .then(() => writeFileAtomic(path, text, { tempDirectory: join(dirname(path), 'tmp') }))
      .catch((error: unknown) =>
        this.options.log(`could not save reminders state: ${String(error)}`),
      );
  }
}
