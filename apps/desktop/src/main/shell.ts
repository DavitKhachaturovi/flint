import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron';
import { writeFileAtomic } from './storage/atomic.js';
import {
  monitorSetupKey,
  rememberBounds,
  restoreBounds,
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
 * Development builds use "Flint (development)" so they never touch a real installation's data.
 * Must run before the single-instance lock, which is keyed by this folder.
 */
export function configureAppPaths(): void {
  const name = app.isPackaged ? 'Flint' : 'Flint (development)';
  app.setName(name);
  app.setPath('userData', join(app.getPath('appData'), name));
  const local = process.env.LOCALAPPDATA ?? app.getPath('appData');
  app.setAppLogsPath(join(local, name, 'logs'));
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
  readonly quit: () => void;
}

/** APP-01, APP-03: the tray, with the only Quit in the app (Proposed menu, docs/02). */
export function createTray(actions: TrayActions): Tray {
  const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  const icon = nativeImage.createFromPath(join(resources, 'tray-32.png'));
  icon.addRepresentation({
    scaleFactor: 1,
    buffer: nativeImage.createFromPath(join(resources, 'tray-16.png')).toPNG(),
  });
  const tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(app.isPackaged ? 'Flint' : 'Flint (development)');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Flint', click: actions.open },
      { label: 'Quick capture', click: actions.capture },
      { label: 'Mini mode', enabled: false },
      { label: 'Settings', enabled: false },
      { type: 'separator' },
      { label: 'Quit Flint', click: actions.quit },
    ]),
  );
  tray.on('click', actions.open);
  return tray;
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

/** APP-05: restores a window's position for the current monitor setup and remembers changes. */
export async function rememberWindowState(
  window: BrowserWindow,
  name: string,
  fallback: Rect,
): Promise<void> {
  const file = join(app.getPath('userData'), 'window-state.json');
  let states: WindowStates = {};
  try {
    states = JSON.parse(await readFile(file, 'utf8')) as WindowStates;
  } catch {
    states = {};
  }
  const setup = (): string => monitorSetupKey(displays());
  const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  window.setBounds(restoreBounds(states[name]?.[setup()], displays(), { ...active }, fallback));

  let timer: NodeJS.Timeout | undefined;
  const save = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return;
      states = rememberBounds(states, name, setup(), window.getBounds());
      void writeFileAtomic(file, `${JSON.stringify(states, null, 2)}\n`, {
        tempDirectory: join(app.getPath('userData'), 'tmp'),
      }).catch(() => undefined);
    }, 500);
  };
  window.on('move', save);
  window.on('resize', save);
}
