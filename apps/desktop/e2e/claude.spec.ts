import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
 * TASK-18, D-151: Give to Claude. The task's menu, G, the side panel and the palette open the
 * card; the folder comes from the picker, the recent ones or the list's own (Shift+Enter, the
 * list's menu, Settings → Claude); the claude:// link carries the prompt, or, too long for it, the
 * clipboard does; Claude not installed says so with Download. Nothing is opened, copied or sent:
 * the test hooks record it (D-93, APP-09). Its own Flint on the suite's fixed clock (D-107),
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

let dataDirectory: string;
let flint: string;
let acmeWeb: string;
let acmeApi: string;
let app: ElectronApplication;
let main: Page;

const LONG = 'word '.repeat(3_000).trim();
const LONG_PROMPT = `# A long one\n\n${LONG}\n`;
const UNICORN = [
  '---',
  'flint: 1',
  'id: unicorn',
  'mode: tasks',
  '---',
  '- [ ] Fix the login redirect loop [priority:: high] [id:: t1]',
  '    After signing in, the page bounces.',
  '    ![shot](attachments/loop.png)',
  '    - [x] Reproduce on staging [id:: s1]',
  '    - [ ] Check the cookie domain [id:: s2]',
  '        It might be the domain.',
  '- [ ] A long one [id:: t2]',
  `    ${LONG}`,
  '',
].join('\n');

interface Hooks {
  opened: string[];
  copied?: string[];
  blockedRequests: string[];
  pickClaudeFolder?: string | null;
  claudeMissing?: boolean;
}
const hooks = (): Promise<Hooks> =>
  app.evaluate(() => (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E);
const setHooks = (changes: Partial<Hooks>): Promise<void> =>
  app.evaluate((_electron, values) => {
    Object.assign((globalThis as unknown as { __flintE2E: Hooks }).__flintE2E, values);
  }, changes);
/** The claude:// links handed over so far. */
const links = async (): Promise<string[]> =>
  (await hooks()).opened.filter((url) => url.startsWith('claude://'));
const query = (url: string): URLSearchParams => new URLSearchParams(url.split('?')[1] ?? '');
interface SavedSettings {
  readonly claudeFolders?: Record<string, string>;
  readonly claudeRecentFolders?: string[];
}
const settings = async (): Promise<SavedSettings> =>
  JSON.parse(
    await readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8').catch(() => '{}'),
  ) as SavedSettings;

const card = (): ReturnType<Page['locator']> => main.locator('.give-to-claude');
const folderRows = (): ReturnType<Page['locator']> => card().locator('.palette-item');
const toast = (): ReturnType<Page['locator']> => main.locator('.toast');
const row = (title: string): ReturnType<Page['locator']> =>
  main.locator('.row', { hasText: title }).first();
const menu = (): ReturnType<Page['locator']> => main.locator('.fl-menu:not(.fl-submenu)');
/** Selects a task with a first click (a second click on a selected row would edit its title). */
async function select(title: string): Promise<void> {
  await main.keyboard.press('Escape');
  await row(title).click();
}

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-claude-'));
  flint = join(dataDirectory, 'Flint');
  acmeWeb = join(dataDirectory, 'code', 'acme-web');
  acmeApi = join(dataDirectory, 'code', 'acme-api');
  for (const folder of [join(flint, '.flint'), acmeWeb, acmeApi])
    await mkdir(folder, { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
  await writeFile(join(flint, 'Unicorn.md'), UNICORN);
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
    },
  });
  await expect
    .poll(() => app.windows().some((page) => page.url().includes('main-window')), {
      timeout: 15_000,
    })
    .toBe(true);
  main = app.windows().find((page) => page.url().includes('main-window')) as Page;
  // Wide enough for the side panel (NAV-07).
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint');
    if (!window) return;
    window.setSkipTaskbar(true);
    window.setBounds({ x: -6000, y: 0, width: 1720, height: 900 });
    window.showInactive();
  });
  await main.locator('.nav', { hasText: 'Unicorn' }).first().click();
  await expect(row('Fix the login redirect loop')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('the task menu: Give to Claude, a folder chosen, the prompt in the claude:// link (D-151)', async () => {
  await row('Fix the login redirect loop').click({ button: 'right' });
  await menu().getByText('Give to Claude', { exact: true }).click();
  await expect(card()).toBeVisible();
  await expect(card().locator('.give-title')).toHaveText('Fix the login redirect loop');
  // No folder yet: only Choose a folder…; the count before anything is given.
  await expect(folderRows()).toHaveText(['Choose a folder…Ctrl O']);
  await expect(card().locator('.give-count')).toHaveText(
    /^\d+ \/ 14,336 characters · about \d+ tokens$/,
  );
  await setHooks({ pickClaudeFolder: acmeWeb });
  await main.keyboard.press('Enter');
  await expect(card()).toHaveCount(0);
  await expect(toast()).toContainText('Given to Claude · acme-web');
  const [url] = await links();
  expect(url?.startsWith('claude://code/new?q=')).toBe(true);
  expect(query(url ?? '').get('folder')).toBe(acmeWeb);
  expect(query(url ?? '').get('q')).toBe(
    [
      '# Fix the login redirect loop',
      '',
      'After signing in, the page bounces.',
      `![shot](<${join(flint, 'attachments', 'loop.png')}>)`,
      '',
      '## Subtasks',
      '- [x] Reproduce on staging',
      '- [ ] Check the cookie domain',
      '    It might be the domain.',
      '',
    ].join('\n'),
  );
  expect((await hooks()).copied ?? []).toEqual([]);
  await expect.poll(async () => (await settings()).claudeRecentFolders).toEqual([acmeWeb]);
  // The task is as it was.
  expect(await readFile(join(flint, 'Unicorn.md'), 'utf8')).toBe(UNICORN);
});

test('G: the recent folder first; Shift+Enter gives and makes it the list’s; Esc closes (D-151)', async () => {
  await select('Fix the login redirect loop');
  await main.keyboard.press('g');
  await expect(card()).toBeVisible();
  await expect(folderRows().first()).toContainText('acme-web');
  await expect(folderRows().first()).toContainText('Recent');
  await expect(folderRows().first()).toHaveClass(/\bon\b/);
  await main.keyboard.press('Escape');
  await expect(card()).toHaveCount(0);
  expect(await links()).toHaveLength(1);

  await main.keyboard.press('g');
  await expect(folderRows().first()).toContainText('acme-web');
  await main.keyboard.press('Shift+Enter');
  await expect(card()).toHaveCount(0);
  await expect.poll(async () => (await links()).length).toBe(2);
  await expect.poll(async () => (await settings()).claudeFolders).toEqual({ unicorn: acmeWeb });
  // Now it is the list's folder, first, and tagged so.
  await main.keyboard.press('g');
  await expect(folderRows().first()).toContainText("Unicorn's folder");
  await main.keyboard.press('Escape');
  await expect(card()).toHaveCount(0);
});

test('a subtask gives itself with its parent; a prompt too long for a link goes to the clipboard (D-151)', async () => {
  await row('Check the cookie domain').click({ button: 'right' });
  await menu().getByText('Give to Claude', { exact: true }).click();
  await expect(folderRows().first()).toContainText('acme-web');
  await main.keyboard.press('Enter');
  await expect.poll(async () => (await links()).length).toBe(3);
  expect(query((await links())[2] ?? '').get('q')).toBe(
    '# Check the cookie domain\n\nIt might be the domain.\n\nPart of: Fix the login redirect loop\n',
  );

  await select('A long one');
  await main.keyboard.press('g');
  await expect(card().locator('.give-count')).toContainText(
    `Too long for a link (${LONG_PROMPT.length.toLocaleString('en-US')} characters`,
  );
  await main.keyboard.press('Enter');
  await expect(toast()).toContainText('Copied: paste it into Claude with Ctrl+V');
  await expect.poll(async () => (await links()).length).toBe(4);
  const url = (await links())[3] ?? '';
  expect(query(url).get('q')).toBe(
    'Paste the task from Flint here (Ctrl+V), in place of this line.',
  );
  expect(query(url).get('folder')).toBe(acmeWeb);
  expect((await hooks()).copied).toEqual([LONG_PROMPT]);
});

test('the side panel and the palette open it too; the list’s menu and the palette set its folder (D-151)', async () => {
  await select('Fix the login redirect loop');
  await main.locator('.context-panel button[title="Give to Claude (G)"]').click();
  await expect(card()).toBeVisible();
  await main.keyboard.press('Escape');
  await expect(card()).toHaveCount(0);

  await main.keyboard.press('Control+k');
  const palette = main.locator('.palette:not(.give-to-claude)');
  await palette.locator('.palette-field').fill('give to claude');
  await expect(palette.locator('.palette-item').first()).toContainText('Give to Claude');
  await main.keyboard.press('Enter');
  await expect(card()).toBeVisible();
  await main.keyboard.press('Escape');
  await expect(card()).toHaveCount(0);

  // The list's menu: Claude folder ›, its path, Change…, Forget.
  await main.locator('.nav', { hasText: 'Unicorn' }).first().click({ button: 'right' });
  await menu().getByText('Claude folder', { exact: true }).hover();
  const submenu = main.locator('.fl-submenu .fl-menu-item > span:first-child');
  await expect(submenu).toHaveText([acmeWeb, 'Change…', 'Forget']);
  await setHooks({ pickClaudeFolder: acmeApi });
  await main.locator('.fl-submenu').getByText('Change…', { exact: true }).click();
  await expect(toast()).toContainText('Unicorn gives to Claude in acme-api');
  await expect.poll(async () => (await settings()).claudeFolders).toEqual({ unicorn: acmeApi });

  // The palette: Forget Claude folder for this list.
  await main.keyboard.press('Control+k');
  await palette.locator('.palette-field').fill('forget claude folder');
  await expect(palette.locator('.palette-item').first()).toContainText(
    'Forget Claude folder for this list',
  );
  await main.keyboard.press('Enter');
  await expect(toast()).toContainText('Unicorn has no Claude folder now');
  await expect.poll(async () => (await settings()).claudeFolders).toEqual({});
});

test('Claude not installed: a toast with Download, which opens the download page (D-151)', async () => {
  await setHooks({ claudeMissing: true });
  const before = (await links()).length;
  await select('Fix the login redirect loop');
  await main.keyboard.press('g');
  await expect(folderRows().first()).toContainText('acme-web');
  await main.keyboard.press('Enter');
  await expect(toast()).toContainText("Claude isn't installed, or Windows couldn't open it");
  await toast().getByRole('button', { name: 'Download' }).click();
  await expect.poll(async () => (await hooks()).opened).toContain('https://claude.com/download');
  expect(await links()).toHaveLength(before);
  await setHooks({ claudeMissing: false });
});

test('Settings → Claude: a list’s folder with Forget, Clear recent folders; the Privacy line (D-151)', async () => {
  await select('Fix the login redirect loop');
  await main.keyboard.press('g');
  await expect(folderRows().first()).toContainText('acme-web');
  await setHooks({ pickClaudeFolder: acmeApi });
  await main.keyboard.press('Control+Shift+O');
  await expect.poll(async () => (await settings()).claudeFolders).toEqual({ unicorn: acmeApi });

  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  const list = main.locator('.claude-folders .link-pattern');
  await expect(list).toHaveCount(1);
  await expect(list).toContainText('Unicorn');
  await expect(list).toContainText(acmeApi);
  await list.getByRole('button', { name: 'Forget' }).click();
  await expect(main.locator('.claude-none')).toBeVisible();
  await main.getByRole('button', { name: 'Clear recent folders' }).click();
  await expect(main.getByRole('button', { name: 'Clear recent folders' })).toHaveCount(0);
  await expect.poll(async () => (await settings()).claudeRecentFolders).toEqual([]);
  await expect(main.getByText('Give to Claude only hands a task to the Claude app')).toBeVisible();
});

test('no request leaves Flint (APP-09)', async () => {
  expect((await hooks()).blockedRequests).toEqual([]);
});
