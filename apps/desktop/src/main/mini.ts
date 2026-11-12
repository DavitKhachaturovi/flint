import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import {
  Channels,
  type MiniCapture,
  type MiniEdgeState,
  type MiniLayout,
  type MiniState,
  type MiniSurface,
  type MiniTab,
} from '../shared/ipc.js';
import { edgeAt, edgeStep, tabHovered, type EdgeState } from './mini-edge.js';
import {
  cardBox,
  clampSize,
  firstHang,
  firstTab,
  hangForTab,
  hangInCorner,
  insetIn,
  roomFor,
  settle,
  snapTabY,
  stageFor,
  tabAt,
  tabForCard,
  tabSpots,
  tabStage,
  TAB_SIZE,
  TAB_SNAP,
  type Corner,
  type Hang,
  type Side,
  type TabPlace,
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
  /** MINI-04, D-177: where the edge tab is (the card at the edge hangs from it). */
  tab?: TabPlace;
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
  const tab = place.tab as Partial<Record<keyof TabPlace, unknown>> | undefined;
  return {
    hang: { corner: hang.corner as Corner, x: hang.x, y: hang.y },
    snapped: place.snapped === true,
    ...clampSize({ width: place.width, limit: place.limit }),
    ...(tab &&
      (tab.side === 'left' || tab.side === 'right') &&
      typeof tab.x === 'number' &&
      typeof tab.y === 'number' && { tab: { side: tab.side, x: tab.x, y: tab.y } }),
  };
};

/** Checking the cursor: often while it is near mini, seldom elsewhere (ms). */
const NEAR_MS = 16;
const FAR_MS = 120;
/** How near counts as near (DIP around the window). */
const NEAR = 48;
/** D-111: the card's fade out before the window hides (`--fl-dur-base`, a little more). */
const HIDE_MS = 230;
/** D-177: an ordinary card's slide into its edge before the window becomes the edge's strip. */
const COLLAPSE_MS = 200;

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
  /** MINI-04, D-177 Q8: shown as the edge tab, without the focus (Flint starting). */
  readonly startCollapsed: () => void;
  /** D-177: at the edge now, and how (tests read it). */
  readonly edge: () => {
    readonly mode: 'card' | 'tab';
    readonly view: string;
    readonly tab: TabPlace | null;
  };
  /** Only once it exists. */
  readonly send: (channel: string, ...args: unknown[]) => void;
  readonly owns: (sender: Electron.WebContents) => boolean;
}

export function createMini(options: {
  readonly url: string;
  readonly onTop: () => boolean;
  readonly hideFromSharing: () => boolean;
  /** MINI-04, D-177: Settings → Mini mode → Open on hover. */
  readonly hoverOpens: () => boolean;
  /** Reminders wait in mini's card (one may hold a peek out, D-177 Q5). */
  readonly alertWaiting: () => boolean;
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
  // D-160: one write at a time, with what `stored` holds when it runs: two saves in one tick (the
  // tab and the list chosen together, D-158) used to write side by side, and the older could land
  // last.
  let saving: Promise<void> = Promise.resolve();
  let saveQueued = false;
  const save = (): void => {
    if (saveQueued) return;
    saveQueued = true;
    saving = saving.then(async () => {
      saveQueued = false;
      await writeFileAtomic(file, `${JSON.stringify(stored, null, 2)}\n`, {
        tempDirectory: join(dirname(file), 'tmp'),
      }).catch(() => undefined);
    });
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

  // MINI-04, D-177: at the screen's edge ('tab': the window is a strip along the tab's edge, the
  // card out of the tab or tucked away) or an ordinary card ('card'). `from`: where an open card
  // came from, so the hotkey goes back there (Q4).
  let mode: 'card' | 'tab' = 'card';
  let edge: EdgeState = edgeAt('collapsed');
  let from: 'hidden' | 'tab' = 'hidden';
  /** A reminder brought the card out of the tab (Show reminders in Flint: Always, Q5). */
  let alertPeek = false;
  /** An ordinary card collapsing: its window becomes the strip once the card has slid away. */
  let collapsing = 0;
  /** The tab in DIP (48 page pixels at the page's zoom). */
  const tabSize = (): number => Math.round(TAB_SIZE * zoom());
  /** The point just inside the tab's edge, on its screen. */
  const tabPoint = (tab: TabPlace): { x: number; y: number } => ({
    x: tab.side === 'right' ? tab.x - 1 : tab.x,
    y: tab.y,
  });
  const areaOfTab = (tab: TabPlace): Rect => screen.getDisplayNearestPoint(tabPoint(tab)).workArea;
  /** This monitor setup's tab: remembered (still on a screen: back on its edge), or the first. */
  const currentTab = (): TabPlace => {
    const saved = stored.places[setupKey()]?.tab;
    if (saved) {
      const point = tabPoint(saved);
      if (screen.getAllDisplays().some((display) => contains(display.bounds, point.x, point.y)))
        return tabAt(saved.side, saved.y, areaOfTab(saved), tabSize());
    }
    // D-177: a tab whose screen is gone goes to the primary screen; the first to the mouse's.
    const area = saved
      ? screen.getPrimaryDisplay().workArea
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    return firstTab(area, tabSize());
  };
  /** Q3, one position: the tab, and the card hanging from it, remembered together. */
  const setTab = (tab: TabPlace): Place => {
    const place: Place = {
      ...currentPlace(),
      tab,
      hang: hangForTab(tab, areaOfTab(tab), tabSize()),
      snapped: false,
    };
    stored.places[setupKey()] = place;
    save();
    return place;
  };

  /** The page's layout for a place (page pixels). */
  const layoutFor = (place: Place, stage: Rect, moving?: number): MiniLayout => {
    const factor = zoom();
    const inset = insetIn(place.hang, stage);
    const area = areaOf(place.hang);
    const room = roomFor(place.hang, area);
    const tab = mode === 'tab' ? (place.tab ?? null) : null;
    const tabArea = tab ? areaOfTab(tab) : area;
    const spots = tabSpots(tabArea, tabSize());
    return {
      ...(tab && {
        tab: {
          side: tab.side,
          top: (tab.y - stage.y) / factor,
          size: TAB_SIZE,
          spots: [spots.top, spots.bottom].map((y) => (y - stage.y) / factor),
          snap: TAB_SNAP / factor,
          middle: (tabArea.x + tabArea.width / 2 - stage.x) / factor,
        },
      }),
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
    if (mode === 'tab') {
      // At the edge: the strip along the tab's edge (the taskbar may have moved: back on it).
      const placed = setTab(currentTab());
      const tab = placed.tab ?? currentTab();
      const stage = tabStage(tab, areaOfTab(tab), zoom());
      stageNow = stage;
      setStage(window, stage);
      sendLayout(layoutFor(placed, stage));
      return;
    }
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
    const inRect = (rect: MiniSurface['rects'][number] | null | undefined): boolean =>
      !!rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    const over = surface.rects.some(inRect) || inRect(surface.tab);
    setInteractive(over || surface.held);
    // MINI-04, D-177 Q1: resting on the tab peeks; away from a peek, it slides back. Tests (their
    // windows off-screen) say where the cursor is instead.
    if (mode === 'tab' && !hiding) {
      const pointer = hooks?.miniPointer;
      const next = edgeStep(edge, {
        now: Date.now(),
        overTab: pointer ? pointer === 'tab' : inRect(surface.tab),
        inZone: pointer ? pointer === 'zone' : inRect(surface.zone),
        held: surface.held,
        hoverOpens: options.hoverOpens(),
        alertHold: alertPeek && options.alertWaiting(),
      });
      if (next !== edge) {
        const before = edge;
        edge = next;
        if (before.view !== next.view || tabHovered(before) !== tabHovered(next)) applyEdge();
      }
    }
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
  /** D-177: the tab (and a peek) always on top, whatever the pin says; the pin is the open card's. */
  const onTopNow = (): boolean => (mode === 'tab' && edge.view !== 'open') || options.onTop();

  const edgeState = (): MiniEdgeState => ({
    view: mode === 'tab' ? edge.view : null,
    hover: mode === 'tab' && tabHovered(edge),
  });
  let lastFocusable: boolean | null = null;
  /** The view changed: the window follows (a click on the tab never takes the focus), the page too. */
  const applyEdge = (): void => {
    if (edge.view !== 'peek') alertPeek = false;
    if (window && !window.isDestroyed()) {
      const focusable = !(mode === 'tab' && edge.view === 'collapsed');
      if (focusable !== lastFocusable) {
        lastFocusable = focusable;
        window.setFocusable(focusable);
      }
      applyOnTop(window, onTopNow());
    }
    send(Channels.miniEdge, edgeState());
  };

  // Snapping into another corner: the page hides the card, the window moves, the card settles in.
  let moving = 0;
  const pending = new Map<number, () => void>();
  /**
   * The window to another stage while the page's content changes its place in it (another corner;
   * to or from the edge's strip; the tab to the other side): the page hides what it shows first,
   * so it never shows a frame in the wrong place, then it settles in.
   */
  const moveTo = (target: BrowserWindow, stage: Rect, at: Place): void => {
    const id = ++moving;
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      pending.delete(id);
      stageNow = stage;
      setStage(target, stage);
      send(Channels.miniSettled, id);
    };
    pending.set(id, go);
    sendLayout(layoutFor(at, stage, id));
    // D-138: not after the window is gone (a quit in between).
    setTimeout(() => {
      if (!target.isDestroyed()) go();
    }, 160);
  };

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
    applyOnTop(made, onTopNow());
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
      // D-177 Q1: a click into a peek opens it (it has the keyboard now).
      if (mode === 'tab' && edge.view === 'peek') {
        edge = edgeAt('open');
        from = 'tab';
        applyEdge();
      }
    });
    // D-179: a press on a peek opens it. The page tells main about presses on its content; a press
    // on the header's blank space or the grip (drag regions) only reaches Windows, as
    // WM_NCLBUTTONDOWN.
    if (process.platform === 'win32') {
      // After Windows has handled the press (a drag of a peek makes it an ordinary card instead).
      made.hookWindowMessage(0x00a1, () => {
        setImmediate(() => {
          if (mode === 'tab' && edge.view === 'peek') openEdge();
        });
      });
    }
    // Dragged by its header or grip and let go: near a corner, into it; elsewhere it stays.
    made.on('moved', () => {
      if (hooks || placing > 0 || !stageNow) return;
      const bounds = made.getBounds();
      const current = currentPlace();
      // D-177 Q3: a card out of the tab, dragged away, is an ordinary card now (collapsing puts the
      // tab where it is then); the window, a strip, becomes its stage, so the card settles in.
      const wasTab = mode === 'tab';
      if (wasTab) {
        mode = 'card';
        from = 'tab';
        applyEdge();
      }
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
      if (wasTab) {
        moveTo(made, stage, place);
        return;
      }
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
      // the window moves.
      moveTo(made, stage, place);
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
    const next = value as {
      card?: unknown;
      rects?: unknown;
      held?: unknown;
      tab?: unknown;
      zone?: unknown;
    };
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
      tab: isRect(next.tab) ? next.tab : null,
      zone: isRect(next.zone) ? next.zone : null,
    };
    // D-159: the tests read what the page takes clicks over.
    if (hooks) hooks.miniSurface = surface;
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
  // MINI-04, D-177: the tab clicked, the header's Collapse, Ctrl+M; the tab dragged.
  ipcMain.handle(Channels.miniGetEdge, (event) =>
    window && event.sender === window.webContents ? edgeState() : null,
  );
  ipcMain.on(Channels.miniEdgeAction, (event, action: unknown) => {
    if (!window || event.sender !== window.webContents) return;
    if (action === 'open') openEdge();
    else if (action === 'collapse') collapse();
  });
  ipcMain.on(Channels.miniTabMoved, (event, value: unknown) => {
    if (!window || event.sender !== window.webContents || mode !== 'tab' || !stageNow) return;
    if (typeof value !== 'object' || value === null) return;
    const moved = value as { side?: unknown; top?: unknown; done?: unknown };
    if ((moved.side !== 'left' && moved.side !== 'right') || typeof moved.top !== 'number') return;
    if (!Number.isFinite(moved.top)) return;
    const side: Side = moved.side;
    const before = currentTab();
    const area = areaOfTab(before);
    let y = stageNow.y + moved.top * zoom();
    if (moved.done === true) y = snapTabY(y, area, tabSize());
    const placed = setTab(tabAt(side, y, area, tabSize()));
    const tab = placed.tab ?? before;
    // Across to the other edge: the strip moves there; along the edge it stays where it is.
    if (side !== before.side) moveTo(window, tabStage(tab, area, zoom()), placed);
    else if (moved.done === true) sendLayout(layoutFor(placed, stageNow));
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
  /** Mini takes the keyboard (the window in front before gets it back when mini goes). */
  const takeFocus = (target: BrowserWindow): void => {
    // Tests never take the focus (Davit's machine runs them).
    if (hooks) return;
    const current = foregroundWindow();
    if (current !== handle()) {
      previous = current;
      lastOther = current;
    }
    target.focus();
    if (foregroundWindow() !== handle()) forceForeground(handle());
  };
  const shownNow = (): boolean =>
    window !== null && !window.isDestroyed() && window.isVisible() && hiding === undefined;

  /** D-177 Q1: the card out of the tab with the keyboard (a click on the tab, the hotkey). */
  const openEdge = (): void => {
    if (!window || mode !== 'tab' || !shownNow()) return;
    edge = edgeAt('open');
    from = 'tab';
    applyEdge();
    takeFocus(window);
    options.onShown?.();
  };

  /**
   * D-177: back to the tab (the header's Collapse, Ctrl+M, the hotkey after opening from the tab).
   * An ordinary card first gets its tab, on its nearer edge and level with it (a card snapped into
   * a corner: that corner's spot); its page has played the card's way out already. The keyboard
   * goes back to the app in front before.
   */
  const collapse = (): void => {
    if (!window || !shownNow()) return;
    const target = window;
    const hadFocus = target.isFocused();
    if (mode === 'card') {
      const current = currentPlace();
      const factor = zoom();
      const box = cardBox(current.hang, {
        width: Math.round(surface.card.width * factor),
        height: Math.round(surface.card.height * factor),
      });
      const area = screen.getDisplayMatching(box).workArea;
      const placed = setTab(
        tabForCard(box, current.snapped ? current.hang.corner : null, area, tabSize()),
      );
      mode = 'tab';
      edge = edgeAt('collapsed');
      from = 'tab';
      applyEdge();
      const tab = placed.tab ?? currentTab();
      const stage = tabStage(tab, areaOfTab(tab), factor);
      // The card slides into its edge where it is first (the page's own motion), then the window
      // becomes the strip and the tab comes out.
      const token = ++collapsing;
      setTimeout(() => {
        if (token !== collapsing || target.isDestroyed() || mode !== 'tab') return;
        moveTo(target, stage, placed);
      }, COLLAPSE_MS);
    } else {
      edge = edgeAt('collapsed');
      applyEdge();
    }
    if (hadFocus && !hooks) returnFocus(handle(), previous);
  };

  /** D-177 Q8: Flint starting: mini as the tab at its place, without the focus. */
  const startCollapsed = (): void => {
    if (shownNow()) return;
    mode = 'tab';
    edge = edgeAt('collapsed');
    from = 'tab';
    const made = window === null;
    window ??= make();
    const target = window;
    const reveal = (): void => {
      // A hide still fading out (the hotkey just before) mustn't hide it again afterwards.
      if (hiding) {
        clearTimeout(hiding);
        hiding = undefined;
      }
      if (made) {
        // `make` places it once the page has loaded (before this runs).
      } else place();
      applyEdge();
      target.showInactive();
      send(Channels.miniShown, { focus: false });
    };
    if (target.webContents.isLoading()) target.webContents.once('did-finish-load', reveal);
    else reveal();
  };

  const show = (focus: boolean): void => {
    window ??= make();
    const target = window;
    // A reminder (shown without the focus) while mini is on screen as an ordinary card: it is there.
    if (!focus && mode === 'card' && shownNow()) return;
    if (mode === 'tab' && shownNow()) {
      // At the edge: opened (the hotkey, the tray, the palette), or out for a reminder (Q5).
      if (focus) openEdge();
      else if (edge.view === 'collapsed') {
        edge = edgeAt('peek');
        alertPeek = true;
        applyEdge();
      }
      return;
    }
    if (!shownNow()) {
      // D-177 Q4: from hidden, mini opens as before: an ordinary card (at the tab's level when
      // it was at the edge, one position).
      from = 'hidden';
      if (mode === 'tab') {
        mode = 'card';
        applyEdge();
        place();
      }
    }
    const reveal = (): void => {
      if (hiding) {
        clearTimeout(hiding);
        hiding = undefined;
      }
      // Tests never take the focus (Davit's machine runs them).
      if (focus && !hooks) {
        // The app in front, before `show` brings mini forward.
        const current = foregroundWindow();
        if (current !== handle()) {
          previous = current;
          lastOther = current;
        }
        target.show();
        // D-111 (as the popup, CAP-01): Windows sometimes refuses to hand over the foreground (its
        // foreground lock); mini would then show without the keyboard: `takeFocus` takes it.
        takeFocus(target);
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
    visible: shownNow,
    show,
    hide,
    // D-177 Q4: the hotkey goes back where it came from: from the tab or a peek it opens mini and,
    // again, collapses it; from hidden it opens and hides as before.
    toggle: () => {
      if (!shownNow()) show(true);
      else if (mode === 'tab') {
        if (edge.view === 'open') collapse();
        else openEdge();
      } else if (from === 'tab') collapse();
      else hide();
    },
    startCollapsed,
    edge: () => ({
      mode,
      view: edge.view,
      tab: mode === 'tab' ? currentTab() : null,
    }),
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
    // The pin's setting is read by `onTopNow` (the tab stays on top whatever it says).
    setOnTop: () => {
      if (window) applyOnTop(window, onTopNow());
    },
    setHideFromSharing: (hidden) => {
      window?.setContentProtection(hidden);
    },
    send,
    owns: (sender) => window !== null && !window.isDestroyed() && sender === window.webContents,
  };
}
