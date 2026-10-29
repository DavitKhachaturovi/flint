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
  devEvent: 'dev:event',
  devSendToast: 'dev:send-toast',
} as const;

/** Main → popup: the popup was just shown by the hotkey at `hotkeyAt`. */
export interface PopupShown {
  readonly hotkeyAt: number;
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
