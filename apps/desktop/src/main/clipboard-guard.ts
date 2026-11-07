import { existsSync, rmSync, writeFileSync } from 'node:fs';
import type { ClipboardHistoryRead } from './clipboard-history.js';

/**
 * NAV-08, D-127: reading Windows' clipboard history calls into Windows directly, which could take
 * Flint down instead of failing. A marker file is written before every read and removed after it;
 * found at a start (or any time after), the last read never finished: reads stay off, the section
 * says why, and only a deliberate retry reads again, so it can never cause a crash loop. A quit in
 * the middle of a read removes the marker (that wasn't a crash).
 */
export type GuardedRead = ClipboardHistoryRead | { readonly kind: 'crashed' };

export class ClipboardGuard {
  private reading = 0;

  private readonly marker: string;
  private readonly reader: (limit: number) => Promise<ClipboardHistoryRead>;

  constructor(marker: string, reader: (limit: number) => Promise<ClipboardHistoryRead>) {
    this.marker = marker;
    this.reader = reader;
  }

  /** The last read never finished (a crash during it): reads are off until a retry. */
  get crashed(): boolean {
    return this.reading === 0 && existsSync(this.marker);
  }

  /** The newest `limit` items; `retry` reads even after a crash (the user asked for it). */
  async read(limit: number, retry = false): Promise<GuardedRead> {
    if (this.crashed && !retry) return { kind: 'crashed' };
    return this.marked(() => this.reader(limit));
  }

  /**
   * D-129: any other call into Windows' clipboard history (a picture, Delete, Clear all, Copy),
   * behind the same marker; null after a crash (reads are paused until Try again).
   */
  async act<T>(call: () => Promise<T> | T): Promise<T | null> {
    if (this.crashed) return null;
    return this.marked(call);
  }

  private async marked<T>(call: () => Promise<T> | T): Promise<T> {
    if (this.reading === 0) writeFileSync(this.marker, `${new Date().toISOString()}\n`);
    this.reading++;
    try {
      return await call();
    } finally {
      this.reading--;
      if (this.reading === 0) rmSync(this.marker, { force: true });
    }
  }

  /** Flint is quitting: a read under way is cut short, not crashed. */
  quitting(): void {
    if (this.reading > 0) rmSync(this.marker, { force: true });
  }
}
