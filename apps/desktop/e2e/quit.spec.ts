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
 * D-138: Flint quits cleanly whatever was just closing. A quit while the capture popup was still
 * fading out (Esc, a capture) used to hit the popup's fade timer after the window was gone; the
 * error that threw left Flint unable to exit (an error box nobody saw). Restart to update (D-136)
 * quits the same way, so it is checked with a draft waiting too. Each test starts its own Flint on
 * the suite's fixed clock (D-107), off-screen.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const NOW = new Date(2026, 2, 10, 10, 0).getTime();

let dataDirectory = '';
/** Flint's process (Playwright's handle is gone once the app has exited). */
let child: ReturnType<ElectronApplication['process']> | undefined;

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
  child = started.process();
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
  return { app: started, main };
}

/** Whether Flint's process ends within `ms`. */
function exitsWithin(ms: number): Promise<boolean> {
  const running = child;
  if (!running || running.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    running.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Asks Flint to quit, as the tray's Quit does. */
function quit(running: ElectronApplication): void {
  void running
    .evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.quit(), 0);
    })
    .catch(() => undefined);
}

const popupOf = (running: ElectronApplication): Page | undefined =>
  running.windows().find((page) => page.url().includes('capture-popup'));

test.beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-quit-'));
  await mkdir(join(dataDirectory, 'Flint'), { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
});

test.afterEach(async () => {
  if (child && child.exitCode === null) child.kill();
  child = undefined;
  await rm(dataDirectory, { recursive: true, force: true });
});

test('a quit while the popup fades out (opened from clipboard history, Esc keeps a draft) exits cleanly (CAP-08, NAV-08, D-138)', async () => {
  const { app: running, main } = await launch();
  await running.evaluate((_, at) => {
    const hooks = (
      globalThis as {
        __flintE2E?: { clipboardHistory?: unknown; clipboardSequence?: number };
      }
    ).__flintE2E;
    if (!hooks) return;
    hooks.clipboardHistory = {
      kind: 'ok',
      items: [{ id: 'c1', at: at - 60_000, text: 'deploy the hotfix tonight' }],
    };
    hooks.clipboardSequence = (hooks.clipboardSequence ?? 0) + 1;
  }, NOW);
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await main.locator('.main .composer-input').click();
  await main.keyboard.press('Control+Shift+h');
  await expect(main.locator('.fl-picker .fl-picker-row')).toHaveCount(1);
  // Capture as task: the popup opens the way the hotkey opens it (the foreground fallback too).
  await main.keyboard.type('hotfix');
  await main.keyboard.press('Shift+Enter');
  await expect.poll(() => popupOf(running) !== undefined, { timeout: 15_000 }).toBe(true);
  const popup = popupOf(running) as Page;
  await expect(popup.locator('#capture')).toHaveValue('deploy the hotfix tonight');
  // Esc keeps it as a draft and the card fades out (140 ms); the quit lands in that fade.
  await popup.locator('#capture').press('Escape');
  await new Promise((resolve) => setTimeout(resolve, 50));
  quit(running);
  expect(await exitsWithin(10_000), 'Flint exits').toBe(true);
  const drafts = await readFile(join(dataDirectory, 'appdata', 'drafts.json'), 'utf8');
  expect(drafts).toContain('deploy the hotfix tonight');
  // Nothing threw on the way out (D-138: the closed popup's fade timer used to).
  expect(await readFile(join(dataDirectory, 'logs', 'flint.log'), 'utf8')).not.toContain(
    'main process error',
  );
});

test('Restart to update quits cleanly with a draft in the popup (APP-06, CAP-08, D-136, D-138)', async () => {
  const { app: running, main } = await launch();
  await expect
    .poll(() =>
      running.evaluate(
        () =>
          (globalThis as { __flintE2E?: { updater?: unknown } }).__flintE2E?.updater !== undefined,
      ),
    )
    .toBe(true);
  await running.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  await expect.poll(() => popupOf(running) !== undefined, { timeout: 15_000 }).toBe(true);
  const popup = popupOf(running) as Page;
  await popup.locator('#capture').fill('call the bank about the card');
  await popup.locator('#capture').press('Escape');
  await running.evaluate(() =>
    (
      globalThis as {
        __flintE2E?: { updater?: { emit: (event: string, arg?: unknown) => void } };
      }
    ).__flintE2E?.updater?.emit('update-downloaded', { version: '9.9.9' }),
  );
  const toast = main.locator('.toast');
  await expect(toast).toContainText('Update ready');
  // Flint quits as the click lands, so Playwright may see the page close under its click.
  await toast
    .getByRole('button', { name: 'Restart now' })
    .click()
    .catch(() => undefined);
  expect(await exitsWithin(10_000), 'Flint exits').toBe(true);
  const log = await readFile(join(dataDirectory, 'logs', 'flint.log'), 'utf8');
  expect(log).toContain('restarting to install 9.9.9');
  expect(log).not.toContain('main process error');
  const drafts = await readFile(join(dataDirectory, 'appdata', 'drafts.json'), 'utf8');
  expect(drafts).toContain('call the bank about the card');
});

test('an error while quitting is logged and Flint still exits, with no error box (D-138)', async () => {
  const { app: running } = await launch();
  // An error nothing catches, thrown from a timer in the middle of the quit.
  void running
    .evaluate(({ app: electronApp }) => {
      electronApp.once('before-quit', () => {
        setTimeout(() => {
          throw new Error('thrown while quitting, on purpose');
        }, 0);
      });
      setTimeout(() => electronApp.quit(), 0);
    })
    .catch(() => undefined);
  expect(await exitsWithin(10_000), 'Flint exits').toBe(true);
  const log = await readFile(join(dataDirectory, 'logs', 'flint.log'), 'utf8');
  expect(log).toContain('main process error');
  expect(log).toContain('thrown while quitting, on purpose');
  expect(log).toContain('quitting');
});
