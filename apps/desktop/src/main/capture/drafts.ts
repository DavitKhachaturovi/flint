import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CaptureBlock, TextRange } from '@flint/core/shorthand';
import type { CaptureDraft } from '../../shared/ipc.js';
import { writeFileAtomic } from '../storage/atomic.js';

/**
 * The capture popup's draft (CAP-08), in app data (`drafts.json`, docs/04 §2): the title line, the
 * selection area's blocks (D-38) and any pasted images (CAP-06), kept on Esc, on click-away and
 * across restarts; cleared only once the capture is durably saved (D-27), or by Shift+Esc (D-39).
 * Ctrl+Shift+X on a closed popup sets the draft aside as the previous draft (D-39), so it is never
 * lost. Pasted images wait in `draft-attachments/` until they are saved.
 */

export interface DraftAttachment {
  readonly id: string;
  /** Shown on the chip, e.g. `screenshot.png`. */
  readonly name: string;
  readonly extension: string;
  readonly file: string;
}

interface Slot {
  draft: CaptureDraft;
  attachments: DraftAttachment[];
}

const EMPTY: CaptureDraft = { title: '', blocks: [] };

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const BLOCK_KINDS = new Set(['json', 'stack-trace', 'code', 'text', 'note']);

function readDraft(value: unknown): CaptureDraft {
  // Drafts saved before D-38 were one string: its first line is the title, the rest a text block.
  if (typeof value === 'string') {
    const [title = '', ...rest] = value.split(/\r\n|\r|\n/);
    const body = rest.join('\n').trim();
    return { title, blocks: body === '' ? [] : [{ kind: 'text', text: body }] };
  }
  const { title, blocks, inert } = (value ?? {}) as {
    title?: unknown;
    blocks?: unknown;
    inert?: unknown;
  };
  const text = typeof title === 'string' ? title : '';
  const ranges = Array.isArray(inert)
    ? inert.filter(
        (range): range is TextRange =>
          typeof (range as TextRange | null)?.start === 'number' &&
          typeof (range as TextRange).end === 'number' &&
          (range as TextRange).start >= 0 &&
          (range as TextRange).end <= text.length &&
          (range as TextRange).start < (range as TextRange).end,
      )
    : [];
  return {
    title: text,
    ...(ranges.length > 0 ? { inert: ranges } : {}),
    blocks: Array.isArray(blocks)
      ? blocks.filter(
          (block): block is CaptureBlock =>
            typeof (block as CaptureBlock | null)?.text === 'string' &&
            BLOCK_KINDS.has((block as CaptureBlock).kind),
        )
      : [],
  };
}

export function hasContent(draft: CaptureDraft): boolean {
  return draft.title.trim() !== '' || draft.blocks.some((block) => block.text.trim() !== '');
}

export class DraftFile {
  readonly path: string;
  private current: Slot = { draft: EMPTY, attachments: [] };
  private previous: Slot | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  get draft(): CaptureDraft {
    return this.current.draft;
  }

  get attachments(): readonly DraftAttachment[] {
    return this.current.attachments;
  }

  get hasPrevious(): boolean {
    return this.previous !== null;
  }

  /** Whether there is anything to keep: text, blocks or images. */
  get hasContent(): boolean {
    return hasContent(this.current.draft) || this.current.attachments.length > 0;
  }

  private get folder(): string {
    return join(dirname(this.path), 'draft-attachments');
  }

  private async readAttachments(value: unknown): Promise<DraftAttachment[]> {
    const attachments: DraftAttachment[] = [];
    for (const item of Array.isArray(value) ? (value as unknown[]) : []) {
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
        attachments.push({ id, name, extension, file });
    }
    return attachments;
  }

  async load(): Promise<CaptureDraft> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Record<
        string,
        unknown
      > | null;
      this.current = {
        draft: readDraft(parsed?.draft ?? parsed?.capture),
        attachments: await this.readAttachments(parsed?.attachments),
      };
      const previous = parsed?.previous as Record<string, unknown> | null | undefined;
      this.previous = previous
        ? {
            draft: readDraft(previous.draft),
            attachments: await this.readAttachments(previous.attachments),
          }
        : null;
    } catch {
      this.current = { draft: EMPTY, attachments: [] };
      this.previous = null;
    }
    return this.current.draft;
  }

  private persist(): Promise<void> {
    const slot = ({ draft, attachments }: Slot): Record<string, unknown> => ({
      draft,
      attachments: attachments.map(({ id, name, extension }) => ({ id, name, extension })),
    });
    const data = { ...slot(this.current), previous: this.previous ? slot(this.previous) : null };
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
  set(draft: CaptureDraft): Promise<void> {
    this.current.draft = readDraft(draft);
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
    this.current.attachments.push(attachment);
    await this.persist();
    return attachment;
  }

  async detach(id: string): Promise<void> {
    const attachment = this.current.attachments.find((item) => item.id === id);
    if (!attachment) return;
    this.current.attachments = this.current.attachments.filter((item) => item !== attachment);
    await this.persist();
    await rm(attachment.file, { force: true });
  }

  private async drop(attachments: readonly DraftAttachment[]): Promise<void> {
    await Promise.all(attachments.map((item) => rm(item.file, { force: true })));
  }

  /**
   * Clears the draft after a save, unless the user has changed it meanwhile: the draft must be the
   * same, and only the images that were saved are removed.
   */
  async clearIf(
    saved: CaptureDraft,
    savedAttachments: readonly DraftAttachment[] = [],
  ): Promise<void> {
    if (JSON.stringify(readDraft(saved)) !== JSON.stringify(this.current.draft)) return;
    const ids = new Set(savedAttachments.map((item) => item.id));
    const removed = this.current.attachments.filter((item) => ids.has(item.id));
    this.current = {
      draft: EMPTY,
      attachments: this.current.attachments.filter((item) => !ids.has(item.id)),
    };
    await this.persist();
    await this.drop(removed);
  }

  /** Shift+Esc (D-39): the draft and its images are gone. */
  async discard(): Promise<void> {
    const removed = this.current.attachments;
    this.current = { draft: EMPTY, attachments: [] };
    await this.persist();
    await this.drop(removed);
  }

  /** Ctrl+Shift+X on a closed popup (D-39): the draft becomes the previous draft; start fresh. */
  async setAside(): Promise<void> {
    if (!this.hasContent) return;
    const replaced = this.previous?.attachments ?? [];
    this.previous = this.current;
    this.current = { draft: EMPTY, attachments: [] };
    await this.persist();
    await this.drop(replaced);
  }

  /** "Previous draft · Restore": it comes back, and the current draft takes its place (D-39). */
  async restorePrevious(): Promise<void> {
    if (!this.previous) return;
    const current = this.current;
    this.current = this.previous;
    this.previous = hasContent(current.draft) || current.attachments.length > 0 ? current : null;
    await this.persist();
  }

  async dismissPrevious(): Promise<void> {
    const removed = this.previous?.attachments ?? [];
    this.previous = null;
    await this.persist();
    await this.drop(removed);
  }
}
