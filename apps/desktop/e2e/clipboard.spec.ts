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
 * NAV-08 (D-86, D-127, D-128): Windows' clipboard history, the side panel's Clipboard section and its
 * picker. Tests never read the real history (D-93):
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
    window.setBounds({ x: -6000, y: 0, width: 1600, height: 900 });
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

const NOW = new Date(2026, 2, 10, 10, 0).getTime();

/** What Windows' clipboard history holds (as if something new was copied). */
async function holds(running: ElectronApplication, read: object, policyOff = false): Promise<void> {
  await running.evaluate(
    (_, { value, policy }) => {
      const hooks = (
        globalThis as {
          __flintE2E?: {
            clipboardHistory?: unknown;
            clipboardSequence?: number;
            clipboardPolicyOff?: boolean;
          };
        }
      ).__flintE2E;
      if (!hooks) return;
      hooks.clipboardHistory = value;
      hooks.clipboardPolicyOff = policy;
      hooks.clipboardSequence = (hooks.clipboardSequence ?? 0) + 1;
    },
    { value: read, policy: policyOff },
  );
}

const ITEMS = {
  kind: 'ok',
  items: [
    { id: 'c1', at: NOW - 60_000, text: 'deploy the hotfix tonight' },
    {
      id: 'c2',
      at: NOW - 4 * 60_000,
      text: 'https://dev.azure.com/acme/web/_git/flint',
    },
    {
      id: 'c3',
      at: NOW - 12 * 60_000,
      text: 'const total = items.reduce((sum, x) => sum + x, 0);',
    },
    { id: 'c4', at: NOW - 2 * 3_600_000, text: 'fourth thing\nwith a second line' },
    { id: 'c5', at: NOW - 3 * 3_600_000, text: null },
  ],
};

async function toInbox(main: Page): Promise<void> {
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('.context-panel .clip-section')).toBeVisible();
}

test('the Clipboard section: placeholder bars at rest, contents only after the pointer rests; Always show contents (NAV-08, D-128)', async () => {
  const { app: running, main } = await launch();
  await holds(running, ITEMS);
  await toInbox(main);
  const section = main.locator('.context-panel .clip-section');
  // Text items only, newest first; folded, three rows in view.
  await expect(section.locator('.clip-count')).toHaveText('4');
  await expect(section.locator('.clip-row')).toHaveCount(4);
  await expect(section.locator('.clip-kind')).toHaveText(['Text', 'Link', 'Code', 'Text']);
  await expect(section.locator('.clip-age').first()).toHaveText('1m');
  // At rest none of the text is drawn (D-128 Q3): not even in the page.
  expect(await section.textContent()).not.toContain('hotfix');
  const rows = section.locator('.clip-rows');
  expect((await rows.boundingBox())?.height ?? 0).toBeLessThan(4 * 30);

  // A pointer passing across shows nothing; resting ~300 ms shows the text; leaving hides it.
  const box = await section.boundingBox();
  if (!box) throw new Error('no section');
  await main.mouse.move(box.x + box.width / 2, box.y - 40);
  for (let step = 0; step <= 6; step++) {
    await main.mouse.move(box.x + 20 + step * 40, box.y + box.height / 2);
    await main.waitForTimeout(60);
  }
  expect(await section.textContent()).not.toContain('hotfix');
  await main.waitForTimeout(450);
  await expect(section.locator('.clip-text').first()).toHaveText('deploy the hotfix tonight');
  await main.mouse.move(box.x + box.width / 2, box.y - 200);
  await expect(section.locator('.clip-text')).toHaveCount(0);

  // Open: every row; remembered.
  await section.locator('.clip-fold').click();
  await expect(section).toHaveClass(/open/);
  await expect.poll(async () => (await rows.boundingBox())?.height ?? 0).toBeGreaterThan(3.5 * 30);

  // Always show contents: the text at rest, said once.
  await section.locator('.clip-eye').click();
  await expect(main.locator('.toast')).toContainText(
    'Clipboard contents will be visible when you share your screen',
  );
  await expect(section.locator('.clip-text').first()).toHaveText('deploy the hotfix tonight');
  await section.locator('.clip-eye').click();
  await expect(section.locator('.clip-text')).toHaveCount(0);
});

test('a click pastes into the field with the keyboard, one undo; the menu: Insert, Capture as task, Copy (NAV-08, D-128)', async () => {
  const { app: running, main } = await launch();
  await holds(running, ITEMS);
  await toInbox(main);
  const section = main.locator('.context-panel .clip-section');
  const composer = main.locator('.main .composer-input');

  // No field: it says where to click.
  await section.locator('.clip-row').first().click();
  await expect(main.locator('.toast')).toContainText('Click where it should go');

  // The composer keeps the keyboard; the item goes in as a paste (shorthand stays plain).
  await composer.click();
  await composer.fill('note: ');
  await section.locator('.clip-row').first().click();
  await expect(composer).toHaveValue('note: deploy the hotfix tonight');
  await expect(composer).toBeFocused();
  await main.keyboard.press('Control+z');
  await expect(composer).toHaveValue('note: ');
  // A two-line item in a one-line field: the line break becomes a space.
  await section.locator('.clip-row').nth(3).click();
  await expect(composer).toHaveValue('note: fourth thing with a second line');
  await composer.fill('');

  // Copy: the only write to the clipboard (tests see what it would have been).
  await section.locator('.clip-row').nth(1).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Copy' }).click();
  await expect
    .poll(() =>
      running.evaluate(
        () => (globalThis as { __flintE2E?: { copied?: string[] } }).__flintE2E?.copied ?? [],
      ),
    )
    .toEqual(['https://dev.azure.com/acme/web/_git/flint']);

  // Capture as task: the capture popup, prefilled as by Ctrl+Shift+X.
  await section.locator('.clip-row').first().click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Capture as task' }).click();
  const popupPage = (): Page | undefined =>
    running.windows().find((page) => page.url().includes('capture-popup'));
  await expect.poll(() => popupPage() !== undefined, { timeout: 15_000 }).toBe(true);
  await expect((popupPage() as Page).locator('#capture')).toHaveValue('deploy the hotfix tonight');
  await (popupPage() as Page).locator('#capture').press('Escape');

  // The note editor: its own paste (one undo step), the section in the note's panel too.
  await main.keyboard.press('Control+Shift+j');
  const editor = main.locator('.main .note-card .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await main.keyboard.type('Plan: ');
  await expect(section).toBeVisible();
  await section.locator('.clip-row').first().click();
  await expect(editor).toContainText('Plan: deploy the hotfix tonight');
  await main.keyboard.press('Control+z');
  await expect(editor).not.toContainText('hotfix');
  await expect(editor).toContainText('Plan:');
});

test('Paste from clipboard history… (Ctrl+Shift+H): the text, Enter inserts, Ctrl+C copies, Shift+Enter captures (NAV-08, D-128)', async () => {
  const { app: running, main } = await launch();
  await holds(running, ITEMS);
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  const composer = main.locator('.main .composer-input');
  await composer.click();
  await main.keyboard.press('Control+Shift+h');
  const picker = main.locator('.fl-picker');
  await expect(picker.locator('.fl-picker-row')).toHaveCount(4);
  // Opened on purpose: the real text.
  await expect(picker.locator('.fl-picker-label').first()).toHaveText('deploy the hotfix tonight');
  await expect(picker.locator('.fl-picker-foot')).toContainText('Shift+Enter');
  await main.keyboard.type('azure');
  await main.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(composer).toHaveValue('https://dev.azure.com/acme/web/_git/flint');
  await expect(composer).toBeFocused();
  await composer.fill('');

  // Ctrl+C copies the highlighted item.
  await main.keyboard.press('Control+Shift+h');
  await main.keyboard.press('ArrowDown');
  await main.keyboard.press('Control+c');
  await expect(picker).toHaveCount(0);
  await expect
    .poll(() =>
      running.evaluate(
        () => (globalThis as { __flintE2E?: { copied?: string[] } }).__flintE2E?.copied ?? [],
      ),
    )
    .toEqual(['deploy the hotfix tonight']);

  // The palette has it too; Shift+Enter captures as a task.
  await main.keyboard.press('Control+k');
  await main.keyboard.type('paste from clipboard');
  await main.locator('.palette-layer').getByText('Paste from clipboard history…').first().click();
  await expect(picker.locator('.fl-picker-row')).toHaveCount(4);
  await main.keyboard.type('hotfix');
  await main.keyboard.press('Shift+Enter');
  const popupPage = (): Page | undefined =>
    running.windows().find((page) => page.url().includes('capture-popup'));
  await expect.poll(() => popupPage() !== undefined, { timeout: 15_000 }).toBe(true);
  await expect((popupPage() as Page).locator('#capture')).toHaveValue('deploy the hotfix tonight');
  await (popupPage() as Page).locator('#capture').press('Escape');
});

test('the section says why when there is nothing to show: off, a policy, a read that never finished, off in Flint (NAV-08, D-127, D-128)', async () => {
  const marker = join(dataDirectory, 'appdata', 'clipboard-reading');
  // As a crash in the middle of a read leaves it.
  await writeFile(marker, '2026-03-10T09:00:00.000Z\n');
  const { app: running, main } = await launch();
  await holds(running, ITEMS);
  await toInbox(main);
  const section = main.locator('.context-panel .clip-section');
  // Paused: the folded header says so; open, the note and Try again.
  await expect(section.locator('.clip-count')).toHaveText('paused');
  await expect(section.locator('.clip-row')).toHaveCount(0);
  expect(await exists(marker)).toBe(true);
  await section.locator('.clip-fold').click();
  await expect(section.locator('.clip-note')).toContainText('stopped Flint last time');
  await section.getByRole('button', { name: 'Try again' }).click();
  await expect(section.locator('.clip-count')).toHaveText('4');
  expect(await exists(marker)).toBe(false);

  // Off in Windows: the note opens Windows' clipboard settings.
  await holds(running, { kind: 'off' });
  await expect(section.locator('.clip-count')).toHaveText('off');
  await expect(section.locator('.clip-note')).toContainText('off in Windows');
  await section.getByRole('button', { name: 'Open clipboard settings' }).click();
  await expect
    .poll(() =>
      running.evaluate(
        () => (globalThis as { __flintE2E?: { opened?: string[] } }).__flintE2E?.opened ?? [],
      ),
    )
    .toContain('ms-settings:clipboard');
  // Turned off by a policy: no button.
  await holds(running, { kind: 'off' }, true);
  await expect(section.locator('.clip-note')).toContainText('turned off on this PC');
  await expect(section.locator('.clip-note button')).toHaveCount(0);

  // Off in Flint: no section; the picker says so, with Turn on.
  await holds(running, ITEMS);
  await main.locator('.nav', { hasText: 'Settings' }).click();
  const row = main.locator('#settings-clipboard');
  await row.getByRole('switch', { name: 'Clipboard history' }).click();
  await expect(row.getByRole('switch', { name: 'Clipboard history' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await toInboxWithoutSection(main);
  await main.keyboard.press('Control+Shift+h');
  const picker = main.locator('.fl-picker');
  await expect(picker).toContainText('Clipboard history is off in Flint');
  await picker.getByText('Turn on').click();
  await expect(main.locator('.context-panel .clip-section')).toBeVisible();
});

async function toInboxWithoutSection(main: Page): Promise<void> {
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('.context-panel')).toBeVisible();
  await expect(main.locator('.context-panel .clip-section')).toHaveCount(0);
}
