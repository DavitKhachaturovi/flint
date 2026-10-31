import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { Channels, type HotkeyName, type HotkeysView, type RebindOutcome } from '../shared/ipc.js';
import type { HotkeyRegistry } from './hotkey-registry.js';
import { appIcon } from './shell.js';

/**
 * The Hotkeys window (APP-08, **Proposed** until the Settings screen, M8): from the tray, and from
 * the tray's warning when a hotkey is taken. Created the first time it is needed, then hidden on
 * close like Flint's other windows (APP-02).
 */
export function hotkeysWindow(
  url: string,
  registry: HotkeyRegistry,
  /** A hotkey changed: save it in settings and refresh the tray warning. */
  onChanged: (name: HotkeyName, accelerator: string) => void,
): { show(): void } {
  let window: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  const owns = (sender: Electron.WebContents): boolean => window?.webContents === sender;

  const view = (): HotkeysView => ({
    capture: registry.get('capture'),
    selection: registry.get('selection'),
  });

  ipcMain.handle(Channels.hotkeysState, (event) => (owns(event.sender) ? view() : null));
  ipcMain.on(Channels.hotkeysRecording, (event, active: unknown) => {
    if (!owns(event.sender)) return;
    if (active === true) registry.pause();
    else registry.resume();
  });
  ipcMain.handle(
    Channels.hotkeysRebind,
    (event, name: unknown, accelerator: unknown): RebindOutcome | null => {
      if (!owns(event.sender)) return null;
      if ((name !== 'capture' && name !== 'selection') || typeof accelerator !== 'string')
        return null;
      const result = registry.rebind(name, accelerator);
      if (result.kind === 'saved') onChanged(name, accelerator);
      return result.kind;
    },
  );

  return {
    show() {
      if (!window) {
        window = new BrowserWindow({
          width: 520,
          height: 340,
          show: false,
          icon: appIcon(),
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          backgroundColor: '#0D0E10',
          title: 'Flint hotkeys',
          autoHideMenuBar: true,
          webPreferences: {
            preload: join(import.meta.dirname, '../preload/hotkeys.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        const created = window;
        created.on('close', (event) => {
          if (quitting) return;
          // Hidden, not destroyed (APP-02); recording stops with the window.
          event.preventDefault();
          registry.resume();
          created.hide();
        });
        void created.loadURL(url);
        created.once('ready-to-show', () => {
          created.show();
          created.focus();
        });
        return;
      }
      window.show();
      window.focus();
    },
  };
}
