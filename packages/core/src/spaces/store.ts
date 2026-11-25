/**
 * SPACE-02, SPACE-05 (D-190, docs/05 §5): what spaces need from a cloud provider, provider-neutral.
 * A space is a fixed set of files in one member's account (`.flintspace`, `.flintfiles`; each
 * member's own `.flintmine` in theirs, 04 §9). A store only reads, writes with an expected revision,
 * creates and shares files and lists who has them; merging, the archive checks (Q11) and the
 * write-gap repair (Q9) live in core and name no provider. Google Drive and OneDrive implement it
 * in the app; `FakeSpaceStore` (several members, revisions, failures) runs it in unit tests and,
 * through `FLINT_E2E`, in end-to-end tests, so they reach no network.
 */

/** A space file as the provider reports it. */
export interface SpaceFileRef {
  readonly id: string;
  /** Changes whenever the content changes (Drive's `headRevisionId`, OneDrive's eTag). */
  readonly revision: string;
  readonly size: number;
  /** When it was last written, by the provider's clock (ms): the `.flintmine` clock rule's bound. */
  readonly modifiedTime: number;
}

/** One stored revision of a file, newest last (for the write-gap check, Q9). */
export interface SpaceRevision {
  readonly revision: string;
  readonly modifiedTime: number;
}

/** Someone with access to a space's files, as the provider reports them. */
export interface SpaceMember {
  readonly name: string;
  readonly address: string;
  /** Whose account holds the files. */
  readonly owner: boolean;
}

export type SpaceStoreProblem =
  /** No network, or the provider unreachable. */
  | 'offline'
  /** The sign-in expired or access was revoked. */
  | 'auth'
  /** The provider's storage is full. */
  | 'quota'
  /** The file is gone (deleted, trashed, or no longer shared with this account). */
  | 'gone'
  /** The file changed since the revision expected: read, merge and write again. */
  | 'changed'
  /** The provider has no account for that address (Drive's silent share, R-S2). */
  | 'no-account'
  | 'other';

export class SpaceStoreError extends Error {
  readonly problem: SpaceStoreProblem;

  constructor(problem: SpaceStoreProblem, message: string = problem) {
    super(message);
    this.name = 'SpaceStoreError';
    this.problem = problem;
  }
}

export interface SpaceStore {
  /**
   * Whether `write` with `expect` is truly conditional (OneDrive's `If-Match`: another write in
   * between is refused) or checked just before writing (Drive: another write can still land in the
   * gap, so core checks `revisions` after writing, Q9).
   */
  readonly conditionalWrites: boolean;
  info(fileId: string): Promise<SpaceFileRef>;
  read(fileId: string): Promise<{ readonly ref: SpaceFileRef; readonly content: Uint8Array }>;
  /** Writes the file whole. Throws `changed` when its revision is no longer `expect`. */
  write(fileId: string, content: Uint8Array, expect: string): Promise<SpaceFileRef>;
  /** The file's stored revisions, oldest first (kept 30 days by Drive). */
  revisions(fileId: string): Promise<readonly SpaceRevision[]>;
  /** One stored revision's content. */
  readRevision(fileId: string, revision: string): Promise<Uint8Array>;
  /** A new file in this account's spaces folder. */
  create(name: string, mimeType: string, content: Uint8Array): Promise<SpaceFileRef>;
  /** Gives `address` write access to the files, without the provider's own e-mail (Q18). */
  share(fileIds: readonly string[], address: string): Promise<void>;
  /** Takes access away (Remove from space); the file stays with its owner. */
  unshare(fileIds: readonly string[], address: string): Promise<void>;
  members(fileId: string): Promise<readonly SpaceMember[]>;
}
