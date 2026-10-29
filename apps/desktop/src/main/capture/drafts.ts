import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from '../storage/atomic.js';

/**
 * The capture popup's draft (CAP-08), in app data (`drafts.json`, docs/04 §2): the text and any
 * pasted images (CAP-06), kept on Esc, on losing focus and across restarts; cleared only once a
 * capture is durably saved (D-27). Pasted images wait in `draft-attachments/` until then.
 */

export interface DraftAttachment {
  readonly id: string;
  /** Shown on the chip, e.g. `screenshot.png`. */
  readonly name: string;
  readonly extension: string;
  readonly file: string;
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export class DraftFile {
  readonly path: string;
  text = '';
  attachments: DraftAttachment[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  private get folder(): string {
    return join(dirname(this.path), 'draft-attachments');
  }

  async load(): Promise<string> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as {
        capture?: unknown;
        attachments?: unknown;
      } | null;
      this.text = typeof parsed?.capture === 'string' ? parsed.capture : '';
      const stored = Array.isArray(parsed?.attachments) ? (parsed.attachments as unknown[]) : [];
      this.attachments = [];
      for (const item of stored) {
        const { id, name, extension } = (item ?? {}) as Record<string, unknown>;
        if (typeof id !== 'string' || typeof name !== 'string' || typeof extension !== 'string')
          continue;
        const file = join(this.folder, `${id}.${extension}`);
        // A staged image that is gone (cleaned up by hand) is dropped from the draft.
        if (
          await stat(file).then(
            () => true,
            () => false,
          )
        )
          this.attachments.push({ id, name, extension, file });
      }
    } catch {
      this.text = '';
      this.attachments = [];
    }
    return this.text;
  }

  private persist(): Promise<void> {
    const data = {
      capture: this.text,
      attachments: this.attachments.map(({ id, name, extension }) => ({ id, name, extension })),
    };
    this.writing = this.writing
      .catch(() => undefined)
      .then(() =>
        writeFileAtomic(this.path, `${JSON.stringify(data, null, 2)}\n`, {
          tempDirectory: join(dirname(this.path), 'tmp'),
        }),
      );
    return this.writing;
  }

  /** Writes are queued, so the last one always wins. */
  set(text: string): Promise<void> {
    this.text = text;
    return this.persist();
  }

  /** Stages a pasted image (CAP-06); null for types Flint doesn't attach. */
  async attach(bytes: Uint8Array, type: string): Promise<DraftAttachment | null> {
    const extension = IMAGE_TYPES[type];
    if (!extension) return null;
    const id = randomUUID();
    const file = join(this.folder, `${id}.${extension}`);
    await mkdir(this.folder, { recursive: true });
    await writeFileAtomic(file, bytes, { tempDirectory: join(dirname(this.path), 'tmp') });
    const attachment = { id, name: `screenshot.${extension}`, extension, file };
    this.attachments.push(attachment);
    await this.persist();
    return attachment;
  }

  async detach(id: string): Promise<void> {
    const attachment = this.attachments.find((item) => item.id === id);
    if (!attachment) return;
    this.attachments = this.attachments.filter((item) => item !== attachment);
    await this.persist();
    await rm(attachment.file, { force: true });
  }

  /**
   * Clears the draft after a save, unless the user has changed it meanwhile: the text must be the
   * same, and only the images that were saved are removed.
   */
  async clearIf(saved: string, savedAttachments: readonly DraftAttachment[] = []): Promise<void> {
    if (this.text !== saved) return;
    const ids = new Set(savedAttachments.map((item) => item.id));
    const removed = this.attachments.filter((item) => ids.has(item.id));
    this.attachments = this.attachments.filter((item) => !ids.has(item.id));
    this.text = '';
    await this.persist();
    await Promise.all(removed.map((item) => rm(item.file, { force: true })));
  }
}
