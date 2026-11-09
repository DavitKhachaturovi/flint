import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import {
  Channels,
  type MiniCapture,
  type MiniLayout,
  type MiniState,
  type MiniSurface,
  type MiniTab,
} from '../shared/ipc.js';
import {
  cardBox,
  clampSize,
  firstHang,
  hangInCorner,
  insetIn,
  roomFor,
  settle,
  stageFor,
  type Corner,
  type Hang,
} from './mini-place.js';
import { e2eHooks, recoverFromCrashes, testWindowArguments } from './shell.js';
import { forceForeground, foregroundWindow, handleValue, returnFocus } from './win32.js';
import { writeFileAtomic } from './storage/atomic.js';
import { monitorSetupKey, type DisplayInfo, type Rect } from './window-state.js';

/**
 * MINI-01, D-109, D-110: mini mode's window. Made on first use, then hidden, never destroyed (05 §3);
 * beside the main window, in sync with it. Always on top (also over a full-screen Teams call, like
 * the capture popup), left out of screen shares (content protection), no taskbar button. It takes
 * the keyboard only when Davit opens it, never when a reminder does.
 *
 * D-110: like the capture popup (D-42), the window is transparent and only the card shows, with
 * mockup 05's 22 px corners and floating shadow. The window is a stage: the largest card's area
 * from the corner the card hangs from (`mini-place.ts`), so the card's resizing and its height
 * fitting its content are the page's own (CSS) and the window never moves for them. Clicks reach
 * the page only over the card, its resize handles and open menus; elsewhere they pass through to
 * the apps below. Unlike the popup it doesn't forward mouse moves to find out (that watches every
 * mouse move on the system and made the cursor flicker over text fields in Flint's other windows,
 * D-69; mini stays open for hours): main checks the cursor itself while mini is shown, often near
 * it and seldom elsewhere. The card's place, width and height limit are remembered per monitor
 * setup; let go near a screen corner, it snaps there and hangs from it.
 */

/** Where the card is on one monitor setup. */
interface Place {
  hang: Hang;
  snapped: boolean;
  width: number;
  limit: number;
}

/** What mini mode remembers (`mini-state.json` in app data). */
interface StoredMini {
  tab: MiniTab;
  /** MINI-03, D-158: the task list the second tab shows (null: Inbox). */
  listId: string | null;
  noteId: string | null;
  /** Per monitor setup. */
  places: Record<string, Place>;
}

const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const readPlace = (value: unknown): Place | null => {
  if (typeof value !== 'object' || value === null) return null;
  const place = value as Partial<Record<keyof Place, unknown>>;
  const hang = place.hang as Partial<Record<keyof Hang, unknown>> | undefined;
  if (
    !hang ||
    !CORNERS.includes(hang.corner as Corner) ||
    typeof hang.x !== 'number' ||
    typeof hang.y !== 'number'
  )
    return null;
  return {
    hang: { corner: hang.corner as Corner, x: hang.x, y: hang.y },
    snapped: place.snapped === true,
    ...clampSize({ width: place.width, limit: place.limit }),
  };
};

/** Checking the cursor: often while it is near mini, seldom elsewhere (ms). */
const NEAR_MS = 16;
const FAR_MS = 120;
/** How near counts as near (DIP around the window). */
const NEAR = 48;
/** D-111: the card's fade out before the window hides (`--fl-dur-base`, a little more). */
const HIDE_MS = 230;

export interface Mini {
  readonly visible: () => boolean;
  /** Shown (`focus`: Davit opened it, so it takes the keyboard; a reminder shows it without). */
  readonly show: (focus: boolean) => void;
  readonly hide: () => void;
  readonly toggle: () => void;
  readonly state: () => MiniState;
  readonly setState: (state: Partial<Pick<MiniState, 'tab' | 'listId' | 'noteId'>>) => void;
  /**
   * MINI-02, D-157: a selection captured into the note: kept until the page takes it (the page
   * may still be loading, or its listeners not yet on), the page told one waits.
   */
  readonly capture: (capture: MiniCapture) => void;
  readonly takeCaptures: () => readonly MiniCapture[];
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
  /** Shown, on screen (D-116: the walkthrough's last step waits for it). */
  readonly onShown?: () => void;
  /** Hidden (×, the hotkey, the command): what it showed is left. */
  readonly onHidden: () => void;
  readonly log: (message: string) => void;
}): Mini {
  const file = join(app.getPath('userData'), 'mini-state.json');
  let stored: StoredMini = { tab: 'today', listId: null, noteId: null, places: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredMini>;
    const places: Record<string, Place> = {};
    if (typeof parsed.places === 'object' && parsed.places !== null)
      for (const [key, value] of Object.entries(parsed.places)) {
        const place = readPlace(value);
        if (place) places[key] = place;
      }
    stored = {
      tab: parsed.tab === 'inbox' || parsed.tab === 'note' ? parsed.tab : 'today',
      listId: typeof parsed.listId === 'string' && parsed.listId !== '' ? parsed.listId : null,
      noteId: typeof parsed.noteId === 'string' ? parsed.noteId : null,
      places,
    };
  } catch {
    // First use: the defaults.
  }
  const save = (): void => {
    void writeFileAtomic(file, `${JSON.stringify(stored, null, 2)}\n`, {
      tempDirectory: join(dirname(file), 'tmp'),
    }).catch(() => undefined);
  };
  const displays = (): DisplayInfo[] =>
    screen.getAllDisplays().map((display): DisplayInfo => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
    }));
  const setupKey = (): string => monitorSetupKey(displays());
  const contains = (area: Rect, x: number, y: number): boolean =>
    x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;

  let window: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  const hooks = e2eHooks();

  /** The page's zoom: the card's pixels in DIP. */
  const zoom = (): number =>
    window && !window.isDestroyed() ? window.webContents.getZoomFactor() : 1;

  /** This monitor setup's place: remembered (if its point is still on a screen), or the first. */
  const currentPlace = (): Place => {
    const key = setupKey();
    const saved = stored.places[key];
    const areas = screen.getAllDisplays().map((display) => display.workArea);
    if (saved && areas.some((area) => contains(area, saved.hang.x, saved.hang.y))) return saved;
    const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const place: Place = {
      hang: firstHang(active),
      snapped: true,
      ...clampSize({ width: saved?.width, limit: saved?.limit }),
    };
    stored.places[key] = place;
    return place;
  };
  const areaOf = (hang: Hang): Rect => screen.getDisplayNearestPoint(hang).workArea;

  /** The page's layout for a place (page pixels). */
  const layoutFor = (place: Place, stage: Rect, moving?: number): MiniLayout => {
    const factor = zoom();
    const inset = insetIn(place.hang, stage);
    const area = areaOf(place.hang);
    const room = roomFor(place.hang, area);
    return {
      corner: inset.corner,
      horizontal: inset.horizontal / factor,
      vertical: inset.vertical / factor,
      room,
      visible: {
        left: (Math.max(stage.x, area.x) - stage.x) / factor,
        top: (Math.max(stage.y, area.y) - stage.y) / factor,
        right: (Math.min(stage.x + stage.width, area.x + area.width) - stage.x) / factor,
        bottom: (Math.min(stage.y + stage.height, area.y + area.height) - stage.y) / factor,
      },
      width: place.width,
      limit: place.limit,
      ...(moving !== undefined && { moving }),
    };
  };

  /** The layout the page has (it asks for it when it starts, in case it missed the message). */
  let lastLayout: MiniLayout | null = null;
  const sendLayout = (layout: MiniLayout): void => {
    lastLayout = layout;
    send(Channels.miniLayout, layout);
  };

  /** Bounds set by Flint (not a drag): `moved` ignores them. */
  let placing = 0;
  const setStage = (target: BrowserWindow, stage: Rect): void => {
    placing++;
    target.setBounds(hooks ? { ...stage, x: -6000, y: 0 } : stage);
    setTimeout(() => placing--, 200);
  };
  /** The stage where the window is now (after a drag, it moved with the card). */
  let stageNow: Rect | null = null;

  /** Into its place (made, the screens changed): the window and the page together. */
  const place = (): void => {
    if (!window) return;
    const current = currentPlace();
    // A snapped card stays in its corner of the screen it is on (the taskbar may have moved).
    if (current.snapped) current.hang = hangInCorner(current.hang.corner, areaOf(current.hang));
    const stage = stageFor(current.hang, zoom());
    stageNow = stage;
    setStage(window, stage);
    sendLayout(layoutFor(current, stage));
  };
  // What the page says about its card (page pixels): its size and the places that take clicks.
  let surface: MiniSurface = { card: { width: 0, height: 0 }, rects: [], held: false };

  // Click-through: the page takes the pointer only over its card (and handles, menus) or while a
  // button is held in it.
  let interactive: boolean | null = null;
  let watching: NodeJS.Timeout | undefined;
  const setInteractive = (next: boolean): void => {
    if (!window || next === interactive) return;
    interactive = next;
    window.setIgnoreMouseEvents(!next);
  };
  const watch = (): void => {
    clearTimeout(watching);
    if (!window || window.isDestroyed() || !window.isVisible()) {
      watching = undefined;
      return;
    }
    const bounds = window.getBounds();
    const at = screen.getCursorScreenPoint();
    const factor = zoom();
    const x = (at.x - bounds.x) / factor;
    const y = (at.y - bounds.y) / factor;
    const over = surface.rects.some(
      (rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height,
    );
    setInteractive(over || surface.held);
    // D-114: the window in front while mini isn't, so a click into mini knows where to go back.
    if (!hooks) {
      const front = foregroundWindow();
      if (front !== 0n && front !== handle()) lastOther = front;
    }
    const near =
      at.x >= bounds.x - NEAR &&
      at.x <= bounds.x + bounds.width + NEAR &&
      at.y >= bounds.y - NEAR &&
      at.y <= bounds.y + bounds.height + NEAR;
    watching = setTimeout(watch, near ? NEAR_MS : FAR_MS);
  };

  const applyOnTop = (target: BrowserWindow, onTop: boolean): void => {
    target.setAlwaysOnTop(onTop, 'screen-saver');
    target.setVisibleOnAllWorkspaces(onTop, { visibleOnFullScreen: onTop });
  };

  // Snapping into another corner: the page hides the card, the window moves, the card settles in.
  let moving = 0;
  const pending = new Map<number, () => void>();

  const make = (): BrowserWindow => {
    const stage = stageFor(currentPlace().hang);
    const made = new BrowserWindow({
      ...stage,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      title: 'Flint mini',
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
    made.setIgnoreMouseEvents(true);
    interactive = false;
    applyOnTop(made, options.onTop());
    made.setContentProtection(options.hideFromSharing());
    made.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      hide();
    });
    made.on('show', watch);
    // D-114: a click into mini (shown without the focus) goes back to the window in front before.
    made.on('focus', () => {
      if (lastOther !== 0n && lastOther !== handle()) previous = lastOther;
    });
    // Dragged by its header or grip and let go: near a corner, into it; elsewhere it stays.
    made.on('moved', () => {
      if (hooks || placing > 0 || !stageNow) return;
      const bounds = made.getBounds();
      const current = currentPlace();
      const dx = bounds.x - stageNow.x;
      const dy = bounds.y - stageNow.y;
      const moved: Hang = { ...current.hang, x: current.hang.x + dx, y: current.hang.y + dy };
      const factor = zoom();
      const size = {
        width: Math.round(surface.card.width * factor),
        height: Math.round(surface.card.height * factor),
      };
      const box = cardBox(moved, size);
      const area = screen.getDisplayMatching(box).workArea;
      const next = settle(box, area, current.hang.corner);
      const place: Place = { ...current, hang: next.hang, snapped: next.snapped };
      stored.places[setupKey()] = place;
      save();
      const stage = stageFor(place.hang, factor);
      if (!next.snapped || (next.hang.x === moved.x && next.hang.y === moved.y)) {
        // Where it was let go: the window already is its stage.
        stageNow = { ...bounds, width: stage.width, height: stage.height };
        sendLayout(layoutFor(place, stageNow));
        return;
      }
      const placeNow = insetIn(moved, { ...bounds, width: stage.width, height: stage.height });
      const placeThen = insetIn(next.hang, stage);
      if (
        next.hang.corner === current.hang.corner &&
        placeNow.horizontal === placeThen.horizontal &&
        placeNow.vertical === placeThen.vertical
      ) {
        // The same corner: the card keeps its place in the window, which moves into the corner.
        stageNow = stage;
        setStage(made, stage);
        sendLayout(layoutFor(place, stage));
        return;
      }
      // Another corner (or a hang side resized before): the card's place in the window changes as
      // the window moves. The page hides
      // the card first, so it never shows a frame in the wrong place, then it settles in.
      const id = ++moving;
      let done = false;
      const go = (): void => {
        if (done) return;
        done = true;
        pending.delete(id);
        stageNow = stage;
        setStage(made, stage);
        send(Channels.miniSettled, id);
      };
      pending.set(id, go);
      sendLayout(layoutFor(place, stage, id));
      // D-138: not after the window is gone (a quit in between).
      setTimeout(() => {
        if (!made.isDestroyed()) go();
      }, 160);
    });
    recoverFromCrashes(made, 'mini mode', options.log);
    void made.loadURL(options.url);
    made.webContents.once('did-finish-load', place);
    return made;
  };
  const replace = (): void => {
    if (!window || hooks) return;
    place();
  };
  screen.on('display-metrics-changed', replace);
  screen.on('display-removed', replace);
  screen.on('display-added', replace);

  ipcMain.on(Channels.miniSurface, (event, value: unknown) => {
    if (!window || event.sender !== window.webContents) return;
    if (typeof value !== 'object' || value === null) return;
    const next = value as { card?: unknown; rects?: unknown; held?: unknown };
    const isRect = (rect: unknown): rect is MiniSurface['rects'][number] => {
      if (typeof rect !== 'object' || rect === null) return false;
      const box = rect as Record<string, unknown>;
      return [box['x'], box['y'], box['width'], box['height']].every(
        (n) => typeof n === 'number' && Number.isFinite(n),
      );
    };
    const card = next.card as { width?: unknown; height?: unknown } | null | undefined;
    surface = {
      card:
        card && typeof card.width === 'number' && typeof card.height === 'number'
          ? { width: card.width, height: card.height }
          : surface.card,
      rects: Array.isArray(next.rects) ? next.rects.filter(isRect) : [],
      held: next.held === true,
    };
    if (window.isVisible()) watch();
  });
  ipcMain.on(Channels.miniResized, (event, value: unknown) => {
    if (!window || event.sender !== window.webContents) return;
    if (typeof value !== 'object' || value === null) return;
    const size = clampSize(value);
    const current = currentPlace();
    // D-111: resized from its hang side, the card's hang point moved (the window didn't).
    const horizontal = (value as { horizontal?: unknown }).horizontal;
    let hang = current.hang;
    if (typeof horizontal === 'number' && Number.isFinite(horizontal) && stageNow) {
      const at = horizontal * zoom();
      hang = {
        ...hang,
        x: Math.round(
          hang.corner.endsWith('left') ? stageNow.x + at : stageNow.x + stageNow.width - at,
        ),
      };
    }
    stored.places[setupKey()] = { ...current, ...size, hang };
    save();
  });
  ipcMain.handle(Channels.miniGetLayout, (event) =>
    window && event.sender === window.webContents ? lastLayout : null,
  );
  ipcMain.on(Channels.miniLayoutReady, (event, id: unknown) => {
    if (!window || event.sender !== window.webContents || typeof id !== 'number') return;
    pending.get(id)?.();
  });

  const send = (channel: string, ...args: unknown[]): void => {
    if (!window || window.isDestroyed()) return;
    const go = (): void => {
      // D-138: never to a window a quit has closed.
      if (window && !window.isDestroyed()) window.webContents.send(channel, ...args);
    };
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', go);
    else go();
  };

  // D-111: hiding plays the card's fade out: the focus goes back at once, clicks pass through, and
  // the window hides when the fade is over (shown again meanwhile, it simply stays).
  let hiding: NodeJS.Timeout | undefined;
  /** D-157: selections captured into the note, until the page takes them. */
  const captures: MiniCapture[] = [];
  /** The window in front before mini took the focus (it gets it back when mini hides). */
  let previous = 0n;
  /** D-114: the last other window in front while mini was shown without the focus. */
  let lastOther = 0n;
  const handle = (): bigint => (window ? handleValue(window.getNativeWindowHandle()) : 0n);
  const show = (focus: boolean): void => {
    window ??= make();
    const target = window;
    const reveal = (): void => {
      if (hiding) {
        clearTimeout(hiding);
        hiding = undefined;
      }
      // Tests never take the focus (Davit's machine runs them).
      if (focus && !hooks) {
        const current = foregroundWindow();
        if (current !== handle()) {
          previous = current;
          lastOther = current;
        }
        target.show();
        target.focus();
        // D-111 (as the popup, CAP-01): Windows sometimes refuses to hand over the foreground (its
        // foreground lock); mini would then show without the keyboard. Take it explicitly.
        if (foregroundWindow() !== handle()) forceForeground(handle());
      } else target.showInactive();
      send(Channels.miniShown, { focus });
      options.onShown?.();
    };
    if (target.webContents.isLoading()) target.webContents.once('did-finish-load', reveal);
    else reveal();
  };

  const hide = (): void => {
    if (!window || !window.isVisible() || hiding) return;
    const target = window;
    const hadFocus = target.isFocused();
    send(Channels.miniHiding);
    clearTimeout(watching);
    watching = undefined;
    setInteractive(false);
    // D-114: the focus goes back to the app in front before (also when mini got the focus by a
    // click), else to the next app window; never a minimized window, never by Windows' own pick
    // (which could restore the minimized main window).
    if (hadFocus && !hooks) returnFocus(handle(), previous);
    options.onHidden();
    hiding = setTimeout(() => {
      hiding = undefined;
      lastOther = 0n;
      // D-138: closed meanwhile by a quit: nothing to hide.
      if (target.isDestroyed()) return;
      target.hide();
      send(Channels.miniHidden);
    }, HIDE_MS);
  };

  return {
    visible: () =>
      window !== null && !window.isDestroyed() && window.isVisible() && hiding === undefined,
    show,
    hide,
    toggle: () => {
      if (window?.isVisible() && !hiding) hide();
      else show(true);
    },
    state: () => ({
      tab: stored.tab,
      listId: stored.listId,
      noteId: stored.noteId,
      onTop: options.onTop(),
    }),
    setState: (state) => {
      if (state.tab) stored.tab = state.tab;
      if (state.listId !== undefined) stored.listId = state.listId;
      if (state.noteId !== undefined) stored.noteId = state.noteId;
      save();
    },
    capture: (capture) => {
      captures.push(capture);
      send(Channels.miniCapture);
    },
    takeCaptures: () => captures.splice(0),
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
