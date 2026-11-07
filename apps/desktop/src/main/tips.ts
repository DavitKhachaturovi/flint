import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';

/**
 * D-107, D-109: tips shown the first few times only, counted in app data (`tips.json`), so the
 * main window and mini mode share the count (their pages keep separate storage). Losing the file
 * only shows a tip again.
 */
export class TipsFile {
  private counts: Record<string, number> = {};
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      this.counts = {};
      if (typeof parsed === 'object' && parsed !== null)
        for (const [name, value] of Object.entries(parsed))
          if (typeof value === 'number') this.counts[name] = value;
    } catch {
      this.counts = {};
    }
  }

  /** Whether `name` was shown fewer than `times` times; counts this showing. */
  due(name: string, times: number): boolean {
    const seen = this.counts[name] ?? 0;
    if (seen >= times) return false;
    this.counts[name] = seen + 1;
    this.save();
    return true;
  }

  /** APP-14, D-118: a tip's pattern happened once more (not counted once it was shown). */
  bump(tip: string): number {
    if (this.shown(tip)) return 0;
    const key = `tip:${tip}`;
    const count = (this.counts[key] ?? 0) + 1;
    this.counts[key] = count;
    this.save();
    return count;
  }

  shown(tip: string): boolean {
    return (this.counts[`shown:${tip}`] ?? 0) > 0;
  }

  /** D-118: seen (about 3 s on screen, or closed): never again. */
  markShown(tip: string): void {
    this.counts[`shown:${tip}`] = 1;
    this.save();
  }

  /** D-118, D-119: Reset tips: every tip (and the earlier counted hints) eligible again. */
  reset(): void {
    this.counts = {};
    this.save();
  }

  /** One write at a time, the latest counts last. */
  private writing: Promise<void> = Promise.resolve();

  private save(): void {
    const text = `${JSON.stringify(this.counts, null, 2)}\n`;
    this.writing = this.writing
      .catch(() => undefined)
      .then(() =>
        writeFileAtomic(this.path, text, { tempDirectory: join(dirname(this.path), 'tmp') }),
      )
      .catch(() => undefined);
  }
}
