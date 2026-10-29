import type { CaptureBlock, ListInfo } from '@flint/core/shorthand';

/**
 * IPC between the main process and renderers. Renderers only reach the OS through the typed
 * bridges in the preload scripts (docs/05 §2); these are the messages behind them.
 */

/** Milliseconds since the Unix epoch with sub-millisecond precision, comparable across processes. */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

export const Channels = {
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
  devEvent: 'dev:event',
  devSendToast: 'dev:send-toast',
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

/** Main → dev window: something happened (toast action, latency sample). */
export interface DevEvent {
  readonly at: number;
  readonly message: string;
}

/** APP-08: a global hotkey as the Hotkeys window shows it. */
export interface HotkeyView {
  readonly accelerator: string;
  /** False when another app owns the combination, so it doesn't work. */
  readonly registered: boolean;
}

export type HotkeyName = 'capture' | 'selection';

export type HotkeysView = Readonly<Record<HotkeyName, HotkeyView>>;

export type RebindOutcome = 'saved' | 'in-use' | 'invalid' | 'needs-modifier' | 'same-as-other';
