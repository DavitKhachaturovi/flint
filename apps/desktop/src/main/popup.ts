import { join } from 'node:path';
import { BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import {
  Channels,
  epochNow,
  type PopupFocused,
  type PopupShown,
  type PopupSubmit,
  type PopupSubmitAck,
} from '../shared/ipc.js';
import { bringToForeground, forceForeground, foregroundWindow, handleValue } from './win32.js';

/**
 * The capture popup (CAP-01, CAP-09, CAP-10): created once at startup, kept rendered while hidden,
 * and only positioned, shown and focused by the hotkey (docs/05 §4).
 */

const WIDTH = 720;
const HEIGHT = 300;
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
}

export interface CapturePopup {
  readonly window: BrowserWindow;
  /** Called from the global hotkey. */
  show(hotkeyAt: number): void;
  hide(): void;
  readonly windowHandle: bigint;
}

/** Centered on the display under the cursor, in its upper third (CAP-09, 03 §4). */
function boundsOnActiveDisplay(): Rectangle {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + area.height * 0.18),
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

  // Clicking elsewhere hides the popup; the draft stays (CAP-08). Focus is already elsewhere.
  window.on('blur', () => {
    if (window.isVisible()) window.hide();
  });

  return {
    window,
    windowHandle,
    show(hotkeyAt: number) {
      const current = foregroundWindow();
      if (current !== windowHandle) previous = current;
      window.setBounds(boundsOnActiveDisplay());
      window.show();
      window.focus();
      // Windows sometimes refuses to hand over the foreground (its foreground lock); then the popup
      // would be visible while keystrokes still go to the previous app. Take it explicitly.
      forced = foregroundWindow() !== windowHandle;
      if (forced) forceForeground(windowHandle);
      const shown: PopupShown = { hotkeyAt };
      window.webContents.send(Channels.popupShown, shown);
    },
    hide() {
      hideAndReturn();
    },
  };
}
