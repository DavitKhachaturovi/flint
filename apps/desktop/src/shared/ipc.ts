import type { LinkPattern } from './link-patterns.js';
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
  /** D-111: main → popup: the card fades out (the focus is already back), then it is hidden. */
  popupHiding: 'popup:hiding',
  popupHidden: 'popup:hidden',
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
  /** APP-08, D-102: the global hotkeys, recorded in Settings (the main window). */
  mainHotkeys: 'main:hotkeys',
  mainHotkeysRecording: 'main:hotkeys-recording',
  mainHotkeysRebind: 'main:hotkeys-rebind',
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
  /** MINI-01, D-109: the main window, the palette or the hotkey: show mini mode, or hide it. */
  miniToggle: 'mini:toggle',
  /** Mini → main: hide it (×), to the tray. */
  miniHide: 'mini:hide',
  /** Mini ↔ main: its tab and note, remembered; on top (its pin). */
  miniState: 'mini:state',
  miniSetState: 'mini:set-state',
  miniSetOnTop: 'mini:set-on-top',
  /** Main → mini: it was shown (`focus`: Davit opened it, so it takes the keyboard). */
  miniShown: 'mini:shown',
  /** Main → mini: it is being hidden (a quick note is left). */
  miniHiding: 'mini:hiding',
  /** D-111: main → mini: hidden now (after its fade): the card waits, ready to rise in. */
  miniHidden: 'mini:hidden',
  /** Mini → main: a place in the main window (Open, double-click, Enter), mini stays. */
  miniOpen: 'mini:open',
  /** REM-06, D-109: the reminder cards waiting in mini (main → mini), and acting on one. */
  miniAlerts: 'mini:alerts',
  miniGetAlerts: 'mini:get-alerts',
  miniAlertAction: 'mini:alert-action',
  /**
   * D-110: mini mode's transparent stage. Main → mini: where the card sits in the window and how
   * big it may be; mini → main: the card's size and the places that take the pointer, a resize's
   * result, and (snapping into another corner) that the card is hidden, so the window can move.
   */
  miniLayout: 'mini:layout',
  miniGetLayout: 'mini:get-layout',
  miniLayoutReady: 'mini:layout-ready',
  miniSettled: 'mini:settled',
  miniSurface: 'mini:surface',
  miniResized: 'mini:resized',
  /** D-109: one window edits a note at a time (claim, hand over, the owner's live text). */
  noteClaim: 'note:claim',
  noteRelease: 'note:release',
  noteReleased: 'note:released',
  noteLive: 'note:live',
  noteLeave: 'note:leave',
  noteEditor: 'note:editor',
  noteEditorOf: 'note:editor-of',
  /** D-107, D-109: a first-few-times tip, counted in app data (shared by both windows). */
  tipDue: 'tip:due',
  /** Main → main window: show this task (a reminder's Open, REM-05). */
  mainReveal: 'main:reveal',
  /** REM-07, D-94: the missed-reminders toast's Open: Today, its Overdue card open. */
  mainOverdue: 'main:overdue',
  /** REM-06, D-94: a reminder fired and Flint's own sound is on: play it. */
  mainChime: 'main:chime',
  /** DATA-02, D-97: the Trash view, and what it does. */
  mainTrash: 'main:trash',
  mainTrashRestore: 'main:trash-restore',
  mainTrashPreview: 'main:trash-preview',
  mainTrashDelete: 'main:trash-delete',
  mainTrashEmpty: 'main:trash-empty',
  mainArchiveRestore: 'main:archive-restore',
  /** DATA-04, D-97: snapshots, their files, a restore, and the tray asking for the view. */
  mainSnapshots: 'main:snapshots',
  mainSnapshotFiles: 'main:snapshot-files',
  mainSnapshotRestore: 'main:snapshot-restore',
  /** D-99: a list's or note's comparison with now, and restoring chosen tasks of it. */
  mainSnapshotDiff: 'main:snapshot-diff',
  mainSnapshotRestoreTasks: 'main:snapshot-restore-tasks',
  mainShowSnapshots: 'main:show-snapshots',
  /** DATA-05, D-99: Export Flint folder… (a save dialog). */
  mainExport: 'main:export',
  /** APP-11, D-100: Settings: read, change, and what goes with them. */
  mainSettings: 'main:settings',
  mainSetSetting: 'main:set-setting',
  mainSnapshotSpace: 'main:snapshot-space',
  mainClearSnapshots: 'main:clear-snapshots',
  mainOpenFolder: 'main:open-folder',
  mainShowSettings: 'main:show-settings',
  /** Main window → main: Windows' folder picker for a new Flint folder, and what it holds (D-104). */
  mainChooseFolder: 'main:choose-folder',
  /** Main window → main: move to, start fresh in, or open a folder as the Flint folder (D-104). */
  mainChangeFolder: 'main:change-folder',
  /** Main window → main: the user's link patterns, saved from Settings → Links (D-104). */
  mainSaveLinkPatterns: 'main:save-link-patterns',
  /** Main window → main: the built-in link recognizers turned off, and setting them (D-105). */
  mainBuiltInLinksOff: 'main:built-in-links-off',
  mainSetBuiltInLinksOff: 'main:set-built-in-links-off',
  /** Main window → main: how many places in the lists and notes a pattern would link (D-105). */
  mainCountLinkMatches: 'main:count-link-matches',
  /** Main window → main: the Ctrl+K palette's search, live or in Trash and the archive (D-106). */
  mainSearch: 'main:search',
  /** Main window → main: Quit Flint, from the palette (APP-03, D-106). */
  mainQuit: 'main:quit',
  /** D-67, D-100: the animation speed changed (every window scales its motion). */
  mainAppearance: 'main:appearance',
  /** NOTE-08, D-99: a new quick note; an empty one left behind goes. */
  mainQuickNote: 'main:quick-note',
  mainDiscardQuickNote: 'main:discard-quick-note',
  mainKeepQuickNote: 'main:keep-quick-note',
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
  /** TODAY-02 (M6): the rollover prompt's answer: keep the pins, or clear them. */
  mainTodayAnswer: 'main:today-answer',
  /** TASK-06, D-88: auto-archive's days (null: off), and turning it on or off. */
  mainAutoArchive: 'main:auto-archive',
  mainSetAutoArchive: 'main:set-auto-archive',
  /** MEDIA-02, D-87: a picture's menu: copy it, show it in its folder, open it in its app. */
  mainImageAction: 'main:image-action',
  /** Main window → main: the context panel's "Up next" (NAV-07, D-83). */
  mainUpNext: 'main:up-next',
  /** Main → main window: the context panel hidden or shown on this display (NAV-07, D-83). */
  mainPanel: 'main:panel',
  /** Main window → main: Ctrl+\ hid or showed the panel on this display. */
  mainSetPanel: 'main:set-panel',
  /** Main window → main: a note in monospace or not (NOTE-06, D-84). */
  mainNoteMono: 'main:note-mono',
  /**
   * D-116: main → main window and mini: everything is set up, calls can go; asked, whether it is
   * (answered from before the page loads).
   */
  mainStarted: 'main:started',
  /** APP-10, APP-15, D-117: main → main window: it was shown (the tour and What's new wait). */
  mainShown: 'main:shown',
  /** APP-14, D-118: main → main window: it was hidden (a tip not seen yet comes back later). */
  mainHidden: 'main:hidden',
  /** Main window → main: what onboarding has to show this start (`OnboardingState`). */
  mainOnboarding: 'main:onboarding',
  /** Main window → main: the walkthrough started, moved on, ended, or removes what it made. */
  mainTour: 'main:tour',
  /** Main → main window: something a walkthrough step waits for happened (`TourEvent`). */
  mainTourEvent: 'main:tour-event',
  /** Main window → main: What's new was shown; this version is the last one seen. */
  mainWhatsNewSeen: 'main:whats-new-seen',
  /** APP-14, D-118: main window → main: a tip's pattern happened; resolves to whether it is due. */
  mainTipEvent: 'main:tip-event',
  /** Main window → main: a tip was seen (3 s on screen, or closed): never again. */
  mainTipShown: 'main:tip-shown',
  /** Main window → main: Reset tips (D-118, D-119). */
  mainResetTips: 'main:reset-tips',
  /**
   * NAV-08, D-127, D-128: main window → main: Windows' clipboard history as the section shows it
   * (`true`: retry, also after a read that never finished); read again only when something new was
   * copied.
   */
  mainClipboard: 'main:clipboard',
  /** D-129: an item made the clipboard's content again, as Win+V's pick (no new entry). */
  mainClipboardCopy: 'main:clipboard-copy',
  /** D-128: an item captured as a task: the capture popup, prefilled as by Ctrl+Shift+X. */
  mainClipboardCapture: 'main:clipboard-capture',
  /** D-129: a picture item whole, as PNG bytes. */
  mainClipboardImage: 'main:clipboard-image',
  /** D-129: an item deleted (also from Win+V); resolves to the Undo token. */
  mainClipboardDelete: 'main:clipboard-delete',
  /** D-129: Undo of a delete: the item added back as the newest. */
  mainClipboardRestore: 'main:clipboard-restore',
  /** D-129: Clear all (Win+V too; its pinned items are kept). */
  mainClipboardClear: 'main:clipboard-clear',
  /** D-128: Windows' clipboard settings (`ms-settings:clipboard`). */
  mainClipboardSettings: 'main:clipboard-settings',
  /** Main window → main: the user's link patterns (NOTE-07, D-84). */
  mainLinkPatterns: 'main:link-patterns',
  /** Main → main window: the interface size changed (UI-12, D-81); the new zoom factor. */
  mainZoomed: 'main:zoomed',
  /** Main window → main: zoom in, out or back to 100 % (keys the main process didn't see first). */
  mainZoom: 'main:zoom',
  /** Main window → main: the interface size on its display now (D-102, Settings). */
  mainZoomLevel: 'main:zoom-level',
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
  /** D-105: the link patterns and the built-ins turned off, for the link chips. */
  readonly linkPatterns: readonly LinkPattern[];
  readonly builtInLinksOff: readonly string[];
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

export type HotkeyName = 'capture' | 'selection' | 'mini';

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
  /**
   * NOTE-08, D-99: a quick note (no title yet): its label (its first line, or when it was made)
   * and when it was made (newest first under Inbox).
   */
  readonly quick?: { readonly label: string; readonly at: number };
  /** D-122: a note's (or quick note's) creation time, ms: mini's Open a note… lists newest first. */
  readonly made?: number;
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
  /** TASK-08, D-88: when Flint first saw it (`YYYY-MM-DDTHH:MM`), for the sort by date added. */
  readonly createdAt?: string;
  /** TODAY-01, D-85: pinned (the Today view in M6). */
  readonly pinned?: boolean;
  /** TODAY-01 (M6): in Today, the task's home list, shown subtly on its row. */
  readonly home?: { readonly listId: string; readonly listName: string };
}

/**
 * TODAY-01 (M6, D-89): the Today view's ID: a view over the pinned tasks of every list, never a
 * file (`@` can't start a list's ID, docs/04).
 */
export const TODAY_ID = '@today';

/** TODAY-03: a reminder later today, as a card in Today. */
export interface TodayReminder {
  readonly key: string;
  readonly listId: string;
  readonly listName: string;
  readonly title: string;
  /** `15:00`. */
  readonly time: string;
  /** The reminder as written (`YYYY-MM-DDTHH:MM`), for "in 2 h". */
  readonly at: string;
  /** D-92: the task is done (struck through on the timeline). */
  readonly done: boolean;
}

/** DATA-02, D-97: something in the Trash view's Deleted tab. */
export interface TrashItem {
  /** Its file name in `.flint/trash/`. */
  readonly id: string;
  readonly kind: 'task' | 'list' | 'note';
  readonly title: string;
  /** The list a task was deleted from. */
  readonly from: string | null;
  /** When it was deleted, `YYYY-MM-DDTHH:MM`. */
  readonly deleted: string;
}

/** TASK-06, D-97: one list's auto-archived completed tasks, in the Trash view's Archived tab. */
export interface ArchivedList {
  readonly listId: string;
  readonly listName: string;
  readonly tasks: readonly {
    readonly key: string;
    readonly title: string;
    /** When it was completed, `YYYY-MM-DD`. */
    readonly completed: string;
  }[];
}

/** DATA-02, D-97: the Trash view. */
export interface TrashView {
  readonly deleted: readonly TrashItem[];
  readonly archived: readonly ArchivedList[];
}

/** D-98: a trash item opened read-only: its title, text and tasks (a list's, or a task's subtasks). */
export interface TrashPreview extends TrashItem {
  /** A task's notes, or a note's text (without its header). */
  readonly body: string;
  readonly tasks: readonly {
    readonly title: string;
    readonly done: boolean;
    readonly sub: boolean;
  }[];
}

/** D-98: where a restored item now is: "Go to Work", and opening it to edit. */
export interface RestoredItem {
  readonly label: string;
  readonly listId: string;
  readonly listName: string;
  /** The task, for a restored task; null for a list or a note. */
  readonly key: string | null;
}

/** DATA-04, D-97: a snapshot in the Snapshots view. */
export interface SnapshotSummary {
  readonly id: string;
  /** When it was taken, `YYYY-MM-DDTHH:MM`. */
  readonly at: string;
  /** How many of its lists and notes differ from now (changed, or deleted since). */
  readonly differs: number;
}

/** DATA-04, D-97: a list or note in a snapshot, and how it compares with now. */
export interface SnapshotFile {
  readonly path: string;
  readonly name: string;
  readonly kind: 'list' | 'note';
  readonly state: 'same' | 'changed' | 'deleted';
}

/** D-99: one task in a snapshot's comparison with now (by task ID). */
export interface SnapshotTaskDiff {
  readonly key: string;
  /** added: there now, not then (restoring removes it); deleted: then, not now; changed: both. */
  readonly state: 'added' | 'deleted' | 'changed';
  readonly title: string;
  /** For a changed task, what differs: title, priority, reminder, notes, subtasks, completion. */
  readonly changes: readonly string[];
}

/** D-99: a list or note in a snapshot against now (or, deleted since, as it was). */
export type SnapshotDiff =
  | { readonly kind: 'list'; readonly name: string; readonly tasks: readonly SnapshotTaskDiff[] }
  | {
      readonly kind: 'note';
      readonly name: string;
      readonly lines: readonly {
        readonly kind: 'same' | 'added' | 'removed';
        readonly text: string;
      }[];
    }
  | {
      readonly kind: 'deleted';
      readonly name: string;
      readonly mode: 'list' | 'note';
      readonly text: string;
      readonly tasks: readonly {
        readonly title: string;
        readonly done: boolean;
        readonly sub: boolean;
      }[];
    };

/** The Snapshots view's place (D-97): reached from the tray and from Trash, never a list. */
export const SNAPSHOTS_ID = '@snapshots';

/** APP-11, D-100: what the Settings view shows and changes. */
export interface SettingsView {
  readonly startWithWindows: boolean;
  readonly notifications: boolean;
  readonly reminderSound: boolean;
  readonly hideNotificationText: boolean;
  readonly rolloverPrompt: boolean;
  readonly autoArchiveDays: number | null;
  readonly snapshotEveryMinutes: number;
  readonly keepHourlyHours: number;
  readonly keepDailyDays: number;
  readonly animationSpeed: 'relaxed' | 'normal' | 'quick';
  readonly flintFolder: string;
  readonly captureHotkey: string;
  readonly captureSelectionHotkey: string;
  /** D-109: mini mode (Settings → Mini mode) and the popup's sharing switch. */
  readonly miniHotkey: string;
  readonly miniHideFromSharing: boolean;
  readonly popupHideFromSharing: boolean;
  readonly miniReminders: 'when-open' | 'always';
  readonly version: string;
  /** APP-14, D-118: Don't show tips. */
  readonly tipsOff: boolean;
  /** NAV-08, D-128: clipboard history on in Flint; its contents shown at rest. */
  readonly clipboardHistory: boolean;
  readonly clipboardShowContents: boolean;
}

/** The settings the Settings view can change, and the values they take. */
export type SettingChange =
  | {
      readonly key: 'startWithWindows' | 'notifications' | 'reminderSound';
      readonly value: boolean;
    }
  | {
      readonly key:
        | 'hideNotificationText'
        | 'rolloverPrompt'
        | 'tipsOff'
        | 'clipboardHistory'
        | 'clipboardShowContents';
      readonly value: boolean;
    }
  | { readonly key: 'autoArchiveDays'; readonly value: number | null }
  | {
      readonly key: 'snapshotEveryMinutes' | 'keepHourlyHours' | 'keepDailyDays';
      readonly value: number;
    }
  | { readonly key: 'animationSpeed'; readonly value: 'relaxed' | 'normal' | 'quick' }
  | {
      readonly key: 'miniHideFromSharing' | 'popupHideFromSharing';
      readonly value: boolean;
    }
  | { readonly key: 'miniReminders'; readonly value: 'when-open' | 'always' };

/** APP-10, APP-15, D-117, D-119: what onboarding has to show on this start. */
export interface OnboardingState {
  /** Whether the main window is on screen now (else the tour and What's new wait for it). */
  readonly visible: boolean;
  /** The walkthrough to run once the window shows, from this step (0-based); null: none. */
  readonly tourFrom: number | null;
  /** D-119: a tour was cut short by a quit or crash: say so once, with Replay. */
  readonly interrupted: boolean;
  /** D-117: What's new is due, for the versions after `since` (null: an install from before it). */
  readonly whatsNew: { readonly since: string | null } | null;
  readonly version: string;
}

/** The walkthrough's progress, told to main so it survives the folder change's restart (D-119). */
export type TourAction =
  | { readonly kind: 'start' }
  | { readonly kind: 'step'; readonly step: number }
  | { readonly kind: 'end' }
  /** D-116, D-117: what the tour made goes to Trash as one undoable step; ends it. */
  | { readonly kind: 'remove' };

/** What a walkthrough step waits for, seen by main (D-116). */
export type TourEvent =
  | 'captured'
  | 'shorthand'
  /** D-122: step 4: a named list, note or group, or a quick note with text or a title. */
  | 'made'
  | 'pinned'
  | 'reminder'
  | 'mini-open';

/** D-67, D-100: how the main window looks (sent when it changes). */
export interface Appearance {
  readonly animationSpeed: 'relaxed' | 'normal' | 'quick';
}

/** The Settings view's place (D-100): the row above Trash, never a list. */
export const SETTINGS_ID = '@settings';

/** The Trash view's place in the sidebar (D-97): a view, never a list. */
export const TRASH_ID = '@trash';

/** D-92: a task in Today's Done today or Captured today, with the time it was done or captured. */
export interface TodayEntry {
  readonly key: string;
  readonly listId: string;
  readonly listName: string;
  readonly title: string;
  /** `11:20`. */
  readonly time: string;
}

/** TODAY-01, TODAY-02, TODAY-03: what Today shows besides its tasks. */
export interface TodayExtras {
  /**
   * D-92: all of today's reminders (not turned off), done and passed ones too, by time; the cards
   * show the ones still to come, the timeline all of them, as the clock moves.
   */
  readonly reminders: readonly TodayReminder[];
  /**
   * D-111: today's open tasks whose reminder is turned off (REM-12), so mini mode keeps them in
   * its Today, the bell struck, to turn back on. Nothing else shows them.
   */
  readonly muted?: readonly TodayReminder[];
  /** TODAY-02, Q-04: unfinished tasks pinned before today, until the prompt is answered today. */
  readonly rollover: readonly { readonly key: string; readonly title: string }[];
  /**
   * D-92: the "High priority · not pinned" rows, the last of the view's items (after the pinned
   * tasks, open then done), in the sidebar's list order.
   */
  readonly high: readonly string[];
  /** D-92: tasks completed today in any list, newest first. */
  readonly done: readonly TodayEntry[];
  /** D-92: today's captures from the popup, newest first. */
  readonly captured: readonly TodayEntry[];
  /** D-92: Inbox, for "Sort Inbox · N". */
  readonly inbox: { readonly id: string; readonly open: number };
  /** D-92: today's pinned tasks and today's reminder tasks; how many of them are done today. */
  readonly progress: { readonly done: number; readonly total: number };
  /**
   * REM-07, REM-11, D-94: open tasks whose reminder (on) has passed, any day, oldest first: Today's
   * Overdue card. The window adds today's reminders that pass while it shows.
   */
  readonly overdue: readonly TodayReminder[];
}

/**
 * NAV-07, D-83, D-85: an item of the context panel's "Up next": a pinned task, a reminder, or a
 * recent capture (its own collapsed section).
 */
export interface UpNextItem {
  readonly group: 'pinned' | 'today' | 'tomorrow' | 'overdue' | 'captured';
  readonly key: string;
  readonly listId: string;
  readonly listName: string;
  readonly title: string;
  /** `15:00`, or for an overdue one `Yest 17:00`; empty for a pin or a capture without one. */
  readonly when: string;
  /** A done pin (until the day changes) or a done capture: shown faded. */
  readonly done?: boolean;
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
  /** NAV-07, D-85: a note's first sighting (`2 Nov`). */
  readonly created?: string;
  /** TODAY-01 (M6): the Today view's reminders and rollover prompt. */
  readonly today?: TodayExtras;
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
      /** D-25, D-87: Tab on the close-match card: create the typed list instead. */
      readonly chooseNewList?: boolean;
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
  /** TODAY-01, D-85. */
  | { readonly kind: 'pin'; readonly key: string; readonly pinned: boolean }
  /** TASK-17, D-85: the task becomes a note; the outcome's list is the note. */
  | { readonly kind: 'toNote'; readonly key: string }
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
  | {
      readonly kind: 'new';
      readonly name: string;
      readonly mode: 'tasks' | 'note';
      /** D-98: made inside this sidebar group (its right-click menu). */
      readonly group?: string;
    }
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
  /** TODAY-01 (M6): the open pinned tasks, Today's count. */
  readonly today?: number;
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

/** DATA-07, D-104: a folder chosen to be the Flint folder, and what it holds. */
export interface FolderChoice {
  readonly path: string;
  readonly state: 'empty' | 'flint' | 'other';
  readonly lists: number;
  readonly insideOneDrive: boolean;
  readonly refused: string | null;
  readonly subfolder: {
    readonly path: string;
    readonly state: 'empty' | 'flint' | 'other' | 'missing';
    readonly refused: string | null;
  };
  /** The Flint folder now. */
  readonly current: string;
}

/** D-104: what is done with the chosen folder. */
export type FolderChange = 'move' | 'fresh' | 'open';

export interface FolderChangeOutcome {
  readonly ok: boolean;
  readonly problem?: string;
}

/** NAV-01, D-106: one palette result from the lists and notes, or from Trash and the archive. */
export interface SearchHit {
  readonly kind: 'task' | 'line' | 'deleted' | 'archived';
  readonly listId: string;
  readonly listName: string;
  /** A task's key (open, completed or archived). */
  readonly key?: string;
  /** What it shows: a task's title, a note's line, a deleted item's title. */
  readonly text: string;
  /** A task's notes line that matched, when its title didn't. */
  readonly detail?: string | undefined;
  readonly done?: boolean;
  /** A note's line number (0-based, in its text). */
  readonly line?: number;
  /** A deleted item's file in Trash. */
  readonly trashId?: string;
  readonly score: number;
  /** The letters of `text` that matched, to highlight. */
  readonly indices: readonly number[];
}

/** MINI-01, D-109: mini mode's tabs. */
export type MiniTab = 'today' | 'inbox' | 'note';

/** What mini mode remembers (app data): its tab, the quick note shown, on top. */
export interface MiniState {
  readonly tab: MiniTab;
  readonly noteId: string | null;
  readonly onTop: boolean;
}

/** REM-06, D-109: a reminder waiting in mini mode's card (the toast fired too). */
export interface MiniAlert {
  readonly id: string;
  readonly title: string;
  /** `Reminder · 15:00`. */
  readonly label: string;
}

export type MiniAlertAction = 'done' | 'snooze' | 'open';

/** D-110: the corner mini mode's card hangs from (it grows away from it). */
export type MiniCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** D-110: where the card sits in mini mode's transparent window, in the page's pixels. */
export interface MiniLayout {
  readonly corner: MiniCorner;
  /** From the window's left edge (a left corner) or right edge (a right corner). */
  readonly horizontal: number;
  /** From the window's top edge (a top corner) or bottom edge (a bottom corner). */
  readonly vertical: number;
  /** The most the card may take on this screen. */
  readonly room: { readonly width: number; readonly height: number };
  /**
   * D-115: the part of the window on the screen's work area (page pixels, from the window's top
   * left): menus and pickers open within it (the window reaches past the screen beside the card).
   */
  readonly visible?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  /** Its width and height limit (remembered per monitor setup). */
  readonly width: number;
  readonly limit: number;
  /** Snapping into another corner: hide the card, say `miniLayoutReady` with this, then settle in. */
  readonly moving?: number;
}

/** D-111: a resize let go: the size (every tab's), and where the hang-side edge now is. */
export interface MiniResize {
  readonly width: number;
  readonly limit: number;
  /** The `horizontal` of `MiniLayout` after the resize (moved when resized from the hang side). */
  readonly horizontal: number;
}

/** D-110: what mini mode's page tells main about its card (page pixels, window coordinates). */
export interface MiniSurface {
  readonly card: { readonly width: number; readonly height: number };
  /** The card with its resize handles, and open menus: where clicks reach the page. */
  readonly rects: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
  /** A button is held in the page (a drag, a resize): it keeps the pointer wherever it goes. */
  readonly held: boolean;
}

/** D-109: which window edits a note now (null: neither), and what it last had. */
export interface NoteEditorState {
  readonly noteId: string;
  readonly editor: 'main' | 'mini' | null;
}

/** NAV-08, D-128: one text item of Windows' clipboard history. */
export interface ClipboardItemView {
  /** Windows' id for it. */
  readonly id: string;
  /** When it was copied (ms since 1970). */
  readonly at: number;
  /** Its text (empty for a picture). */
  readonly text: string;
  /**
   * "Link" (one URL), "Code" (as pasting into the capture popup judges it, CAP-06), "Text", or a
   * picture (D-129).
   */
  readonly kind: 'text' | 'link' | 'code' | 'image';
  /** D-129: a picture's thumbnail (a PNG data URL, at most 400 × 112). */
  readonly thumb?: string;
}

/**
 * NAV-08, D-128: what the Clipboard section and its picker show. `ok`: the items (text only, newest
 * first); `off`: history is off in Windows; `policy`: turned off on this PC (a group policy);
 * `paused`: the last read never finished (D-127), reads wait for Try again; `error`: it couldn't be
 * read (the last items stay); `disabled`: off in Flint's settings; `loading`: not read yet.
 */
export interface ClipboardView {
  readonly state: 'ok' | 'off' | 'policy' | 'paused' | 'error' | 'disabled' | 'loading';
  readonly items: readonly ClipboardItemView[];
  /** Its contents shown at rest (Always show contents). */
  readonly showContents: boolean;
}
