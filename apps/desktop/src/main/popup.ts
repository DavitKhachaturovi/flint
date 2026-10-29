import { join } from 'node:path';
import { BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import {
  Channels,
  epochNow,
  type AttachmentChip,
  type CaptureDraft,
  type PopupFocused,
  type PopupNoticeAction,
  type PopupShown,
  type PreviousDraftAction,
  type PopupSubmit,
  type PopupSubmitAck,
} from '../shared/ipc.js';
import { bringToForeground, forceForeground, foregroundWindow, handleValue } from './win32.js';

/**
 * The capture popup (CAP-01, CAP-09, CAP-10): created once at startup, kept rendered while hidden,
 * and only positioned, shown and focused by the hotkey (docs/05 §4).
 */

/**
 * The card is 680 px wide (mockup 02). The window is larger by a transparent margin that holds the
 * card's soft shadow without cutting it off (D-42); the margin lets clicks through to the apps below.
 * Keep in step with the body padding in popup.css.
 */
const CARD_WIDTH = 680;
const MARGIN = { top: 36, side: 72, bottom: 108 } as const;
const WIDTH = CARD_WIDTH + 2 * MARGIN.side;
const HEIGHT = 300;
/** Room for the selection area and the `##` menu (the window follows the card, CAP-05). */
const MAX_HEIGHT = 720;
/** Ground colour of the window behind the card; the card itself is opaque (docs/09). */
const TRANSPARENT = '#00000000';

/** A popup-focused report, plus what Windows says: is the popup the foreground window, and did it
 * take the foreground-lock fallback to get there (R-1). */
export type FocusSample = PopupFocused & {
  readonly windowFocused: boolean;
  readonly inFront: boolean;
  readonly forced: boolean;
};

export interface PopupEvents {
  /** The input is focused and painted: R-1 latency, measured from the hotkey callback. */
  readonly onFocused: (sample: FocusSample) => void;
  /** Enter (D-27): the main process owns the capture from here; focus is back where it was. */
  readonly onCaptured: (
    capture: PopupSubmit & { readonly hiddenAt: number; readonly returnedAt: number },
  ) => void;
  /** What the popup shows when it opens: the saved draft and any follow-up notice (CAP-08, D-26). */
  readonly state: () => Omit<PopupShown, 'hotkeyAt'>;
  readonly onDraft: (draft: CaptureDraft) => void;
  /** D-41: the popup has something in it, so clicking elsewhere keeps it open. */
  readonly onContent: (hasContent: boolean) => void;
  readonly keepOpen: () => boolean;
  /** Shift+Esc (D-39). */
  readonly onDiscard: () => void;
  /** "Previous draft · Restore" (D-39); resolves to what the popup shows next. */
  readonly onPrevious: (action: PreviousDraftAction) => Promise<Omit<PopupShown, 'hotkeyAt'>>;
  readonly onAttach: (bytes: Uint8Array, type: string) => Promise<AttachmentChip | null>;
  readonly onDetach: (id: string) => void;
  readonly onNoticeAction: (action: PopupNoticeAction) => void;
}

export interface CapturePopup {
  readonly window: BrowserWindow;
  /** Called from the global hotkeys; capture-selection adds the selection or a hint (CAP-07). */
  show(hotkeyAt: number, extra?: Pick<PopupShown, 'prefill' | 'hint' | 'replaceDraft'>): void;
  hide(): void;
  /** Visible and the window the user is typing in (D-41: the capture hotkey then closes it). */
  isFocused(): boolean;
  readonly windowHandle: bigint;
}

/** The card centered on the display under the cursor, in its upper third (CAP-09, 03 §4). */
function boundsOnActiveDisplay(): Rectangle {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + area.height * 0.18 - MARGIN.top),
    width: WIDTH,
    height: HEIGHT,
  };
}

export function createCapturePopup(url: string, events: PopupEvents): CapturePopup {
  const window = new BrowserWindow({
    ...boundsOnActiveDisplay(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: TRANSPARENT,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/popup.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep the hidden popup's renderer awake so its first frame after show() isn't delayed (05 §4).
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  // Above full-screen apps such as a full-screen Teams call (CAP-01).
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // D-42: the transparent margin lets clicks through; the renderer turns clicks back on over the
  // card (`popupInteractive`). Mouse moves are still forwarded so it can tell.
  window.setIgnoreMouseEvents(true, { forward: true });

  void window.loadURL(url);

  const windowHandle = handleValue(window.getNativeWindowHandle());
  let previous = 0n;
  let forced = false;

  /** Hides and gives focus back to the app the user was in (CAP-01). */
  const hideAndReturn = (): number => {
    window.hide();
    if (previous !== 0n && previous !== windowHandle && foregroundWindow() !== previous) {
      bringToForeground(previous);
    }
    return epochNow();
  };

  ipcMain.on(Channels.popupFocused, (event, sample: PopupFocused) => {
    if (event.sender !== window.webContents) return;
    events.onFocused({
      ...sample,
      windowFocused: window.isFocused(),
      inFront: foregroundWindow() === windowHandle,
      forced,
    });
  });

  ipcMain.handle(Channels.popupSubmit, (event, capture: PopupSubmit): PopupSubmitAck => {
    if (event.sender !== window.webContents) return { accepted: false };
    // D-27: the capture is the main process's from this point; hiding never waits for the disk.
    const hiddenAt = epochNow();
    const returnedAt = hideAndReturn();
    events.onCaptured({ ...capture, hiddenAt, returnedAt });
    return { accepted: true };
  });

  ipcMain.on(Channels.popupDismiss, (event) => {
    if (event.sender === window.webContents) hideAndReturn();
  });

  ipcMain.on(Channels.popupDraft, (event, draft: unknown) => {
    if (event.sender === window.webContents && typeof draft === 'object' && draft !== null)
      events.onDraft(draft as CaptureDraft);
  });

  ipcMain.on(Channels.popupContent, (event, hasContent: unknown) => {
    if (event.sender === window.webContents) events.onContent(hasContent === true);
  });

  ipcMain.on(Channels.popupDiscard, (event) => {
    if (event.sender !== window.webContents) return;
    events.onDiscard();
    hideAndReturn();
  });

  ipcMain.handle(Channels.popupPrevious, (event, action: unknown) => {
    if (event.sender !== window.webContents) return null;
    return action === 'restore' || action === 'dismiss' ? events.onPrevious(action) : null;
  });

  ipcMain.on(Channels.popupInteractive, (event, interactive: unknown) => {
    if (event.sender !== window.webContents) return;
    if (interactive === true) window.setIgnoreMouseEvents(false);
    else window.setIgnoreMouseEvents(true, { forward: true });
  });

  ipcMain.handle(Channels.popupAttach, (event, bytes: unknown, type: unknown) => {
    if (event.sender !== window.webContents) return null;
    if (!(bytes instanceof Uint8Array) || typeof type !== 'string') return null;
    return events.onAttach(bytes, type);
  });

  ipcMain.on(Channels.popupDetach, (event, id: unknown) => {
    if (event.sender === window.webContents && typeof id === 'string') events.onDetach(id);
  });

  ipcMain.on(Channels.popupResize, (event, height: unknown) => {
    if (event.sender !== window.webContents || typeof height !== 'number') return;
    const [width = WIDTH] = window.getSize();
    window.setSize(width, Math.round(Math.min(Math.max(height, 120), MAX_HEIGHT)));
  });

  ipcMain.on(Channels.popupNoticeAction, (event, action: unknown) => {
    if (event.sender !== window.webContents) return;
    if (action === 'undo' || action === 'dismiss') events.onNoticeAction(action);
  });

  // D-41: clicking elsewhere hides an empty popup; one with content stays visible (without the
  // focus) so the user can copy from other apps or add more with Ctrl+Shift+X.
  window.on('blur', () => {
    if (window.isVisible() && !events.keepOpen()) window.hide();
  });

  return {
    window,
    windowHandle,
    show(hotkeyAt: number, extra = {}) {
      const current = foregroundWindow();
      if (current !== windowHandle) previous = current;
      // A popup that stayed open (D-41) stays where it is; otherwise the active display (CAP-09),
      // keeping the height the card last asked for (popupResize).
      if (!window.isVisible())
        window.setBounds({ ...boundsOnActiveDisplay(), height: window.getSize()[1] ?? HEIGHT });
      window.show();
      window.focus();
      // Windows sometimes refuses to hand over the foreground (its foreground lock); then the popup
      // would be visible while keystrokes still go to the previous app. Take it explicitly.
      forced = foregroundWindow() !== windowHandle;
      if (forced) forceForeground(windowHandle);
      const shown: PopupShown = { hotkeyAt, ...events.state(), ...extra };
      window.webContents.send(Channels.popupShown, shown);
    },
    hide() {
      hideAndReturn();
    },
    isFocused() {
      return window.isVisible() && window.isFocused();
    },
  };
}
