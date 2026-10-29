import { appendFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Notification,
  protocol as schemes,
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
import { IDENTITIES, type BuildKind } from './identity.js';
import { showReminderToast } from './notifications.js';
import { createCapturePopup, type CapturePopup, type FocusSample } from './popup.js';
import { SettingsFile } from './settings.js';
import { APP_SCHEME, contentType, rendererPageUrl, resolveRendererFile } from './renderer-url.js';
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
import { findActivation, type ReminderActivation } from './toast.js';
import { VirtualKey } from './win32.js';

/**
 * Who this build is (D-33). The installed AppUserModelID must match the installer's Start Menu
 * shortcut, or Windows hides the toasts (05 §5).
 */
const BUILD: BuildKind = app.isPackaged ? 'installed' : 'development';
const IDENTITY = IDENTITIES[BUILD];
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
 * Development builds get their own Start Menu shortcut carrying their AppUserModelID, as the
 * installer does for the real app (05 §5): Windows silently drops toasts from an app identity
 * without a shortcut.
 */
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
    appUserModelId: IDENTITY.appId,
    description: 'Flint development build (Windows needs this shortcut to show its toasts)',
  };
  if (!shell.writeShortcutLink(link, 'replace', details))
    shell.writeShortcutLink(link, 'create', details);
}

const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
/** Where a page loads from: the dev server while developing, otherwise `app://flint` (D-34). */
const pageUrl = (page: string): string =>
  devServerUrl ? `${devServerUrl}/${page}/index.html` : rendererPageUrl(page);

configureAppPaths(IDENTITY.name);
guardNodeNetworkForTests();
// Before the app is ready: a standard, secure origin for the renderers, inside Flint only.
schemes.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
]);

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

/**
 * Serves `app://flint/…` from the built renderer folder and nothing else (D-34). Read directly, not
 * fetched as `file://`, so the network guard needs no exception for `file:`.
 */
function serveRenderer(): void {
  const root = join(import.meta.dirname, '../renderer');
  schemes.handle(APP_SCHEME, async (request) => {
    const file = resolveRendererFile(request.url, root);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(file), {
        headers: { 'Content-Type': contentType(file) },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Defense in depth for "no network requests at all in v1" (APP-09): only local content loads. */
function blockNetwork(): void {
  const devServer = devServerUrl ? new URL(devServerUrl).origin : null;
  const guard = (target: Electron.Session): void => {
    target.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, respond) => {
      const url = new URL(details.url);
      const local = [`${APP_SCHEME}:`, 'devtools:', 'data:', 'blob:'].includes(url.protocol);
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

function registerProtocol(protocol: string): void {
  // Registered on every start (the uninstaller removes it); in development, point at this app folder.
  if (app.isPackaged) app.setAsDefaultProtocolClient(protocol);
  else app.setAsDefaultProtocolClient(protocol, process.execPath, [app.getAppPath()]);
}

async function start(): Promise<void> {
  const protocol = IDENTITY.protocol;
  app.setAppUserModelId(IDENTITY.appId);
  // End-to-end runs leave the machine alone: no Start Menu shortcut, no taking over flint://.
  if (!testDataDirectory()) {
    if (BUILD === 'development') ensureDevShortcut();
    if (protocol) registerProtocol(protocol);
  }
  await app.whenReady();
  // Set up notifications now (REM-05). Electron creates its toast machinery on first use; when that
  // came later, from a toast-button launch of the hidden app, it reported notifications unsupported
  // for the whole session (29 Oct 2026). Logged so a machine that refuses toasts is diagnosable.
  log(`notifications supported: ${String(Notification.isSupported())} (${IDENTITY.appId})`);
  blockNetwork();
  serveRenderer();
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
  void mainWindow.loadURL(pageUrl('main-window'));
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
  const popup: CapturePopup = createCapturePopup(pageUrl('capture-popup'), {
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
  /** The R-3 test toast, until reminders exist (M6). Development builds only. */
  const sendTestToast = (kind: ToastKind, id = 'k3f9'): void => {
    if (BUILD !== 'development' || !protocol) return;
    showReminderToast(
      { id, title: 'Fix null ref in tenant resolver', label: `Reminder · ${kind}`, kind },
      protocol,
      log,
    );
    log(`sent a ${kind} toast for task ${id}`);
  };
  // Development only: `flint-dev://dev/toast?kind=reminder` sends a test toast, so R-3 can be tested by a script.
  const handleDevCommand = (argv: readonly string[]): void => {
    if (BUILD !== 'development') return;
    const command = argv.find((argument) => argument.startsWith(`${protocol}://dev/toast`));
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
    sendTestToast(kind, id);
  };
  const activationOf = (argv: readonly string[]): ReminderActivation | null =>
    protocol ? findActivation(argv, protocol) : null;
  app.on('second-instance', (_event, argv) => {
    log(`second launch: ${argv.slice(1).join(' ')}`);
    handleActivation(activationOf(argv));
    handleDevCommand(argv);
  });
  handleActivation(activationOf(process.argv));
  handleDevCommand(process.argv);

  ipcMain.on(Channels.devSendToast, (_event, kind: ToastKind) => sendTestToast(kind));

  // Test hooks are development-only: an installed Flint ignores these variables.
  const devEnv = (name: string): string | undefined =>
    BUILD === 'development' ? process.env[name] : undefined;
  const benchIterations = Number(devEnv('FLINT_BENCH') ?? 0);
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

  const testToast = devEnv('FLINT_TEST_TOAST') as ToastKind | undefined;
  if (testToast) setTimeout(() => sendTestToast(testToast), 1500);
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
