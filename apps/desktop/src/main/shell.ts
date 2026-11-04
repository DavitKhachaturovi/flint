import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import net from 'node:net';
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron';
import { writeFileAtomic } from './storage/atomic.js';
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
  /** D-94: tests turn Flint's own sound on (it is off by default). */
  reminderSound?: boolean;
  /** Links and files a click would open in the browser or their app, recorded instead. */
  readonly opened: string[];
  showPopup?: () => void;
  /** A toast button's activation URL, as Windows would hand it over (REM-05). */
  activate?: (url: string) => void;
  showHotkeys?: () => void;
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
  /** APP-08: the Hotkeys window. */
  readonly hotkeys: () => void;
  /** DATA-05, D-97: Export Flint folder… (a save dialog). */
  readonly exportFolder: () => void;
  /** DATA-04, D-97: Restore from a snapshot… (the Snapshots view). */
  readonly snapshots: () => void;
  readonly quit: () => void;
}

export interface TrayHandle {
  readonly tray: Tray;
  /** A problem the user must see, e.g. a hotkey another app owns (APP-08); null clears it. */
  setWarning(warning: string | null): void;
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
  const menu = (warning: string | null): Menu =>
    Menu.buildFromTemplate([
      ...(warning
        ? ([{ label: warning, click: actions.hotkeys }, { type: 'separator' }] as const)
        : []),
      { label: 'Open Flint', click: actions.open },
      { label: 'Quick capture', click: actions.capture },
      { label: 'Mini mode', enabled: false },
      { label: 'Hotkeys…', click: actions.hotkeys },
      { label: 'Settings', enabled: false },
      { type: 'separator' },
      // D-97: until Settings and Ctrl+K have them (M8).
      { label: 'Export Flint folder…', click: actions.exportFolder },
      { label: 'Restore from a snapshot…', click: actions.snapshots },
      { type: 'separator' },
      { label: 'Quit Flint', click: actions.quit },
    ]);
  tray.setToolTip(app.getName());
  tray.setContextMenu(menu(null));
  tray.on('click', actions.open);
  return {
    tray,
    setWarning(warning) {
      tray.setContextMenu(menu(warning));
      tray.setToolTip(warning ? `${app.getName()}: ${warning}` : app.getName());
    },
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
export function rememberWindowState(
  window: BrowserWindow,
  name: string,
  fallback: Rect,
): { readonly show: (focus?: boolean) => void } {
  const file = join(app.getPath('userData'), 'window-state.json');
  let states: WindowStates = {};
  try {
    states = JSON.parse(readFileSync(file, 'utf8')) as WindowStates;
  } catch {
    states = {};
  }
  const setup = (): string => monitorSetupKey(displays());
  const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const saved = states[name]?.[setup()];
  const bounds = restoreBounds(saved, displays(), { ...active }, fallback);
  window.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  let maximized = saved?.maximized === true;

  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Hidden or minimized, it keeps what it had (hiding a window never unmaximizes it).
      if (window.isDestroyed() || window.isMinimized() || !window.isVisible()) return;
      const normal = maximized ? window.getNormalBounds() : window.getBounds();
      states = rememberBounds(states, name, setup(), { ...normal, maximized });
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
