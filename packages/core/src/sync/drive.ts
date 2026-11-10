/**
 * What Google Drive sync needs from Drive and from this PC (SYNC-01, D-161, docs/05 §5). The app
 * implements them with Google's REST API and the workspace; the tests with `FakeDrive` and memory.
 */

/** A file in the Drive folder that Flint created (`drive.file` sees no other). */
export interface RemoteFile {
  readonly id: string;
  /**
   * The file's name: a list's without `.md` (`Groceries` for `Groceries.md` in Drive), an
   * attachment's as it is, `groups.json`.
   */
  readonly name: string;
  readonly kind: 'list' | 'attachment' | 'meta';
  /** The list ID for lists (from the file's `appProperties`), the file name otherwise. */
  readonly flintId: string;
  /** Changes whenever the content changes (Drive's `md5Checksum` or revision). */
  readonly revision: string;
  readonly size: number;
  /** When it was last written, by Google's clock (ms). */
  readonly modifiedTime: number;
  /** The PC that wrote it last (`appProperties.device`), when known. */
  readonly device: string | null;
}

export interface RemoteFolder {
  readonly id: string;
  /** Where it is now, for Settings: `My Drive › Flint`. */
  readonly path: string;
}

export type DriveProblem =
  /** No network, or Google unreachable. */
  | 'offline'
  /** The sign-in expired or access was revoked. */
  | 'auth'
  /** Drive is full. */
  | 'quota'
  /** The Flint folder is in Drive's trash or deleted. */
  | 'folder-gone'
  /** The file changed in Drive since it was read: read, merge and write again. */
  | 'changed'
  | 'other';

export class DriveError extends Error {
  readonly problem: DriveProblem;

  constructor(problem: DriveProblem, message: string = problem) {
    super(message);
    this.name = 'DriveError';
    this.problem = problem;
  }
}

export interface Drive {
  /**
   * The sync folder: the known one by its ID (wherever it was moved or renamed to), or, when there
   * is none yet, a new one named `name` in My Drive. Throws `folder-gone` when the known one is in
   * Drive's trash or deleted.
   */
  folder(knownId: string | null, name: string): Promise<RemoteFolder>;
  /** Every file Flint created in the folder (lists, attachments, bookkeeping), not trashed. */
  list(folderId: string): Promise<RemoteFile[]>;
  read(file: RemoteFile): Promise<Uint8Array>;
  create(
    folderId: string,
    kind: RemoteFile['kind'],
    name: string,
    flintId: string,
    content: Uint8Array,
    device: string,
  ): Promise<RemoteFile>;
  /**
   * Writes a file again. With `expect`, throws `changed` when its revision is no longer that (Drive
   * has no conditional write: it is checked right before writing).
   */
  update(
    file: RemoteFile,
    content: Uint8Array | null,
    options: { readonly name?: string; readonly device: string; readonly expect?: string },
  ): Promise<RemoteFile>;
  /** Moves a file to Drive's trash (Google keeps it 30 days). */
  trash(file: RemoteFile): Promise<void>;
}

export interface LocalItem {
  readonly listId: string;
  /** The file's name without `.md`. */
  readonly name: string;
  /** The group it is in on this PC, if any. */
  readonly group: string | null;
  /** An empty quick note: never uploaded (D-161 Q9). */
  readonly skip: boolean;
}

export interface LocalGroup {
  readonly id: string;
  readonly name: string;
  readonly lists: readonly string[];
}

/** A task's bookkeeping carried between PCs (docs/04 §7): created and last touched, in ms. */
export interface TaskTimes {
  readonly c?: number;
  readonly t?: number;
}

/** This PC's side: the Flint folder through the workspace (atomic, re-read before write). */
export interface LocalSide {
  readonly device: string;
  now(): number;
  items(): Promise<LocalItem[]>;
  read(listId: string): Promise<string | null>;
  /** Writes a list or note (creating it as `name`, or a free variant, when new); returns its name. */
  write(listId: string, text: string, name: string): Promise<string>;
  /** Renames a list or note; returns the name it got (a free variant when taken). */
  rename(listId: string, name: string): Promise<string>;
  /** Moves a list or note to Flint's Trash. */
  trashList(listId: string): Promise<void>;
  /** Puts a task the other PC deleted into Flint's Trash (its block's text). */
  trashTask(listId: string, block: string): Promise<void>;
  groups(): Promise<LocalGroup[]>;
  /** Makes these synced groups so here (create, rename, membership); `removed` groups go (lists stay). */
  applyGroups(groups: readonly LocalGroup[], removed: readonly string[]): Promise<void>;
  taskTimes(listId: string): Promise<ReadonlyMap<string, TaskTimes>>;
  /** Takes newer times from the other PC. */
  applyTaskTimes(listId: string, times: ReadonlyMap<string, TaskTimes>): Promise<void>;
  /** Re-IDed incoming tasks (Today's order and reminder bookkeeping follow them). */
  renamedTasks(renamed: ReadonlyMap<string, string>): Promise<void>;
  readAttachment(name: string): Promise<Uint8Array | null>;
  attachmentSize(name: string): Promise<number | null>;
  writeAttachment(name: string, content: Uint8Array): Promise<void>;
  /** A linked file's size when it exists on this PC (`file:///…` target). */
  linkedFileSize(target: string): Promise<number | null>;
}

/** Where merge bases live (app data's `sync\base\`). */
export interface BaseStore {
  get(listId: string): Promise<string | null>;
  set(listId: string, text: string): Promise<void>;
  delete(listId: string): Promise<void>;
}
