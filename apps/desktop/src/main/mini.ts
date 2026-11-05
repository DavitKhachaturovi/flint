import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { Channels, type MiniState, type MiniTab } from '../shared/ipc.js';
import {
  firstMiniBounds,
  inCorner,
  MINI_MAX,
  MINI_MIN,
  MINI_SIZE,
  snapCorner,
  type Corner,
} from './mini-place.js';
import { e2eHooks, recoverFromCrashes, rememberWindowState, testWindowArguments } from './shell.js';
import { writeFileAtomic } from './storage/atomic.js';
import { monitorSetupKey, type DisplayInfo } from './window-state.js';

/**
 * MINI-01, D-109: mini mode's window. Made on first use, then hidden, never destroyed (05 §3);
 * beside the main window, in sync with it. Frameless and always on top (also over a full-screen
 * Teams call, like the capture popup), left out of screen shares (content protection), no taskbar
 * button. It takes the keyboard only when Davit opens it, never when a reminder does. Its place is
 * remembered per monitor setup; let go near a screen corner, it snaps there and stays anchored.
 */

/** What mini mode remembers besides its bounds (`mini-state.json` in app data). */
interface StoredMini {
  tab: MiniTab;
  noteId: string | null;
  /** Per monitor setup: the corner it is anchored to, if any. */
  corners: Record<string, Corner | null>;
}

/** The ground of its card (09's floating level, `--fl-ground-float`), shown before the page paints. */
const GROUND = '#1B1D20';

export interface Mini {
  readonly visible: () => boolean;
  /** Shown (`focus`: Davit opened it, so it takes the keyboard; a reminder shows it without). */
  readonly show: (focus: boolean) => void;
  readonly hide: () => void;
  readonly toggle: () => void;
  readonly state: () => MiniState;
  readonly setState: (state: Partial<Pick<MiniState, 'tab' | 'noteId'>>) => void;
  readonly setOnTop: (onTop: boolean) => void;
  readonly setHideFromSharing: (hide: boolean) => void;
  /** Only once it exists. */
  readonly send: (channel: string, ...args: unknown[]) => void;
  readonly owns: (sender: Electron.WebContents) => boolean;
}

export function createMini(options: {
  readonly url: string;
  readonly onTop: () => boolean;
  readonly hideFromSharing: () => boolean;
  /** Hidden (×, the hotkey, the command): what it showed is left. */
  readonly onHidden: () => void;
  readonly log: (message: string) => void;
}): Mini {
  const file = join(app.getPath('userData'), 'mini-state.json');
  let stored: StoredMini = { tab: 'today', noteId: null, corners: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredMini>;
    stored = {
      tab: parsed.tab === 'inbox' || parsed.tab === 'note' ? parsed.tab : 'today',
      noteId: typeof parsed.noteId === 'string' ? parsed.noteId : null,
      corners: typeof parsed.corners === 'object' && parsed.corners !== null ? parsed.corners : {},
    };
  } catch {
    // First use: the defaults.
  }
  const save = (): void => {
    void writeFileAtomic(file, `${JSON.stringify(stored, null, 2)}\n`, {
      tempDirectory: join(dirname(file), 'tmp'),
    }).catch(() => undefined);
  };
  const setupKey = (): string =>
    monitorSetupKey(
      screen.getAllDisplays().map((display): DisplayInfo => ({
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
      })),
    );

  let window: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  const applyOnTop = (target: BrowserWindow, onTop: boolean): void => {
    target.setAlwaysOnTop(onTop, 'screen-saver');
    target.setVisibleOnAllWorkspaces(onTop, { visibleOnFullScreen: onTop });
  };

  /** Into its corner again (after a resize, or when the screens changed). */
  const anchor = (): void => {
    const corner = stored.corners[setupKey()];
    if (!window || !corner) return;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const target = inCorner(corner, area, bounds);
    if (target.x !== bounds.x || target.y !== bounds.y || target.width !== bounds.width)
      window.setBounds(target);
  };

  const make = (): BrowserWindow => {
    const made = new BrowserWindow({
      ...MINI_SIZE,
      show: false,
      frame: false,
      // Opaque: a transparent window can't be resized reliably on Windows. Windows 11 draws the
      // frameless window's rounded corners and shadow (Proposed, D-109).
      backgroundColor: GROUND,
      title: 'Flint mini',
      minWidth: MINI_MIN.width,
      minHeight: MINI_MIN.height,
      maxWidth: MINI_MAX.width,
      maxHeight: MINI_MAX.height,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/mini.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        additionalArguments: testWindowArguments(),
      },
    });
    made.setMenu(null);
    const place = rememberWindowState(made, 'mini', { x: 0, y: 0, ...MINI_SIZE }, (active) =>
      firstMiniBounds(active.workArea),
    );
    void place;
    // D-109: the end-to-end tests keep it off-screen (like the main window there).
    const hooks = e2eHooks();
    if (hooks) made.setBounds({ x: -6000, y: 0, ...MINI_SIZE });
    applyOnTop(made, options.onTop());
    made.setContentProtection(options.hideFromSharing());
    made.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      hide();
    });
    // Let go near a corner: into it, anchored; elsewhere: free.
    made.on('moved', () => {
      if (hooks) return;
      const bounds = made.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const corner = snapCorner(bounds, area);
      stored.corners[setupKey()] = corner;
      save();
      if (corner) made.setBounds(inCorner(corner, area, bounds));
    });
    made.on('resized', () => {
      if (!hooks) anchor();
    });
    recoverFromCrashes(made, 'mini mode', options.log);
    void made.loadURL(options.url);
    return made;
  };
  screen.on('display-metrics-changed', anchor);
  screen.on('display-removed', anchor);
  screen.on('display-added', anchor);

  const send = (channel: string, ...args: unknown[]): void => {
    if (!window || window.isDestroyed()) return;
    const go = (): void => window?.webContents.send(channel, ...args);
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', go);
    else go();
  };

  const show = (focus: boolean): void => {
    window ??= make();
    const target = window;
    const reveal = (): void => {
      // Tests never take the focus (Davit's machine runs them).
      if (focus && !e2eHooks()) {
        target.show();
        target.focus();
      } else target.showInactive();
      send(Channels.miniShown, { focus });
    };
    if (target.webContents.isLoading()) target.webContents.once('did-finish-load', reveal);
    else reveal();
  };

  const hide = (): void => {
    if (!window || !window.isVisible()) return;
    send(Channels.miniHiding);
    window.hide();
    options.onHidden();
  };

  return {
    visible: () => window !== null && !window.isDestroyed() && window.isVisible(),
    show,
    hide,
    toggle: () => {
      if (window?.isVisible()) hide();
      else show(true);
    },
    state: () => ({ tab: stored.tab, noteId: stored.noteId, onTop: options.onTop() }),
    setState: (state) => {
      if (state.tab) stored.tab = state.tab;
      if (state.noteId !== undefined) stored.noteId = state.noteId;
      save();
    },
    setOnTop: (onTop) => {
      if (window) applyOnTop(window, onTop);
    },
    setHideFromSharing: (hidden) => {
      window?.setContentProtection(hidden);
    },
    send,
    owns: (sender) => window !== null && !window.isDestroyed() && sender === window.webContents,
  };
}
