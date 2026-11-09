import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { dirname, extname, isAbsolute, join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  powerMonitor,
  protocol as schemes,
  screen,
  session,
  shell,
} from 'electron';
import {
  Channels,
  epochNow,
  type ListAction,
  type SidebarAction,
  type ListChange,
  type ListView,
  type PopupNotice,
  type PopupShown,
  type PopupSubmit,
  type ToastKind,
  type SettingChange,
  type OnboardingState,
  type TourAction,
  type TourEvent,
  type MiniAlert,
  type SettingsView,
  type ClipboardItemView,
  type ClipboardView,
  type ClaudeState,
} from '../shared/ipc.js';
import { isOpenableLink } from '../shared/inline-markdown.js';
import { runBench } from './bench.js';
import { IDENTITIES, type BuildKind } from './identity.js';
import { closeReminderToast, showMissedSummary, showReminderToast } from './notifications.js';
import { createMini } from './mini.js';
import { NoteEditors, type EditorWindow } from './note-editors.js';
import { TipsFile } from './tips.js';
import { UPDATE_VIEW_OFF, type UpdateView } from '../shared/updates.js';
import { UpdateService, isUpdateRequest, testUpdater, type UpdaterLike } from './updates.js';
import { DraftFile } from './capture/drafts.js';
import { captureSelection, restoreClipboard, saveClipboard } from './capture/selection.js';
import { SnapshotStore } from './storage/snapshots.js';
import { zipFolder } from './storage/zip.js';
import { displayAccelerator } from '../shared/accelerator.js';
import { HotkeyRegistry } from './hotkey-registry.js';
import { acceleratorKeys } from './hotkeys.js';
import { Workspace, type CreatedList } from './capture/workspace.js';
import { createCapturePopup, type CapturePopup, type FocusSample } from './popup.js';
import { isAbsoluteFolder, SettingsFile } from './settings.js';
import { claudeState, giveToClaude, readGiveRequest, withFolder } from './claude.js';
import {
  displayKey,
  isZoomRequest,
  PanelFile,
  stepZoom,
  zoomKey,
  ZoomFile,
  type ZoomRequest,
} from './zoom.js';
import { upNext } from './up-next.js';
import {
  APP_SCHEME,
  contentType,
  MAIN_WINDOW_HOST,
  MINI_HOST,
  rendererPageUrl,
  type RendererHost,
  isVideoFile,
  resolveLinkedFile,
  resolveMediaFile,
  resolveRendererFile,
} from './renderer-url.js';
import {
  attachFile,
  copyIntoFlint,
  fileKind,
  linkedPath,
  openRule,
  type AttachOutcome,
} from './attachments.js';
import { prepareFlintFolder } from './storage/flint-folder.js';
import { checkFolder, clashes, copyFlintFolder } from './storage/folder-change.js';
import { searchLists, searchTrash } from './search.js';
import { compileLinkPatterns, findShortForms, readLinkPatterns } from '../shared/link-patterns.js';
import { ReminderService } from './reminder-service.js';
import type { ToastPlan } from './reminders.js';
import { watchListFolder } from './storage/watcher.js';
import { TourFile } from './onboarding.js';
import { ClipboardGuard } from './clipboard-guard.js';
import {
  clearHistory,
  clipboardHistoryPolicyOff,
  deleteHistoryItem,
  makeHistoryItemCurrent,
  readClipboardHistory,
  readHistoryImage,
} from './clipboard-history.js';
import { decodeBmp, shrink } from '../shared/bmp.js';
import { isTipId, TIP_GAP_MS, tipAllowed, TIPS } from '../shared/tips.js';
import {
  appIcon,
  applyStartWithWindows,
  configureAppPaths,
  createTray,
  e2eHooks,
  fixClockForTests,
  guardNodeNetworkForTests,
  recoverFromCrashes,
  rememberWindowState,
  STARTED_AT_LOGIN,
  testDataDirectory,
  testWindowArguments,
} from './shell.js';
import {
  findActivation,
  MISSED_SUMMARY_ID,
  type ReminderActivation,
  type ToastOptions,
} from './toast.js';
import { clipboardSequence, VirtualKey } from './win32.js';
import { classifyPaste } from '@flint/core/shorthand';

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
/** APP-06, D-136: only the installed build updates (never development, tests or the benchmark). */
const UPDATES = BUILD === 'installed';
/** electron-updater's own session (its `NET_SESSION_NAME`): the only one that may reach GitHub. */
const UPDATER_SESSION = 'electron-updater';
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

/** NOTE-02, D-82: the picture types Insert ▸ Image takes (MEDIA-02), by file extension. */
const PICKED_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
/** Where a page loads from: the dev server while developing, otherwise `app://flint` (D-34). */
const pageUrl = (page: string, host?: RendererHost): string =>
  devServerUrl ? `${devServerUrl}/${page}/index.html` : rendererPageUrl(page, host);

configureAppPaths(IDENTITY.name);
guardNodeNetworkForTests();
fixClockForTests();
// Before the app is ready: a standard, secure origin for the renderers, inside Flint only.
schemes.registerSchemesAsPrivileged([
  // D-84: `stream` lets videos seek (range requests).
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, stream: true } },
]);

/**
 * D-138: an error nothing caught in the main process. Logged always. While Flint quits it changes
 * nothing (the quit goes on: an error box then would keep Flint from exiting); in a test run it is
 * recorded, never shown as a box on the screen (the tests fail on it); otherwise the box Electron
 * would show, as before.
 */
let quittingApp = false;
app.on('before-quit', () => {
  quittingApp = true;
});
process.on('uncaughtException', (error) => {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  log(`main process error${quittingApp ? ' while quitting' : ''}: ${text}`);
  const hooks = e2eHooks();
  if (hooks) {
    (hooks.mainErrors ??= []).push(text);
    return;
  }
  if (quittingApp) return;
  dialog.showErrorBox(
    'A JavaScript error occurred in the main process',
    `Uncaught Exception:\n${text}`,
  );
});

// APP-04: one Flint. A second launch, including a toast button's `flint://` activation, is routed here.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

function log(message: string): void {
  console.log(`[flint] ${message}`);
  // Local log only, never uploaded (APP-09, docs/05 §6).
  try {
    mkdirSync(app.getPath('logs'), { recursive: true });
    appendFileSync(
      join(app.getPath('logs'), 'flint.log'),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    // Logging must never break the app.
  }
}

/** The Flint folder, once known: `app://media/…` serves its images (task bodies, D-49). */
let mediaRoot: string | null = null;

/**
 * Serves `app://flint/…` from the built renderer folder and nothing else (D-34), and
 * `app://media/…` from the images in the Flint folder. Read directly, not fetched as `file://`, so
 * the network guard needs no exception for `file:`.
 */
function serveRenderer(): void {
  const root = join(import.meta.dirname, '../renderer');
  schemes.handle(APP_SCHEME, async (request) => {
    const file =
      resolveRendererFile(request.url, root) ??
      (mediaRoot ? resolveMediaFile(request.url, mediaRoot) : null) ??
      resolveLinkedFile(request.url);
    if (!file) return new Response('Not found', { status: 404 });
    // D-84: videos (also large linked ones) are streamed, with range requests for seeking.
    if (isVideoFile(file)) return streamFile(file, request.headers.get('range'));
    try {
      return new Response(await readFile(file), {
        headers: { 'Content-Type': contentType(file) },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/**
 * The only network use is the updater's (APP-09, D-136); everything else is blocked, as a defense in
 * depth: only local content loads. `updates`: this build updates (installed builds only), so its
 * updater's own session (electron-updater's) may reach GitHub's release hosts over HTTPS, and only
 * that session.
 */
function blockNetwork(updates: boolean): void {
  const devServer = devServerUrl ? new URL(devServerUrl).origin : null;
  let updaterSession: Electron.Session | null = null;
  const guard = (target: Electron.Session): void => {
    target.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, respond) => {
      const url = new URL(details.url);
      const local = [`${APP_SCHEME}:`, 'devtools:', 'data:', 'blob:'].includes(url.protocol);
      const dev =
        devServer !== null &&
        (url.origin === devServer || url.origin === devServer.replace(/^http/, 'ws'));
      if (local || dev) return respond({});
      if (updates && isUpdateRequest(details.url)) {
        updaterSession ??= session.fromPartition(UPDATER_SESSION, { cache: false });
        if (target === updaterSession) return respond({});
      }
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
  blockNetwork(UPDATES);
  serveRenderer();
  // No window ever navigates away from Flint's own pages or opens another window: links in titles
  // go to the browser through mainOpenLink (LIST-02), never into a Flint window.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  const settingsFile = new SettingsFile(
    join(app.getPath('userData'), 'settings.json'),
    !app.isPackaged,
  );
  const settings = await settingsFile.load();
  // APP-10, APP-15, D-117, D-119: a fresh install (no settings yet) gets the walkthrough once the
  // window shows; an update gets What's new. End-to-end runs start fresh every time, so only a test
  // that asks for it (FLINT_E2E_ONBOARDING, development builds only) sees either.
  const onboardingOn =
    !e2eHooks() || (BUILD === 'development' && process.env.FLINT_E2E_ONBOARDING === '1');
  const tour = new TourFile(join(app.getPath('userData'), 'tour.json'));
  await tour.load();
  const fresh = !settingsFile.existed;
  if (onboardingOn && fresh) {
    await tour.due();
    // Its own What's new is not for a fresh install.
    await settingsFile.update({ lastSeenVersion: app.getVersion() });
  }
  const tourAtStart = onboardingOn
    ? await tour.atStart()
    : { from: null as number | null, interrupted: false };
  let tourInterrupted = tourAtStart.interrupted;
  /** Where the page runs the tour from (it follows the tour, for a page reloaded mid-way). */
  let tourFrom = tourAtStart.from;
  /** D-118: a session the walkthrough ran in shows no tips. */
  let tourThisSession = tourAtStart.from !== null;
  const whatsNewDue =
    onboardingOn && !fresh && settingsFile.current.lastSeenVersion !== app.getVersion()
      ? { since: settingsFile.current.lastSeenVersion }
      : null;
  if (tourAtStart.from !== null) log(`walkthrough from step ${tourAtStart.from + 1}`);
  if (tourInterrupted) log('walkthrough: the last one was cut short');
  const testData = testDataDirectory();
  const folder = await prepareFlintFolder(
    testData ? join(testData, 'Flint') : settings.flintFolder,
  );
  log(
    `Flint folder ${folder.folder}: ${folder.lists.length} lists, Inbox ${folder.inbox}${folder.inboxCreated ? ' (created)' : ''}`,
  );
  mediaRoot = folder.folder;
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
    width: 1120,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#0D0E10',
    title: 'Flint',
    icon: appIcon(),
    // Frameless like mockup 01; Windows still draws its own caption buttons (snap layouts work).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0D0E10', symbolColor: '#7C7F84', height: 40 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/main.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: testWindowArguments(),
    },
  });
  // D-116: the page's calls wait for this (preload/main-bridge.ts); true once all is set up.
  let setUp = false;
  ipcMain.handle(Channels.mainStarted, () => setUp);
  // D-81: its own origin, so its zoom (UI-12) never reaches the capture popup.
  void mainWindow.loadURL(pageUrl('main-window', MAIN_WINDOW_HOST));
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
    // D-138: each stage of a quit, so one that stops says where.
    log('quitting');
  });
  app.on('will-quit', () => log('quitting: windows closed'));
  recoverFromCrashes(mainWindow, 'main window', log);
  // APP-10, APP-15, D-117: the tour and What's new wait for the window to be on screen.
  mainWindow.on('show', () => mainWindow.webContents.send(Channels.mainShown));
  mainWindow.on('hide', () => mainWindow.webContents.send(Channels.mainHidden));
  /** D-116: what a walkthrough step waits for, to the main window while a tour runs. */
  const tourEvent = (event: TourEvent): void => {
    if (tour.running && !mainWindow.isDestroyed())
      mainWindow.webContents.send(Channels.mainTourEvent, event);
  };
  const mainState = rememberWindowState(mainWindow, 'main', {
    x: 0,
    y: 0,
    width: 900,
    height: 640,
  });
  setUpZoom(mainWindow);
  /** APP-05, D-96: from every entry point, as it was left (maximized, or its remembered bounds). */
  const showMain = (): void => mainState.show();

  // D-116: an end-to-end test holds the start here, before the folder is read (slow on the first
  // start after an update), so the page asks main for its settings before main can answer.
  // Development builds only.
  const slowStart = BUILD === 'development' ? Number(process.env.FLINT_E2E_SLOW_START ?? 0) : 0;
  if (slowStart > 0) await new Promise((resolve) => setTimeout(resolve, slowStart));
  // Captures (CAP-01, CAP-02, CAP-05, D-27): every list loaded, drafts kept in app data.
  const workspace = await Workspace.open(
    folder.folder,
    join(app.getPath('userData'), 'ui-state.json'),
  );
  watchListFolder(folder.folder, (path) => {
    workspace.fileChanged(path).catch((error: unknown) => log(`reload failed: ${String(error)}`));
  });
  // MINI-01, D-109: mini mode, beside the main window and in sync with it (made on first use).
  const mini = createMini({
    url: pageUrl('mini', MINI_HOST),
    onTop: () => settingsFile.current.miniOnTop,
    hideFromSharing: () => settingsFile.current.miniHideFromSharing,
    onShown: () => tourEvent('mini-open'),
    onHidden: () => noteEditors.leaveAll('mini'),
    log,
  });
  /** D-109: which of Flint's two list windows sent something (null: neither). */
  const windowOf = (sender: Electron.WebContents): EditorWindow | null =>
    sender === mainWindow.webContents ? 'main' : mini.owns(sender) ? 'mini' : null;
  // M4: the main window's lists, read from and changed through the workspace; D-109: mini mode
  // reaches the same handlers (its preload exposes only the part it needs).
  const owns = (sender: Electron.WebContents): boolean => windowOf(sender) !== null;
  /** D-109: to both list windows. */
  const toWindows = (channel: string, ...args: unknown[]): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
    mini.send(channel, ...args);
  };
  const toWindow = (which: EditorWindow, channel: string, ...args: unknown[]): void => {
    if (which === 'mini') mini.send(channel, ...args);
    else if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
  };
  // D-109: one window edits a note at a time.
  const noteEditors = new NoteEditors({
    release: (to, noteId) => toWindow(to, Channels.noteRelease, noteId),
    live: (to, noteId, text) => toWindow(to, Channels.noteLive, noteId, text),
    editor: (noteId, editor) => toWindows(Channels.noteEditor, { noteId, editor }),
  });
  ipcMain.handle(Channels.noteClaim, (event, noteId: unknown) => {
    const which = windowOf(event.sender);
    return which && typeof noteId === 'string' ? noteEditors.claim(noteId, which) : false;
  });
  ipcMain.on(Channels.noteReleased, (event, noteId: unknown, text: unknown) => {
    const which = windowOf(event.sender);
    if (which && typeof noteId === 'string' && typeof text === 'string')
      noteEditors.released(noteId, which, text);
  });
  ipcMain.on(Channels.noteLive, (event, noteId: unknown, text: unknown) => {
    const which = windowOf(event.sender);
    if (which && typeof noteId === 'string' && typeof text === 'string')
      noteEditors.live(noteId, which, text);
  });
  ipcMain.handle(Channels.noteEditorOf, (event, noteId: unknown) =>
    owns(event.sender) && typeof noteId === 'string' ? noteEditors.owner(noteId) : null,
  );
  ipcMain.on(Channels.noteLeave, (event, noteId: unknown) => {
    const which = windowOf(event.sender);
    if (which && typeof noteId === 'string') noteEditors.leave(noteId, which);
  });
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) noteEditors.leaveAll('main');
  });
  // D-107, D-109: the first-few-times tips, counted in app data for both windows.
  const tips = new TipsFile(join(app.getPath('userData'), 'tips.json'));
  await tips.load();
  ipcMain.handle(Channels.tipDue, (event, name: unknown, times: unknown) =>
    owns(event.sender) && typeof name === 'string' && typeof times === 'number'
      ? tips.due(name, times)
      : false,
  );
  // APP-14, D-118, D-125: the tips: each once, at most two a session and ten minutes apart, none
  // in a session the walkthrough ran (or started in), none with Don't show tips.
  let tipsThisSession: number[] = [];
  ipcMain.handle(Channels.mainTipEvent, (event, tip: unknown) => {
    // End-to-end runs see tips only when they ask for onboarding (each starts as a fresh install).
    if (!owns(event.sender) || !isTipId(tip) || !onboardingOn) return false;
    const count = tips.bump(tip);
    return (
      count >= TIPS[tip].after &&
      !settingsFile.current.tipsOff &&
      tipAllowed(tipsThisSession, Date.now()) &&
      !tourThisSession
    );
  });
  ipcMain.handle(Channels.mainTipShown, (event, tip: unknown) => {
    if (!owns(event.sender) || !isTipId(tip)) return;
    tips.markShown(tip);
    tipsThisSession = [...tipsThisSession, Date.now()];
    log(`tip shown: ${tip}`);
  });
  // D-125: tests skip the ten minutes between two tips.
  const tipHooks = e2eHooks();
  if (tipHooks)
    tipHooks.tipGapPassed = () => {
      tipsThisSession = tipsThisSession.map((at) => at - TIP_GAP_MS);
    };
  // NAV-08, D-127, D-128: Windows' clipboard history, read-only, behind the crash marker. End-to-end
  // runs never read the real history: they set what it holds (D-93).
  const clipboardGuard = new ClipboardGuard(
    join(app.getPath('userData'), 'clipboard-reading'),
    (limit) => {
      const fake = e2eHooks();
      return fake
        ? Promise.resolve(fake.clipboardHistory ?? { kind: 'off' })
        : readClipboardHistory(limit);
    },
  );
  if (clipboardGuard.crashed)
    log('clipboard history: the last read never finished; reads are off until retried');
  app.on('before-quit', () => clipboardGuard.quitting());
  // D-129: a picture's bytes (a BMP as Windows hands it over; tests set them), read behind the
  // crash marker.
  const clipboardBmp = async (id: string): Promise<Uint8Array | null> => {
    const fake = e2eHooks();
    if (fake) {
      const base64 = fake.clipboardImages?.[id];
      return base64 ? Buffer.from(base64, 'base64') : null;
    }
    return clipboardGuard.act(() => readHistoryImage(id));
  };
  /** D-129: thumbnails by item id, made once and kept while the item is in the history. */
  const clipboardThumbs = new Map<string, string>();
  const clipboardThumb = async (id: string): Promise<string | null> => {
    const known = clipboardThumbs.get(id);
    if (known) return known;
    const bytes = await clipboardBmp(id);
    const picture = bytes ? decodeBmp(bytes) : null;
    if (!picture) return null;
    // Twice the 56 px it shows at (crisp at 200 %), at most 400 px wide.
    const small = shrink(picture, 400, 112);
    const thumb = nativeImage
      .createFromBitmap(Buffer.from(small.data), { width: small.width, height: small.height })
      .toDataURL();
    clipboardThumbs.set(id, thumb);
    return thumb;
  };
  const clipboardPng = async (id: string): Promise<Buffer | null> => {
    const bytes = await clipboardBmp(id);
    const picture = bytes ? decodeBmp(bytes) : null;
    return picture
      ? nativeImage
          .createFromBitmap(Buffer.from(picture.data), {
            width: picture.width,
            height: picture.height,
          })
          .toPNG()
      : null;
  };
  // D-128: what the section shows. The last items stay while a read runs; Windows' clipboard
  // sequence number says when something new was copied (only then is it read again); a state other
  // than the items (off, policy, an error) is looked at again at most every 5 s or on a new copy.
  // Windows answers only while Flint is in front, so a read waits for the main window's focus.
  let clipboardItems: { readonly sequence: number; readonly items: ClipboardItemView[] } | null =
    null;
  let clipboardOther: {
    readonly state: ClipboardView['state'];
    readonly sequence: number;
    readonly at: number;
  } | null = null;
  let clipboardReading: Promise<ClipboardView> | null = null;
  let clipboardLogged = '';
  const clipboardKind = (text: string): ClipboardItemView['kind'] =>
    /^\s*https?:\/\/\S+\s*$/i.test(text)
      ? 'link'
      : classifyPaste(text) === 'text'
        ? 'text'
        : 'code';
  const clipboardView = (retry: boolean): Promise<ClipboardView> => {
    const settings = settingsFile.current;
    const view = (
      state: ClipboardView['state'],
      items: readonly ClipboardItemView[] = clipboardItems?.items ?? [],
    ): ClipboardView => ({ state, items, showContents: settings.clipboardShowContents });
    if (!settings.clipboardHistory) return Promise.resolve(view('disabled', []));
    if (clipboardGuard.crashed && !retry) return Promise.resolve(view('paused'));
    const fake = e2eHooks();
    const sequence = fake ? (fake.clipboardSequence ?? 0) : clipboardSequence();
    if (!retry && clipboardOther?.sequence === sequence && Date.now() - clipboardOther.at < 5000)
      return Promise.resolve(view(clipboardOther.state));
    if (!retry && !clipboardOther && clipboardItems?.sequence === sequence)
      return Promise.resolve(view('ok'));
    // Tests: the window is never focused.
    if (!fake && !mainWindow.isFocused())
      return Promise.resolve(view(clipboardOther?.state ?? (clipboardItems ? 'ok' : 'loading')));
    clipboardReading ??= (async (): Promise<ClipboardView> => {
      const started = performance.now();
      const read = await clipboardGuard.read(25, retry);
      const ms = Math.round(performance.now() - started);
      let result: ClipboardView;
      if (read.kind === 'ok') {
        const items: ClipboardItemView[] = [];
        for (const item of read.items) {
          if (item.text !== null && item.text.trim() !== '')
            items.push({
              id: item.id,
              at: item.at,
              text: item.text,
              kind: clipboardKind(item.text),
            });
          else if (item.image) {
            // D-129: pictures as thumbnails (made once per item, kept while it is in the history).
            const thumb = await clipboardThumb(item.id);
            if (thumb) items.push({ id: item.id, at: item.at, text: '', kind: 'image', thumb });
          }
        }
        for (const id of clipboardThumbs.keys())
          if (!read.items.some((item) => item.id === id)) clipboardThumbs.delete(id);
        clipboardItems = { sequence, items };
        clipboardOther = null;
        result = view('ok', items);
      } else if (read.kind === 'denied') {
        // Not in front after all: the last items stay; read again next time.
        result = view(clipboardOther?.state ?? (clipboardItems ? 'ok' : 'loading'));
      } else {
        const state =
          read.kind === 'crashed'
            ? 'paused'
            : read.kind === 'off'
              ? (fake ? fake.clipboardPolicyOff === true : clipboardHistoryPolicyOff())
                ? 'policy'
                : 'off'
              : 'error';
        if (state === 'off' || state === 'policy') clipboardItems = null;
        clipboardOther = { state, sequence, at: Date.now() };
        result = view(state, state === 'error' ? (clipboardItems?.items ?? []) : []);
      }
      // The log says when the state changes (and every error), not every read.
      const said = read.kind === 'ok' ? `ok, ${result.items.length} items` : `${read.kind}`;
      if (said !== clipboardLogged || read.kind === 'unavailable') {
        clipboardLogged = said;
        log(
          `clipboard history: ${said}` +
            (read.kind === 'unavailable' ? ` (${read.reason})` : '') +
            `, ${ms} ms`,
        );
      }
      return result;
    })().finally(() => {
      clipboardReading = null;
    });
    return clipboardReading;
  };
  ipcMain.handle(Channels.mainClipboard, (event, retry: unknown): Promise<ClipboardView> | null =>
    owns(event.sender) ? clipboardView(retry === true) : null,
  );
  /** D-129: after a write the history is read again at the next ask (a delete keeps the number). */
  const clipboardStale = (): void => {
    clipboardItems = null;
    clipboardOther = null;
  };
  const clipboardItem = (id: unknown): ClipboardItemView | null =>
    typeof id === 'string' ? (clipboardItems?.items.find((item) => item.id === id) ?? null) : null;
  // D-129: a picture whole, as PNG (inserted as a pasted picture, captured, kept for Undo).
  ipcMain.handle(Channels.mainClipboardImage, async (event, id: unknown) => {
    if (!owns(event.sender) || clipboardItem(id)?.kind !== 'image') return null;
    const png = await clipboardPng(id as string);
    return png ? new Uint8Array(png) : null;
  });
  // D-129: Copy: the item becomes the clipboard's content again as Win+V's pick does (no new
  // entry); the only clipboard writes are on the user's explicit actions. Tests see the call.
  ipcMain.handle(Channels.mainClipboardCopy, async (event, id: unknown) => {
    if (!owns(event.sender) || !clipboardItem(id)) return 'gone';
    const hooks = e2eHooks();
    let done: 'ok' | 'gone' | 'failed' | null;
    if (hooks) {
      hooks.madeCurrent = [...(hooks.madeCurrent ?? []), id as string];
      done = 'ok';
    } else done = await clipboardGuard.act(() => makeHistoryItemCurrent(id as string));
    log(`clipboard: an item made current (${done ?? 'paused'})`);
    clipboardStale();
    return done ?? 'failed';
  });
  // D-129: Delete, also from Win+V (pinned or not); Undo adds it back as the newest item. What
  // Undo needs is kept in memory only, and only while it is offered.
  const clipboardUndo = new Map<
    string,
    { readonly text?: string; readonly png?: Buffer; readonly timer: NodeJS.Timeout }
  >();
  const UNDO_KEPT_MS = 10_000;
  ipcMain.handle(Channels.mainClipboardDelete, async (event, id: unknown) => {
    const item = owns(event.sender) ? clipboardItem(id) : null;
    if (!item) return null;
    const png = item.kind === 'image' ? await clipboardPng(item.id) : null;
    if (item.kind === 'image' && !png) return null;
    const hooks = e2eHooks();
    let deleted: boolean | null;
    if (hooks) {
      const held = hooks.clipboardHistory;
      deleted = held?.kind === 'ok' && held.items.some((each) => each.id === item.id);
      if (held?.kind === 'ok' && deleted) {
        hooks.clipboardHistory = {
          kind: 'ok',
          items: held.items.filter((each) => each.id !== item.id),
        };
        hooks.clipboardSequence = (hooks.clipboardSequence ?? 0) + 1;
      }
    } else deleted = await clipboardGuard.act(() => deleteHistoryItem(item.id));
    log(`clipboard: an item deleted (${deleted === true ? 'done' : 'not there'})`);
    clipboardStale();
    if (deleted !== true) return null;
    const token = randomUUID();
    const timer = setTimeout(() => clipboardUndo.delete(token), UNDO_KEPT_MS);
    clipboardUndo.set(token, png ? { png, timer } : { text: item.text, timer });
    return token;
  });
  ipcMain.handle(Channels.mainClipboardRestore, async (event, token: unknown) => {
    const kept = owns(event.sender) && typeof token === 'string' ? clipboardUndo.get(token) : null;
    if (!kept) return false;
    clipboardUndo.delete(token as string);
    clearTimeout(kept.timer);
    const hooks = e2eHooks();
    if (hooks) hooks.restored = [...(hooks.restored ?? []), kept.text ?? 'picture'];
    else if (kept.png)
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(kept.png)], { type: 'image/png' }),
        }),
      ]);
    else if (kept.text !== undefined) await clipboard.writeText(kept.text);
    log('clipboard: a deleted item added back');
    clipboardStale();
    return true;
  });
  // D-129: Clear all, as Win+V's (pinned items are kept); no undo, confirmed in the section.
  ipcMain.handle(Channels.mainClipboardClear, async (event) => {
    if (!owns(event.sender)) return false;
    const hooks = e2eHooks();
    let cleared: boolean | null;
    if (hooks) {
      hooks.clipboardHistory = { kind: 'ok', items: [] };
      hooks.clipboardSequence = (hooks.clipboardSequence ?? 0) + 1;
      cleared = true;
    } else cleared = await clipboardGuard.act(() => clearHistory());
    log(`clipboard: history cleared (${cleared === true ? 'done' : 'not done'})`);
    clipboardStale();
    return cleared === true;
  });
  ipcMain.handle(Channels.mainClipboardSettings, (event) => {
    if (!owns(event.sender)) return;
    const hooks = e2eHooks();
    if (hooks) hooks.opened.push('ms-settings:clipboard');
    else void shell.openExternal('ms-settings:clipboard');
  });
  ipcMain.handle(Channels.mainResetTips, async (event) => {
    if (!owns(event.sender)) return;
    tips.reset();
    tipsThisSession = [];
    await settingsFile.update({ tipsOff: false });
    log('tips reset');
  });
  ipcMain.handle(Channels.mainLists, (event) =>
    owns(event.sender) ? workspace.summaries(new Date()) : [],
  );
  ipcMain.handle(Channels.mainView, (event, id: unknown) =>
    owns(event.sender) && typeof id === 'string' ? workspace.view(id, new Date()) : null,
  );
  ipcMain.handle(Channels.mainToggle, (event, id: unknown, key: unknown) =>
    owns(event.sender) && typeof id === 'string' && typeof key === 'string'
      ? workspace.toggleDone(id, key, new Date()).catch((error: unknown) => {
          log(`could not change the task: ${String(error)}`);
          return null;
        })
      : null,
  );
  /** D-116: the walkthrough's steps 3, 5 and 6: shorthand typed, a task pinned, a reminder set. */
  const tourChange = (change: ListChange, now: Date): void => {
    if (!tour.running) return;
    if (change.kind === 'many') for (const each of change.changes) tourChange(each, now);
    else if (change.kind === 'add') {
      const parsed = workspace.parse(
        { text: change.text, chooseNewList: change.chooseNewList ?? false },
        now,
      );
      if (parsed.counts.priority + parsed.counts.reminder + parsed.counts.list > 0)
        tourEvent('shorthand');
      if (parsed.reminder) tourEvent('reminder');
    } else if (change.kind === 'pin' && change.pinned) tourEvent('pinned');
    else if (change.kind === 'reminder') tourEvent('reminder');
  };
  ipcMain.handle(Channels.mainChange, async (event, id: unknown, change: unknown) => {
    if (!owns(event.sender) || typeof id !== 'string' || typeof change !== 'object' || !change)
      return null;
    const now = new Date();
    const outcome = await workspace
      .change(id, change as ListChange, now)
      .catch((error: unknown) => {
        log(`could not change the list: ${String(error)}`);
        return null;
      });
    if (outcome) tourChange(change as ListChange, now);
    return outcome;
  });
  // UI-08: a text field's menu in any Flint window; the command runs on that window.
  ipcMain.on(Channels.editCommand, (event, command: unknown) => {
    const contents = event.sender;
    if (command === 'cut') contents.cut();
    else if (command === 'copy') contents.copy();
    else if (command === 'paste') contents.paste();
    else if (command === 'pasteAndMatchStyle') contents.pasteAndMatchStyle();
    else if (command === 'selectAll') contents.selectAll();
  });
  ipcMain.on(Channels.mainOpenLink, (event, href: unknown) => {
    if (!owns(event.sender) || typeof href !== 'string' || !isOpenableLink(href)) return;
    // Tests never open a browser on the machine running them.
    const hooks = e2eHooks();
    if (hooks) hooks.opened.push(href);
    else void shell.openExternal(href);
  });
  ipcMain.handle(Channels.mainListAction, (event, action: unknown) => {
    if (!owns(event.sender) || typeof action !== 'object' || action === null) return null;
    const request = action as ListAction;
    const now = new Date();
    const run =
      request.kind === 'new'
        ? request.group
          ? workspace.newListInGroup(request.name, request.mode, request.group, now)
          : workspace.newList(request.name, request.mode, now)
        : request.kind === 'rename'
          ? // NOTE-08, D-99: renaming a quick note gives it its title (a normal note).
            workspace.summaries(now).some((list) => list.id === request.id && list.quick)
            ? workspace.titleQuickNote(request.id, request.name, now)
            : workspace.renameList(request.id, request.name, now)
          : request.kind === 'duplicate'
            ? workspace.duplicateList(request.id, now)
            : request.kind === 'convert'
              ? workspace.convertList(request.id, request.mode, now)
              : request.kind === 'deleteMany'
                ? workspace.deleteLists(request.ids, now)
                : workspace.deleteList(request.id, now);
    return run
      .then((outcome) => {
        // D-122: the walkthrough's step 4: a named list or note, or a quick note given a title.
        if (outcome.ok && (request.kind === 'new' || request.kind === 'rename')) tourEvent('made');
        return outcome;
      })
      .catch((error: unknown) => {
        log(`list action failed: ${String(error)}`);
        return { ok: false, problem: 'Flint could not change the file' } as const;
      });
  });
  ipcMain.handle(Channels.mainAttach, (event, bytes: unknown, type: unknown) =>
    owns(event.sender) && bytes instanceof Uint8Array && typeof type === 'string'
      ? workspace.saveImage(bytes, type, new Date()).catch((error: unknown) => {
          log(`could not save the image: ${String(error)}`);
          return null;
        })
      : null,
  );
  // MEDIA-01, MEDIA-03, D-84: a dragged or pasted file: copied in, or linked when it's large.
  ipcMain.handle(Channels.mainAttachFile, (event, path: unknown): Promise<AttachOutcome | null> =>
    owns(event.sender) && typeof path === 'string'
      ? attachFile(path, folder.folder, new Date())
      : Promise.resolve(null),
  );
  ipcMain.handle(
    Channels.mainCopyIntoFlint,
    (event, link: unknown): Promise<AttachOutcome | null> =>
      owns(event.sender) && typeof link === 'string'
        ? copyIntoFlint(link, folder.folder, new Date())
        : Promise.resolve(null),
  );
  ipcMain.handle(Channels.mainAttachmentExists, async (event, link: unknown) => {
    if (!owns(event.sender) || typeof link !== 'string') return false;
    const path = linkedPath(link, folder.folder);
    return path
      ? stat(path).then(
          (info) => info.isFile(),
          () => false,
        )
      : false;
  });
  // D-84: opens an attachment in its default app: media and documents only; programs and scripts
  // never; anything else after asking.
  // MEDIA-02, D-87: a picture's menu. Only pictures: never a program (D-84).
  ipcMain.handle(Channels.mainImageAction, async (event, source: unknown, action: unknown) => {
    if (!owns(event.sender) || typeof source !== 'string') return false;
    if (action !== 'copy' && action !== 'show' && action !== 'open') return false;
    const path = /^app:\/\//i.test(source)
      ? (resolveMediaFile(source, folder.folder) ?? resolveLinkedFile(source))
      : linkedPath(source, folder.folder);
    // D-89: Show in folder works for any attachment; copying and opening here, for pictures.
    if (!path || (action !== 'show' && fileKind(path) !== 'image')) return false;
    const exists = await stat(path).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!exists) return false;
    if (action === 'copy') {
      const image = nativeImage.createFromPath(path);
      if (image.isEmpty()) return false;
      // Electron 45's clipboard: W3C-style items (as a PNG, which every app pastes).
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }),
        }),
      ]);
      return true;
    }
    // Tests never open Explorer or an app on the machine running them.
    const hooks = e2eHooks();
    if (hooks) {
      hooks.opened.push(`${action}:${path}`);
      return true;
    }
    if (action === 'show') shell.showItemInFolder(path);
    else return (await shell.openPath(path)) === '';
    return true;
  });
  ipcMain.handle(Channels.mainOpenAttachment, async (event, link: unknown) => {
    if (!owns(event.sender) || typeof link !== 'string') return 'refused';
    const path = linkedPath(link, folder.folder);
    if (!path) return 'refused';
    const exists = await stat(path).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!exists) return 'missing';
    const rule = openRule(path);
    if (rule === 'never') return 'refused';
    if (rule === 'ask') {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Open', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Open file',
        message: `Open “${path.split(/[\\/]/).pop() ?? path}”?`,
        detail:
          'Flint opens pictures, videos and documents by itself. This is another kind of file.',
      });
      if (answer.response !== 0) return 'cancelled';
    }
    // Tests never open a file's app on the machine running them.
    const hooks = e2eHooks();
    if (hooks) {
      hooks.opened.push(path);
      return 'opened';
    }
    const problem = await shell.openPath(path);
    return problem === '' ? 'opened' : 'refused';
  });
  // NAV-07, D-83, D-85: the context panel's "Up next": pins, reminders, recent captures.
  ipcMain.handle(Channels.mainUpNext, (event) =>
    owns(event.sender)
      ? upNext({ reminders: workspace.reminderTasks(), ...workspace.panelTasks() }, new Date())
      : [],
  );
  // NOTE-06, D-84: a note in monospace, on this machine.
  ipcMain.handle(Channels.mainNoteMono, async (event, id: unknown, on: unknown) => {
    if (!owns(event.sender) || typeof id !== 'string' || typeof on !== 'boolean') return;
    await workspace.setMono(id, on);
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(Channels.mainChanged);
  });
  // NOTE-09, D-141: a note in Source mode, on this machine; from the main window or mini.
  ipcMain.handle(Channels.mainNoteSource, async (event, id: unknown, on: unknown) => {
    if (!owns(event.sender) || typeof id !== 'string' || typeof on !== 'boolean') return;
    await workspace.setSource(id, on);
    toWindows(Channels.mainChanged);
  });
  // NOTE-07, D-84: the user's link patterns, for titles, bodies and notes.
  ipcMain.handle(Channels.mainLinkPatterns, (event) =>
    owns(event.sender) ? settingsFile.current.linkPatterns : [],
  );
  // NOTE-07, D-104: saved from Settings → Links (the tolerant reader keeps only usable ones).
  ipcMain.handle(Channels.mainSaveLinkPatterns, async (event, patterns: unknown) => {
    if (!owns(event.sender)) return null;
    const kept = readLinkPatterns(patterns);
    await settingsFile.update({ linkPatterns: kept });
    return kept;
  });
  // D-105: the built-ins turned off; and how much a pattern would link in the lists and notes.
  ipcMain.handle(Channels.mainBuiltInLinksOff, (event) =>
    owns(event.sender) ? settingsFile.current.builtInLinksOff : [],
  );
  ipcMain.handle(Channels.mainSetBuiltInLinksOff, async (event, off: unknown) => {
    if (!owns(event.sender) || !Array.isArray(off)) return null;
    const kept = off.filter((id): id is string => typeof id === 'string');
    await settingsFile.update({ builtInLinksOff: kept });
    return kept;
  });
  // APP-03, D-106: Quit Flint from the palette (explicit, as the tray's).
  ipcMain.on(Channels.mainQuit, (event) => {
    if (owns(event.sender)) app.quit();
  });
  // NAV-01, D-106: the Ctrl+K palette's search.
  ipcMain.handle(Channels.mainSearch, async (event, query: unknown, scope: unknown) => {
    if (!owns(event.sender) || typeof query !== 'string' || query.trim() === '') return [];
    if (scope === 'trash') return searchTrash(await workspace.trashView(), query);
    const now = new Date();
    const views = workspace
      .summaries(now)
      .map((list) => workspace.view(list.id, now))
      .filter((view): view is ListView => view !== null);
    return searchLists(views, query);
  });
  ipcMain.handle(Channels.mainCountLinkMatches, (event, pattern: unknown) => {
    if (!owns(event.sender)) return 0;
    const compiled = compileLinkPatterns(readLinkPatterns([pattern]));
    if (compiled.length === 0) return 0;
    let count = 0;
    for (const text of workspace.texts()) count += findShortForms(text, compiled).length;
    return count;
  });
  // NOTE-02, D-82: Insert ▸ Image: a picture from the file picker, copied into attachments/.
  ipcMain.handle(Channels.mainPickImage, async (event) => {
    if (!owns(event.sender)) return null;
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Insert image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const type = PICKED_TYPES[extname(file).toLowerCase()];
    if (!type) return null;
    try {
      return await workspace.saveImage(new Uint8Array(await readFile(file)), type, new Date());
    } catch (error) {
      log(`could not insert the image: ${String(error)}`);
      return null;
    }
  });
  ipcMain.handle(Channels.mainSidebar, (event) =>
    owns(event.sender) ? workspace.sidebar() : null,
  );
  ipcMain.handle(Channels.mainSidebarAction, (event, action: unknown) => {
    if (!owns(event.sender) || typeof action !== 'object' || action === null) return null;
    return workspace
      .sidebarAction(action as SidebarAction, new Date())
      .then((outcome) => {
        // D-122: step 4: a new group.
        if (outcome.ok && (action as SidebarAction).kind === 'newGroup') tourEvent('made');
        return outcome;
      })
      .catch((error: unknown) => {
        log(`sidebar change failed: ${String(error)}`);
        return { ok: false, problem: 'Flint could not change the sidebar' } as const;
      });
  });
  ipcMain.handle(Channels.mainSaveNote, async (event, id: unknown, text: unknown) => {
    if (!owns(event.sender) || typeof id !== 'string' || typeof text !== 'string') return null;
    const now = new Date();
    const outcome = await workspace.saveNote(id, text, now).catch((error: unknown) => {
      log(`could not save the note: ${String(error)}`);
      return { ok: false, problem: 'Flint could not save the note' } as const;
    });
    // D-122: step 4: a quick note with something in it (an empty one opened isn't "made").
    if (
      outcome.ok &&
      tour.running &&
      tour.currentStep === 3 &&
      text.trim() !== '' &&
      workspace.summaries(now).some((list) => list.id === outcome.listId && list.quick)
    )
      tourEvent('made');
    return outcome;
  });
  ipcMain.handle(Channels.mainReserveId, (event) =>
    owns(event.sender) ? workspace.reserveId() : null,
  );
  ipcMain.handle(Channels.mainUndo, (event) =>
    owns(event.sender)
      ? workspace.undoLast(new Date()).catch((error: unknown) => {
          log(`undo failed: ${String(error)}`);
          return null;
        })
      : null,
  );

  ipcMain.handle(Channels.mainRedo, (event) =>
    owns(event.sender)
      ? workspace.redoLast(new Date()).catch((error: unknown) => {
          log(`redo failed: ${String(error)}`);
          return null;
        })
      : null,
  );
  workspace.onChange(() => toWindows(Channels.mainChanged));
  // TODAY-01, D-85: completed pinned tasks lose their pin once their day is over. TASK-06, D-88:
  // with auto-archive on, old completed tasks go to the archive at the same moments.
  let archiveDays = settings.autoArchiveDays;
  const archive = (): Promise<number> =>
    archiveDays === null
      ? Promise.resolve(0)
      : workspace.archiveDone(new Date(), archiveDays).catch((error: unknown) => {
          log(`archive failed: ${String(error)}`);
          return 0;
        });
  // DATA-02, MEDIA-04, D-97: the trash's 30 days, and (at start-up only) orphaned attachments.
  let started = false;
  const unpin = (): Promise<unknown> => {
    const unpinned = workspace
      .unpinDone(new Date())
      .catch((error: unknown) => log(`unpin failed: ${String(error)}`));
    void archive();
    // NOTE-08, D-102: quick notes titled before today become normal notes.
    workspace
      .settleQuickNotes(new Date())
      .then((count) => {
        if (count > 0) log(`${count} titled quick note(s) became notes`);
      })
      .catch((error: unknown) => log(`quick notes not settled: ${String(error)}`));
    const orphans = !started;
    started = true;
    workspace
      .expireTrash(new Date(), orphans)
      .then(({ expired, orphans: removed }) => {
        if (expired > 0) log(`removed ${expired} item(s) older than 30 days from the trash`);
        if (removed.length > 0) log(`removed unused attachments: ${removed.join(', ')}`);
      })
      .catch((error: unknown) => log(`trash expiry failed: ${String(error)}`));
    return unpinned;
  };
  ipcMain.handle(Channels.mainAutoArchive, (event) => (owns(event.sender) ? archiveDays : null));
  // DATA-04, D-97: snapshots of the Flint folder in app data, taken every hour when something
  // changed (and a minute after start-up), kept as Q-05 says; restored from the Snapshots view.
  const snapshotStore = new SnapshotStore(
    folder.folder,
    join(dirname(app.getPath('logs')), 'snapshots'),
  );
  const snapshot = (): void => {
    snapshotStore
      .take(new Date())
      .then((taken) => {
        if (taken) log(`snapshot ${taken.id}`);
        return snapshotStore.prune(new Date(), {
          hourlyHours: settingsFile.current.keepHourlyHours,
          dailyDays: settingsFile.current.keepDailyDays,
        });
      })
      .catch((error: unknown) => log(`snapshot failed: ${String(error)}`));
  };
  const testHooks = e2eHooks();
  setTimeout(snapshot, testHooks ? 1000 : 60_000);
  // D-100: as often as Settings says (an hour by default).
  let snapshotTimer = setInterval(snapshot, settingsFile.current.snapshotEveryMinutes * 60_000);
  const reschedule = (): void => {
    clearInterval(snapshotTimer);
    snapshotTimer = setInterval(snapshot, settingsFile.current.snapshotEveryMinutes * 60_000);
  };
  if (testHooks)
    testHooks.snapshot = () => snapshotStore.take(new Date()).then((taken) => taken?.id ?? null);
  ipcMain.handle(Channels.mainSnapshots, (event) =>
    owns(event.sender) ? workspace.snapshots(snapshotStore) : [],
  );
  ipcMain.handle(Channels.mainSnapshotFiles, (event, id: unknown) =>
    owns(event.sender) && typeof id === 'string' ? workspace.snapshotFiles(snapshotStore, id) : [],
  );
  ipcMain.handle(Channels.mainSnapshotRestore, (event, id: unknown, path: unknown) =>
    owns(event.sender) && typeof id === 'string' && (typeof path === 'string' || path === null)
      ? workspace.restoreSnapshot(snapshotStore, id, path, new Date()).catch((error: unknown) => {
          log(`snapshot restore failed: ${String(error)}`);
          return null;
        })
      : null,
  );
  ipcMain.handle(Channels.mainSnapshotDiff, (event, id: unknown, path: unknown) =>
    owns(event.sender) && typeof id === 'string' && typeof path === 'string'
      ? workspace.snapshotDiff(snapshotStore, id, path)
      : null,
  );
  ipcMain.handle(
    Channels.mainSnapshotRestoreTasks,
    (event, id: unknown, path: unknown, keys: unknown) =>
      owns(event.sender) &&
      typeof id === 'string' &&
      typeof path === 'string' &&
      Array.isArray(keys) &&
      keys.every((key) => typeof key === 'string')
        ? workspace
            .restoreSnapshotTasks(snapshotStore, id, path, keys, new Date())
            .catch((error: unknown) => {
              log(`restoring tasks from a snapshot failed: ${String(error)}`);
              return null;
            })
        : null,
  );
  // APP-11, D-100: Settings: what it shows, and each change applied at once.
  const settingsView = (): SettingsView => {
    const current = settingsFile.current;
    return {
      startWithWindows: current.startWithWindows,
      notifications: current.notifications,
      reminderSound: current.reminderSound,
      hideNotificationText: current.hideNotificationText,
      rolloverPrompt: current.rolloverPrompt,
      autoArchiveDays: archiveDays,
      snapshotEveryMinutes: current.snapshotEveryMinutes,
      keepHourlyHours: current.keepHourlyHours,
      keepDailyDays: current.keepDailyDays,
      animationSpeed: current.animationSpeed,
      flintFolder: folder.folder,
      captureHotkey: current.captureHotkey,
      captureSelectionHotkey: current.captureSelectionHotkey,
      miniHotkey: current.miniHotkey,
      miniHideFromSharing: current.miniHideFromSharing,
      popupHideFromSharing: current.popupHideFromSharing,
      miniReminders: current.miniReminders,
      version: app.getVersion(),
      tipsOff: current.tipsOff,
      clipboardHistory: current.clipboardHistory,
      clipboardShowContents: current.clipboardShowContents,
      checkForUpdates: current.checkForUpdates,
    };
  };
  // APP-10, APP-15, D-117, D-119: what onboarding shows on this start, and the tour's progress.
  ipcMain.handle(Channels.mainOnboarding, (event): OnboardingState | null => {
    if (!owns(event.sender)) return null;
    const state: OnboardingState = {
      visible: mainWindow.isVisible(),
      tourFrom,
      interrupted: tourInterrupted,
      whatsNew:
        whatsNewDue && settingsFile.current.lastSeenVersion !== app.getVersion()
          ? whatsNewDue
          : null,
      version: app.getVersion(),
    };
    // Said once (a reloaded page doesn't say it again).
    tourInterrupted = false;
    return state;
  });
  ipcMain.handle(Channels.mainTour, async (event, action: unknown): Promise<string | null> => {
    if (!owns(event.sender) || typeof action !== 'object' || action === null) return null;
    const { kind } = action as TourAction;
    if (kind === 'start') {
      await tour.start(workspace.tourBaseline());
      tourFrom = 0;
      tourThisSession = true;
      log('walkthrough started');
    } else if (kind === 'step') {
      const { step } = action as Extract<TourAction, { kind: 'step' }>;
      if (typeof step === 'number' && Number.isInteger(step) && step >= 0) {
        await tour.step(step);
        tourFrom = step;
      }
    } else if (kind === 'end') {
      await tour.end();
      tourFrom = null;
      log('walkthrough ended');
    } else if (kind === 'remove') {
      const baseline = tour.baseline;
      const label = baseline ? await workspace.removeMadeSince(baseline, new Date()) : null;
      await tour.end();
      tourFrom = null;
      log(`walkthrough ended: ${label ?? 'nothing to remove'}`);
      return label;
    }
    return null;
  });
  ipcMain.handle(Channels.mainWhatsNewSeen, async (event) => {
    if (!owns(event.sender)) return;
    await settingsFile.update({ lastSeenVersion: app.getVersion() });
  });
  workspace.rolloverPrompt = settingsFile.current.rolloverPrompt;
  ipcMain.handle(Channels.mainSettings, (event) => (owns(event.sender) ? settingsView() : null));
  ipcMain.handle(Channels.mainSetSetting, async (event, change: unknown) => {
    if (!owns(event.sender) || typeof change !== 'object' || change === null) return null;
    const { key, value } = change as SettingChange;
    if (key === 'autoArchiveDays') {
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1))
        return settingsView();
      archiveDays = value;
      await settingsFile.update({ autoArchiveDays: value });
      void archive();
      return settingsView();
    }
    const before = settingsFile.current;
    await settingsFile.update({ [key]: value });
    const after = settingsFile.current;
    if (before[key] === after[key] && after[key] !== value) return settingsView();
    if (key === 'startWithWindows' && BUILD === 'installed')
      applyStartWithWindows(after.startWithWindows);
    if (key === 'rolloverPrompt') {
      workspace.rolloverPrompt = after.rolloverPrompt;
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(Channels.mainChanged);
    }
    if (key === 'snapshotEveryMinutes') reschedule();
    // D-136: the automatic checks stop, or start again from the last check.
    if (key === 'checkForUpdates') updates?.automaticChanged();
    // D-109: left out of screen shares, or not, at once.
    if (key === 'miniHideFromSharing') mini.setHideFromSharing(after.miniHideFromSharing);
    if (key === 'popupHideFromSharing') hideFromSharing(after.popupHideFromSharing);
    if (key === 'keepHourlyHours' || key === 'keepDailyDays') snapshot();
    // D-110: both windows' motion follows it.
    if (key === 'animationSpeed')
      toWindows(Channels.mainAppearance, { animationSpeed: after.animationSpeed });
    log(`setting ${key} is now ${JSON.stringify(after[key])}`);
    return settingsView();
  });
  ipcMain.handle(Channels.mainSnapshotSpace, (event) =>
    owns(event.sender) ? snapshotStore.size() : 0,
  );
  ipcMain.handle(Channels.mainClearSnapshots, async (event) => {
    if (!owns(event.sender)) return 0;
    const removed = await snapshotStore.clearOld();
    log(`cleared ${removed} old snapshot(s)`);
    return removed;
  });
  ipcMain.handle(Channels.mainOpenFolder, async (event, which: unknown) => {
    if (!owns(event.sender)) return;
    const path = which === 'logs' ? app.getPath('logs') : which === 'flint' ? folder.folder : null;
    if (path) await shell.openPath(path);
  });
  /** D-97: the tray's Restore from a snapshot…: the main window, on the Snapshots view. */
  const showSnapshots = (): void => {
    showMain();
    const send = (): void => mainWindow.webContents.send(Channels.mainShowSnapshots);
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
    else send();
  };
  // DATA-07, D-104: changing the Flint folder: a folder chosen, then moved to, started fresh in,
  // or opened; Flint restarts on it (every watcher, reminder and timer starts clean).
  ipcMain.handle(Channels.mainChooseFolder, async (event) => {
    if (!owns(event.sender)) return null;
    let path = testHooks?.pickFolder || null;
    if (path === null) {
      const picked = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a folder for Flint',
        defaultPath: dirname(folder.folder),
        properties: ['openDirectory', 'createDirectory'],
      });
      path = picked.canceled ? null : (picked.filePaths[0] ?? null);
    }
    if (path === null) return null;
    return { ...(await checkFolder(path, folder.folder)), current: folder.folder };
  });
  // TASK-18, D-151: Give to Claude. Flint hands Windows a claude:// link it builds itself from the
  // prompt and the folder; tests record it (and what would be copied) instead, and never ask
  // Windows whether Claude is installed.
  const claudeInstalled = (): boolean =>
    testHooks
      ? testHooks.claudeMissing !== true
      : app.getApplicationNameForProtocol('claude://') !== '';
  const currentClaudeState = (): Promise<ClaudeState> =>
    claudeState(settingsFile.current, folder.folder, claudeInstalled());
  ipcMain.handle(Channels.mainClaudeState, (event) =>
    owns(event.sender) ? currentClaudeState() : null,
  );
  ipcMain.handle(Channels.mainClaudeChooseFolder, async (event, near: unknown) => {
    if (!owns(event.sender)) return null;
    if (testHooks && 'pickClaudeFolder' in testHooks) return testHooks.pickClaudeFolder ?? null;
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for Claude',
      ...(isAbsoluteFolder(near) ? { defaultPath: near } : {}),
      properties: ['openDirectory'],
    });
    const path = picked.canceled ? null : (picked.filePaths[0] ?? null);
    return isAbsoluteFolder(path) ? path : null;
  });
  ipcMain.handle(Channels.mainClaudeSetFolder, async (event, list: unknown, path: unknown) => {
    if (!owns(event.sender) || typeof list !== 'string' || list === '') return null;
    if (path !== null && !isAbsoluteFolder(path)) return null;
    await settingsFile.update({
      claudeFolders: withFolder(settingsFile.current.claudeFolders, list, path),
    });
    return currentClaudeState();
  });
  ipcMain.handle(Channels.mainClaudeClearRecent, async (event) => {
    if (!owns(event.sender)) return null;
    await settingsFile.update({ claudeRecentFolders: [] });
    return currentClaudeState();
  });
  ipcMain.handle(Channels.mainGiveToClaude, async (event, value: unknown) => {
    if (!owns(event.sender)) return null;
    const request = readGiveRequest(value);
    if (!request) return null;
    const { outcome, changes } = await giveToClaude(request, settingsFile.current, {
      installed: claudeInstalled,
      open: async (url) => {
        // Only the link `planHandoff` built: claude://code/new, nothing else (D-151).
        if (!url.startsWith('claude://code/new?')) throw new Error('not a Claude link');
        if (testHooks) testHooks.opened.push(url);
        else await shell.openExternal(url);
      },
      copy: async (text) => {
        // D-93: tests never touch the real clipboard.
        if (testHooks) (testHooks.copied ??= []).push(text);
        else await clipboard.writeText(text);
      },
    });
    if (changes) await settingsFile.update(changes);
    log(`give to Claude: ${outcome}`);
    return outcome;
  });
  ipcMain.handle(Channels.mainChangeFolder, async (event, path: unknown, how: unknown) => {
    if (
      !owns(event.sender) ||
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      (how !== 'move' && how !== 'fresh' && how !== 'open')
    )
      return null;
    const check = await checkFolder(path, folder.folder);
    if (check.refused) return { ok: false, problem: check.refused };
    if (how === 'open' && check.state !== 'flint')
      return { ok: false, problem: 'That folder has no Flint lists.' };
    if (how !== 'open' && check.state === 'flint')
      return { ok: false, problem: 'That folder already has Flint lists: open them instead.' };
    if (how === 'move') {
      const clash = await clashes(folder.folder, path);
      if (clash)
        return {
          ok: false,
          problem: `“${clash}” is already there. Use a Flint subfolder instead.`,
        };
      const copied = await copyFlintFolder(folder.folder, path);
      if (!copied.ok) {
        log(`Flint folder not moved: ${copied.problem ?? ''}`);
        return { ok: false, problem: copied.problem ?? 'Flint could not move its folder.' };
      }
      log(`Flint folder copied to ${path}: ${copied.files} files, checked`);
    } else if (how === 'fresh') await mkdir(path, { recursive: true });
    await settingsFile.update({ flintFolder: path });
    // D-119: a walkthrough goes on after the restart (step 1's Change…: at step 2).
    if (tour.running) await tour.restartAt(Math.max(1, tour.currentStep));
    log(`Flint folder is now ${path} (${how}); restarting`);
    if (testHooks) {
      testHooks.relaunched = path;
      return { ok: true };
    }
    // A moment for Settings to say so, then a new Flint on the new folder, back on Settings.
    setTimeout(() => {
      app.relaunch({
        args: [
          ...process.argv
            .slice(1)
            .filter((argument) => argument !== '--hidden' && argument !== '--show-settings'),
          '--show-settings',
        ],
      });
      app.quit();
    }, 900);
    return { ok: true };
  });
  // D-104: back from that restart: on Settings.
  if (process.argv.includes('--show-settings') && tourAtStart.from === null) {
    showMain();
    const send = (): void => mainWindow.webContents.send(Channels.mainShowSettings, 'general');
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
    else send();
  }
  if (testHooks) {
    testHooks.showSnapshots = () => showSnapshots();
    testHooks.exportTo = (path) => zipFolder(folder.folder, path);
  }
  // NOTE-08, D-99: quick notes: a new one, and an empty one left behind.
  ipcMain.handle(Channels.mainQuickNote, (event) =>
    owns(event.sender) ? workspace.newQuickNote(new Date()) : null,
  );
  ipcMain.handle(Channels.mainKeepQuickNote, (event, id: unknown) =>
    owns(event.sender) && typeof id === 'string'
      ? workspace.keepQuickNote(id, null, new Date())
      : null,
  );
  ipcMain.on(Channels.mainQuickNoteOpened, (event, id: unknown) => {
    if (owns(event.sender) && typeof id === 'string') workspace.quickNoteOpened(id);
  });
  ipcMain.handle(Channels.mainDiscardQuickNote, (event, id: unknown) =>
    // D-131: kept when a window has it open again by then (the main window went back, or mini).
    owns(event.sender) && typeof id === 'string'
      ? workspace.discardQuickNote(id, () => noteEditors.owner(id) === null)
      : false,
  );
  // D-99: Export, from Trash's header until Settings → Data (M8).
  ipcMain.handle(Channels.mainExport, (event) => (owns(event.sender) ? exportFolder() : undefined));
  /** DATA-05, D-97, D-99: Export Flint folder…: a zip where the user chooses. */
  const exportFolder = async (): Promise<void> => {
    const two = (value: number): string => String(value).padStart(2, '0');
    const now = new Date();
    const name = `Flint ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.zip`;
    const chosen = await dialog.showSaveDialog({
      title: 'Export Flint folder',
      defaultPath: join(app.getPath('documents'), name),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (chosen.canceled || !chosen.filePath) return;
    try {
      const count = await zipFolder(folder.folder, chosen.filePath);
      log(`exported ${count} files to ${chosen.filePath}`);
      shell.showItemInFolder(chosen.filePath);
    } catch (error) {
      log(`export failed: ${String(error)}`);
      dialog.showErrorBox('Flint', `The Flint folder couldn't be exported: ${String(error)}`);
    }
  };
  // DATA-02, TASK-06, D-97: the Trash view and what it does.
  ipcMain.handle(Channels.mainTrash, (event) =>
    owns(event.sender) ? workspace.trashView() : { deleted: [], archived: [] },
  );
  ipcMain.handle(Channels.mainTrashRestore, (event, id: unknown) =>
    owns(event.sender) && typeof id === 'string'
      ? workspace.restoreFromTrash(id, new Date()).catch((error: unknown) => {
          log(`restore from the trash failed: ${String(error)}`);
          return null;
        })
      : null,
  );
  ipcMain.handle(Channels.mainTrashPreview, (event, id: unknown) =>
    owns(event.sender) && typeof id === 'string' ? workspace.trashPreview(id) : null,
  );
  ipcMain.handle(Channels.mainTrashDelete, (event, id: unknown) =>
    owns(event.sender) && typeof id === 'string' ? workspace.deleteFromTrash(id) : false,
  );
  ipcMain.handle(Channels.mainTrashEmpty, (event) =>
    owns(event.sender) ? workspace.emptyTrash() : 0,
  );
  ipcMain.handle(Channels.mainArchiveRestore, (event, listId: unknown, key: unknown) =>
    owns(event.sender) && typeof listId === 'string' && typeof key === 'string'
      ? workspace.restoreArchived(listId, key, new Date()).catch((error: unknown) => {
          log(`restore from the archive failed: ${String(error)}`);
          return null;
        })
      : null,
  );
  // TODAY-02 (M6): the rollover prompt's answer; Clear's label for the toast.
  ipcMain.handle(Channels.mainTodayAnswer, (event, clear: unknown) =>
    owns(event.sender) ? workspace.todayAnswer(clear === true, new Date()) : null,
  );
  ipcMain.handle(Channels.mainSetAutoArchive, async (event, days: unknown) => {
    if (!owns(event.sender)) return 0;
    if (days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < 1))
      return 0;
    archiveDays = days;
    await settingsFile.update({ autoArchiveDays: days });
    return archive();
  });
  /**
   * D-107: the day change, at midnight itself (and checked every minute and on waking from sleep,
   * should the clock jump): done pins lose their pin, then the window reads every view again, so
   * Today shows the new day's rollover card and reminders at once, not up to two minutes later.
   */
  let pinDay = new Date().toDateString();
  void unpin();
  const newDay = (): void => {
    const day = new Date().toDateString();
    if (day === pinDay) return;
    pinDay = day;
    void unpin().finally(() => toWindows(Channels.mainChanged));
  };
  setInterval(newDay, 60_000).unref();
  const atMidnight = (): void => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 200);
    setTimeout(() => {
      newDay();
      atMidnight();
    }, next.getTime() - now.getTime()).unref();
  };
  atMidnight();
  powerMonitor.on('resume', newDay);

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
    linkPatterns: settingsFile.current.linkPatterns,
    builtInLinksOff: settingsFile.current.builtInLinksOff,
  });

  // D-138: a quit waits (at most 3 s) for what is still being written: a capture handed over a
  // moment ago, the draft Esc just sent, a list change, the pins and Today's order.
  const capturesInFlight = new Set<Promise<void>>();
  let savedForQuit = false;
  app.on('before-quit', (event) => {
    if (savedForQuit) return;
    savedForQuit = true;
    event.preventDefault();
    log('quitting: saving what is still being written');
    const saved = Promise.allSettled([drafts.settled(), workspace.settled(), ...capturesInFlight]);
    const cap = new Promise((resolve) => setTimeout(resolve, 3000));
    void Promise.race([saved, cap]).then(() => app.quit());
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
        const diskMs = epochNow() - capture.keyAt;
        log(
          `capture saved to ${outcome.listName}; Enter → durably on disk ${diskMs.toFixed(1)} ms`,
        );
        // D-137: the performance check reads it (05 §4: < 100 ms at p95).
        e2eHooks()?.captureDiskMs?.push(diskMs);
        notice = outcome.createdList
          ? {
              popup: { kind: 'created-list', name: outcome.createdList.name },
              undo: outcome.createdList,
            }
          : null;
      }
      await drafts.clearIf(capture.draft, attachments);
      e2eHooks()?.captured.push(capture.text);
      if (outcome.kind === 'saved') tourEvent('captured');
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
      // D-137: the performance check's strict half of D-27 (< 50 ms).
      e2eHooks()?.captureHiddenMs?.push(capture.returnedAt - capture.keyAt);
      capturedWaiters.splice(0).forEach((resolve) => resolve(capture));
      const saving = saveCapture(capture);
      capturesInFlight.add(saving);
      void saving.finally(() => capturesInFlight.delete(saving));
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
  if (hooks) {
    let kept: Awaited<ReturnType<typeof saveClipboard>> = null;
    hooks.saveClipboard = async () => {
      kept = await saveClipboard();
    };
    hooks.restoreClipboard = async () => {
      await restoreClipboard(kept);
      kept = null;
    };
  }

  recoverFromCrashes(popup.window, 'capture popup', log);
  // D-109: the capture popup is left out of screen shares too (on by default).
  const hideFromSharing = (hidden: boolean): void => popup.window.setContentProtection(hidden);
  hideFromSharing(settingsFile.current.popupHideFromSharing);

  // D-41: the capture hotkey opens the popup, brings the cursor back to one that stayed open, and
  // closes one that has it (the draft is kept, like Esc).
  const onCaptureHotkey = (): void => {
    if (popup.isFocused()) popup.hide();
    else popup.show(epochNow());
  };

  // D-39: the popup with text to capture: a closed popup starts fresh (its draft is set aside as
  // the previous draft); an open one collects the text below what it already has.
  const capturePrefilled = (text: string | null, at: number, png?: Buffer): Promise<void> => {
    const fresh = !popup.window.isVisible();
    const ready = fresh ? drafts.setAside() : Promise.resolve();
    return ready.then(async () => {
      if (fresh) popupHasContent = false;
      // D-129: a picture goes in as a pasted one would: an attachment chip.
      if (png) await drafts.attach(new Uint8Array(png), 'image/png');
      popup.show(at, { ...(text !== null && { prefill: text }), replaceDraft: fresh });
    });
  };
  // NAV-08, D-128: a clipboard history item captured as a task: as Ctrl+Shift+X would (D-45).
  ipcMain.handle(Channels.mainClipboardCapture, async (event, id: unknown) => {
    const item = owns(event.sender) ? clipboardItem(id) : null;
    if (!item) return;
    log('clipboard: an item captured');
    if (item.kind !== 'image') {
      await capturePrefilled(item.text, epochNow());
      return;
    }
    const png = await clipboardPng(item.id);
    if (png) await capturePrefilled(null, epochNow(), png);
  });

  // CAP-07, R-2: copy what is selected in the app in front, then open the popup with it.
  let selecting = false;
  const onSelectionHotkey = (): void => {
    const keys = acceleratorKeys(hotkeys.get('selection').accelerator);
    if (selecting || !keys) return;
    selecting = true;
    const hotkeyAt = epochNow();
    captureSelection(keys)
      .then((selection) => {
        log(`capture-selection: ${selection.kind}`);
        if (selection.kind === 'text') return capturePrefilled(selection.text, hotkeyAt);
        if (selection.kind === 'elevated') {
          popup.show(hotkeyAt, {
            hint: "Couldn't read selection from an admin window; paste with Ctrl+V",
          });
          // D-68: nothing selected just opens the popup, without a message.
        } else popup.show(hotkeyAt);
        return undefined;
      })
      .catch((error: unknown) => {
        log(`capture-selection failed: ${String(error)}`);
        popup.show(hotkeyAt, { hint: "Couldn't read the selection; paste with Ctrl+V" });
      })
      .finally(() => {
        selecting = false;
      });
  };

  // APP-08: the hotkeys, rebindable with conflict detection; D-109: mini mode's third.
  const hotkeys = new HotkeyRegistry(
    {
      capture: settings.captureHotkey,
      selection: settings.captureSelectionHotkey,
      mini: settings.miniHotkey,
    },
    { capture: onCaptureHotkey, selection: onSelectionHotkey, mini: () => mini.toggle() },
  );
  /** A hotkey another app owns must never fail silently: the tray says so (APP-08). */
  const hotkeyWarning = (): string | null => {
    const capture = hotkeys.get('capture');
    const selection = hotkeys.get('selection');
    if (!capture.registered)
      return `${displayAccelerator(capture.accelerator)} is taken: change the capture hotkey…`;
    if (!selection.registered)
      return `${displayAccelerator(selection.accelerator)} is taken: change the selection hotkey…`;
    const miniKey = hotkeys.get('mini');
    if (!miniKey.registered)
      return `${displayAccelerator(miniKey.accelerator)} is taken: change the mini mode hotkey…`;
    return null;
  };
  for (const name of ['capture', 'selection', 'mini'] as const) {
    const state = hotkeys.get(name);
    log(
      state.registered
        ? `${name} hotkey ${state.accelerator} registered`
        : `${name} hotkey ${state.accelerator} is already used by another app`,
    );
  }

  const tray = createTray({
    open: showMain,
    capture: () => popup.show(epochNow()),
    mini: () => mini.toggle(),
    settings: (section) => {
      showMain();
      const send = (): void => mainWindow.webContents.send(Channels.mainShowSettings, section);
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
      else send();
    },
    quit: () => app.quit(),
    restartToUpdate: () => updates?.restart(),
  });
  // APP-06, D-136: updates from GitHub Releases. Installed builds only; test runs get a fake that
  // contacts nothing; development and benchmark builds have none (Settings says so).
  let updates: UpdateService | null = null;
  const updateHooks = e2eHooks();
  const sendUpdates = (view: UpdateView): void => {
    tray.setUpdateReady(view.phase === 'ready' ? view.version : null);
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(Channels.mainUpdatesChanged, view);
  };
  const updaterForBuild = async (): Promise<UpdaterLike | null> => {
    if (updateHooks) {
      const fake = testUpdater(() => app.quit());
      updateHooks.updater = fake.record;
      updateHooks.trayLabels = () => tray.labels();
      return fake.updater;
    }
    if (!UPDATES) return null;
    const { autoUpdater } = (await import('electron-updater')).default;
    autoUpdater.logger = {
      info: (message: unknown) => log(`updater: ${String(message)}`),
      warn: (message: unknown) => log(`updater warning: ${String(message)}`),
      error: (message: unknown) => log(`updater error: ${String(message)}`),
      debug: () => {},
    };
    return autoUpdater;
  };
  void updaterForBuild()
    .then((updater) => {
      updates = new UpdateService({
        updater,
        automatic: () => settingsFile.current.checkForUpdates,
        now: () => Date.now(),
        log,
        changed: sendUpdates,
        beforeInstall: (version) => {
          quitting = true;
          // D-140: nothing frozen on screen: the windows go at once, and Windows' first check of
          // the new installer and Flint (half a minute each, unsigned) happens out of sight.
          if (!mainWindow.isDestroyed()) mainWindow.hide();
          if (mini.visible()) mini.hide();
          if (!popup.window.isDestroyed()) popup.window.hide();
          const body = `Flint reopens by itself in about a minute (Windows checks the new version the first time it runs).`;
          if (updateHooks) updateHooks.toasts.push(`Updating Flint to ${version} | ${body}`);
          else if (Notification.isSupported())
            new Notification({ title: `Updating Flint to ${version}`, body, silent: true }).show();
          log(`update notice shown: Updating Flint to ${version}, the windows hidden`);
        },
      });
      sendUpdates(updates.view());
      // Test runs check only when a test asks.
      if (!updateHooks) updates.start();
    })
    .catch((error: unknown) => log(`updater not set up: ${String(error)}`));
  powerMonitor.on('resume', () => updates?.resumed());
  ipcMain.handle(Channels.mainUpdates, (event) =>
    owns(event.sender) ? (updates?.view() ?? UPDATE_VIEW_OFF) : UPDATE_VIEW_OFF,
  );
  ipcMain.handle(Channels.mainUpdatesCheck, (event) => {
    if (owns(event.sender)) void updates?.check();
  });
  ipcMain.handle(Channels.mainUpdatesRestart, (event) => {
    if (owns(event.sender)) updates?.restart();
  });
  ipcMain.handle(Channels.mainUpdatesToastSeen, (event) => {
    if (owns(event.sender)) updates?.toastSeen();
  });
  // APP-08, D-102: the global hotkeys, recorded in Settings → Capture & hotkeys. Flint tries a
  // new combination at once; one another app owns is refused and the old one stays.
  ipcMain.handle(Channels.mainHotkeys, (event) =>
    owns(event.sender)
      ? {
          capture: hotkeys.get('capture'),
          selection: hotkeys.get('selection'),
          mini: hotkeys.get('mini'),
        }
      : null,
  );
  ipcMain.on(Channels.mainHotkeysRecording, (event, active: unknown) => {
    if (!owns(event.sender)) return;
    // While a new hotkey is recorded the current ones must not fire.
    if (active === true) hotkeys.pause();
    else hotkeys.resume();
  });
  // Recording ends with the window's focus, whatever the page did.
  mainWindow.on('blur', () => hotkeys.resume());
  ipcMain.handle(Channels.mainHotkeysRebind, (event, name: unknown, accelerator: unknown) => {
    if (!owns(event.sender)) return null;
    if (
      (name !== 'capture' && name !== 'selection' && name !== 'mini') ||
      typeof accelerator !== 'string'
    )
      return null;
    const result = hotkeys.rebind(name, accelerator);
    if (result.kind === 'saved') {
      log(`${name} hotkey changed to ${accelerator}`);
      tray.setWarning(hotkeyWarning());
      settingsFile
        .update(
          name === 'capture'
            ? { captureHotkey: accelerator }
            : name === 'selection'
              ? { captureSelectionHotkey: accelerator }
              : { miniHotkey: accelerator },
        )
        .catch((error: unknown) => log(`hotkey not saved: ${String(error)}`));
    }
    return result.kind;
  });
  tray.setWarning(hotkeyWarning());

  // Reminders (REM-01, REM-05, REM-07 basic; D-64): toasts while Flint runs, missed ones once at
  // the next start or wake. Not in the R-1 benchmark build, which has no toast scheme.
  const toastOptions = (): ToastOptions | null =>
    protocol
      ? {
          protocol,
          hideText: settingsFile.current.hideNotificationText,
          silent: settingsFile.current.reminderSound,
        }
      : null;
  /** REM-06, D-109: the reminders waiting in mini mode's card, oldest first. */
  let alerts: MiniAlert[] = [];
  const dropAlert = (id: string): void => {
    if (!alerts.some((alert) => alert.id === id)) return;
    alerts = alerts.filter((alert) => alert.id !== id);
    mini.send(Channels.miniAlerts, alerts);
  };
  // A card whose task was done, snoozed or deleted elsewhere goes too.
  workspace.onChange(() => {
    if (alerts.length === 0) return;
    const now = new Date();
    const due = new Set(
      workspace
        .reminderTasks()
        .filter(
          (task) =>
            !task.done &&
            !task.muted &&
            new Date(task.at.year, task.at.month - 1, task.at.day, task.at.hour, task.at.minute) <=
              now,
        )
        .map((task) => task.id),
    );
    const kept = alerts.filter((alert) => due.has(alert.id));
    if (kept.length === alerts.length) return;
    alerts = kept;
    mini.send(Channels.miniAlerts, alerts);
  });
  const showReminders = (plan: ToastPlan): void => {
    // APP-11, D-100: notifications off: no toast, no chime (the Overdue card still has them).
    if (!settingsFile.current.notifications && !hooks) return;
    // REM-06, D-94: Flint's own chime, once for what fires together, when it is turned on.
    if (
      (plan.separate.length > 0 || plan.summary) &&
      (hooks?.reminderSound ?? settingsFile.current.reminderSound)
    ) {
      if (hooks) hooks.chimes = (hooks.chimes ?? 0) + 1;
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(Channels.mainChime);
    }
    const options = toastOptions();
    for (const toast of plan.separate) {
      if (hooks) hooks.toasts.push(`${toast.label} | ${toast.title}`);
      else if (options) showReminderToast({ ...toast, kind: 'reminder' }, options, log);
    }
    // REM-06, D-109: mini mode's card too, an additional place to act (the toast fires anyway).
    if (plan.separate.length > 0) {
      const fired = new Set(plan.separate.map((toast) => toast.id));
      alerts = [
        ...alerts.filter((alert) => !fired.has(alert.id)),
        ...plan.separate.map((toast) => ({ id: toast.id, title: toast.title, label: toast.label })),
      ];
      mini.send(Channels.miniAlerts, alerts);
      if (settingsFile.current.miniReminders === 'always' && !mini.visible()) mini.show(false);
    }
    if (plan.summary) {
      if (hooks) hooks.toasts.push(`${plan.summary.count} reminders you missed`);
      else if (options) showMissedSummary(plan.summary, options, log);
    }
  };
  if (!__FLINT_BENCH_BUILD__) {
    const reminders = await ReminderService.start({
      statePath: join(app.getPath('userData'), 'reminders-state.json'),
      tasks: () => workspace.reminderTasks(),
      show: showReminders,
      log,
    });
    // A list changed (a capture, an edit, another program): a new or moved reminder may be sooner.
    let pending: NodeJS.Timeout | undefined;
    workspace.onChange(() => {
      clearTimeout(pending);
      pending = setTimeout(() => reminders.check(), 200);
    });
  }

  /** Open on a reminder toast: the main window, with the task's list open and the task selected. */
  const reveal = (taskId: string): void => {
    const found = workspace.locate(taskId);
    if (!found) return;
    const send = (): void => mainWindow.webContents.send(Channels.mainReveal, found);
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
    else send();
  };
  // MINI-01, D-109: mini mode's own calls.
  ipcMain.on(Channels.miniToggle, (event) => {
    if (owns(event.sender)) mini.toggle();
  });
  ipcMain.on(Channels.miniHide, (event) => {
    if (mini.owns(event.sender)) mini.hide();
  });
  ipcMain.handle(Channels.miniState, (event) => (mini.owns(event.sender) ? mini.state() : null));
  ipcMain.on(Channels.miniSetState, (event, state: unknown) => {
    if (!mini.owns(event.sender) || typeof state !== 'object' || state === null) return;
    const { tab, noteId } = state as { tab?: unknown; noteId?: unknown };
    mini.setState({
      ...((tab === 'today' || tab === 'inbox' || tab === 'note') && { tab: tab }),
      ...((typeof noteId === 'string' || noteId === null) && { noteId }),
    });
  });
  ipcMain.handle(Channels.miniSetOnTop, async (event, onTop: unknown) => {
    if (!mini.owns(event.sender) || typeof onTop !== 'boolean')
      return settingsFile.current.miniOnTop;
    await settingsFile.update({ miniOnTop: onTop });
    mini.setOnTop(onTop);
    return onTop;
  });
  // Open, double-click or Enter in mini: the main window at that place; mini stays.
  ipcMain.on(Channels.miniOpen, (event, place: unknown) => {
    if (!mini.owns(event.sender) || typeof place !== 'object' || place === null) return;
    const { listId, key } = place as { listId?: unknown; key?: unknown };
    if (typeof listId !== 'string') return;
    showMain();
    const target = { listId, key: typeof key === 'string' ? key : '' };
    const send = (): void => mainWindow.webContents.send(Channels.mainReveal, target);
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
    else send();
  });
  ipcMain.handle(Channels.miniGetAlerts, (event) => (mini.owns(event.sender) ? alerts : []));
  if (hooks) {
    hooks.showMini = () => mini.show(true);
    hooks.hideMini = () => mini.hide();
    hooks.miniVisible = () => mini.visible();
    hooks.closedToasts = [];
  }
  /** REM-07, D-94: "N reminders you missed": Today, its Overdue card open, in view. */
  const showOverdue = (): void => {
    const send = (): void => mainWindow.webContents.send(Channels.mainOverdue);
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
    else send();
  };
  const handleActivation = (activation: ReminderActivation | null, from = 'toast'): void => {
    if (!activation) return;
    log(`${from} action "${activation.action}" for task ${activation.id}`);
    // D-109: acting in either place clears the other: the card in mini, the toast (Action Center).
    dropAlert(activation.id);
    if (from !== 'toast' && closeReminderToast(activation.id))
      log(`toast for ${activation.id} closed`);
    if (from !== 'toast') hooks?.closedToasts?.push(activation.id);
    const now = new Date();
    if (activation.action === 'open') {
      showMain();
      if (activation.id !== MISSED_SUMMARY_ID) reveal(activation.id);
      else showOverdue();
      return;
    }
    const run =
      activation.action === 'done'
        ? workspace.completeById(activation.id, now)
        : workspace.snoozeById(activation.id, now);
    run
      .then((done) => log(`reminder ${activation.action}: ${done ?? 'nothing to do'}`))
      .catch((error: unknown) => log(`reminder ${activation.action} failed: ${String(error)}`));
  };
  if (hooks) hooks.activate = (url: string) => handleActivation(activationOf([url]));
  ipcMain.on(Channels.miniAlertAction, (event, id: unknown, action: unknown) => {
    if (!mini.owns(event.sender) || typeof id !== 'string') return;
    if (action !== 'done' && action !== 'snooze' && action !== 'open') return;
    handleActivation({ id, action: action }, 'mini');
  });
  /** The R-3 test toast (`flint-dev://dev/toast`, FLINT_TEST_TOAST). Development builds only. */
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
    const activation = activationOf(argv);
    handleActivation(activation);
    handleDevCommand(argv);
    // APP-01, D-68: starting Flint again by hand (Start menu, shortcut) shows its window.
    const devCommand = argv.some((argument) => argument.startsWith(`${protocol}://dev/`));
    if (!activation && !devCommand && !argv.includes('--hidden')) showMain();
  });
  handleActivation(activationOf(process.argv));
  handleDevCommand(process.argv);

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
          runLaptopBench(popup, benchHooks, CAPTURE_HOTKEY, hotkeys.get('capture').registered, log),
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
  } else if (!STARTED_AT_LOGIN) {
    // APP-01, D-68: a manual start (Start menu, shortcut, the installer's finish) shows the main
    // window; only the start-with-Windows launch (`--hidden`) stays in the tray.
    showMain();
  }

  const testToast = devEnv('FLINT_TEST_TOAST') as ToastKind | undefined;
  if (testToast) setTimeout(() => sendTestToast(testToast), 1500);

  // D-116: every handler is registered: the pages' calls can go (asked or told, whichever is first).
  setUp = true;
  toWindows(Channels.mainStarted);
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

/**
 * Interface size (UI-12, D-81): Ctrl+= (Ctrl++), Ctrl+− and Ctrl+0 zoom the main window, remembered
 * per display; moving the window to another display takes that display's size. The level shows
 * briefly in the window. The title bar's strip grows with the page, so Windows' caption buttons do
 * too. Handled before the page and any menu sees the keys.
 */
function setUpZoom(window: BrowserWindow): void {
  const zooms = new ZoomFile(join(app.getPath('userData'), 'zoom.json'));
  // NAV-07, D-83: the context panel hidden or not, per display too.
  const panels = new PanelFile(join(app.getPath('userData'), 'panel.json'));
  const loaded = Promise.all([zooms.load(), panels.load()]);
  const displayOf = (): string => displayKey(screen.getDisplayMatching(window.getBounds()));
  let shownOn = '';
  const apply = (show: boolean): void => {
    if (window.isDestroyed()) return;
    shownOn = displayOf();
    const factor = zooms.get(shownOn);
    window.webContents.setZoomFactor(factor);
    window.setTitleBarOverlay({
      color: '#0D0E10',
      symbolColor: '#7C7F84',
      height: Math.round(40 * factor),
    });
    if (show) window.webContents.send(Channels.mainZoomed, factor);
    window.webContents.send(Channels.mainPanel, panels.hidden(shownOn));
  };
  ipcMain.on(Channels.mainSetPanel, (event, hidden: unknown) => {
    if (event.sender !== window.webContents || typeof hidden !== 'boolean') return;
    void panels
      .set(displayOf(), hidden)
      .catch((error: unknown) => log(`panel not saved: ${String(error)}`));
  });
  window.webContents.on('did-finish-load', () => void loaded.then(() => apply(false)));
  let timer: NodeJS.Timeout | undefined;
  window.on('move', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!window.isDestroyed() && displayOf() !== shownOn) apply(true);
    }, 250);
  });
  const zoomBy = async (how: ZoomRequest): Promise<void> => {
    const display = displayOf();
    await zooms
      .set(display, stepZoom(zooms.get(display), how))
      .catch((error: unknown) => log(`zoom not saved: ${String(error)}`));
    apply(true);
  };
  // Real key presses: before the page and any menu sees them.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
    const how = zoomKey(input.key, input.code);
    if (!how) return;
    event.preventDefault();
    void zoomBy(how);
  });
  // Keys that reach the page anyway (synthesized ones, as in the end-to-end tests) ask here.
  // D-102: Settings' Interface size sets an exact level too.
  ipcMain.handle(Channels.mainZoom, (event, how: unknown) =>
    event.sender === window.webContents && isZoomRequest(how) ? zoomBy(how) : undefined,
  );
  // D-102: the level on this display now, for Settings.
  ipcMain.handle(Channels.mainZoomLevel, async (event) => {
    if (event.sender !== window.webContents) return 1;
    await loaded;
    return zooms.get(displayOf());
  });
}

/**
 * D-84: a video, streamed: the whole file, or the range a player asks for (seeking), so even a large
 * linked video never has to be read at once.
 */
async function streamFile(file: string, range: string | null): Promise<Response> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = contentType(file);
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!match) {
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(body, {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    });
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end)
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}
