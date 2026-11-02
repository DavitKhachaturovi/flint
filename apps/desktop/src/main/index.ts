import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  Notification,
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
  type PopupNotice,
  type PopupShown,
  type PopupSubmit,
  type ToastKind,
} from '../shared/ipc.js';
import { isOpenableLink } from '../shared/inline-markdown.js';
import { runBench } from './bench.js';
import { IDENTITIES, type BuildKind } from './identity.js';
import { showMissedSummary, showReminderToast } from './notifications.js';
import { DraftFile } from './capture/drafts.js';
import { captureSelection } from './capture/selection.js';
import { displayAccelerator } from '../shared/accelerator.js';
import { HotkeyRegistry } from './hotkey-registry.js';
import { acceleratorKeys } from './hotkeys.js';
import { hotkeysWindow } from './hotkeys-window.js';
import { Workspace, type CreatedList } from './capture/workspace.js';
import { createCapturePopup, type CapturePopup, type FocusSample } from './popup.js';
import { SettingsFile } from './settings.js';
import { displayKey, stepZoom, zoomKey, ZoomFile, type ZoomStep } from './zoom.js';
import {
  APP_SCHEME,
  contentType,
  MAIN_WINDOW_HOST,
  rendererPageUrl,
  resolveMediaFile,
  resolveRendererFile,
} from './renderer-url.js';
import { prepareFlintFolder } from './storage/flint-folder.js';
import { ReminderService } from './reminder-service.js';
import type { ToastPlan } from './reminders.js';
import { watchListFolder } from './storage/watcher.js';
import {
  appIcon,
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
import {
  findActivation,
  MISSED_SUMMARY_ID,
  type ReminderActivation,
  type ToastOptions,
} from './toast.js';
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
const pageUrl = (page: string, host?: typeof MAIN_WINDOW_HOST): string =>
  devServerUrl ? `${devServerUrl}/${page}/index.html` : rendererPageUrl(page, host);

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
      (mediaRoot ? resolveMediaFile(request.url, mediaRoot) : null);
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
    },
  });
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
  });
  recoverFromCrashes(mainWindow, 'main window', log);
  void rememberWindowState(mainWindow, 'main', { x: 0, y: 0, width: 900, height: 640 });
  setUpZoom(mainWindow);
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
  // M4: the main window's lists, read from and changed through the workspace.
  const owns = (sender: Electron.WebContents): boolean => sender === mainWindow.webContents;
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
  ipcMain.handle(Channels.mainChange, (event, id: unknown, change: unknown) =>
    owns(event.sender) && typeof id === 'string' && typeof change === 'object' && change !== null
      ? workspace.change(id, change as ListChange, new Date()).catch((error: unknown) => {
          log(`could not change the list: ${String(error)}`);
          return null;
        })
      : null,
  );
  // UI-08: a text field's menu in any Flint window; the command runs on that window.
  ipcMain.on(Channels.editCommand, (event, command: unknown) => {
    const contents = event.sender;
    if (command === 'cut') contents.cut();
    else if (command === 'copy') contents.copy();
    else if (command === 'paste') contents.paste();
    else if (command === 'selectAll') contents.selectAll();
  });
  ipcMain.on(Channels.mainOpenLink, (event, href: unknown) => {
    if (owns(event.sender) && typeof href === 'string' && isOpenableLink(href))
      void shell.openExternal(href);
  });
  ipcMain.handle(Channels.mainListAction, (event, action: unknown) => {
    if (!owns(event.sender) || typeof action !== 'object' || action === null) return null;
    const request = action as ListAction;
    const now = new Date();
    const run =
      request.kind === 'new'
        ? workspace.newList(request.name, request.mode, now)
        : request.kind === 'rename'
          ? workspace.renameList(request.id, request.name, now)
          : request.kind === 'duplicate'
            ? workspace.duplicateList(request.id, now)
            : request.kind === 'convert'
              ? workspace.convertList(request.id, request.mode, now)
              : request.kind === 'deleteMany'
                ? workspace.deleteLists(request.ids, now)
                : workspace.deleteList(request.id, now);
    return run.catch((error: unknown) => {
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
  ipcMain.handle(Channels.mainSidebar, (event) =>
    owns(event.sender) ? workspace.sidebar() : null,
  );
  ipcMain.handle(Channels.mainSidebarAction, (event, action: unknown) => {
    if (!owns(event.sender) || typeof action !== 'object' || action === null) return null;
    return workspace.sidebarAction(action as SidebarAction, new Date()).catch((error: unknown) => {
      log(`sidebar change failed: ${String(error)}`);
      return { ok: false, problem: 'Flint could not change the sidebar' } as const;
    });
  });
  ipcMain.handle(Channels.mainSaveNote, (event, id: unknown, text: unknown) =>
    owns(event.sender) && typeof id === 'string' && typeof text === 'string'
      ? workspace.saveNote(id, text, new Date()).catch((error: unknown) => {
          log(`could not save the note: ${String(error)}`);
          return { ok: false, problem: 'Flint could not save the note' } as const;
        })
      : null,
  );
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
  workspace.onChange(() => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(Channels.mainChanged);
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

  // D-41: the capture hotkey opens the popup, brings the cursor back to one that stayed open, and
  // closes one that has it (the draft is kept, like Esc).
  const onCaptureHotkey = (): void => {
    if (popup.isFocused()) popup.hide();
    else popup.show(epochNow());
  };

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

  // APP-08: both hotkeys, rebindable with conflict detection.
  const hotkeys = new HotkeyRegistry(
    { capture: settings.captureHotkey, selection: settings.captureSelectionHotkey },
    { capture: onCaptureHotkey, selection: onSelectionHotkey },
  );
  /** A hotkey another app owns must never fail silently: the tray says so (APP-08). */
  const hotkeyWarning = (): string | null => {
    const capture = hotkeys.get('capture');
    const selection = hotkeys.get('selection');
    if (!capture.registered)
      return `${displayAccelerator(capture.accelerator)} is taken: change the capture hotkey…`;
    if (!selection.registered)
      return `${displayAccelerator(selection.accelerator)} is taken: change the selection hotkey…`;
    return null;
  };
  for (const name of ['capture', 'selection'] as const) {
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
    hotkeys: () => hotkeysPanel.show(),
    quit: () => app.quit(),
  });
  const hotkeysPanel = hotkeysWindow(pageUrl('hotkeys'), hotkeys, (name, accelerator) => {
    log(`${name} hotkey changed to ${accelerator}`);
    tray.setWarning(hotkeyWarning());
    settingsFile
      .update(
        name === 'capture'
          ? { captureHotkey: accelerator }
          : { captureSelectionHotkey: accelerator },
      )
      .catch((error: unknown) => log(`hotkey not saved: ${String(error)}`));
  });
  tray.setWarning(hotkeyWarning());
  if (hooks) hooks.showHotkeys = () => hotkeysPanel.show();

  // Reminders (REM-01, REM-05, REM-07 basic; D-64): toasts while Flint runs, missed ones once at
  // the next start or wake. Not in the R-1 benchmark build, which has no toast scheme.
  const toastOptions = (): ToastOptions | null =>
    protocol ? { protocol, hideText: settings.hideNotificationText } : null;
  const showReminders = (plan: ToastPlan): void => {
    const options = toastOptions();
    for (const toast of plan.separate) {
      if (hooks) hooks.toasts.push(`${toast.label} | ${toast.title}`);
      else if (options) showReminderToast({ ...toast, kind: 'reminder' }, options, log);
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
  const handleActivation = (activation: ReminderActivation | null): void => {
    if (!activation) return;
    log(`toast action "${activation.action}" for task ${activation.id}`);
    const now = new Date();
    if (activation.action === 'open') {
      showMain();
      if (activation.id !== MISSED_SUMMARY_ID) reveal(activation.id);
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

/**
 * Interface size (UI-12, D-81): Ctrl+= (Ctrl++), Ctrl+− and Ctrl+0 zoom the main window, remembered
 * per display; moving the window to another display takes that display's size. The level shows
 * briefly in the window. The title bar's strip grows with the page, so Windows' caption buttons do
 * too. Handled before the page and any menu sees the keys.
 */
function setUpZoom(window: BrowserWindow): void {
  const zooms = new ZoomFile(join(app.getPath('userData'), 'zoom.json'));
  const loaded = zooms.load();
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
  };
  window.webContents.on('did-finish-load', () => void loaded.then(() => apply(false)));
  let timer: NodeJS.Timeout | undefined;
  window.on('move', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!window.isDestroyed() && displayOf() !== shownOn) apply(true);
    }, 250);
  });
  const zoomBy = async (how: ZoomStep): Promise<void> => {
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
  ipcMain.handle(Channels.mainZoom, (event, how: unknown) =>
    event.sender === window.webContents && (how === 'in' || how === 'out' || how === 'reset')
      ? zoomBy(how)
      : undefined,
  );
}
