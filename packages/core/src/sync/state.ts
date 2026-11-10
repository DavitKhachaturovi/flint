/**
 * Google Drive sync's per-PC state (`%APPDATA%\Flint\sync\state.json`, docs/04 §7, D-161). Plain
 * JSON; a missing or unreadable file is a new connection.
 */

export type SyncMode = 'everything' | 'chosen';

export interface SyncedItem {
  readonly fileId: string;
  /** The Drive file's revision when this PC last synced it. */
  readonly revision: string;
  /** Its name in Drive then (`Groceries.md` without `.md`). */
  readonly name: string;
  /** Its name on this PC then. */
  readonly localName: string;
}

export interface LinkedFile {
  /** The PC whose Windows computer name had the file. */
  readonly device: string;
  readonly size: number;
}

export interface SyncedGroup {
  readonly id: string;
  readonly name: string;
  readonly lists: readonly string[];
}

export interface SyncState {
  readonly flint: 1;
  /** The Drive folder's ID, null until the first sync made or found it. */
  folderId: string | null;
  folderPath: string | null;
  /** Null until What should sync? was answered (D-161). */
  mode: SyncMode | null;
  /** Chosen lists, notes and groups (by ID), under Chosen items. */
  chosen: string[];
  /** Lists and groups stopped on this PC: never downloaded here again (D-161 Q1). */
  stopped: string[];
  /** Synced lists and notes, by list ID. */
  items: Record<string, SyncedItem>;
  /** Attachments known in Drive, by name: the file's ID and revision. */
  attachments: Record<string, { readonly fileId: string; readonly revision: string }>;
  /** groups.json as last synced (the base of the group merge). */
  groups: SyncedGroup[];
  /** Linked files of synced lists: list ID → `file:///` target → where it is. */
  linked: Record<string, Record<string, LinkedFile>>;
  /** "No longer synced: removed from Drive on another device" (D-161), by list ID. */
  notices: string[];
  /** Lists and groups to stop syncing everywhere at the next run ("Also remove from Drive"). */
  removals: string[];
  /** Lists whose attachments didn't all reach Drive yet (Drive was full): tried again. */
  pending: string[];
  lastSync: number | null;
}

export function emptyState(): SyncState {
  return {
    flint: 1,
    folderId: null,
    folderPath: null,
    mode: null,
    chosen: [],
    stopped: [],
    items: {},
    attachments: {},
    groups: [],
    linked: {},
    notices: [],
    removals: [],
    pending: [],
    lastSync: null,
  };
}

/** Reads state.json tolerantly: anything missing gets its empty value. */
export function readState(text: string | null): SyncState {
  const state = emptyState();
  if (text === null) return state;
  try {
    const value = JSON.parse(text) as Partial<SyncState>;
    const list = (input: unknown): string[] =>
      Array.isArray(input)
        ? input.filter((entry): entry is string => typeof entry === 'string')
        : [];
    const record = <T>(input: unknown): Record<string, T> =>
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, T>)
        : {};
    state.folderId = typeof value.folderId === 'string' ? value.folderId : null;
    state.folderPath = typeof value.folderPath === 'string' ? value.folderPath : null;
    state.mode = value.mode === 'everything' || value.mode === 'chosen' ? value.mode : null;
    state.chosen = list(value.chosen);
    state.stopped = list(value.stopped);
    state.items = record(value.items);
    state.attachments = record(value.attachments);
    state.groups = Array.isArray(value.groups) ? value.groups : [];
    state.linked = record(value.linked);
    state.notices = list(value.notices);
    state.removals = list(value.removals);
    state.pending = list(value.pending);
    state.lastSync = typeof value.lastSync === 'number' ? value.lastSync : null;
  } catch {
    // An unreadable state file is a new connection (docs/04 §7).
  }
  return state;
}
