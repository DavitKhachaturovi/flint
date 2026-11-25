/**
 * An in-memory provider for spaces' tests (D-190, docs/05 §5): several members' accounts share one,
 * each with their own view (`as(address)`), so a space's files can be created by one, shared with
 * others and written by all. Every write keeps a revision (for the write-gap repair, Q9); writes are
 * conditional (OneDrive) or checked just before writing (Drive, `conditionalWrites: false`), and a
 * test can slip another member's write into that gap (`beforeWrite`). Problems can be injected.
 * End-to-end tests use it through `FLINT_E2E`, so they reach no network.
 */
import {
  SpaceStoreError,
  type SpaceFileRef,
  type SpaceMember,
  type SpaceRevision,
  type SpaceStore,
} from './store.js';

interface Stored {
  readonly id: string;
  name: string;
  readonly mimeType: string;
  readonly owner: string;
  readonly shared: Set<string>;
  readonly revisions: { revision: string; modifiedTime: number; content: Uint8Array }[];
  deleted: boolean;
}

export class FakeSpaceStore {
  private readonly files = new Map<string, Stored>();
  /** Display names by address. */
  private readonly people = new Map<string, string>();
  private counter = 0;
  /** The provider's clock (ms); each write moves it on a second. */
  clock = Date.UTC(2026, 2, 10, 9, 0);
  /** Drive by default: the revision is checked right before writing, not with it. */
  conditionalWrites = false;
  offline = false;
  /** Addresses the provider has no account for (a silent share to them fails). */
  readonly noAccount = new Set<string>();
  /** Called right after a write's revision check, before it lands: another member can write here. */
  beforeWrite: ((fileId: string) => void) | null = null;
  readonly calls: string[] = [];

  private next(prefix: string): string {
    this.counter++;
    return `${prefix}${this.counter}`;
  }

  private later<T>(call: () => T): Promise<T> {
    return Promise.resolve().then(call);
  }

  /** Someone with an account at this provider. */
  person(address: string, name: string): void {
    this.people.set(address, name);
  }

  private stored(fileId: string, as: string): Stored {
    const file = this.files.get(fileId);
    if (!file || file.deleted || (file.owner !== as && !file.shared.has(as)))
      throw new SpaceStoreError('gone');
    return file;
  }

  private ref(file: Stored): SpaceFileRef {
    const last = file.revisions.at(-1);
    return {
      id: file.id,
      revision: last?.revision ?? '',
      size: last?.content.length ?? 0,
      modifiedTime: last?.modifiedTime ?? 0,
    };
  }

  private append(file: Stored, content: Uint8Array): SpaceFileRef {
    this.clock += 1000;
    file.revisions.push({
      revision: this.next('r'),
      modifiedTime: this.clock,
      content: content.slice(),
    });
    return this.ref(file);
  }

  /** A member's view of the provider. */
  as(address: string): SpaceStore {
    const check = (call: string): void => {
      this.calls.push(`${address} ${call}`);
      if (this.offline) throw new SpaceStoreError('offline');
    };
    const conditional = (): boolean => this.conditionalWrites;
    const store: SpaceStore = {
      get conditionalWrites() {
        return conditional();
      },
      info: (fileId) =>
        this.later(() => {
          check(`info ${fileId}`);
          return this.ref(this.stored(fileId, address));
        }),
      read: (fileId) =>
        this.later(() => {
          check(`read ${fileId}`);
          const file = this.stored(fileId, address);
          const last = file.revisions.at(-1);
          return { ref: this.ref(file), content: (last?.content ?? new Uint8Array()).slice() };
        }),
      write: (fileId, content, expect) =>
        this.later(() => {
          check(`write ${fileId}`);
          const file = this.stored(fileId, address);
          if (this.ref(file).revision !== expect) throw new SpaceStoreError('changed');
          // Drive: someone may write between the check and the write; OneDrive refuses then.
          if (this.beforeWrite) {
            const before = this.ref(file).revision;
            this.beforeWrite(fileId);
            if (this.conditionalWrites && this.ref(file).revision !== before)
              throw new SpaceStoreError('changed');
          }
          return this.append(file, content);
        }),
      revisions: (fileId) =>
        this.later(() => {
          check(`revisions ${fileId}`);
          return this.stored(fileId, address).revisions.map(
            ({ revision, modifiedTime }): SpaceRevision => ({ revision, modifiedTime }),
          );
        }),
      readRevision: (fileId, revision) =>
        this.later(() => {
          check(`readRevision ${fileId} ${revision}`);
          const found = this.stored(fileId, address).revisions.find(
            (each) => each.revision === revision,
          );
          if (!found) throw new SpaceStoreError('gone');
          return found.content.slice();
        }),
      create: (name, mimeType, content) =>
        this.later(() => {
          check(`create ${name}`);
          const file: Stored = {
            id: this.next('f'),
            name,
            mimeType,
            owner: address,
            shared: new Set(),
            revisions: [],
            deleted: false,
          };
          this.files.set(file.id, file);
          return this.append(file, content);
        }),
      share: (fileIds, to) =>
        this.later(() => {
          check(`share ${to}`);
          if (this.noAccount.has(to)) throw new SpaceStoreError('no-account');
          for (const fileId of fileIds) this.stored(fileId, address).shared.add(to);
        }),
      unshare: (fileIds, to) =>
        this.later(() => {
          check(`unshare ${to}`);
          for (const fileId of fileIds) this.stored(fileId, address).shared.delete(to);
        }),
      members: (fileId) =>
        this.later(() => {
          check(`members ${fileId}`);
          const file = this.stored(fileId, address);
          return [file.owner, ...file.shared].map((each): SpaceMember => ({
            name: this.people.get(each) ?? each,
            address: each,
            owner: each === file.owner,
          }));
        }),
    };
    return store;
  }

  /** Writes a file as `address` at once, bypassing the checks (another member's racing write). */
  writeNow(fileId: string, content: Uint8Array): void {
    const file = this.files.get(fileId);
    if (!file) throw new Error(`no file ${fileId}`);
    this.append(file, content);
  }

  /** The file's current content, for assertions. */
  content(fileId: string): Uint8Array | undefined {
    return this.files.get(fileId)?.revisions.at(-1)?.content;
  }

  /** The owner deletes the file (Leave by the creator, SPACE-08). */
  remove(fileId: string): void {
    const file = this.files.get(fileId);
    if (file) file.deleted = true;
  }
}
