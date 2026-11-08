import { describe, expect, it, vi } from 'vitest';
import {
  updateStatus,
  isOfflineError,
  UPDATE_VIEW_OFF,
  type UpdateView,
} from '../shared/updates.js';
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  RESTART_DELAY_MS,
  UpdateService,
  isUpdateRequest,
  type UpdaterLike,
} from './updates.js';

/** A fake electron-updater: records calls, emits what a test tells it to. */
function fakeUpdater() {
  const listeners = new Map<string, (arg?: unknown) => void>();
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    allowDowngrade: true,
    checks: 0,
    installed: [] as [boolean | undefined, boolean | undefined][],
    next: null as null | (() => void),
    checkForUpdates: vi.fn((): Promise<unknown> => {
      updater.checks++;
      listeners.get('checking-for-update')?.();
      updater.next?.();
      return Promise.resolve(null);
    }),
    quitAndInstall(silent?: boolean, run?: boolean) {
      updater.installed.push([silent, run]);
    },
    on(event: string, listener: (arg?: unknown) => void) {
      listeners.set(event, listener);
      return updater;
    },
    emit(event: string, arg?: unknown) {
      listeners.get(event)?.(arg);
    },
  };
  return updater;
}

/** Manual timers: `tick(ms)` runs what is due. */
function clock() {
  let now = 1_000_000;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      const id = ++ids;
      timers.push({ at: now + ms, run, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers = timers.filter((timer) => timer.id !== id);
    },
    pending: () => timers.map((timer) => timer.at - now),
    async tick(ms: number) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function service(
  options: { automatic?: boolean; updater?: ReturnType<typeof fakeUpdater> | null } = {},
) {
  const time = clock();
  const updater = options.updater === undefined ? fakeUpdater() : options.updater;
  let automatic = options.automatic ?? true;
  const views: UpdateView[] = [];
  const beforeInstall = vi.fn();
  const updates = new UpdateService({
    updater: updater as unknown as UpdaterLike | null,
    automatic: () => automatic,
    now: time.now,
    log: () => {},
    changed: (view) => views.push(view),
    beforeInstall,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
  });
  return {
    updates,
    updater,
    time,
    views,
    beforeInstall,
    setAutomatic: (on: boolean) => {
      automatic = on;
    },
  };
}

describe('UpdateService (APP-06, D-136)', () => {
  it('sets electron-updater up: background download, install on quit, stable only, no downgrade', () => {
    const { updater } = service();
    expect(updater).toMatchObject({
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      allowDowngrade: false,
    });
  });

  it('checks 30 s after start, then every 4 hours', async () => {
    const { updates, updater, time } = service();
    updater!.next = () => updater!.emit('update-not-available');
    updates.start();
    expect(time.pending()).toEqual([FIRST_CHECK_MS]);
    await time.tick(FIRST_CHECK_MS - 1);
    expect(updater!.checks).toBe(0);
    await time.tick(1);
    expect(updater!.checks).toBe(1);
    expect(updates.view()).toMatchObject({ phase: 'idle', checkedAt: time.now() });
    expect(time.pending()).toEqual([CHECK_EVERY_MS]);
    await time.tick(CHECK_EVERY_MS);
    expect(updater!.checks).toBe(2);
  });

  it('with automatic checks off, nothing is contacted until "Check for updates"', async () => {
    const { updates, updater, time } = service({ automatic: false });
    updates.start();
    updates.resumed();
    expect(time.pending()).toEqual([]);
    await time.tick(CHECK_EVERY_MS * 2);
    expect(updater!.checks).toBe(0);
    await updates.check();
    expect(updater!.checks).toBe(1);
  });

  it('turning automatic checks back on resumes from the last check', async () => {
    const { updates, updater, time, setAutomatic } = service({ automatic: false });
    updater!.next = () => updater!.emit('update-not-available');
    await updates.check();
    await time.tick(60_000);
    setAutomatic(true);
    updates.automaticChanged();
    expect(time.pending()).toEqual([CHECK_EVERY_MS - 60_000]);
    setAutomatic(false);
    updates.automaticChanged();
    expect(time.pending()).toEqual([]);
  });

  it('on waking, checks at once only when a check is due', async () => {
    const { updates, updater, time } = service();
    updater!.next = () => updater!.emit('update-not-available');
    await updates.check();
    updates.resumed();
    expect(time.pending()).toEqual([]);
    await time.tick(CHECK_EVERY_MS);
    updates.resumed();
    expect(time.pending()).toEqual([0]);
  });

  it('downloads in the background, then is ready; Restart now installs silently and starts again', async () => {
    const { updates, updater, views, beforeInstall, time } = service();
    updater!.next = () => updater!.emit('update-available', { version: '1.0.1' });
    await updates.check();
    expect(updates.view()).toMatchObject({ phase: 'downloading', version: '1.0.1', percent: 0 });
    updater!.emit('download-progress', { percent: 42.4 });
    expect(updateStatus(updates.view(), 0)).toBe('Downloading 1.0.1 · 42%');
    updater!.emit('update-downloaded', { version: '1.0.1' });
    expect(updates.view()).toMatchObject({ phase: 'ready', version: '1.0.1' });
    expect(views.at(-1)?.phase).toBe('ready');
    // A check while one is ready does nothing.
    await updates.check();
    expect(updater!.checks).toBe(1);
    updates.restart();
    // D-140: Flint hides and says so first; the installer starts a moment later.
    expect(beforeInstall).toHaveBeenCalledExactlyOnceWith('1.0.1');
    expect(updater!.installed).toEqual([]);
    await time.tick(RESTART_DELAY_MS);
    expect(updater!.installed).toEqual([[true, true]]);
  });

  it('Restart now does nothing before an update is ready', () => {
    const { updates, updater, beforeInstall } = service();
    updates.restart();
    expect(beforeInstall).not.toHaveBeenCalled();
    expect(updater!.installed).toEqual([]);
  });

  it('errors only change the status (offline or not); a ready update stays ready', async () => {
    const { updates, updater } = service();
    updater!.next = () => updater!.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    await updates.check();
    expect(updates.view()).toMatchObject({ phase: 'error', error: 'offline' });
    expect(updateStatus(updates.view(), 0)).toBe('Couldn’t check for updates (offline).');
    updater!.next = () => updater!.emit('error', new Error('HttpError: 404'));
    await updates.check();
    expect(updates.view()).toMatchObject({ phase: 'error', error: 'failed' });
    updater!.next = () => updater!.emit('update-downloaded', { version: '1.0.2' });
    await updates.check();
    updater!.emit('error', new Error('later failure'));
    expect(updates.view().phase).toBe('ready');
  });

  it('a check that throws without an error event still ends in an error state', async () => {
    const { updates, updater } = service();
    updater!.checkForUpdates.mockImplementationOnce(() => {
      updater!.emit('checking-for-update');
      return Promise.reject(new Error('getaddrinfo ENOTFOUND github.com'));
    });
    await updates.check();
    expect(updates.view()).toMatchObject({ phase: 'error', error: 'offline' });
  });

  it('the toast is seen once a session', () => {
    const { updates } = service();
    expect(updates.view().toastSeen).toBe(false);
    updates.toastSeen();
    expect(updates.view().toastSeen).toBe(true);
  });

  it('a build without an updater is off: no timers, no checks, no restart', async () => {
    const { updates, time } = service({ updater: null });
    updates.start();
    updates.resumed();
    await updates.check();
    updates.restart();
    expect(time.pending()).toEqual([]);
    expect(updates.view()).toEqual(UPDATE_VIEW_OFF);
  });
});

describe('updateStatus (D-136)', () => {
  const now = new Date(2026, 2, 10, 15, 0).getTime();
  const view = (change: Partial<UpdateView>): UpdateView => ({
    ...UPDATE_VIEW_OFF,
    phase: 'idle',
    ...change,
  });
  it.each([
    [
      view({ phase: 'off' }),
      'Updates are off in this build (development and test builds never update).',
    ],
    [view({}), 'Not checked yet.'],
    [view({ checkedAt: new Date(2026, 2, 10, 14, 2).getTime() }), 'Up to date · checked 14:02'],
    [view({ checkedAt: new Date(2026, 2, 3, 9, 5).getTime() }), 'Up to date · checked 3 Mar 09:05'],
    [view({ phase: 'checking' }), 'Checking for updates…'],
    [
      view({ phase: 'ready', version: '1.0.2' }),
      '1.0.2 is ready · it installs when you restart Flint.',
    ],
    [view({ phase: 'error', error: 'failed' }), 'Couldn’t check for updates.'],
  ])('%j', (input, text) => {
    expect(updateStatus(input, now)).toBe(text);
  });

  it('recognises being offline', () => {
    expect(isOfflineError('getaddrinfo ENOTFOUND api.github.com')).toBe(true);
    expect(isOfflineError('net::ERR_NAME_NOT_RESOLVED')).toBe(true);
    expect(isOfflineError('HttpError: 404 Not Found')).toBe(false);
  });
});

describe('isUpdateRequest (D-136): the only requests the network guard lets through', () => {
  it.each([
    ['https://github.com/DavitKhachaturovi/flint/releases.atom', true],
    ['https://github.com/DavitKhachaturovi/flint/releases/download/v1.0.1/latest.yml', true],
    ['https://release-assets.githubusercontent.com/github-production-release-asset/1/x', true],
    ['https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/x', true],
    ['http://github.com/DavitKhachaturovi/flint/releases.atom', false],
    ['https://github.com:8443/x', false],
    ['https://user@github.com/x', false],
    ['https://github.com.evil.example/x', false],
    ['https://raw.githubusercontent.com/x', false],
    ['https://example.com/', false],
    ['not a url', false],
  ])('%s → %s', (url, allowed) => {
    expect(isUpdateRequest(url)).toBe(allowed);
  });
});
