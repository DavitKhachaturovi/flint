import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * APP-06 (D-136): updates from GitHub Releases, as Flint shows them. Development builds never
 * update; in a test run the main process gets a fake updater whose events the test emits, so the
 * real update service, its IPC, Settings → About, the toast, the palette and the tray are checked
 * with nothing contacted. Each test starts its own Flint on the suite's fixed clock (D-107),
 * off-screen, never focused.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();

let dataDirectory = '';
let app: ElectronApplication | undefined;

async function launch(): Promise<{ app: ElectronApplication; main: Page }> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const started = await electron.launch({
    executablePath: electronPath,
    args: [appDirectory, '--hidden'],
    env: {
      ...env,
      FLINT_E2E: '1',
      FLINT_DATA_DIR: dataDirectory,
      FLINT_E2E_CLOCK_OFFSET: String(CLOCK_OFFSET),
    },
  });
  app = started;
  await expect
    .poll(() => started.windows().some((page) => page.url().includes('main-window')), {
      timeout: 15_000,
    })
    .toBe(true);
  const main = started.windows().find((page) => page.url().includes('main-window')) as Page;
  await main.waitForLoadState('domcontentloaded');
  await started.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint');
    if (!window) return;
    window.setSkipTaskbar(true);
    window.setBounds({ x: -6000, y: 0, width: 1600, height: 900 });
    window.showInactive();
  });
  // The fake updater is set up a moment after start.
  await expect
    .poll(() =>
      started.evaluate(
        () =>
          (globalThis as { __flintE2E?: { updater?: unknown } }).__flintE2E?.updater !== undefined,
      ),
    )
    .toBe(true);
  return { app: started, main };
}

/** electron-updater's event, as the fake updater emits it. */
async function emit(running: ElectronApplication, event: string, arg?: unknown): Promise<void> {
  await running.evaluate(
    (_, { name, value }) => {
      const hooks = (
        globalThis as {
          __flintE2E?: { updater?: { emit: (event: string, arg?: unknown) => void } };
        }
      ).__flintE2E;
      hooks?.updater?.emit(name, value === null ? undefined : value);
    },
    { name: event, value: arg ?? null },
  );
}

async function record(running: ElectronApplication): Promise<{ checks: number; installs: number }> {
  return running.evaluate(() => {
    const updater = (
      globalThis as { __flintE2E?: { updater?: { checks: number; installs: number } } }
    ).__flintE2E?.updater;
    return { checks: updater?.checks ?? -1, installs: updater?.installs ?? -1 };
  });
}

async function trayLabels(running: ElectronApplication): Promise<string[]> {
  return running.evaluate(
    () =>
      (globalThis as { __flintE2E?: { trayLabels?: () => string[] } }).__flintE2E?.trayLabels?.() ??
      [],
  );
}

test.beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-updates-'));
  await mkdir(join(dataDirectory, 'Flint'), { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(dataDirectory, { recursive: true, force: true });
});

test('Settings → About: the status line, Check for updates, the switch and the Privacy row (APP-06, APP-09, D-136)', async () => {
  const { app: running, main } = await launch();
  await main.locator('.nav', { hasText: 'Settings' }).click();
  const about = main.locator('#settings-about');
  await expect(about.locator('.settings-row').first()).toContainText(
    'Your notes never leave your machine. Flint only contacts GitHub to check for updates, which you can turn off.',
  );
  const version = about.locator('.settings-row', { hasText: /^Flint \d/ });
  const status = version.locator('.update-status');
  await expect(status).toHaveText('Not checked yet.');
  // A test run never checks by itself.
  expect((await record(running)).checks).toBe(0);

  await version.getByRole('button', { name: 'Check for updates' }).click();
  await expect(status).toHaveText('Checking for updates…');
  await expect(version.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
  expect((await record(running)).checks).toBe(1);
  await emit(running, 'update-not-available');
  await expect(status).toHaveText('Up to date · checked 10:00');

  // Offline: said in the status line only, never as a toast.
  await version.getByRole('button', { name: 'Check for updates' }).click();
  await emit(running, 'error', { message: 'net::ERR_INTERNET_DISCONNECTED' });
  await expect(status).toHaveText('Couldn’t check for updates (offline).');
  await expect(main.locator('.toast')).toHaveCount(0);

  // The switch is saved (on by default).
  const automatic = about
    .locator('.settings-row', { hasText: 'Automatic updates' })
    .locator('.switch');
  await expect(automatic).toHaveAttribute('aria-checked', 'true');
  await automatic.click();
  await expect(automatic).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(
      async () =>
        JSON.parse(
          await readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8'),
        ) as unknown,
    )
    .toMatchObject({ checkForUpdates: false });
});

test('an update downloads, then "Update ready" once; Restart now, the palette and the tray (APP-06, D-136)', async () => {
  const { app: running, main } = await launch();
  await emit(running, 'checking-for-update');
  await emit(running, 'update-available', { version: '1.0.1' });
  await emit(running, 'download-progress', { percent: 42.4 });
  await main.locator('.nav', { hasText: 'Settings' }).click();
  const version = main.locator('#settings-about .settings-row', { hasText: /^Flint \d/ });
  await expect(version.locator('.update-status')).toHaveText('Downloading 1.0.1 · 42%');
  expect(await trayLabels(running)).not.toContain('Restart to update');

  await emit(running, 'update-downloaded', { version: '1.0.1' });
  const toast = main.locator('.toast');
  await expect(toast).toContainText('Update ready · Flint 1.0.1');
  await expect(toast.getByRole('button', { name: 'Restart now' })).toBeVisible();
  await expect(version.locator('.update-status')).toHaveText(
    '1.0.1 is ready · it installs when you restart Flint.',
  );
  // The tray's one exception to its five items, while an update is ready (D-136).
  expect(await trayLabels(running)).toContain('Restart to update');

  // Later: gone, and not shown again this session.
  await toast.getByRole('button', { name: 'Later' }).click();
  await expect(toast).toHaveCount(0);
  await running.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint');
    window?.hide();
    window?.showInactive();
  });
  await main.waitForTimeout(400);
  await expect(toast).toHaveCount(0);

  // The palette offers Restart to update while one is ready.
  await main.keyboard.press('Control+k');
  const palette = main.locator('.palette[aria-label="Search or run a command"]');
  await palette.locator('.palette-field').fill('restart to update');
  await expect(
    palette.locator('.palette-item', { hasText: 'Restart to update (Flint 1.0.1)' }),
  ).toBeVisible();
  await main.keyboard.press('Escape');

  await version.getByRole('button', { name: 'Restart now' }).click();
  await expect.poll(async () => (await record(running)).installs).toBe(1);
});

test("the palette's Check for updates opens About and checks; nothing is contacted (APP-06, D-136)", async () => {
  const { app: running, main } = await launch();
  await main.keyboard.press('Control+k');
  const palette = main.locator('.palette[aria-label="Search or run a command"]');
  await palette.locator('.palette-field').fill('check for updates');
  await palette.locator('.palette-item', { hasText: 'Check for updates' }).click();
  await expect(main.locator('#settings-about .update-status')).toHaveText('Checking for updates…');
  expect((await record(running)).checks).toBe(1);
  // Nothing tried the network (the fake contacts nothing; the guard would have recorded it).
  const blocked = await running.evaluate(
    () =>
      (globalThis as { __flintE2E?: { blockedRequests: string[] } }).__flintE2E?.blockedRequests ??
      [],
  );
  expect(blocked).toEqual([]);
});
