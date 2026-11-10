/**
 * Google Drive sync as the windows see it (SYNC-01, D-161): the status main sends, and the actions
 * the windows ask for. Shared by main, the preload bridge and the renderer.
 */

export type SyncMode = 'everything' | 'chosen';

export type SyncPhase =
  /** No Google client ID in this build (docs/06 §6): "Not set up in this build". */
  | 'unavailable'
  | 'disconnected'
  /** The browser sign-in is open: "Waiting for Google…". */
  | 'signing-in'
  /** Connected, What should sync? not answered yet (the setup dialog). */
  | 'setup'
  | 'synced'
  | 'syncing'
  | 'offline'
  /** Needs attention: `problem` says what. */
  | 'attention';

export interface SyncProblem {
  readonly kind: 'auth' | 'quota' | 'folder-gone' | 'error';
  readonly message: string;
  /** Drive full: what didn't fit. */
  readonly files?: readonly { readonly name: string; readonly size: number }[];
}

export interface SyncConflict {
  readonly listId: string;
  readonly name: string;
  readonly count: number;
}

export interface SyncLinkedFile {
  readonly device: string;
  readonly size: number;
}

export interface SyncRemoteItem {
  readonly listId: string;
  readonly name: string;
  readonly group: string | null;
}

export interface SyncRemoteGroup {
  readonly id: string;
  readonly name: string;
  readonly lists: readonly string[];
}

export interface SyncStatusView {
  readonly phase: SyncPhase;
  readonly email: string | null;
  /** When it last synced (ms), for "2 min ago". */
  readonly lastSync: number | null;
  readonly folderId: string | null;
  /** `My Drive › Flint`. */
  readonly folderPath: string | null;
  readonly mode: SyncMode | null;
  /** Lists and notes that sync on this PC. */
  readonly synced: readonly string[];
  /** Groups that sync on this PC. */
  readonly syncedGroups: readonly string[];
  /** "No longer synced: removed from Drive on another device", by list ID. */
  readonly notices: readonly string[];
  readonly problem: SyncProblem | null;
  readonly conflicts: readonly SyncConflict[];
  /** What other PCs sync that this one doesn't have (Choose…'s "In Drive, not on this PC"). */
  readonly remoteOnly: readonly SyncRemoteItem[];
  readonly remoteGroups: readonly SyncRemoteGroup[];
  /** Linked files of synced lists: list ID → `file:///` target → the PC that has it. */
  readonly linked: Readonly<Record<string, Readonly<Record<string, SyncLinkedFile>>>>;
  /** This PC's name (Windows computer name). */
  readonly device: string;
  /** Why the last Connect failed (Google's words), shown in Settings → Sync until the next try. */
  readonly connectError: string | null;
}

/** What Chosen → Everything will do (D-161 Q9), for its question. */
export interface SyncEverythingPreview {
  /** Lists and notes on this PC that start syncing. */
  readonly start: number;
  /** Items in Drive that come to this PC. */
  readonly fromDrive: number;
  /** Of those, the ones stopped on this PC before. */
  readonly stoppedHere: number;
}

export type SyncAction =
  | { readonly kind: 'connect' }
  | { readonly kind: 'cancel-connect' }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'sync-now' }
  | { readonly kind: 'mode'; readonly mode: SyncMode }
  /** Choose…: the chosen lists, notes and groups (on this PC and from Drive). */
  | { readonly kind: 'choose'; readonly ids: readonly string[] }
  /** Right-click → Sync with Google Drive on an item that doesn't sync. */
  | { readonly kind: 'start'; readonly id: string }
  /** The stop dialog: on this PC, or everywhere ("Also remove from Drive"). */
  | { readonly kind: 'stop'; readonly id: string; readonly everywhere: boolean }
  | { readonly kind: 'dismiss-notice'; readonly id: string }
  /** Open in Drive: the Flint folder, or (`id`) a synced list's or note's file. */
  | { readonly kind: 'open-drive'; readonly id?: string }
  | { readonly kind: 'restore-in-drive' }
  | { readonly kind: 'new-folder' };

/** "2 min ago", "just now", "at 14:02" (the status line, the list header). */
export function syncedAgo(lastSync: number | null, now: number): string {
  if (lastSync === null) return 'not synced yet';
  const minutes = Math.floor((now - lastSync) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const date = new Date(lastSync);
  return `on ${date.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]}`;
}

/** "3 lists, 1 note and 1 group" (the popover; `and` false: Settings' "3 lists, 1 note, 1 group"). */
export function syncCounts(lists: number, notes: number, groups: number, and = true): string {
  const parts = [
    lists > 0 ? `${lists} ${lists === 1 ? 'list' : 'lists'}` : null,
    notes > 0 ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : null,
    groups > 0 ? `${groups} ${groups === 1 ? 'group' : 'groups'}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return 'Nothing';
  if (!and || parts.length === 1) return parts.join(', ');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "1.8 GB" for a linked file's chip. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

const ACTIONS = new Set([
  'connect',
  'cancel-connect',
  'disconnect',
  'sync-now',
  'mode',
  'choose',
  'start',
  'stop',
  'dismiss-notice',
  'open-drive',
  'restore-in-drive',
  'new-folder',
]);

/** What a window sent is one of the actions, with the fields it needs (main checks, D-34). */
export function isSyncAction(value: unknown): value is SyncAction {
  if (typeof value !== 'object' || value === null) return false;
  const action = value as Record<string, unknown>;
  if (typeof action['kind'] !== 'string' || !ACTIONS.has(action['kind'])) return false;
  switch (action['kind']) {
    case 'mode':
      return action['mode'] === 'everything' || action['mode'] === 'chosen';
    case 'choose':
      return Array.isArray(action['ids']) && action['ids'].every((id) => typeof id === 'string');
    case 'start':
    case 'dismiss-notice':
      return typeof action['id'] === 'string';
    case 'stop':
      return typeof action['id'] === 'string' && typeof action['everywhere'] === 'boolean';
    case 'open-drive':
      return action['id'] === undefined || typeof action['id'] === 'string';
    default:
      return true;
  }
}
