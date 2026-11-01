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

  mainChange: 'main:change',
  mainReserveId: 'main:reserve-id',
  mainChanged: 'main:changed',
  /** Main → main window: show this task (a reminder's Open, REM-05). */
  mainReveal: 'main:reveal',
  /** Main window → main: open a link from a title in the browser (LIST-02). */
  mainOpenLink: 'main:open-link',
  /** Main window → main: new, rename or delete a list or note (LIST-01). */
  mainListAction: 'main:list-action',
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
  | {
      readonly kind: 'priority';
      readonly key: string;
      readonly priority: 'high' | 'medium' | 'low' | null;
    }
  | { readonly kind: 'move'; readonly key: string; readonly direction: 'up' | 'down' }
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
export type EditCommand = 'cut' | 'copy' | 'paste' | 'selectAll';

/** LIST-01, D-52, D-55: what the sidebar asks of a list. */
export type ListAction =
  | { readonly kind: 'new'; readonly name: string; readonly mode: 'tasks' | 'note' }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | { readonly kind: 'delete'; readonly id: string };

/** What a list action did, or why it couldn't (shown next to the name being typed). */
export type ListActionOutcome =
  | { readonly ok: true; readonly listId: string; readonly label: string }
  | { readonly ok: false; readonly problem: string };
