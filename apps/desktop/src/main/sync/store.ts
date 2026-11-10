/**
 * Google Drive sync's files on this PC (SYNC-01, D-161, docs/04 §7), in app data's `sync\`:
 * `state.json`, the merge bases in `base\`, and the account in `account.bin`, encrypted with
 * Electron's safeStorage (DPAPI on Windows). Never in the Flint folder.
 */
import { mkdir, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readState, type BaseStore, type SyncState } from '@flint/core/sync';
import { writeFileAtomic } from '../storage/atomic.js';

export interface Account {
  readonly email: string;
  readonly refreshToken: string;
}

/** What encrypts the account (Electron's safeStorage; a plain stand-in in tests). */
export interface Cipher {
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

/** A list ID as a file name (IDs are `[A-Za-z0-9_-]`, but a file name must never escape the folder). */
function safeName(id: string): string {
  return encodeURIComponent(id).replace(/\./g, '%2E');
}

export class SyncStore {
  readonly folder: string;
  private readonly cipher: Cipher;

  constructor(folder: string, cipher: Cipher) {
    this.folder = folder;
    this.cipher = cipher;
  }

  private get statePath(): string {
    return join(this.folder, 'state.json');
  }

  private get accountPath(): string {
    return join(this.folder, 'account.bin');
  }

  /** Temporary files beside the state, on the same volume (atomic writes, DATA-01). */
  private get temp(): { readonly tempDirectory: string } {
    return { tempDirectory: join(this.folder, 'tmp') };
  }

  private get baseFolder(): string {
    return join(this.folder, 'base');
  }

  async readState(): Promise<SyncState> {
    return readState(await readFile(this.statePath, 'utf8').catch(() => null));
  }

  async writeState(state: SyncState): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await writeFileAtomic(this.statePath, JSON.stringify(state, null, 2), this.temp);
  }

  async readAccount(): Promise<Account | null> {
    try {
      const data = await readFile(this.accountPath);
      const value = JSON.parse(this.cipher.decrypt(data)) as Partial<Account>;
      return typeof value.refreshToken === 'string' && typeof value.email === 'string'
        ? { email: value.email, refreshToken: value.refreshToken }
        : null;
    } catch {
      return null;
    }
  }

  async writeAccount(account: Account): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await writeFileAtomic(
      this.accountPath,
      this.cipher.encrypt(JSON.stringify(account)),
      this.temp,
    );
  }

  /** Disconnect: the account, the state and the bases go; nothing in the Flint folder or Drive. */
  async forget(): Promise<void> {
    await unlink(this.accountPath).catch(() => undefined);
    await unlink(this.statePath).catch(() => undefined);
    await rm(this.baseFolder, { recursive: true, force: true });
  }

  /** Forgets what was synced (a new folder), keeping the account. */
  async forgetBases(): Promise<void> {
    await rm(this.baseFolder, { recursive: true, force: true });
  }

  readonly bases: BaseStore = {
    get: async (id) =>
      readFile(join(this.baseFolder, `${safeName(id)}.md`), 'utf8').catch(() => null),
    set: async (id, text) => {
      await mkdir(this.baseFolder, { recursive: true });
      await writeFileAtomic(join(this.baseFolder, `${safeName(id)}.md`), text, this.temp);
    },
    delete: async (id) => {
      await unlink(join(this.baseFolder, `${safeName(id)}.md`)).catch(() => undefined);
    },
  };
}
