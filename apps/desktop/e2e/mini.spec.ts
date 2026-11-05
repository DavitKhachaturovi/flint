import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
 * MINI-01, REM-06, D-109: mini mode, beside the main window. Its own Flint on the suite's fixed
 * clock (Tuesday 10 March 2026 from 10:00, D-107); both windows off-screen and never focused
 * (Davit's machine runs these). One run in order: a failure stops the rest.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();

const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const appNow = (): Date => new Date(Date.now() + CLOCK_OFFSET);
const two = (n: number): string => String(n).padStart(2, '0');
const stamp = (d: Date): string =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;

let dataDirectory: string;
let flint: string;
let app: ElectronApplication;
let main: Page;
let mini: Page;

type Hooks = {
  showMini?: () => void;
  hideMini?: () => void;
  miniVisible?: () => boolean;
  toasts: string[];
  closedToasts?: string[];
};
/** A test hook: called when it is a function, else its value. */
const hook = (name: keyof Hooks): Promise<unknown> =>
  app.evaluate((_electron, key) => {
    const found = (globalThis as { __flintE2E?: Record<string, unknown> }).__flintE2E;
    const value = found?.[key];
    return typeof value === 'function' ? (value as () => unknown)() : value;
  }, name);

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-mini-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await writeFile(
    join(flint, 'Work.md'),
    [
      '---\nflint: 1\nid: work\nmode: tasks\n---',
      '- [ ] Write the mini report [pinned:: true] [id:: mw1]',
      '- [ ] Urgent and pinned [priority:: high] [pinned:: true] [id:: mw2]',
      '- [ ] Call the vendor [reminder:: 2026-03-10T15:00] [id:: mw3]',
      '- [ ] Not for mini [priority:: high] [id:: mw4]',
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
    },
  });
  const page = (part: string): Page | undefined =>
    app.windows().find((each) => each.url().includes(part));
  await expect.poll(() => page('main-window') !== undefined, { timeout: 15_000 }).toBe(true);
  main = page('main-window') as Page;
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint');
    if (!window) return;
    window.setSkipTaskbar(true);
    window.setBounds({ x: -6000, y: 0, width: 1400, height: 860 });
    window.showInactive();
  });
  await expect(main.locator('.nav', { hasText: 'Work' })).toBeVisible();
  await writeFile(
    join(flint, 'Inbox.md'),
    '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] Inbox thing one [id:: in1]\n- [ ] Inbox thing two [id:: in2]\n',
  );
  await hook('showMini');
  await expect.poll(() => page('/mini/') !== undefined, { timeout: 15_000 }).toBe(true);
  mini = page('/mini/') as Page;
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

/** Mini mode's window: always on top, or left out of screen shares. */
const miniWindow = (what: 'onTop' | 'protected'): Promise<boolean | undefined> =>
  app.evaluate(({ BrowserWindow }, which) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint mini');
    return which === 'onTop' ? window?.isAlwaysOnTop() : window?.isContentProtected();
  }, what);

test('mini mode: on top, hidden from screen sharing (both switches), no taskbar button (D-109)', async () => {
  await expect.poll(() => hook('miniVisible')).toBe(true);
  expect(await miniWindow('onTop')).toBe(true);
  expect(await miniWindow('protected')).toBe(true);
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((each) => each.getTitle() === 'Flint capture')
        ?.isContentProtected(),
    ),
  ).toBe(true);
  // Settings → Mini mode → Hide from screen sharing, off and on again.
  await main.evaluate(() =>
    window.flintMain.setSetting({ key: 'miniHideFromSharing', value: false }),
  );
  expect(await miniWindow('protected')).toBe(false);
  await main.evaluate(() =>
    window.flintMain.setSetting({ key: 'miniHideFromSharing', value: true }),
  );
  expect(await miniWindow('protected')).toBe(true);
  // The pin turns "always on top" off and on, remembered.
  await mini.locator('.mini-tool[aria-pressed]').click();
  await expect.poll(() => miniWindow('onTop')).toBe(false);
  await mini.locator('.mini-tool[aria-pressed]').click();
  await expect.poll(() => miniWindow('onTop')).toBe(true);
  // D-109: Ctrl+Alt+Space by default.
  expect((await main.evaluate(() => window.flintMain.hotkeys()))?.mini.accelerator).toBe(
    'Control+Alt+Space',
  );
});

test("Today: pinned tasks, then today's later reminders; no high-priority group (D-109, Q4)", async () => {
  const titles = mini.locator('.mini-row:not(.leaving) .mini-title');
  await expect(titles).toHaveText([
    'Write the mini report',
    'Urgent and pinned',
    'Call the vendor',
  ]);
  await expect(
    mini.locator('.mini-row', { hasText: 'Call the vendor' }).locator('.mini-when'),
  ).toHaveText('15:00');
  await expect(
    mini.locator('.mini-row', { hasText: 'Urgent and pinned' }).locator('.stripe'),
  ).toHaveClass(/p-high/);
});

test('a click selects, a double-click opens it in the main window, mini stays (D-109, Q4)', async () => {
  const row = mini.locator('.mini-row', { hasText: 'Write the mini report' });
  await row.click();
  await expect(row).toHaveClass(/(^| )sel( |$)/);
  // A single click never brings the main window to the task.
  await expect(main.locator('h1')).not.toContainText('Work');
  await row.dblclick();
  await expect(main.locator('h1')).toContainText('Work');
  await expect(main.locator('.row.sel')).toContainText('Write the mini report');
  expect(await hook('miniVisible')).toBe(true);
  // Enter does the same (Today again first).
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
  await mini.keyboard.press('Enter');
  await expect(main.locator('h1')).toContainText('Work');
});

test('Space completes (the row leaves), Ctrl+Z brings it back; keys stay in a text field (D-109, Q7)', async () => {
  const file = join(flint, 'Work.md');
  await mini.locator('.mini-row', { hasText: 'Write the mini report' }).click();
  await mini.keyboard.press('Space');
  await expect(
    mini.locator('.mini-row:not(.leaving)', { hasText: 'Write the mini report' }),
  ).toHaveCount(0);
  await expect.poll(() => readFile(file, 'utf8')).toContain('- [x] Write the mini report');
  await mini.keyboard.press('Control+z');
  await expect(mini.locator('.mini-row', { hasText: 'Write the mini report' })).toHaveCount(1);
  await expect.poll(() => readFile(file, 'utf8')).toContain('- [ ] Write the mini report');
  // N goes to the composer; a letter typed there is text, not a command.
  await mini.locator('.mini-row', { hasText: 'Urgent and pinned' }).click();
  await mini.keyboard.press('n');
  await expect(mini.locator('.mini-composer-input')).toBeFocused();
  await mini.keyboard.type('p');
  await expect(mini.locator('.mini-composer-input')).toHaveValue('p');
  expect(await readFile(file, 'utf8')).toContain(
    'Urgent and pinned [priority:: high] [pinned:: true]',
  );
  await mini.locator('.mini-composer-input').fill('Added from mini !h');
  await mini.keyboard.press('Enter');
  await expect(mini.locator('.mini-row', { hasText: 'Added from mini' })).toHaveCount(1);
  await expect
    .poll(() => readFile(join(flint, 'Inbox.md'), 'utf8'))
    .toMatch(/- \[ \] Added from mini \[pinned:: true\] \[priority:: high\]/);
  await mini.keyboard.press('Escape');
  await expect(mini.locator('.mini-composer-input')).not.toBeFocused();
});

test('Inbox: its open tasks; P pins, and the task joins Today (D-109)', async () => {
  await mini.keyboard.press('Control+2');
  await expect(mini.locator('.mini-tab.on')).toHaveText('Inbox');
  await expect(mini.locator('.mini-row', { hasText: 'Inbox thing one' })).toHaveCount(1);
  await mini.locator('.mini-row', { hasText: 'Inbox thing two' }).click();
  await mini.keyboard.press('p');
  await expect
    .poll(() => readFile(join(flint, 'Inbox.md'), 'utf8'))
    .toContain('- [ ] Inbox thing two [pinned:: true]');
  await mini.keyboard.press('Control+1');
  await expect(mini.locator('.mini-row', { hasText: 'Inbox thing two' })).toHaveCount(1);
  // Right-click: Complete, Pin/Unpin, Open in Flint.
  await mini.locator('.mini-row', { hasText: 'Inbox thing two' }).click({ button: 'right' });
  await expect(mini.locator('.fl-menu .fl-menu-item')).toHaveText([
    /Complete/,
    /Unpin/,
    /Open in Flint/,
  ]);
  await mini.keyboard.press('Escape');
});

test('a reminder: the toast and the card; Done in mini completes it and takes the toast back (REM-06, D-109)', async () => {
  const at = stamp(appNow());
  await writeFile(
    join(flint, 'Calls.md'),
    `---\nflint: 1\nid: calls\nmode: tasks\n---\n- [ ] Ring the bank [reminder:: ${at}] [id:: rb1]\n- [ ] Ring the school [reminder:: ${at}] [id:: rs1]\n`,
  );
  const card = mini.locator('.mini-alert');
  await expect(card).toBeVisible({ timeout: 40_000 });
  await expect(card).toContainText('1 of 2');
  expect(
    ((await hook('toasts')) as string[]).filter((each) => each.includes('Ring the')),
  ).toHaveLength(2);
  const first = (await card.locator('.mini-alert-title').innerText()).trim();
  await mini.locator('.mini-row').first().click();
  await mini.keyboard.press('d');
  await expect(card).not.toContainText('1 of 2');
  await expect(card.locator('.mini-alert-title')).not.toHaveText(first);
  await expect.poll(() => readFile(join(flint, 'Calls.md'), 'utf8')).toContain(`- [x] ${first}`);
  expect(((await hook('closedToasts')) as string[]).length).toBe(1);
  // Acting on the toast (Windows hands Flint its button) clears the card too.
  const id = first === 'Ring the bank' ? 'rs1' : 'rb1';
  await app.evaluate(
    (_electron, target) =>
      (globalThis as { __flintE2E?: { activate?: (url: string) => void } }).__flintE2E?.activate?.(
        `flint-dev://reminder/done?id=${target}`,
      ),
    id,
  );
  await expect(card).toHaveCount(0);
});

test('the Note tab: made on the first keystroke, one window edits it at a time (D-109, Q5)', async () => {
  const before = (await readdir(flint)).length;
  await mini.keyboard.press('Control+3');
  const editor = mini.locator('.mini-editor .cm-content');
  await expect(editor).toBeVisible();
  // Just looking makes nothing.
  await mini.waitForTimeout(400);
  expect((await readdir(flint)).length).toBe(before);
  await editor.click();
  await mini.keyboard.type('Sticky from mini');
  await expect.poll(async () => (await readdir(flint)).length).toBe(before + 1);
  await expect(main.locator('.quick-notes .nav', { hasText: 'Sticky from mini' })).toHaveCount(1);
  // The main window opens it: read-only there while mini edits it.
  await main.locator('.quick-notes .nav', { hasText: 'Sticky from mini' }).click();
  await expect(main.locator('.note-elsewhere')).toHaveText('Editing in mini mode');
  await mini.keyboard.type(' and more');
  await expect(main.locator('.note-editor .cm-content')).toContainText('Sticky from mini and more');
  // A click into the main window's note takes the editing there (mini saved first).
  await main.locator('.note-editor .cm-content').click();
  await expect(main.locator('.note-elsewhere')).toHaveCount(0);
  await expect(mini.locator('.note-elsewhere')).toHaveText('Editing in the main window');
  await main.keyboard.press('End');
  await main.keyboard.type('!');
  await expect(mini.locator('.mini-editor .cm-content')).toContainText(
    'Sticky from mini and more!',
  );
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
});

test('× hides mini mode; the palette and the cheat sheet know it (D-109, D-106)', async () => {
  await mini.locator('.mini-tool[aria-label="Hide mini mode"]').click();
  await expect.poll(() => hook('miniVisible')).toBe(false);
  await main.keyboard.press('Control+k');
  await main.keyboard.type('mini mode');
  // Go to → Settings: Mini mode comes first (D-107's order); the command is under Commands.
  await main
    .locator('.palette-group', { hasText: 'Commands' })
    .locator('.palette-item', { hasText: /^Mini mode/ })
    .click();
  await expect.poll(() => hook('miniVisible')).toBe(true);
  await main.keyboard.press('Shift+Slash');
  await expect(main.locator('.cheat-sheet .cheat-group[aria-label="Mini mode"]')).toHaveCount(1);
  await main.keyboard.press('Escape');
});
