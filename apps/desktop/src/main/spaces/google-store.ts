/**
 * SPACE-02, SPACE-05 (D-190, docs/05 §5): Google Drive as a space store. Drive has no conditional
 * write, so `write` checks the revision right before writing (`conditionalWrites: false`) and core's
 * `writeSafely` lists the revisions afterwards (Q9). Under `drive.file` this account sees only the
 * files Flint made or that were picked in Google's picker (R-S2). Drive's errors become the store's.
 */
import { DriveError } from '@flint/core/sync';
import {
  SpaceStoreError,
  type SpaceFileRef,
  type SpaceMember,
  type SpaceStore,
  type SpaceStoreProblem,
} from '@flint/core/spaces';
import { NoGoogleAccount, type GoogleDrive, type SpaceFacts } from '../sync/google-drive.js';

export interface GoogleStoreOptions {
  readonly drive: GoogleDrive;
  /** The spaces folder's name (`Flint spaces`, `Flint spaces (development)`). */
  readonly folderName: string;
  /** This PC's name, written with every file (`appProperties.device`). */
  readonly device: string;
}

function problemOf(error: DriveError): SpaceStoreProblem {
  switch (error.problem) {
    case 'offline':
    case 'auth':
    case 'quota':
    case 'changed':
      return error.problem;
    case 'folder-gone':
      return 'gone';
    default:
      return /\b404\b/.test(error.message) ? 'gone' : 'other';
  }
}

/** Runs a Drive call, its errors as the store's. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NoGoogleAccount) throw new SpaceStoreError('no-account', error.message);
    if (error instanceof DriveError) throw new SpaceStoreError(problemOf(error), error.message);
    throw error;
  }
}

function ref(facts: SpaceFacts): SpaceFileRef {
  if (facts.trashed) throw new SpaceStoreError('gone', 'in Drive’s trash');
  return {
    id: facts.id,
    revision: facts.revision,
    size: facts.size,
    modifiedTime: facts.modifiedTime,
  };
}

export function googleSpaceStore(options: GoogleStoreOptions): SpaceStore {
  const { drive, folderName, device } = options;
  return {
    conditionalWrites: false,
    info: (fileId) => call(async () => ref(await drive.spaceFacts(fileId))),
    read: (fileId) =>
      call(async () => {
        const facts = ref(await drive.spaceFacts(fileId));
        const content = await drive.readSpaceFile(fileId);
        return { ref: facts, content };
      }),
    write: (fileId, content, expect) =>
      call(async () => {
        // Checked right before writing; another write can still land in between (Q9).
        const now = ref(await drive.spaceFacts(fileId));
        if (now.revision !== expect)
          throw new SpaceStoreError('changed', `expected ${expect}, Drive has ${now.revision}`);
        return ref(await drive.uploadSpaceFile(fileId, content, device));
      }),
    revisions: (fileId) =>
      call(async () =>
        (await drive.revisions(fileId)).map((revision) => ({
          revision: revision.id,
          modifiedTime: revision.modifiedTime,
        })),
      ),
    readRevision: (fileId, revision) => call(() => drive.readRevision(fileId, revision)),
    create: (name, mimeType, content) =>
      call(async () => {
        const folder = await drive.spacesFolder(folderName);
        return ref(
          await drive.createSpaceFile(
            folder,
            name,
            mimeType,
            { flintKind: 'space', device },
            content,
          ),
        );
      }),
    share: (fileIds, address) =>
      call(async () => {
        for (const fileId of fileIds) await drive.shareWith(fileId, address);
      }),
    unshare: (fileIds, address) =>
      call(async () => {
        const wanted = address.toLowerCase();
        for (const fileId of fileIds)
          for (const permission of await drive.permissions(fileId))
            if (permission.email.toLowerCase() === wanted && permission.role !== 'owner')
              await drive.removePermission(fileId, permission.id);
      }),
    members: (fileId) =>
      call(async () =>
        (await drive.permissions(fileId))
          .filter((permission) => permission.email !== '')
          .map((permission): SpaceMember => ({
            name: permission.name,
            address: permission.email,
            owner: permission.role === 'owner',
          })),
      ),
  };
}
