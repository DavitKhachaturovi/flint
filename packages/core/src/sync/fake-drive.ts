/**
 * An in-memory Google Drive for sync's tests (SYNC-01, D-161, docs/05 §5): unit tests run the
 * engine against it, and test runs of the app use it in place of Google (no network at all).
 * Several PCs can share one, with their own clocks; problems can be injected.
 */
import { DriveError, type Drive, type RemoteFile, type RemoteFolder } from './drive.js';
import { decodeUtf8 } from './utf8.js';

interface Stored {
  file: RemoteFile;
  content: Uint8Array;
  folder: string;
  trashed: boolean;
}

function checksum(content: Uint8Array): string {
  // FNV-1a over the bytes: enough to tell contents apart in tests.
  let value = 0x811c9dc5;
  for (const byte of content) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

export class FakeDrive {
  private readonly files = new Map<string, Stored>();
  private readonly folders = new Map<
    string,
    { name: string; trashed: boolean; deleted: boolean }
  >();
  private counter = 0;
  /** Google's clock (ms). */
  clock = Date.UTC(2026, 2, 10, 9, 0);
  /** Bytes left; Infinity by default. */
  quota = Number.POSITIVE_INFINITY;
  offline = false;
  signedOut = false;
  /** Called before every write; a test can change Drive in between (a race with another PC). */
  beforeWrite: ((file: RemoteFile) => void) | null = null;
  /** Requests made, for tests that count them. */
  readonly calls: string[] = [];

  private next(prefix: string): string {
    this.counter++;
    return `${prefix}${this.counter}`;
  }

  private check(call: string): void {
    this.calls.push(call);
    if (this.offline) throw new DriveError('offline');
    if (this.signedOut) throw new DriveError('auth');
  }

  /** Runs a call as a request would: asynchronously, its errors as rejections. */
  private later<T>(call: () => T): Promise<T> {
    return Promise.resolve().then(call);
  }

  /** A view of this Drive as one PC sees it. */
  as(): Drive {
    return {
      folder: (knownId, name) => this.later(() => this.folder(knownId, name)),
      list: (folderId) => this.later(() => this.list(folderId)),
      read: (file) => this.later(() => this.read(file)),
      create: (folderId, kind, name, flintId, content, device) =>
        this.later(() => this.create(folderId, kind, name, flintId, content, device)),
      update: (file, content, options) => this.later(() => this.update(file, content, options)),
      trash: (file) => this.later(() => this.trash(file)),
    };
  }

  folder(knownId: string | null, name: string): RemoteFolder {
    this.check('folder');
    if (knownId !== null) {
      const known = this.folders.get(knownId);
      if (!known || known.trashed || known.deleted) throw new DriveError('folder-gone');
      return { id: knownId, path: `My Drive › ${known.name}` };
    }
    // drive.file: only folders this app created are visible; reuse one with this name.
    for (const [id, folder] of this.folders) {
      if (folder.name === name && !folder.trashed && !folder.deleted)
        return { id, path: `My Drive › ${name}` };
    }
    const id = this.next('folder-');
    this.folders.set(id, { name, trashed: false, deleted: false });
    return { id, path: `My Drive › ${name}` };
  }

  list(folderId: string): RemoteFile[] {
    this.check('list');
    const folder = this.folders.get(folderId);
    if (!folder || folder.trashed || folder.deleted) throw new DriveError('folder-gone');
    return [...this.files.values()]
      .filter((stored) => stored.folder === folderId && !stored.trashed)
      .map((stored) => stored.file);
  }

  read(file: RemoteFile): Uint8Array {
    this.check('read');
    const stored = this.files.get(file.id);
    if (!stored || stored.trashed) throw new DriveError('other', `no file ${file.id}`);
    return stored.content.slice();
  }

  private used(): number {
    let total = 0;
    for (const stored of this.files.values()) if (!stored.trashed) total += stored.content.length;
    return total;
  }

  create(
    folderId: string,
    kind: RemoteFile['kind'],
    name: string,
    flintId: string,
    content: Uint8Array,
    device: string,
  ): RemoteFile {
    this.check('create');
    if (this.used() + content.length > this.quota) throw new DriveError('quota');
    const file: RemoteFile = {
      id: this.next('file-'),
      name,
      kind,
      flintId,
      revision: checksum(content),
      size: content.length,
      modifiedTime: this.clock,
      device,
    };
    this.beforeWrite?.(file);
    this.files.set(file.id, { file, content: content.slice(), folder: folderId, trashed: false });
    return file;
  }

  update(
    file: RemoteFile,
    content: Uint8Array | null,
    options: { readonly name?: string; readonly device: string; readonly expect?: string },
  ): RemoteFile {
    this.check('update');
    const stored = this.files.get(file.id);
    if (!stored || stored.trashed) throw new DriveError('other', `no file ${file.id}`);
    this.beforeWrite?.(stored.file);
    const current = this.files.get(file.id) as Stored;
    if (options.expect !== undefined && current.file.revision !== options.expect) {
      throw new DriveError('changed');
    }
    const next = content ?? current.content;
    if (content && this.used() - current.content.length + content.length > this.quota) {
      throw new DriveError('quota');
    }
    const updated: RemoteFile = {
      ...current.file,
      name: options.name ?? current.file.name,
      revision: checksum(next),
      size: next.length,
      modifiedTime: content ? this.clock : current.file.modifiedTime,
      device: content ? options.device : current.file.device,
    };
    this.files.set(file.id, { ...current, file: updated, content: next.slice() });
    return updated;
  }

  trash(file: RemoteFile): void {
    this.check('trash');
    const stored = this.files.get(file.id);
    if (stored) stored.trashed = true;
  }

  // Test helpers: what a person could do in Drive itself.

  /** The files of the (first) folder by name, for assertions. */
  contents(kind: RemoteFile['kind'] = 'list'): Map<string, string> {
    const out = new Map<string, string>();
    for (const stored of this.files.values()) {
      if (stored.trashed || stored.file.kind !== kind) continue;
      out.set(stored.file.name, decodeUtf8(stored.content));
    }
    return out;
  }

  fileNamed(name: string): RemoteFile | undefined {
    for (const stored of this.files.values())
      if (!stored.trashed && stored.file.name === name) return stored.file;
    return undefined;
  }

  /** Trashes a file as the Drive website would (no record in removed.json). */
  trashInDrive(name: string): void {
    const file = this.fileNamed(name);
    const stored = file && this.files.get(file.id);
    if (stored) stored.trashed = true;
  }

  trashFolder(id: string): void {
    const folder = this.folders.get(id);
    if (folder) folder.trashed = true;
  }

  restoreFolder(id: string): void {
    const folder = this.folders.get(id);
    if (folder) folder.trashed = false;
  }

  renameFolder(id: string, name: string): void {
    const folder = this.folders.get(id);
    if (folder) folder.name = name;
  }
}
