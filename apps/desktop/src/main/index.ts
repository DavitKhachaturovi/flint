import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Notification,
  session,
  shell,
} from 'electron';
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
import { SettingsFile } from './settings.js';
import { prepareFlintFolder } from './storage/flint-folder.js';
import {
  applyStartWithWindows,
  configureAppPaths,
  createTray,
  e2eHooks,
  guardNodeNetworkForTests,
  recoverFromCrashes,
  rememberWindowState,
  STARTED_AT_LOGIN,
  testDataDirectory,
} from './shell.js';
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

/**
 * Development builds get their own AppUserModelID and Start Menu shortcut, as the installer does for
 * the real app (05 §5): Windows silently drops toasts from an app identity without a shortcut.
 */
const DEV_APP_ID = 'com.example.flint.dev';

function ensureDevShortcut(): void {
  const link = join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Flint (development).lnk',
  );
  const details = {
    target: process.execPath,
    args: `"${app.getAppPath()}"`,
    appUserModelId: DEV_APP_ID,
    description: 'Flint development build (Windows needs this shortcut to show its toasts)',
  };
  if (!shell.writeShortcutLink(link, 'replace', details))
    shell.writeShortcutLink(link, 'create', details);
}

const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererFile = (name: string): string =>
  join(import.meta.dirname, `../renderer/${name}/index.html`);

configureAppPaths();
guardNodeNetworkForTests();

// APP-04: one Flint. A second launch, including a toast button's `flint://` activation, is routed here.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

function log(message: string): void {
  const event: DevEvent = { at: Date.now(), message };
  console.log(`[flint] ${message}`);
  // Local log only, never uploaded (APP-09, docs/05 §6).
  try {
    mkdirSync(app.getPath('logs'), { recursive: true });
    appendFileSync(
      join(app.getPath('logs'), 'flint.log'),
      `${new Date(event.at).toISOString()} ${message}\n`,
    );
  } catch {
    // Logging must never break the app.
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(Channels.devEvent, event);
  }
}

/** Defense in depth for "no network requests at all in v1" (APP-09): only local content loads. */
function blockNetwork(): void {
  const devServer = rendererUrl ? new URL(rendererUrl).origin : null;
  const guard = (target: Electron.Session): void => {
    target.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, respond) => {
      const url = new URL(details.url);
      const local = ['file:', 'devtools:', 'data:', 'blob:'].includes(url.protocol);
      const dev =
        devServer !== null &&
        (url.origin === devServer || url.origin === devServer.replace(/^http/, 'ws'));
      if (local || dev) return respond({});
      log(`blocked network request: ${details.url}`);
      e2eHooks()?.blockedRequests.push(details.url);
      respond({ cancel: true });
    });
  };
  guard(session.defaultSession);
  // Any other session (a partition, a future webview) gets the same guard.
  app.on('session-created', guard);
}

function registerProtocol(): void {
  // Registered on every start (the uninstaller removes it); in development, point at this app folder.
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  else app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [app.getAppPath()]);
}

async function start(): Promise<void> {
  app.setAppUserModelId(app.isPackaged ? APP_ID : DEV_APP_ID);
  // End-to-end runs leave the machine alone: no Start Menu shortcut, no taking over flint://.
  if (!testDataDirectory()) {
    if (!app.isPackaged) ensureDevShortcut();
    registerProtocol();
  }
  await app.whenReady();
  blockNetwork();
  const settings = await new SettingsFile(
    join(app.getPath('userData'), 'settings.json'),
    !app.isPackaged,
  ).load();
  const testData = testDataDirectory();
  const folder = await prepareFlintFolder(
    testData ? join(testData, 'Flint') : settings.flintFolder,
  );
  log(
    `Flint folder ${folder.folder}: ${folder.lists.length} lists, Inbox ${folder.inbox}${folder.inboxCreated ? ' (created)' : ''}`,
  );
  // Shown in onboarding and settings in M8 (D-23, D-24); logged until then.
  if (folder.insideOneDrive) {
    log('warning: the Flint folder is inside OneDrive, which v1 does not support (D-24)');
  }
  if (folder.obsidianVaultRoot) {
    log('note: the Flint folder is an Obsidian vault root; a Flint subfolder is suggested (D-23)');
  }
  applyStartWithWindows(settings.startWithWindows);
  // Windows are hidden, never closed (APP-02); closing the last one must not quit Flint.
  app.on('window-all-closed', () => undefined);

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
  recoverFromCrashes(mainWindow, 'main window', log);
  void rememberWindowState(mainWindow, 'main', { x: 0, y: 0, width: 900, height: 640 });
  const showMain = (): void => {
    mainWindow.show();
    mainWindow.focus();
  };

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
      e2eHooks()?.captured.push(capture.text);
    },
  });
  const hooks = e2eHooks();
  if (hooks) hooks.showPopup = () => popup.show(epochNow());

  recoverFromCrashes(popup.window, 'capture popup', log);

  const hotkey = settings.captureHotkey;
  const registered = globalShortcut.register(hotkey, () => popup.show(epochNow()));
  log(
    registered
      ? `capture hotkey ${hotkey} registered`
      : `capture hotkey ${hotkey} is already used by another app`,
  );

  createTray({
    open: showMain,
    capture: () => popup.show(epochNow()),
    quit: () => app.quit(),
  });

  const handleActivation = (activation: ReminderActivation | null): void => {
    if (!activation) return;
    log(`toast action "${activation.action}" for task ${activation.id}`);
    if (activation.action === 'open') showMain();
  };
  // Development only: `flint://dev/toast?kind=reminder` sends a test toast, so R-3 can be tested by a script.
  const handleDevCommand = (argv: readonly string[]): void => {
    if (app.isPackaged) return;
    const command = argv.find((argument) => argument.startsWith(`${PROTOCOL}://dev/toast`));
    if (!command) return;
    const url = new URL(command);
    const kind = (url.searchParams.get('kind') ?? 'reminder') as ToastKind;
    const id = url.searchParams.get('id') ?? 'k3f9';
    if (url.searchParams.get('kind') === 'plain') {
      // Diagnostic: a notification without custom toast XML.
      const plain = new Notification({ title: 'Flint test', body: `Plain notification ${id}` });
      plain.on('show', () => log(`plain notification shown (${id})`));
      plain.on('failed', (_event, error) => log(`plain notification failed (${id}): ${error}`));
      plain.show();
      log(`sent a plain notification (${id}); supported: ${String(Notification.isSupported())}`);
      return;
    }
    showReminderToast(
      {
        id,
        title: 'Fix null ref in tenant resolver',
        label: `Reminder · ${kind}`,
        kind,
      },
      log,
    );
    log(`sent a ${kind} toast for task ${id}`);
  };
  app.on('second-instance', (_event, argv) => {
    log(`second launch: ${argv.slice(1).join(' ')}`);
    handleActivation(findActivation(argv));
    handleDevCommand(argv);
  });
  handleActivation(findActivation(process.argv));
  handleDevCommand(process.argv);

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
  } else if (!app.isPackaged && !STARTED_AT_LOGIN) {
    // Development builds open the R-1/R-3 harness; installed builds start in the tray.
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
