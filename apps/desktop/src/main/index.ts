import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeImage,
  Notification,
  protocol as schemes,
  session,
  shell,
} from 'electron';
import {
  Channels,
  epochNow,
  type DevEvent,
  type PopupNotice,
  type PopupShown,
  type PopupSubmit,
  type ToastKind,
} from '../shared/ipc.js';
import { runBench } from './bench.js';
import { IDENTITIES, type BuildKind } from './identity.js';
import { showReminderToast } from './notifications.js';
import { DraftFile } from './capture/drafts.js';
import { captureSelection } from './capture/selection.js';
import { acceleratorKeys } from './hotkeys.js';
import { Workspace, type CreatedList } from './capture/workspace.js';
import { createCapturePopup, type CapturePopup, type FocusSample } from './popup.js';
import { SettingsFile } from './settings.js';
import { APP_SCHEME, contentType, rendererPageUrl, resolveRendererFile } from './renderer-url.js';
import { prepareFlintFolder } from './storage/flint-folder.js';
import { watchListFolder } from './storage/watcher.js';
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
const BUILD: BuildKind = __FLINT_BENCH_BUILD__
  ? 'bench'
  : app.isPackaged
    ? 'installed'
    : 'development';
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
  // Not in test runs or the benchmark: they show no toasts, and setting up notifications can make
  // Electron write a Start Menu shortcut for the app identity.
  if (!testDataDirectory()) {
    log(`notifications supported: ${String(Notification.isSupported())} (${IDENTITY.appId})`);
  }
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
  if (BUILD === 'installed') applyStartWithWindows(settings.startWithWindows);
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

  // Captures (CAP-01, CAP-02, CAP-05, D-27): every list loaded, drafts kept in app data.
  const workspace = await Workspace.open(
    folder.folder,
    join(app.getPath('userData'), 'ui-state.json'),
  );
  watchListFolder(folder.folder, (path) => {
    workspace.fileChanged(path).catch((error: unknown) => log(`reload failed: ${String(error)}`));
  });
  const drafts = new DraftFile(join(app.getPath('userData'), 'drafts.json'));
  await drafts.load();
  /** The follow-up message for the next popup open (D-26), and what its Undo reverts. */
  let notice: { readonly popup: PopupNotice; readonly undo: CreatedList | null } | null = null;
  /** What the popup's renderer last reported: does it hold anything (D-41)? */
  let popupHasContent = drafts.hasContent;

  /** What the popup shows when it opens (CAP-08, D-26, D-38, D-39). */
  const popupState = (): Omit<PopupShown, 'hotkeyAt'> => ({
    draft: drafts.draft,
    previousDraft: drafts.hasPrevious,
    attachments: drafts.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      thumbnail: thumbnail(nativeImage.createFromPath(attachment.file)),
    })),
    notice: notice?.popup ?? null,
    lists: workspace.listInfos(),
  });

  const saveCapture = async (capture: PopupSubmit): Promise<void> => {
    // The images on the draft when Enter was pressed go with this capture (CAP-06).
    const attachments = [...drafts.attachments];
    // What was submitted is the latest draft (the saved copy trails typing by a moment), so it is
    // exactly this that is cleared once saved.
    await drafts.set(capture.draft).catch(() => undefined);
    try {
      const outcome = await workspace.capture({ ...capture, attachments }, new Date());
      if (outcome.kind === 'saved') {
        log(
          `capture saved to ${outcome.listName}; Enter → durably on disk ${(epochNow() - capture.keyAt).toFixed(1)} ms`,
        );
        notice = outcome.createdList
          ? {
              popup: { kind: 'created-list', name: outcome.createdList.name },
              undo: outcome.createdList,
            }
          : null;
      }
      await drafts.clearIf(capture.draft, attachments);
      e2eHooks()?.captured.push(capture.text);
    } catch (error) {
      // D-27: the text comes back as the draft, with `Couldn't save your last capture · Retry`.
      log(`capture could not be saved: ${String(error)}`);
      notice = { popup: { kind: 'save-failed' }, undo: null };
      await drafts.set(capture.draft).catch(() => undefined);
    }
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
      log(
        `capture handed over; Enter → hidden and focus returned ${(capture.returnedAt - capture.keyAt).toFixed(1)} ms`,
      );
      capturedWaiters.splice(0).forEach((resolve) => resolve(capture));
      void saveCapture(capture);
    },
    state: popupState,
    onDraft: (draft) => {
      drafts.set(draft).catch((error: unknown) => log(`draft not saved: ${String(error)}`));
    },
    onContent: (hasContent) => {
      popupHasContent = hasContent;
    },
    keepOpen: () => popupHasContent || drafts.attachments.length > 0,
    onDiscard: () => {
      popupHasContent = false;
      drafts.discard().catch((error: unknown) => log(`draft not discarded: ${String(error)}`));
    },
    onPrevious: async (action) => {
      if (action === 'restore') await drafts.restorePrevious();
      else await drafts.dismissPrevious();
      return popupState();
    },
    onAttach: async (bytes, type) => {
      const attachment = await drafts.attach(bytes, type);
      return attachment
        ? {
            id: attachment.id,
            name: attachment.name,
            thumbnail: thumbnail(nativeImage.createFromBuffer(Buffer.from(bytes))),
          }
        : null;
    },
    onDetach: (id) => {
      drafts.detach(id).catch((error: unknown) => log(`attachment not removed: ${String(error)}`));
    },
    onNoticeAction: (action) => {
      const undo = action === 'undo' ? notice?.undo : null;
      notice = null;
      if (undo) {
        workspace
          .undoCreatedList(undo, new Date())
          .then(() => log(`undid the new list ${undo.name}`))
          .catch((error: unknown) => log(`undo failed: ${String(error)}`));
      }
    },
  });
  const hooks = e2eHooks();
  if (hooks) hooks.showPopup = () => popup.show(epochNow());

  recoverFromCrashes(popup.window, 'capture popup', log);

  const hotkey = settings.captureHotkey;
  // D-41: the hotkey opens the popup, brings back the cursor to one that stayed open, and closes
  // one that has it (the draft is kept, like Esc).
  const registered = globalShortcut.register(hotkey, () => {
    if (popup.isFocused()) popup.hide();
    else popup.show(epochNow());
  });
  log(
    registered
      ? `capture hotkey ${hotkey} registered`
      : `capture hotkey ${hotkey} is already used by another app`,
  );

  // CAP-07, R-2: copy what is selected in the app in front, then open the popup with it.
  const selectionHotkey = settings.captureSelectionHotkey;
  const selectionKeys = acceleratorKeys(selectionHotkey);
  let selecting = false;
  const selectionRegistered =
    selectionKeys !== null &&
    globalShortcut.register(selectionHotkey, () => {
      if (selecting) return;
      selecting = true;
      const hotkeyAt = epochNow();
      captureSelection(selectionKeys)
        .then((selection) => {
          log(`capture-selection: ${selection.kind}`);
          if (selection.kind === 'text') {
            // D-39: a closed popup starts fresh (its draft is set aside as the previous draft);
            // an open one collects the selection below what it already has.
            const fresh = !popup.window.isVisible();
            const ready = fresh ? drafts.setAside() : Promise.resolve();
            return ready.then(() => {
              if (fresh) popupHasContent = false;
              popup.show(hotkeyAt, { prefill: selection.text, replaceDraft: fresh });
            });
          }
          if (selection.kind === 'elevated') {
            popup.show(hotkeyAt, {
              hint: "Couldn't read selection from an admin window; paste with Ctrl+V",
            });
          } else popup.show(hotkeyAt, { hint: 'Nothing was selected; paste with Ctrl+V' });
          return undefined;
        })
        .catch((error: unknown) => {
          log(`capture-selection failed: ${String(error)}`);
          popup.show(hotkeyAt, { hint: "Couldn't read the selection; paste with Ctrl+V" });
        })
        .finally(() => {
          selecting = false;
        });
    });
  log(
    selectionRegistered
      ? `capture-selection hotkey ${selectionHotkey} registered`
      : `capture-selection hotkey ${selectionHotkey} is already used by another app`,
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
      { protocol, hideText: settings.hideNotificationText },
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
  const benchHooks = {
    waitFocused: (timeout: number) => waitFor(focusedWaiters, timeout),
    waitCaptured: (timeout: number) => waitFor(capturedWaiters, timeout),
  };
  const quitAfter = (run: Promise<void>): void => {
    void run.finally(() => {
      quitting = true;
      app.quit();
    });
  };
  const benchIterations = Number(devEnv('FLINT_BENCH') ?? 0);
  if (__FLINT_BENCH_BUILD__) {
    // The R-1 laptop benchmark build does nothing else (docs/06 §1). Other builds don't contain it.
    popup.window.webContents.once('did-finish-load', () =>
      quitAfter(
        import('./laptop-bench.js').then(({ runLaptopBench }) =>
          runLaptopBench(popup, benchHooks, CAPTURE_HOTKEY, registered, log),
        ),
      ),
    );
  } else if (benchIterations > 0) {
    popup.window.webContents.once('did-finish-load', () =>
      quitAfter(
        runBench(popup, benchHooks, CAPTURE_HOTKEY, benchIterations).then((result) => {
          writeFileSync(
            join(app.getPath('userData'), 'bench-r1.json'),
            `${JSON.stringify(result, null, 2)}\n`,
          );
          console.log(`FLINT_BENCH_RESULT ${JSON.stringify(result)}`);
        }),
      ),
    );
  } else if (BUILD === 'development' && !STARTED_AT_LOGIN) {
    // Development builds open the R-1/R-3 harness; installed builds start in the tray.
    mainWindow.show();
  }

  const testToast = devEnv('FLINT_TEST_TOAST') as ToastKind | undefined;
  if (testToast) setTimeout(() => sendTestToast(testToast), 1500);
}

/** A chip-sized thumbnail of a pasted image (CAP-06). */
function thumbnail(image: Electron.NativeImage): string {
  return image.isEmpty() ? '' : image.resize({ height: 28 }).toDataURL();
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
