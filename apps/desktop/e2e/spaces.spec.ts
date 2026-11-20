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
 * SPACE-01 to SPACE-05 (D-189, D-190; mockup 18 concept 1): spaces on this PC. With only Personal
 * the sidebar is as it always was ("Lists"); New space makes `Spaces/<name>/` and the space line
 * with its switcher appears; a list made there lives in the space's folder; Ctrl+Shift+S and 1–9
 * switch; Today's chip of a space's list carries its letter, whose click switches the sidebar.
 * Its own Flint on the suite's fixed clock (D-107), off-screen, never focused.
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
let app: ElectronApplication;
let main: Page;

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-spaces-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(join(flint, '.flint'), { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
  await writeFile(
    join(flint, 'Errands.md'),
    '---\nflint: 1\nid: errands\nmode: tasks\n---\n- [ ] Post the letter [id:: er01]\n',
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
    window.setBounds({ x: -6000, y: 0, width: 1300, height: 760 });
    window.showInactive();
  });
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Errands' }),
  ).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

const switcherName = () => main.locator('.space-btn .space-name');

test('only Personal: the switcher shows anyway, so spaces are found (SPACE-01, D-190 Q21)', async () => {
  await expect(main.locator('.space-line')).toBeVisible();
  await expect(switcherName()).toHaveText('Personal');
  await expect(main.locator('.lists-label')).toHaveCount(0);
  await expect(main.locator('.space-head .add-list')).toBeVisible();
});

test('New space from Ctrl+Shift+S: its folder, the line and the switcher appear (SPACE-03, SPACE-05)', async () => {
  // Ctrl+Shift+letter: the letter in capitals (Playwright sends Shift with it).
  await main.keyboard.press('Control+Shift+S');
  const menu = main.locator('.space-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sm-row')).toHaveCount(1);
  await menu.locator('.space-menu-item', { hasText: 'New space' }).click();
  const field = main.locator('#space-name');
  await expect(field).toBeFocused();
  await field.fill('Home');
  await field.press('Enter');
  await expect(main.locator('.space-line')).toBeVisible();
  await expect(switcherName()).toHaveText('Home');
  await expect(main.locator('.empty-space')).toBeVisible();
  const json = JSON.parse(
    await readFile(join(flint, 'Spaces', 'Home', '.flint', 'space.json'), 'utf8'),
  ) as { name: string; id: string };
  expect(json.name).toBe('Home');
  expect(json.id).toMatch(/^s-[a-z0-9]+$/);
  // Personal's lists are not under the line now.
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Errands' }),
  ).toHaveCount(0);
});

test('a list made in a space lives in its folder (SPACE-02)', async () => {
  await main.locator('.space-head .add-list').click();
  await main.locator('.fl-menu').getByText('New task list').click();
  const name = main.getByPlaceholder('List name');
  await expect(name).toBeFocused();
  await name.fill('Groceries');
  await name.press('Enter');
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Groceries' }),
  ).toBeVisible();
  await expect
    .poll(() => readFile(join(flint, 'Spaces', 'Home', 'Groceries.md'), 'utf8').catch(() => ''))
    .toContain('mode: tasks');
});

test('1–9 in the space menu switch the sidebar; Today and Inbox stay above the line (SPACE-03)', async () => {
  await main.keyboard.press('Control+Shift+S');
  await expect(main.locator('.space-menu .sm-row')).toHaveCount(2);
  await main.keyboard.press('1');
  await expect(main.locator('.space-menu')).toHaveCount(0);
  await expect(switcherName()).toHaveText('Personal');
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Errands' }),
  ).toBeVisible();
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Groceries' }),
  ).toHaveCount(0);
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Today' }),
  ).toBeVisible();
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Inbox' }),
  ).toBeVisible();
});

test('Today’s chip of a space’s list carries its letter; its click switches the sidebar (SPACE-03)', async () => {
  const groceries = join(flint, 'Spaces', 'Home', 'Groceries.md');
  const text = await readFile(groceries, 'utf8');
  await writeFile(groceries, `${text.trimEnd()}\n- [ ] Eggs [pinned:: true] [id:: eg01]\n`);
  await main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Today' }).click();
  const chip = main.locator('.chip.home-list', { hasText: 'Groceries' });
  await expect(chip).toBeVisible();
  const letter = chip.locator('.mm');
  await expect(letter).toHaveText('H');
  await letter.click();
  await expect(switcherName()).toHaveText('Home');
  // The page stays on Today: its chip is still there, the list didn't open.
  await expect(chip).toBeVisible();
  await expect(
    main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Groceries' }),
  ).toBeVisible();
});

test('a list of another space opened from Today switches the line to its space (SPACE-02)', async () => {
  await main.keyboard.press('Control+Shift+S');
  await main.keyboard.press('1');
  await expect(switcherName()).toHaveText('Personal');
  await main.locator('.space-body .nav, .sidebar > .nav', { hasText: 'Today' }).click();
  await main
    .locator('.chip.home-list', { hasText: 'Groceries' })
    .click({ position: { x: 40, y: 6 } });
  await expect(switcherName()).toHaveText('Home');
});

test('Move to space: the open list goes into another space, the line follows; Undo takes both back (SPACE-07, D-190 Q21)', async () => {
  await main.keyboard.press('Control+Shift+S');
  await main.keyboard.press('1');
  await expect(switcherName()).toHaveText('Personal');
  const errands = main.locator('.space-body .nav', { hasText: 'Errands' });
  await errands.click();
  await errands.click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Move to space', { exact: true }).hover();
  await main.locator('.fl-submenu').getByText('Home').click();
  // The open list takes the line along to its new space.
  await expect(switcherName()).toHaveText('Home');
  await expect(errands).toBeVisible();
  await expect
    .poll(() => readFile(join(flint, 'Spaces', 'Home', 'Errands.md'), 'utf8').catch(() => ''))
    .toContain('Post the letter');
  // Undo (Ctrl+Z) moves it back into Personal, and the line follows it back.
  await main.keyboard.press('Control+Z');
  await expect(switcherName()).toHaveText('Personal');
  await expect(errands).toBeVisible();
  await expect
    .poll(() => readFile(join(flint, 'Errands.md'), 'utf8').catch(() => ''))
    .toContain('Post the letter');
});

test('`##` in the composer: a space’s list carries its letter, the highlighted row names the space, and the task lands there (SPACE-04)', async () => {
  // Personal has a Groceries too: by name alone, Personal's would win.
  await writeFile(join(flint, 'Groceries.md'), '---\nflint: 1\nid: gro9\nmode: tasks\n---\n');
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  const input = main.locator('.composer-input');
  await input.click();
  await input.pressSequentially('Butter ##Groc');
  const rows = main.locator('.composer-suggestion', { hasText: 'Groceries' });
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.mm')).toHaveCount(1);
  await expect(rows.locator('.mm')).toHaveText('H');
  const all = main.locator('.composer-suggestion');
  const at = await all.evaluateAll((items) => items.findIndex((item) => item.querySelector('.mm')));
  for (let step = 0; step <= at; step++) await input.press('ArrowDown');
  const highlighted = main.locator('.composer-suggestion[aria-selected="true"]');
  await expect(highlighted.locator('.mm')).toHaveCount(1);
  await expect(highlighted.locator('.space-name-hint')).toHaveText('Home');
  await input.press('Enter');
  await expect(main.locator('.composer-suggestions')).toHaveCount(0);
  await input.press('Enter');
  await expect
    .poll(() => readFile(join(flint, 'Spaces', 'Home', 'Groceries.md'), 'utf8'))
    .toContain('Butter');
  expect(await readFile(join(flint, 'Groceries.md'), 'utf8')).not.toContain('Butter');
});

test('the letter’s and the chip’s tooltips: one short line each (D-190 Q21)', async () => {
  await main.locator('.sidebar > .nav', { hasText: 'Today' }).click();
  const chip = main.locator('.chip.home-list', { hasText: 'Groceries' });
  await chip.locator('.mm').hover();
  await expect(main.locator('.space-tip')).toHaveText('Switch to Home');
  await chip.hover({ position: { x: 60, y: 6 } });
  await expect(main.locator('.space-tip')).toHaveText('Open Groceries');
});
