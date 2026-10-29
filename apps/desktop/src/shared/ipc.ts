import type { ListInfo } from '@flint/core/shorthand';

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
  popupNoticeAction: 'popup:notice-action',
  popupResize: 'popup:resize',
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

/** Main → popup: the popup was just shown by the hotkey at `hotkeyAt`. */
export interface PopupShown {
  readonly hotkeyAt: number;
  /** The saved draft (CAP-08); replaces the input only when the popup's text differs. */
  readonly draft: string;
  readonly notice: PopupNotice | null;
  /** The lists for `##` chips, autocomplete and the new-list card (CAP-04, CAP-05). */
  readonly lists: readonly ListInfo[];
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
  readonly text: string;
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
