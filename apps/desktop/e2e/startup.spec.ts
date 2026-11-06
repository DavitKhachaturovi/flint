import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
 * D-116: a new version starts on the settings an older one saved, and they work at once, with
 * nothing re-saved. The first start after an update reads a cold disk, so main was still reading
 * the Flint folder when the page asked for its link patterns; the call failed unseen and the
 * patterns stayed off until they were saved again in Settings. The test holds main's start
 * (FLINT_E2E_SLOW_START, development builds only) so the page always asks first. Its own Flint on
 * the suite's fixed clock (D-107), off-screen, never focused.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();

let dataDirectory: string;
let app: ElectronApplication;
let main: Page;

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-startup-'));
  const flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
  // As 0.8.13 left it: a pattern saved before D-105 (no examples), one with its examples, and the
  // animation speed.
  await writeFile(
    join(dataDirectory, 'appdata', 'settings.json'),
    JSON.stringify({
      version: 1,
      animationSpeed: 'quick',
      linkPatterns: [
        { short: 'DEV-{id}', url: 'https://tracker.example.com/browse/DEV-{id}' },
        {
          short: '{id}-repo',
          url: 'https://dev.azure.com/acme/web/_git/{id}',
          kinds: { id: 'word' },
          examples: [
            { url: 'https://dev.azure.com/acme/web/_git/platform', short: 'platform-repo' },
            { url: 'https://dev.azure.com/acme/web/_git/web-api', short: 'web-api-repo' },
          ],
        },
      ],
    }),
  );
  await writeFile(
    join(flint, 'Work.md'),
    [
      '---\nflint: 1\nid: work\nmode: tasks\n---',
      '- [ ] check DEV-123 in web-api-repo [id:: st1]',
      '',
    ].join('\n'),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  app = await electron.launch({
    executablePath: electronPath,
    args: [appDirectory, '--hidden'],
    env: {
      ...env,
      FLINT_E2E: '1',
      FLINT_DATA_DIR: dataDirectory,
      FLINT_E2E_CLOCK_OFFSET: String(CLOCK_OFFSET),
      FLINT_E2E_SLOW_START: '3000',
    },
  });
  await expect
    .poll(() => app.windows().some((page) => page.url().includes('main-window')), {
      timeout: 15_000,
    })
    .toBe(true);
  main = app.windows().find((page) => page.url().includes('main-window')) as Page;
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint');
    if (!window) return;
    window.setSkipTaskbar(true);
    window.setBounds({ x: -6000, y: 0, width: 1400, height: 860 });
    window.showInactive();
  });
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('settings an older version saved work right after the update, nothing re-saved (D-116, NOTE-07)', async () => {
  // The page was up and asking while main was still reading the folder.
  await main.waitForLoadState('domcontentloaded');
  await main.locator('.nav', { hasText: 'Work' }).click({ timeout: 15_000 });
  const links = main.locator('.row', { hasText: 'check' }).locator('.title.md a');
  await expect(links).toHaveText(['DEV-123', 'web-api-repo']);
  await expect(links.first()).toHaveAttribute('href', 'https://tracker.example.com/browse/DEV-123');
  // The animation speed it saved is in force too (D-67).
  expect(
    await main.evaluate(() => document.documentElement.style.getPropertyValue('--fl-dur-page')),
  ).not.toBe('');
});
