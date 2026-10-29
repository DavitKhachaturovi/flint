import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from '../storage/atomic.js';

/**
 * The capture popup's draft (CAP-08), in app data (`drafts.json`, docs/04 §2): kept on Esc, on
 * losing focus and across restarts; cleared only once a capture is durably saved (D-27).
 */
export class DraftFile {
  readonly path: string;
  text = '';
  private writing: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<string> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      const text = (parsed as { capture?: unknown } | null)?.capture;
      this.text = typeof text === 'string' ? text : '';
    } catch {
      this.text = '';
    }
    return this.text;
  }

  /** Writes are queued, so the last one always wins. */
  set(text: string): Promise<void> {
    this.text = text;
    this.writing = this.writing
      .catch(() => undefined)
      .then(() =>
        writeFileAtomic(this.path, `${JSON.stringify({ capture: text }, null, 2)}\n`, {
          tempDirectory: join(dirname(this.path), 'tmp'),
        }),
      );
    return this.writing;
  }

  /** Clears the draft after a save, unless the user has typed something new meanwhile. */
  clearIf(saved: string): Promise<void> {
    return this.text === saved ? this.set('') : Promise.resolve();
  }
}
