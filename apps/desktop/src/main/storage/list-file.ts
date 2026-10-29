import { dirname, join } from 'node:path';
import {
  applyOp,
  documentMode,
  parseDocument,
  prepareForSave,
  rebase,
  serializeDocument,
  type Applied,
  type FlintDocument,
  type Op,
} from '@flint/core';
import type { LocalDateTime } from '@flint/core/time';
import { readListFile, writeFileAtomic, type ReadResult } from './atomic.js';

/**
 * One list file in memory (docs/04 §6): the document, the text last read from or written to disk,
 * and the operations applied since the last save. Saving re-reads the file first; if another program
 * changed it, the pending operations are re-applied on top, so its change is never overwritten.
 */
export interface SaveContext {
  readonly now: LocalDateTime;
  readonly isTaken: (id: string) => boolean;
}

export interface SaveOutcome {
  readonly written: boolean;
  /** The file had changed on disk; Flint's pending changes were re-applied on top of it. */
  readonly rebased: boolean;
  /** Task keys that got IDs on this save (for the undo history, `renameKeys`). */
  readonly renamed: ReadonlyMap<string, string>;
}

export type ReloadOutcome = 'unchanged' | 'reloaded' | 'unreadable';

export class ListFile {
  readonly path: string;
  private diskText: string | null;
  private pending: Op[] = [];
  document: FlintDocument;
  /** Why the file can't be edited, if it can't (not UTF-8, newer format, unknown mode, unreadable). */
  readOnly: string | null = null;

  private constructor(path: string, text: string | null) {
    this.path = path;
    this.diskText = text;
    this.document = parseDocument(text ?? '', { keySeed: path });
  }

  static async open(path: string): Promise<ListFile> {
    const read = await readListFile(path);
    const file = new ListFile(path, read.kind === 'text' ? read.text : null);
    file.readOnly = readOnlyReason(read, file.document);
    return file;
  }

  /** Whether there are changes not yet written. */
  get dirty(): boolean {
    return this.pending.length > 0;
  }

  /** Applies an operation to this list (its `list` must be this file's path). */
  apply(op: Op): Applied | null {
    if (this.readOnly) return null;
    const applied = applyOp(new Map([[this.path, this.document]]), op);
    const next = applied?.documents.get(this.path);
    if (!applied || !next) return null;
    this.document = next;
    this.pending.push(op);
    return applied;
  }

  async save(context: SaveContext): Promise<SaveOutcome> {
    const nothing: SaveOutcome = { written: false, rebased: false, renamed: new Map() };
    if (this.readOnly || this.pending.length === 0) return nothing;
    const read = await readListFile(this.path);
    let rebased = false;
    if (read.kind === 'text' && read.text !== this.diskText) {
      const fresh = parseDocument(read.text, { keySeed: this.path });
      this.document = rebase(new Map([[this.path, fresh]]), this.pending).get(this.path) ?? fresh;
      rebased = true;
    } else if (read.kind === 'unreadable' || read.kind === 'not-utf8') {
      throw new Error(
        `cannot save ${this.path}: ${read.kind === 'unreadable' ? read.reason : 'not UTF-8'}`,
      );
    }
    let renamed: ReadonlyMap<string, string> = new Map();
    if (documentMode(this.document) === 'tasks') {
      const prepared = prepareForSave(this.document, context);
      this.document = prepared.document;
      renamed = prepared.renamed;
    }
    const text = serializeDocument(this.document);
    if (read.kind === 'text' && text === read.text) {
      this.diskText = text;
      this.pending = [];
      return { written: false, rebased, renamed };
    }
    await writeFileAtomic(this.path, text, { tempDirectory: tempDirectoryFor(this.path) });
    this.diskText = text;
    this.pending = [];
    return { written: true, rebased, renamed };
  }

  /**
   * Called by the file watcher. Flint's own writes come back unchanged and are ignored by content;
   * another program's change is read, with unsaved Flint changes re-applied on top (DATA-06).
   */
  async reload(): Promise<ReloadOutcome> {
    const read = await readListFile(this.path);
    if (read.kind === 'text' && read.text === this.diskText) return 'unchanged';
    if (read.kind !== 'text') {
      this.readOnly = readOnlyReason(read, this.document);
      return 'unreadable';
    }
    const fresh = parseDocument(read.text, { keySeed: this.path });
    this.document = rebase(new Map([[this.path, fresh]]), this.pending).get(this.path) ?? fresh;
    this.diskText = read.text;
    this.readOnly = readOnlyReason(read, this.document);
    return 'reloaded';
  }
}

/** `.flint/tmp` next to the list: same volume, never shown as a list (docs/04 §2). */
export function tempDirectoryFor(listPath: string): string {
  return join(dirname(listPath), '.flint', 'tmp');
}

function readOnlyReason(read: ReadResult, document: FlintDocument): string | null {
  if (read.kind === 'not-utf8') return 'not-utf8';
  if (read.kind === 'unreadable') return `unreadable: ${read.reason}`;
  const version = Number(document.frontmatter?.flint ?? '1');
  if (Number.isFinite(version) && version > 1) return 'newer-format';
  if (documentMode(document) === 'unknown') return 'unknown-mode';
  return null;
}
