import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';

/**
 * APP-10, D-116, D-119: the walkthrough's progress in app data (`tour.json`), never in the Flint
 * folder. It exists only while a tour is due or running:
 * - step −1: due (a fresh install), run once the main window shows;
 * - step 0 to 8: running, with what existed when it started (to remove what it made, D-117);
 * - `restart`: step 1's folder change is restarting Flint, so it goes on after the restart.
 * Any other start finding a running tour means it was cut short (a quit or a crash): it ends, and
 * the window says so once (D-119).
 */
export interface TourBaseline {
  /** The lists and notes (quick notes too) that existed when the tour started. */
  readonly lists: readonly string[];
  /** The tasks, by ID, in every list then. */
  readonly tasks: readonly string[];
}

interface TourRecord {
  readonly step: number;
  readonly restart: boolean;
  readonly baseline: TourBaseline | null;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];

function readRecord(value: unknown): TourRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const { step, restart, baseline } = value as Record<string, unknown>;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < -1) return null;
  const base =
    typeof baseline === 'object' && baseline !== null
      ? {
          lists: strings((baseline as Record<string, unknown>)['lists']),
          tasks: strings((baseline as Record<string, unknown>)['tasks']),
        }
      : null;
  return { step, restart: restart === true, baseline: base };
}

export class TourFile {
  private record: TourRecord | null = null;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      this.record = readRecord(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      this.record = null;
    }
  }

  /**
   * On a start: the step to run the tour from once the window shows (null: none), and whether a
   * tour was cut short (D-119). A cut-short tour ends here; a resumed one runs on.
   */
  async atStart(): Promise<{ readonly from: number | null; readonly interrupted: boolean }> {
    const record = this.record;
    if (!record) return { from: null, interrupted: false };
    if (record.step < 0) return { from: 0, interrupted: false };
    if (record.restart) {
      await this.write({ ...record, restart: false });
      return { from: record.step, interrupted: false };
    }
    await this.end();
    return { from: null, interrupted: true };
  }

  /** D-117: a fresh install: the tour is due. */
  due(): Promise<void> {
    return this.write({ step: -1, restart: false, baseline: null });
  }

  /** The tour starts (or starts again from step 1): what exists now is not the tour's. */
  start(baseline: TourBaseline): Promise<void> {
    return this.write({ step: 0, restart: false, baseline });
  }

  step(step: number): Promise<void> {
    if (!this.record || this.record.step < 0) return Promise.resolve();
    return this.write({ ...this.record, step });
  }

  /** D-119: step 1's folder change restarts Flint: the tour goes on at `step` after it. */
  restartAt(step: number): Promise<void> {
    if (!this.record || this.record.step < 0) return Promise.resolve();
    return this.write({ ...this.record, step, restart: true });
  }

  /** Whether a tour is running (not only due). */
  get running(): boolean {
    return this.record !== null && this.record.step >= 0;
  }

  /** The running tour's step (0-based); −1 when none runs. */
  get currentStep(): number {
    return this.record?.step ?? -1;
  }

  get baseline(): TourBaseline | null {
    return this.record?.baseline ?? null;
  }

  async end(): Promise<void> {
    this.record = null;
    await rm(this.path, { force: true });
  }

  private async write(record: TourRecord): Promise<void> {
    this.record = record;
    await writeFileAtomic(this.path, `${JSON.stringify(record)}\n`, {
      tempDirectory: join(dirname(this.path), 'tmp'),
    });
  }
}
