import type { TestUpdaterRecord } from './updates.js';
import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import net from 'node:net';
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron';
import { CLOCK_ARGUMENT, installTestClock } from '../shared/test-clock.js';
import { writeFileAtomic } from './storage/atomic.js';
import type { ClipboardHistoryRead } from './clipboard-history.js';
import type { MiniSurface } from '../shared/ipc.js';
import {
  monitorSetupKey,
  rememberBounds,
  restoreBounds,
  showAsLeft,
  type DisplayInfo,
  type Rect,
  type WindowStates,
} from './window-state.js';

/**
 * The parts of the shell that keep Flint "never not running" (docs/05 §3–4): app data locations,
 * tray, start with Windows, silent crash recovery and remembered window positions.
 */

/**
 * App data (docs/04 §2): settings and state in %APPDATA%\Flint, logs in %LOCALAPPDATA%\Flint\logs.
 * Other builds use their own name (identity.ts), so they never touch a real installation's data.
 * Must run before the single-instance lock, which is keyed by this folder.
 */
export function configureAppPaths(name: string): void {
  app.setName(name);
  const testData = testDataDirectory();
  if (testData) {
    app.setPath('userData', join(testData, 'appdata'));
    app.setAppLogsPath(join(testData, 'logs'));
    return;
  }
  app.setPath('userData', join(app.getPath('appData'), name));
  const local = process.env.LOCALAPPDATA ?? app.getPath('appData');
  app.setAppLogsPath(join(local, name, 'logs'));
}

/**
 * End-to-end tests run a development build against a throwaway folder (`FLINT_DATA_DIR`), and the R-1
 * laptop benchmark keeps everything in `bench-data` next to its exe: app data, logs and the Flint
 * folder all live there, and nothing is registered with Windows. Installed builds use neither.
 */
export function testDataDirectory(): string | undefined {
  if (__FLINT_BENCH_BUILD__) return join(dirname(process.execPath), 'bench-data');
  return !app.isPackaged ? process.env.FLINT_DATA_DIR || undefined : undefined;
}

/** Test-mode hooks for the end-to-end smoke test (FLINT_E2E=1, development builds only). */
export interface E2EHooks {
  /** Every non-local request the app attempted (all blocked): must stay empty (APP-09). */
  readonly blockedRequests: string[];
  readonly captured: string[];
  /** Reminder toasts, recorded instead of shown in tests (`label | title`). */
  readonly toasts: string[];
  /** REM-06, D-94: Flint's own sound, how often it was asked for (it plays in the window). */
  chimes?: number;
  /** FOCUS-04, D-170: Focus's alarm, how often it was asked for (it plays in the window). */
  focusAlarms?: number;
  /** FOCUS-04: the running Focus session ends now (tests never wait 25 minutes). */
  focusEndNow?: () => void;
  /** D-94: tests turn Flint's own sound on (it is off by default). */
  reminderSound?: boolean;
  /** Links and files a click would open in the browser or their app, recorded instead. */
  readonly opened: string[];
  /** D-156: resolves once the popup has handled being shown (its focused frame reported). */
  showPopup?: () => Promise<void>;
  /** A toast button's activation URL, as Windows would hand it over (REM-05). */
  activate?: (url: string) => void;
  /**
   * D-93: tests never leave a mark on the user's clipboard: a step that writes to it (a copy
   * button) saves it first and puts it back after.
   */
  saveClipboard?: () => Promise<void>;
  restoreClipboard?: () => Promise<void>;
  /** DATA-04, D-97: a snapshot now (if anything changed); its id. */
  snapshot?: () => Promise<string | null>;
  /** D-97: the tray's Restore from a snapshot…, and Export without its save dialog. */
  showSnapshots?: () => void;
  exportTo?: (path: string) => Promise<number>;
  /** MINI-01, D-109: mini mode shown (off-screen, without the focus, in tests), hidden, visible. */
  showMini?: () => void;
  hideMini?: () => void;
  miniVisible?: () => boolean;
  /** D-109: the reminders whose toast mini mode's card took back. */
  closedToasts?: string[];
  /** D-159: what mini's page last said it takes clicks over (the card, open menus and pickers). */
  miniSurface?: MiniSurface;
  /**
   * MINI-04, D-177: where the cursor is for mini at the edge (the test windows are off-screen):
   * on the tab, in the card's place, or away; unset: the real cursor.
   */
  miniPointer?: 'tab' | 'zone' | 'away';
  /** D-177: mini at the edge now; Flint's start as the tab; the hotkey. */
  miniEdge?: () => { mode: 'card' | 'tab'; view: string; tab: unknown };
  miniStartCollapsed?: () => void;
  miniToggle?: () => void;
  /** D-182: the screen locks (true) or unlocks (false), as Windows would say. */
  screenLock?: (locked: boolean) => void;
  /**
   * MINI-02, D-157: the capture-into-note hotkey after its copy step (tests never send keys to
   * another app): what the selection was, as the hotkey would have read it.
   */
  captureIntoMini?: (
    selection: { kind: 'text'; text: string } | { kind: 'empty' | 'elevated' },
  ) => void;
  /** DATA-07, D-104: the folder the picker returns (no dialog), and where Flint would restart. */
  pickFolder?: string;
  relaunched?: string;
  /** APP-14, D-125: the ten minutes between two tips of a session, passed. */
  tipGapPassed?: () => void;
  /** NAV-08, D-127: what Windows' clipboard history "holds" (tests never read the real one). */
  clipboardHistory?: ClipboardHistoryRead;
  /** D-128: the clipboard's sequence number (a test bumps it when the history changes). */
  clipboardSequence?: number;
  /** D-128: history turned off by a group policy. */
  clipboardPolicyOff?: boolean;
  /** D-129: the pictures the history "holds", by item id (a BMP, base64). */
  clipboardImages?: Record<string, string>;
  /** D-129: the items Copy made current (as Win+V's pick). */
  madeCurrent?: string[];
  /** D-129: what Undo of a delete added back. */
  restored?: string[];
  /**
   * APP-06, D-136: a fake updater in test runs (development builds never update): a test emits
   * electron-updater's events through it; checks and "installs" are counted, nothing is contacted.
   */
  updater?: TestUpdaterRecord;
  /** D-138: main-process errors nothing caught (each also logged); a test fails on any. */
  mainErrors?: string[];
  /** D-137: Enter → capture durably on disk (ms), per capture, once a test asks for them. */
  captureDiskMs?: number[];
  /** D-137: Enter → popup hidden and focus back (ms), per capture, once a test asks for them. */
  captureHiddenMs?: number[];
  /** D-136: the tray menu's labels, as they are now. */
  trayLabels?: () => string[];
  /**
   * TASK-18, D-151: the folder Give to Claude's picker returns (no dialog; null: cancelled), and
   * Claude taken as not installed. Tests never ask Windows: no runner has Claude.
   */
  pickClaudeFolder?: string | null;
  claudeMissing?: boolean;
  /** D-93, D-151: text Flint would have put on the clipboard, recorded instead. */
  copied?: string[];
  /**
   * SYNC-01, D-161: Google Drive in test runs (a fake in this process, no network): a test reads
   * it and changes it as another PC would; `syncNow` runs a sync and resolves when it is done.
   */
  syncDrive?: import('@flint/core/sync').FakeDrive;
  syncNow?: () => Promise<void>;
}

export function e2eHooks(): E2EHooks | undefined {
  if (app.isPackaged || process.env.FLINT_E2E !== '1') return undefined;
  const global = globalThis as { __flintE2E?: E2EHooks };
  global.__flintE2E ??= { blockedRequests: [], captured: [], toasts: [], opened: [] };
  return global.__flintE2E;
}

/**
 * Test mode: records and refuses every outgoing connection and DNS lookup made from Node in the main
 * process. Node's fetch, http, https, tls and any library all go through `net` and `dns`, which a
 * polling check would miss for short-lived connections (APP-09). Call before anything else runs.
 */
export function guardNodeNetworkForTests(): void {
  const hooks = e2eHooks();
  if (!hooks) return;
  const record = (what: string): void => {
    hooks.blockedRequests.push(what);
  };
  const original: unknown = Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect')?.value;
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    // `net.connect()` passes its arguments normalized as one `[options, callback]` array.
    const [first, second] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
    // Local pipes (Electron's own IPC) are not network.
    if (typeof first === 'object' && first !== null && 'path' in first) {
      return Reflect.apply(original as (...a: unknown[]) => net.Socket, this, args);
    }
    const options =
      typeof first === 'object' && first !== null ? (first as net.TcpNetConnectOpts) : undefined;
    const host = options?.host ?? (typeof second === 'string' ? second : 'localhost');
    const port =
      options?.port ?? (typeof first === 'number' || typeof first === 'string' ? first : '?');
    record(`node connect ${host}:${port}`);
    this.destroy(new Error('network disabled in Flint (APP-09)'));
    return this;
  };
  (dns as { lookup: unknown }).lookup = (hostname: string, ...rest: unknown[]) => {
    record(`node dns ${hostname}`);
    const callback = rest.at(-1);
    if (typeof callback === 'function') {
      process.nextTick(() =>
        (callback as (error: Error) => void)(new Error('DNS disabled in Flint (APP-09)')),
      );
    }
  };
  const promises = dns.promises as { lookup: unknown };
  promises.lookup = (hostname: string) => {
    record(`node dns ${hostname}`);
    return Promise.reject(new Error('DNS disabled in Flint (APP-09)'));
  };
}

let clockArguments: string[] = [];

/**
 * D-107: test mode runs on the clock the end-to-end test chose (`FLINT_E2E_CLOCK_OFFSET`, ms from the
 * real time), here and, through `testWindowArguments`, in every window. Call before anything else.
 */
export function fixClockForTests(): void {
  const value = process.env.FLINT_E2E_CLOCK_OFFSET;
  if (!e2eHooks() || !value) return;
  const offset = Number(value);
  if (!Number.isFinite(offset)) return;
  installTestClock(offset);
  clockArguments = [`${CLOCK_ARGUMENT}${offset}`];
}

/** D-107: what a window is started with so its pages share the test clock (nothing otherwise). */
export const testWindowArguments = (): string[] => clockArguments;

/** Launched by Windows at login (APP-01): start in the tray without showing a window. */
export const STARTED_AT_LOGIN = process.argv.includes('--hidden');

/** APP-01: start with Windows, default on. Only for installed builds (dev builds are not apps). */
export function applyStartWithWindows(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

export interface TrayActions {
  readonly open: () => void;
  readonly capture: () => void;
  /** MINI-01, D-109: show or hide mini mode. */
  readonly mini: () => void;
  /** APP-11, D-100: the main window on Settings (D-102: on a section, e.g. a taken hotkey's). */
  readonly settings: (section?: string) => void;
  readonly quit: () => void;
  /** APP-06, D-136: install the downloaded update and start again. */
  readonly restartToUpdate: () => void;
}

export interface TrayHandle {
  readonly tray: Tray;
  /** A problem the user must see, e.g. a hotkey another app owns (APP-08); null clears it. */
  setWarning(warning: string | null): void;
  /**
   * D-136: "Restart to update" while an update is ready (null: none). The one exception to the
   * five-item tray, there only until the update is installed.
   */
  setUpdateReady(version: string | null): void;
  /** The menu's labels (tests). */
  labels(): string[];
}

/** A file in `apps/desktop/resources` (icons), wherever the build keeps it. */
export function resourcePath(name: string): string {
  return join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), name);
}

/** The window icon (UI-07): the same multi-size icon as the installed exe, also in development. */
export function appIcon(): string {
  return resourcePath('icon.ico');
}

/** APP-01, APP-03: the tray, with the only Quit in the app (Proposed menu, docs/02). */
export function createTray(actions: TrayActions): TrayHandle {
  const icon = nativeImage.createFromPath(resourcePath('tray-32.png'));
  icon.addRepresentation({
    scaleFactor: 1,
    buffer: nativeImage.createFromPath(resourcePath('tray-16.png')).toPNG(),
  });
  const tray = new Tray(icon.resize({ width: 16, height: 16 }));
  let warning: string | null = null;
  let update: string | null = null;
  const template = (): Electron.MenuItemConstructorOptions[] => [
    ...(warning
      ? ([
          { label: warning, click: () => actions.settings('capture') },
          { type: 'separator' },
        ] as const)
      : []),
    { label: 'Open Flint', click: actions.open },
    { label: 'Quick capture', click: actions.capture },
    // MINI-01, D-109: shows mini mode, or hides it.
    { label: 'Mini mode', click: actions.mini },
    // D-99, D-102: Open, Quick capture, Mini mode, Settings, Quit; the hotkeys, snapshots and
    // export are in Settings.
    { label: 'Settings', click: () => actions.settings() },
    { type: 'separator' },
    // APP-06, D-136: only while an update is ready, gone once it is installed.
    ...(update
      ? ([
          { type: 'separator' },
          { label: 'Restart to update', click: actions.restartToUpdate },
        ] as const)
      : []),
    { type: 'separator' },
    { label: 'Quit Flint', click: actions.quit },
  ];
  const refresh = (): void => {
    tray.setContextMenu(Menu.buildFromTemplate(template()));
    tray.setToolTip(
      warning
        ? `${app.getName()}: ${warning}`
        : update
          ? `${app.getName()}: ${update} is ready to install`
          : app.getName(),
    );
  };
  refresh();
  tray.on('click', actions.open);
  return {
    tray,
    setWarning(next) {
      warning = next;
      refresh();
    },
    setUpdateReady(version) {
      if (version === update) return;
      update = version;
      refresh();
    },
    labels: () =>
      template()
        .map((item) => item.label)
        .filter((label): label is string => typeof label === 'string'),
  };
}

/**
 * APP-07: if a window's renderer crashes or hangs, reload it silently. The tray and hotkeys live in
 * the main process and keep working meanwhile.
 */
export function recoverFromCrashes(
  window: BrowserWindow,
  name: string,
  log: (message: string) => void,
): void {
  // A window that fails to load would stay blank with no other trace.
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log(`${name} failed to load ${url}: ${description} (${code})`);
  });
  window.webContents.on('did-finish-load', () => log(`${name} loaded`));
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    log(`${name} renderer gone (${details.reason}); reloading`);
    if (!window.isDestroyed()) window.webContents.reload();
  });
  window.on('unresponsive', () => {
    log(`${name} renderer unresponsive; reloading`);
    if (!window.isDestroyed()) window.webContents.forcefullyCrashRenderer();
  });
}

function displays(): DisplayInfo[] {
  return screen
    .getAllDisplays()
    .map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor }));
}

/**
 * APP-05: restores a window's position for the current monitor setup and remembers changes. D-96:
 * also whether it was maximized (its normal bounds kept underneath); `show` then brings it back
 * that way. Read synchronously (a small file, before the window is first shown), so the first show
 * already knows.
 */
/** D-109: one copy of `window-state.json` for every remembered window, so none writes over another's. */
let windowStates: WindowStates | null = null;

export function rememberWindowState(
  window: BrowserWindow,
  name: string,
  fallback: Rect,
  /** D-109: where a window with nothing saved for this monitor setup first goes (else centred). */
  firstPlace?: (active: DisplayInfo) => Rect,
): { readonly show: (focus?: boolean) => void } {
  const file = join(app.getPath('userData'), 'window-state.json');
  if (windowStates === null) {
    try {
      windowStates = JSON.parse(readFileSync(file, 'utf8')) as WindowStates;
    } catch {
      windowStates = {};
    }
  }
  let states: WindowStates = windowStates;
  const setup = (): string => monitorSetupKey(displays());
  const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const saved = states[name]?.[setup()];
  const bounds =
    !saved && firstPlace
      ? firstPlace({ ...active })
      : restoreBounds(saved, displays(), { ...active }, fallback);
  window.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  let maximized = saved?.maximized === true;

  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Hidden or minimized, it keeps what it had (hiding a window never unmaximizes it).
      if (window.isDestroyed() || window.isMinimized() || !window.isVisible()) return;
      const normal = maximized ? window.getNormalBounds() : window.getBounds();
      states = rememberBounds(windowStates ?? states, name, setup(), { ...normal, maximized });
      windowStates = states;
      void writeFileAtomic(file, `${JSON.stringify(states, null, 2)}\n`, {
        tempDirectory: join(app.getPath('userData'), 'tmp'),
      }).catch(() => undefined);
    }, 500);
  };
  window.on('move', save);
  window.on('resize', save);
  window.on('maximize', () => {
    maximized = true;
    save();
  });
  window.on('unmaximize', () => {
    maximized = false;
    save();
  });
  return { show: (focus = true) => showAsLeft(window, maximized, focus) };
}
