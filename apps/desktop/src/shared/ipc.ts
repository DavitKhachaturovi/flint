import type { CaptureBlock, ListInfo, TextRange } from '@flint/core/shorthand';

/**
 * IPC between the main process and renderers. Renderers only reach the OS through the typed
 * bridges in the preload scripts (docs/05 §2); these are the messages behind them.
 */

/** Milliseconds since the Unix epoch with sub-millisecond precision, comparable across processes. */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

export const Channels = {
  /** Any window → main: Cut / Copy / Paste / Select all from a text field's menu (UI-08). */
  editCommand: 'edit:command',
  popupShown: 'popup:shown',
  popupFocused: 'popup:focused',
  popupSubmit: 'popup:submit',
  popupDismiss: 'popup:dismiss',
  popupDraft: 'popup:draft',
  popupContent: 'popup:content',
  popupDiscard: 'popup:discard',
  popupPrevious: 'popup:previous',
  popupInteractive: 'popup:interactive',
  popupDrag: 'popup:drag',
  popupNoticeAction: 'popup:notice-action',
  popupResize: 'popup:resize',
  popupAttach: 'popup:attach',
  popupDetach: 'popup:detach',
  hotkeysState: 'hotkeys:state',
  hotkeysRecording: 'hotkeys:recording',
  hotkeysRebind: 'hotkeys:rebind',
  mainLists: 'main:lists',
  mainView: 'main:view',
  mainToggle: 'main:toggle',
  mainUndo: 'main:undo',
  mainRedo: 'main:redo',
  /** Main window → main: a pasted image saved to attachments/ (D-79). */
  mainAttach: 'main:attach',
  /** Main window → main: the sidebar's groups and order, and changes to them (LIST-05, LIST-06). */
  mainSidebar: 'main:sidebar',
  mainSidebarAction: 'main:sidebar-action',

  mainChange: 'main:change',
  mainReserveId: 'main:reserve-id',
  mainChanged: 'main:changed',
  /** Main → main window: show this task (a reminder's Open, REM-05). */
  mainReveal: 'main:reveal',
  /** Main window → main: open a link from a title in the browser (LIST-02). */
  mainOpenLink: 'main:open-link',
  /** Main window → main: new, rename or delete a list or note (LIST-01). */
  mainListAction: 'main:list-action',
  /** Main window → main: Insert ▸ Image (NOTE-02, D-82): pick a picture, copy it into attachments/. */
  mainPickImage: 'main:pick-image',
  /** Main window → main: a dragged or pasted file (MEDIA-01, MEDIA-03, D-84). */
  mainAttachFile: 'main:attach-file',
  /** Main window → main: a linked large file copied into attachments/ (MEDIA-03, D-84). */
  mainCopyIntoFlint: 'main:copy-into-flint',
  /** Main window → main: whether an attachment's file is there (D-84). */
  mainAttachmentExists: 'main:attachment-exists',
  /** Main window → main: an attachment in its default app, by the rules of D-84. */
  mainOpenAttachment: 'main:open-attachment',
  /** Main window → main: the context panel's "Up next" (NAV-07, D-83). */
  mainUpNext: 'main:up-next',
  /** Main → main window: the context panel hidden or shown on this display (NAV-07, D-83). */
  mainPanel: 'main:panel',
  /** Main window → main: Ctrl+\ hid or showed the panel on this display. */
  mainSetPanel: 'main:set-panel',
  /** Main window → main: a note in monospace or not (NOTE-06, D-84). */
  mainNoteMono: 'main:note-mono',
  /** Main window → main: the user's link patterns (NOTE-07, D-84). */
  mainLinkPatterns: 'main:link-patterns',
  /** Main → main window: the interface size changed (UI-12, D-81); the new zoom factor. */
  mainZoomed: 'main:zoomed',
  /** Main window → main: zoom in, out or back to 100 % (keys the main process didn't see first). */
  mainZoom: 'main:zoom',
  /** Main window → main: a note's text, edited as plain text until M5 (D-64). */
  mainSaveNote: 'main:save-note',
} as const;

/**
 * A message that follows a capture (D-26): shown as one quiet line at the top of the popup the next
 * time it opens, until dismissed or until the next capture is saved.
 */
export type PopupNotice =
  { readonly kind: 'created-list'; readonly name: string } | { readonly kind: 'save-failed' };

export type PopupNoticeAction = 'undo' | 'dismiss';

/** A pasted image on the capture (CAP-06), as its chip shows it. */
export interface AttachmentChip {
  readonly id: string;
  readonly name: string;
  /** A small PNG data URL for the chip. */
  readonly thumbnail: string;
}

/** Main → popup: the popup was just shown by the hotkey at `hotkeyAt`. */
/** What the capture popup holds (D-38): the title line and the selection area's blocks. */
export interface CaptureDraft {
  readonly title: string;
  readonly blocks: readonly CaptureBlock[];
  /** Stretches of the title that came from a selection or paste: plain text, never shorthand (D-45). */
  readonly inert?: readonly TextRange[];
}

/** "Previous draft · Restore" (D-39): bring it back (the current one takes its place) or drop it. */
export type PreviousDraftAction = 'restore' | 'dismiss';

export interface PopupShown {
  readonly hotkeyAt: number;
  /** The saved draft (CAP-08); it fills the popup only when the popup is empty or `replaceDraft`. */
  readonly draft: CaptureDraft;
  /** Ctrl+Shift+X on a closed popup starts fresh (D-39): the popup takes `draft` as it is. */
  readonly replaceDraft?: boolean;
  /** An earlier draft was set aside by Ctrl+Shift+X: show "Previous draft · Restore" (D-39). */
  readonly previousDraft: boolean;
  readonly attachments: readonly AttachmentChip[];
  readonly notice: PopupNotice | null;
  /** The lists for `##` chips, autocomplete and the new-list card (CAP-04, CAP-05). */
  readonly lists: readonly ListInfo[];
  /** Capture-selection (CAP-07): the selected text, added to the selection area (D-38). */
  readonly prefill?: string;
  /** A one-off line at the top of the popup, e.g. why no selection could be read (CAP-07). */
  readonly hint?: string;
}

/** Popup → main: the input has focus and a frame with it has been produced (R-1). */
export interface PopupFocused {
  readonly hotkeyAt: number;
  readonly focusedAt: number;
  readonly frameAt: number;
  readonly documentFocused: boolean;
  readonly inputFocused: boolean;
}

/** Popup → main on Enter (D-27): the capture changes hands before the popup hides. */
export interface PopupSubmit {
  /** The capture as text: title line, then the body (D-38, `composeCapture`). */
  readonly text: string;
  /** The draft it came from, so exactly that draft is cleared once saved (D-27). */
  readonly draft: CaptureDraft;
  readonly keyAt: number;
  /** Tab on the close-match card: create the typed list instead (D-25). */
  readonly chooseNewList: boolean;
}

export interface PopupSubmitAck {
  readonly accepted: boolean;
}

export type ToastKind = 'default' | 'reminder' | 'urgent';

/** APP-08: a global hotkey as the Hotkeys window shows it. */
export interface HotkeyView {
  readonly accelerator: string;
  /** False when another app owns the combination, so it doesn't work. */
  readonly registered: boolean;
}

export type HotkeyName = 'capture' | 'selection';

export type HotkeysView = Readonly<Record<HotkeyName, HotkeyView>>;

export type RebindOutcome = 'saved' | 'in-use' | 'invalid' | 'needs-modifier' | 'same-as-other';

/** M4 main window: a list in the sidebar (LIST-01). */
export interface ListSummary {
  readonly id: string;
  readonly name: string;
  readonly mode: 'tasks' | 'note';
  /** Open top-level tasks. */
  readonly open: number;
  readonly inbox: boolean;
  /** Most recently used rank (0 = last move or capture target), for the list picker (D-25). */
  readonly recentRank?: number;
}

/** A task as a row (TASK-01..06). */
export interface TaskRow {
  readonly key: string;
  /** The task line as written; empty for an untitled task (D-45). */
  readonly title: string;
  /** What the row shows when the title is empty (D-45: made here, never written). */
  readonly label: string;
  /** Untitled task whose body is code: shown as a collapsed code row (D-45). */
  readonly code: { readonly kind: string; readonly lines: number; readonly peek: string } | null;
  readonly priority: 'high' | 'medium' | 'low' | null;
  /** `Today 15:00`, `Tomorrow 09:00` (REM-08). */
  readonly reminder: string | null;
  /** The reminder as written (`YYYY-MM-DDTHH:MM`), for the date/time picker (REM-01). */
  readonly reminderAt: string | null;
  /** REM-11, REM-12: on, past while the task is open (overdue), or turned off (muted). */
  readonly reminderState: 'on' | 'overdue' | 'muted' | null;
  readonly done: boolean;
  /** When it was completed: `Today 11:42`, `Yesterday`, `Mon` (TASK-06). */
  readonly completed: string | null;
  readonly body: string;
  readonly subtasks: readonly TaskRow[];
  /** NAV-07, docs/04 §3: when Flint first saw it, and last changed it (`29 Oct`, `2 h ago`). */
  readonly created?: string;
  readonly edited?: string;
}

/** NAV-07, D-83: an item of the context panel's "Up next". */
export interface UpNextItem {
  readonly group: 'overdue' | 'today' | 'tomorrow';
  readonly key: string;
  readonly listId: string;
  readonly listName: string;
  readonly title: string;
  /** `15:00`, or for an overdue one `Yest 17:00`. */
  readonly when: string;
}

/** Something in a task list that isn't a task: shown read-only (TASK-15). */
export type ListItem =
  | { readonly kind: 'task'; readonly task: TaskRow }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string };

export interface ListView {
  readonly id: string;
  readonly name: string;
  readonly mode: 'tasks' | 'note';
  readonly open: number;
  readonly items: readonly ListItem[];
  readonly completed: readonly TaskRow[];
  /** Why the list can't be changed, if it can't (not UTF-8, newer format…). */
  readonly readOnly: string | null;
  /** A note's text (LIST-01), shown read-only until the note editor (M5). */
  readonly noteText: string | null;
  /** NOTE-06, D-84: a note shown in monospace (this machine's choice). */
  readonly mono?: boolean;
  /** NAV-07: when the file last changed (`just now`, `2 h ago`). */
  readonly edited?: string;
}

/**
 * M4 main window → main: one change from the Navigate/Edit keys or the composer (docs/03 §2).
 * `text` is what was typed, with selected or pasted stretches escaped so they stay text (D-45).
 */
export type ListChange =
  | {
      readonly kind: 'add';
      readonly text: string;
      /** The composer adds at the top; Edit-state Enter below the task being edited. */
      readonly where: 'top' | { readonly after: string };
      /** From `reserveId`: a new row's task ID, known before the save finishes. */
      readonly id?: string;
    }
  | { readonly kind: 'edit'; readonly key: string; readonly text: string }
  /** TASK-05, D-49: a task's body, as typed in its plain field. */
  | { readonly kind: 'body'; readonly key: string; readonly body: string }
  /** TASK-16, D-74: a copy right below the task, open, without its reminder. */
  | { readonly kind: 'duplicate'; readonly key: string }
  /** TASK-07: completes or reopens a task (a bulk action); nothing if it already is. */
  | { readonly kind: 'complete'; readonly key: string; readonly done: boolean }
  /** TASK-07, D-59: several changes as one step, undone together. */
  | { readonly kind: 'many'; readonly label: string; readonly changes: readonly ListChange[] }
  | {
      readonly kind: 'priority';
      readonly key: string;
      readonly priority: 'high' | 'medium' | 'low' | null;
    }
  | { readonly kind: 'move'; readonly key: string; readonly direction: 'up' | 'down' }
  /** TASK-01, D-54: a drop, before or after another task at the same level. */
  | {
      readonly kind: 'place';
      readonly key: string;
      readonly where: { readonly at: 'before' | 'after'; readonly key: string };
    }
  | { readonly kind: 'indent' | 'outdent'; readonly key: string }
  /** REM-01, D-68: a new reminder time from the date/time picker (turns the reminder on). */
  | {
      readonly kind: 'reminder';
      readonly key: string;
      readonly at: {
        readonly year: number;
        readonly month: number;
        readonly day: number;
        readonly hour: number;
        readonly minute: number;
        readonly second: number;
      };
    }
  /** REM-12, D-66: the bell turns a reminder off (kept, never fired) or back on. */
  | { readonly kind: 'mute'; readonly key: string; readonly muted: boolean }
  /** TASK-12, D-50: to Trash storage, undoable. */
  | { readonly kind: 'delete'; readonly key: string }
  /** TASK-11: to the top of another list, or of a new one. */
  | {
      readonly kind: 'moveTo';
      readonly key: string;
      readonly to: { readonly list: string } | { readonly newList: string };
    };

export interface ChangeOutcome {
  /** For the toast and undo: `Added`, `Added to Infra`, `Priority high`. */
  readonly label: string;
  /** The task changed or added. */
  readonly key: string | null;
  /** Where it is now (an `add` with `##list` lands in another list). */
  readonly listId: string;
  readonly listName: string;
}

/** A text field's menu command, run by the main process on the sender (UI-08). */
export type EditCommand = 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'selectAll';

/** LIST-01, D-52, D-55: what the sidebar asks of a list. */
export type ListAction =
  | { readonly kind: 'new'; readonly name: string; readonly mode: 'tasks' | 'note' }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | { readonly kind: 'delete'; readonly id: string }
  /** D-59: several lists and notes at once, undone together. */
  | { readonly kind: 'deleteMany'; readonly ids: readonly string[] }
  /** D-72, D-74: "<name> copy" right below it, new IDs, no reminders. */
  | { readonly kind: 'duplicate'; readonly id: string }
  /** LIST-04, D-22, D-72: a task list becomes a note, or a note a task list. */
  | { readonly kind: 'convert'; readonly id: string; readonly mode: 'tasks' | 'note' };

/** LIST-06, D-73: the sidebar's order. */
export type SidebarSort = 'manual' | 'edited' | 'created';

/** The sidebar as shown (LIST-05, D-73, D-74): Inbox stays pinned above it. */
export type SidebarItem =
  | {
      readonly kind: 'group';
      readonly id: string;
      readonly name: string;
      readonly lists: readonly string[];
    }
  | { readonly kind: 'list'; readonly id: string };

export interface SidebarView {
  readonly sort: SidebarSort;
  /** Groups folded away on this machine (ui-state.json). */
  readonly collapsed: readonly string[];
  readonly items: readonly SidebarItem[];
}

/** Changes to the sidebar's groups and order (LIST-05, LIST-06). */
export type SidebarAction =
  | { readonly kind: 'newGroup'; readonly name: string }
  | { readonly kind: 'renameGroup'; readonly id: string; readonly name: string }
  | { readonly kind: 'deleteGroup'; readonly id: string }
  /** A list into, within or out of a group (`group: null`), or a group among the top level. */
  | {
      readonly kind: 'move';
      readonly id: string;
      readonly to: { readonly group: string | null; readonly index: number };
    }
  /** Alt+↑/↓ in the manual order. */
  | { readonly kind: 'step'; readonly id: string; readonly direction: -1 | 1 }
  | { readonly kind: 'sort'; readonly sort: SidebarSort }
  | { readonly kind: 'collapse'; readonly id: string; readonly collapsed: boolean };

export type SidebarOutcome =
  | { readonly ok: true; readonly label: string; readonly id?: string }
  | { readonly ok: false; readonly problem: string };

/** What a list action did, or why it couldn't (shown next to the name being typed). */
export type ListActionOutcome =
  | { readonly ok: true; readonly listId: string; readonly label: string }
  | { readonly ok: false; readonly problem: string };

/** MEDIA-01, MEDIA-03, D-84: a file added to a note or a body. */
export type AttachFileOutcome =
  | {
      readonly ok: true;
      /** `attachments/…`, or `file:///…` when the file is large and linked where it is. */
      readonly link: string;
      readonly linked: boolean;
      readonly kind: 'image' | 'video' | 'document' | 'blocked' | 'other';
      readonly name: string;
      readonly bytes: number;
    }
  | { readonly ok: false; readonly problem: string };

/** What opening an attachment did (D-84). */
export type OpenAttachmentOutcome = 'opened' | 'missing' | 'refused' | 'cancelled';
