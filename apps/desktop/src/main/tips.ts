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
    void writeFileAtomic(this.path, `${JSON.stringify(this.counts, null, 2)}\n`, {
      tempDirectory: join(dirname(this.path), 'tmp'),
    }).catch(() => undefined);
    return true;
  }
}
