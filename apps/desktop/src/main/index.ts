import { join } from 'node:path';
import { app, BrowserWindow, globalShortcut, ipcMain, session } from 'electron';
import {
  Channels,
  epochNow,
  type DevEvent,
  type PopupSubmit,
  type ToastKind,
} from '../shared/ipc.js';
import { runBench } from './bench.js';
import {
  findActivation,
  PROTOCOL,
  showReminderToast,
  type ReminderActivation,
} from './notifications.js';
import { createCapturePopup, type CapturePopup, type FocusSample } from './popup.js';
import { VirtualKey } from './win32.js';

/** AppUserModelID: must match the installer's Start Menu shortcut, or Windows hides the toasts (05 §5). */
const APP_ID = 'com.example.flint';
/**
 * R-1 test hotkey; the default is decided with Q-03 and made rebindable with APP-08 (M3). No Alt:
 * Alt is a common push-to-talk key (Discord), so an Alt hotkey would key the user's microphone.
 */
const CAPTURE_HOTKEY = {
  accelerator: 'Control+Shift+Space',
  modifiers: [VirtualKey.control, VirtualKey.shift],
  key: 0x20,
} as const;

const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererFile = (name: string): string =>
  join(import.meta.dirname, `../renderer/${name}/index.html`);

// APP-04: one Flint. A second launch, including a toast button's `flint://` activation, is routed here.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

function log(message: string): void {
  const event: DevEvent = { at: Date.now(), message };
  console.log(`[flint] ${message}`);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(Channels.devEvent, event);
  }
}

/** Defense in depth for "no network requests at all in v1" (APP-09): only local content loads. */
function blockNetwork(): void {
  const devServer = rendererUrl ? new URL(rendererUrl).origin : null;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, respond) => {
      const url = new URL(details.url);
      const local = ['file:', 'devtools:', 'data:', 'blob:'].includes(url.protocol);
      const dev =
        devServer !== null &&
        (url.origin === devServer || url.origin === devServer.replace(/^http/, 'ws'));
      if (local || dev) return respond({});
      log(`blocked network request: ${details.url}`);
      respond({ cancel: true });
    },
  );
}

function registerProtocol(): void {
  // Packaged builds are registered by the installer too; in development, point at this app folder.
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  else app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [app.getAppPath()]);
}

async function start(): Promise<void> {
  // Unpackaged builds have no Start Menu shortcut; Windows shows their toasts under the exe path.
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
  registerProtocol();
  await app.whenReady();
  blockNetwork();

  const mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    backgroundColor: '#0D0E10',
    title: 'Flint',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/main.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (rendererUrl) void mainWindow.loadURL(`${rendererUrl}/main-window/index.html`);
  else void mainWindow.loadFile(rendererFile('main-window'));
  // APP-02/03: closing hides; quitting is explicit (tray, M2).
  let quitting = false;
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
  });

  const focusedWaiters: ((sample: FocusSample) => void)[] = [];
  const capturedWaiters: ((
    capture: PopupSubmit & { hiddenAt: number; returnedAt: number },
  ) => void)[] = [];
  const popup: CapturePopup = createCapturePopup(rendererUrl, rendererFile('capture-popup'), {
    onFocused: (sample) => {
      log(
        `R-1 hotkey → focused frame ${(sample.frameAt - sample.hotkeyAt).toFixed(1)} ms (in front: ${String(sample.inFront)}, fallback: ${String(sample.forced)})`,
      );
      focusedWaiters.splice(0).forEach((resolve) => resolve(sample));
    },
    onCaptured: (capture) => {
      // M3 writes it to Inbox; until then the capture is only acknowledged.
      log(
        `captured "${capture.text}"; Enter → hidden and focus returned ${(capture.returnedAt - capture.keyAt).toFixed(1)} ms`,
      );
      capturedWaiters.splice(0).forEach((resolve) => resolve(capture));
    },
  });

  const registered = globalShortcut.register(CAPTURE_HOTKEY.accelerator, () =>
    popup.show(epochNow()),
  );
  log(
    registered
      ? `capture hotkey ${CAPTURE_HOTKEY.accelerator} registered`
      : `capture hotkey ${CAPTURE_HOTKEY.accelerator} is already used by another app`,
  );

  const handleActivation = (activation: ReminderActivation | null): void => {
    if (!activation) return;
    log(`toast action "${activation.action}" for task ${activation.id}`);
    if (activation.action === 'open') {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  app.on('second-instance', (_event, argv) => handleActivation(findActivation(argv)));
  handleActivation(findActivation(process.argv));

  ipcMain.on(Channels.devSendToast, (_event, kind: ToastKind) => {
    showReminderToast({
      id: 'k3f9',
      title: 'Fix null ref in tenant resolver',
      label: `Reminder · ${kind}`,
      kind,
    });
    log(`sent a ${kind} toast`);
  });

  const benchIterations = Number(process.env.FLINT_BENCH ?? 0);
  if (benchIterations > 0) {
    popup.window.webContents.once('did-finish-load', () => {
      void runBench(
        popup,
        {
          waitFocused: (timeout) => waitFor(focusedWaiters, timeout),
          waitCaptured: (timeout) => waitFor(capturedWaiters, timeout),
        },
        CAPTURE_HOTKEY,
        benchIterations,
      ).finally(() => {
        quitting = true;
        app.quit();
      });
    });
  } else if (!app.isPackaged) {
    mainWindow.show();
  }

  const testToast = process.env.FLINT_TEST_TOAST as ToastKind | undefined;
  if (testToast) {
    setTimeout(
      () =>
        showReminderToast({
          id: 'k3f9',
          title: 'Fix null ref in tenant resolver',
          label: `Reminder · ${testToast}`,
          kind: testToast,
        }),
      1500,
    );
  }
}

function waitFor<T>(waiters: ((value: T) => void)[], timeout: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const index = waiters.indexOf(done);
      if (index >= 0) waiters.splice(index, 1);
      resolve(null);
    }, timeout);
    function done(value: T): void {
      clearTimeout(timer);
      resolve(value);
    }
    waiters.push(done);
  });
}
