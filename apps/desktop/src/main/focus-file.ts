import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EMPTY_SPRINT, parseSprint, serializeSprint, type Sprint } from '@flint/core/focus';
import { writeFileAtomic } from './storage/atomic.js';

/**
 * FOCUS-02, FOCUS-03 (D-170): Focus's sprint in `.flint/focus.json` (docs/04): the tasks sent to
 * Focus, their order, estimates and counts. The format and its rules are core's (`@flint/core/focus`);
 * this reads and writes the file (a missing or broken one is an empty sprint). Per PC, never
 * synced. Several changes in a row are one write, as `today.json`'s.
 */
export class FocusFile {
  private value: Sprint = EMPTY_SPRINT;
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();
  readonly path: string;

  constructor(folder: string) {
    this.path = join(folder, '.flint', 'focus.json');
  }

  async load(): Promise<void> {
    try {
      this.value = parseSprint(await readFile(this.path, 'utf8'));
    } catch {
      this.value = EMPTY_SPRINT;
    }
  }

  get sprint(): Sprint {
    return this.value;
  }

  /** The sprint becomes `next` (written soon); false if nothing changed. */
  set(next: Sprint): boolean {
    if (next === this.value) return false;
    this.value = next;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
    return true;
  }

  /** D-138: what waits to be written, written now; resolves once nothing is in flight. */
  settled(): Promise<void> {
    return this.timer === undefined ? this.writing : this.flush();
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const text = serializeSprint(this.value);
    const write = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFileAtomic(this.path, text, {
        tempDirectory: join(dirname(this.path), 'tmp'),
      }).catch(() => undefined);
    });
    this.writing = write;
    return write;
  }
}
