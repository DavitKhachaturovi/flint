/**
 * APP-06, D-136: updates from GitHub Releases (electron-updater). Checks 30 s after start, then
 * every 4 hours while Flint runs, and on waking when a check is due; downloads in the background;
 * installs on Restart now, or when Flint quits. Stable releases only, never a downgrade. Errors are
 * only shown in Settings → About, never as a toast. Development, test and benchmark builds pass no
 * updater and never contact anything.
 */
import {
  UPDATE_VIEW_OFF,
  isOfflineError,
  type UpdatePhase,
  type UpdateView,
} from '../shared/updates.js';

/** What Flint uses of electron-updater's AppUpdater (a fake in tests). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * D-136: the hosts the updater reads GitHub Releases from (the release feed and latest.yml on
 * github.com, the files on GitHub's release-asset hosts after its redirect), HTTPS only. Nothing
 * else is ever allowed through Flint's network guard.
 */
export const UPDATE_HOSTS: readonly string[] = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
];

export function isUpdateRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.port === '' &&
      parsed.username === '' &&
      UPDATE_HOSTS.includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** What a test run's fake updater records (D-136; development builds only, never contacts). */
export interface TestUpdaterRecord {
  emit: (event: string, arg?: unknown) => void;
  checks: number;
  installs: number;
}

/** A fake electron-updater for the end-to-end tests: a test emits its events. */
export function testUpdater(): { updater: UpdaterLike; record: TestUpdaterRecord } {
  const listeners = new Map<string, ((arg?: unknown) => void)[]>();
  const record: TestUpdaterRecord = {
    checks: 0,
    installs: 0,
    emit: (event, arg) => {
      for (const listener of listeners.get(event) ?? []) listener(arg);
    },
  };
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    checkForUpdates: () => {
      record.checks++;
      record.emit('checking-for-update');
      return Promise.resolve(null);
    },
    quitAndInstall: () => {
      record.installs++;
    },
    on: (event: string, listener: (arg?: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return updater;
    },
  };
  return { updater: updater as unknown as UpdaterLike, record };
}

/** The first check waits this long after start, off the startup path (Q2 of M9). */
export const FIRST_CHECK_MS = 30_000;
/** Then one check every this long while Flint runs. */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export interface UpdateServiceOptions {
  /** null: this build never updates (development, tests, the benchmark). */
  readonly updater: UpdaterLike | null;
  /** Settings → About → Check for updates automatically. */
  readonly automatic: () => boolean;
  readonly now: () => number;
  readonly log: (line: string) => void;
  /** Every change of the view (to the main window and the tray). */
  readonly changed: (view: UpdateView) => void;
  /** Before quitAndInstall: lets the app's quit go through (windows hide on close otherwise). */
  readonly beforeInstall: () => void;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export class UpdateService {
  private readonly options: UpdateServiceOptions;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private state: UpdateView;
  private timer: unknown = null;
  private lastCheck: number | null = null;

  constructor(options: UpdateServiceOptions) {
    this.options = options;
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.state = options.updater ? { ...UPDATE_VIEW_OFF, phase: 'idle' } : UPDATE_VIEW_OFF;
    const updater = options.updater;
    if (!updater) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => this.set({ phase: 'checking', error: null }));
    updater.on('update-not-available', () =>
      this.set({ phase: 'idle', checkedAt: this.options.now(), version: null, percent: null }),
    );
    updater.on('update-available', (info) => {
      this.options.log(`update available: ${info.version}`);
      this.set({
        phase: 'downloading',
        checkedAt: this.options.now(),
        version: info.version,
        percent: 0,
      });
    });
    updater.on('download-progress', (progress) => {
      if (this.state.phase === 'downloading') this.set({ percent: progress.percent });
    });
    updater.on('update-downloaded', (info) => {
      this.options.log(`update downloaded: ${info.version}`);
      this.set({ phase: 'ready', version: info.version, percent: 100 });
    });
    updater.on('error', (error) => {
      this.options.log(`update error: ${error.message}`);
      // A failure while downloading or once ready keeps what was there (it is retried later).
      if (this.state.phase === 'ready') return;
      this.set({
        phase: 'error',
        checkedAt: this.options.now(),
        error: isOfflineError(error.message) ? 'offline' : 'failed',
        percent: null,
      });
    });
  }

  view(): UpdateView {
    return this.state;
  }

  /** Starts the automatic checks (if on): the first one 30 s from now. */
  start(): void {
    this.schedule(FIRST_CHECK_MS);
  }

  /** Settings → About's switch changed: stop the automatic checks, or start them again. */
  automaticChanged(): void {
    if (!this.options.automatic()) {
      this.cancel();
      return;
    }
    const due = this.lastCheck === null ? FIRST_CHECK_MS : this.lastCheck + CHECK_EVERY_MS;
    this.schedule(this.lastCheck === null ? FIRST_CHECK_MS : Math.max(0, due - this.options.now()));
  }

  /** The computer woke up: check now if a check is due (timers don't run while it sleeps). */
  resumed(): void {
    if (!this.options.updater || !this.options.automatic()) return;
    if (this.lastCheck === null || this.options.now() - this.lastCheck >= CHECK_EVERY_MS) {
      this.schedule(0);
    }
  }

  /** A check: automatic, or "Check for updates" (also when the automatic checks are off). */
  async check(): Promise<void> {
    const updater = this.options.updater;
    if (!updater) return;
    const busy: readonly UpdatePhase[] = ['checking', 'downloading', 'ready'];
    if (busy.includes(this.state.phase)) return;
    this.lastCheck = this.options.now();
    try {
      await updater.checkForUpdates();
    } catch (error) {
      // electron-updater also emits 'error'; this only makes sure nothing is left unhandled.
      this.options.log(
        `update check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (this.state.phase === 'checking') {
        this.set({
          phase: 'error',
          checkedAt: this.options.now(),
          error: error instanceof Error && isOfflineError(error.message) ? 'offline' : 'failed',
        });
      }
    }
  }

  /** "Restart now": the update installs silently and Flint starts again. */
  restart(): void {
    const updater = this.options.updater;
    if (!updater || this.state.phase !== 'ready') return;
    this.options.log(`restarting to install ${this.state.version ?? 'the update'}`);
    this.options.beforeInstall();
    updater.quitAndInstall(true, true);
  }

  /** The toast was shown, or "Later" pressed: it isn't shown again this session. */
  toastSeen(): void {
    if (!this.state.toastSeen) this.set({ toastSeen: true });
  }

  dispose(): void {
    this.cancel();
  }

  private schedule(ms: number): void {
    this.cancel();
    if (!this.options.updater || !this.options.automatic()) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.check().finally(() => this.schedule(CHECK_EVERY_MS));
    }, ms);
  }

  private cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private set(change: Partial<UpdateView>): void {
    this.state = { ...this.state, ...change };
    this.options.changed(this.state);
  }
}
