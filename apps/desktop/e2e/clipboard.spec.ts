import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
 * NAV-08 (D-86, D-127): Windows' clipboard history. Tests never read the real history (D-93):
 * main's test hook says what it holds. Each test starts its own Flint on the suite's fixed clock
 * (D-107), off-screen, never focused.
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
    window.setBounds({ x: -6000, y: 0, width: 1300, height: 860 });
    window.showInactive();
  });
  return { app: started, main };
}

test.beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-clipboard-'));
  await mkdir(join(dataDirectory, 'Flint'), { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(dataDirectory, { recursive: true, force: true });
});

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** What Windows' clipboard history holds, for this Flint. */
async function holds(running: ElectronApplication, read: object): Promise<void> {
  await running.evaluate((_, value) => {
    const hooks = (globalThis as { __flintE2E?: { clipboardHistory?: unknown } }).__flintE2E;
    if (hooks) hooks.clipboardHistory = value;
  }, read);
}

async function check(main: Page): Promise<void> {
  await main.keyboard.press('Control+k');
  await main.keyboard.type('check clipboard');
  await main.locator('.palette-layer').getByText('Check clipboard history').first().click();
}

test('Check clipboard history says what it read, off and refused too (NAV-08, D-127)', async () => {
  const { app: running, main } = await launch();
  const toast = main.locator('.toast');
  await holds(running, {
    kind: 'ok',
    items: [
      { at: 2, text: 'the newest   copied\ntext' },
      { at: 1, text: null },
    ],
  });
  await check(main);
  await expect(toast).toContainText('Clipboard history works: 2 items (1 text)');
  await expect(toast).toContainText('Newest: “the newest copied text”');
  await holds(running, { kind: 'off' });
  await check(main);
  await expect(toast).toContainText('Clipboard history is off in Windows');
  await holds(running, { kind: 'denied' });
  await check(main);
  await expect(toast).toContainText('Flint wasn’t in front');
});

test('a read that never finished leaves reading off until Retry (NAV-08, D-127)', async () => {
  const marker = join(dataDirectory, 'appdata', 'clipboard-reading');
  // As a crash in the middle of a read leaves it.
  await writeFile(marker, '2026-03-10T09:00:00.000Z\n');
  const { app: running, main } = await launch();
  const toast = main.locator('.toast');
  await holds(running, { kind: 'ok', items: [{ at: 1, text: 'back again' }] });
  await check(main);
  await expect(toast).toContainText('never finished, so reading is off');
  expect(await exists(marker)).toBe(true);
  await toast.getByRole('button', { name: 'Retry' }).click();
  await expect(toast).toContainText('Clipboard history works: 1 item (1 text)');
  expect(await exists(marker)).toBe(false);
});
