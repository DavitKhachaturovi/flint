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
 * FOCUS-01 to FOCUS-06 (D-170, mockup 15): Focus, a Pomodoro timer with its own sprint of tasks
 * sent from any list. Its own Flint on the suite's fixed clock (D-107: Tuesday 10 March 2026,
 * 10:00), off-screen, never focused. A session's end comes from the `focusEndNow` hook: tests
 * never wait 25 minutes (D-156: they wait for what they check).
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const BACKEND = [
  '---\nflint: 1\nid: backend\nmode: tasks\n---',
  '- [ ] Fix the login redirect loop [priority:: high] [id:: fx1]',
  '- [ ] Write the migration for user settings [id:: fx2]',
  '',
].join('\n');

interface Hooks {
  toasts: string[];
  focusAlarms?: number;
  focusEndNow?: () => void;
  showMini?: () => void;
}

let dataDirectory: string;
let flint: string;
let app: ElectronApplication;
let main: Page;

type Global = { __flintE2E?: Hooks };
const focusAlarms = (): Promise<number> =>
  app.evaluate(() => (globalThis as Global).__flintE2E?.focusAlarms ?? 0);
const focusToasts = (): Promise<string[]> =>
  app.evaluate(() =>
    ((globalThis as Global).__flintE2E?.toasts ?? []).filter((toast) =>
      toast.startsWith('Focus |'),
    ),
  );
const endSessionNow = (): Promise<void> =>
  app.evaluate(() => (globalThis as Global).__flintE2E?.focusEndNow?.());
const showMini = (): Promise<void> =>
  app.evaluate(() => (globalThis as Global).__flintE2E?.showMini?.());

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-focus-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await writeFile(
    join(flint, 'Inbox.md'),
    '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] Review the PR on caching [id:: in1]\n',
  );
  await writeFile(join(flint, 'Backend.md'), BACKEND);
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
    window.setBounds({ x: -6000, y: 0, width: 1400, height: 900 });
    window.showInactive();
  });
  await expect(main.locator('.nav', { hasText: 'Backend' })).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

const nav = (name: string) => main.locator('.nav:not(.flip-ghost)', { hasText: name }).first();
const row = (key: string) => main.locator(`.row[data-key="${key}"]`);

test('Focus sits under Inbox; Today’s section is Pinned; an empty sprint says how to fill it (FOCUS-01, D-170 Q2)', async () => {
  const names = await main
    .locator('aside .nav:not(.flip-ghost)')
    .evaluateAll((items) => items.slice(0, 3).map((item) => item.textContent?.trim() ?? ''));
  expect(names[0]).toMatch(/^Today/);
  expect(names[1]).toMatch(/^Inbox/);
  expect(names[2]).toMatch(/^Focus/);
  await nav('Today').click();
  await expect(main.locator('.focus-head').first()).toContainText('Pinned');
  await nav('Focus').click();
  await expect(main.locator('h1')).toHaveText('Focus');
  await expect(main.locator('.focus-timer .focus-digits')).toHaveText('25:00');
  await expect(main.locator('.focus-active')).toContainText('#1');
  await expect(main.locator('.focus-active')).toContainText('Time to focus!');
  await expect(main.locator('.card.tasks .empty')).toContainText('Send tasks here with F');
});

test('F sends a task from its list, with Go to Focus; the task line never changes; the menu says it is in Focus (FOCUS-02)', async () => {
  await nav('Backend').click();
  await row('fx1').click();
  await expect(row('fx1')).toHaveClass(/\bsel\b/);
  await main.keyboard.press('f');
  await expect(main.locator('.toast')).toContainText('Sent to Focus');
  await row('fx2').click();
  await expect(row('fx2')).toHaveClass(/\bsel\b/);
  await main.keyboard.press('f');
  await expect(main.locator('.toast')).toContainText('Sent to Focus');
  expect(await readFile(join(flint, 'Backend.md'), 'utf8')).toBe(BACKEND);
  await row('fx1').click({ button: 'right' });
  await expect(main.locator('.fl-menu')).toContainText('Remove from Focus');
  await main.keyboard.press('Escape');
  await main.locator('.toast button', { hasText: 'Go to Focus' }).click();
  await expect(main.locator('h1')).toContainText('Focus · 2 open');
  await expect(row('fx1').locator('.chip.home-list')).toHaveText('Backend');
  await expect(row('fx1').locator('.focus-count-text')).toHaveText('0/1');
  await expect(row('fx1').locator('.focus-count')).toHaveClass(/\bactive\b/);
  await expect(main.locator('.focus-active-title')).toHaveText('Fix the login redirect loop');
  await expect
    .poll(
      // Written a moment after the change (one write for several, as today.json).
      async () =>
        JSON.parse(
          await readFile(join(flint, '.flint', 'focus.json'), 'utf8').catch(() => 'null'),
        ) as unknown,
    )
    .toMatchObject({ tasks: [{ id: 'fx1' }, { id: 'fx2' }] });
});

test('Start inverts the timer card; Shift+Space pauses it back to dark; Shift+F makes a task the active one; + raises its estimate (FOCUS-01, FOCUS-02, FOCUS-03)', async () => {
  const card = main.locator('.focus-timer');
  await main.locator('.focus-go').click();
  await expect(card).toHaveClass(/\binverted\b/);
  await expect(main.locator('.focus-go')).toHaveText('Pause');
  await expect(main.locator('.focus-skip')).toBeVisible();
  await row('fx2').click();
  await expect(row('fx2')).toHaveClass(/\bsel\b/);
  await main.keyboard.press('Shift+Space');
  await expect(card).not.toHaveClass(/\binverted\b/);
  await expect(main.locator('.focus-go')).toHaveText('Resume');
  await main.keyboard.press('Shift+F');
  await expect(main.locator('.focus-active-title')).toHaveText(
    'Write the migration for user settings',
  );
  await expect(main.locator('.card.tasks .row').first()).toHaveAttribute('data-key', 'fx2');
  await main.keyboard.press('+');
  await expect(row('fx2').locator('.focus-count-text')).toHaveText('0/2');
  await expect(main.locator('.focus-plan')).toContainText('0 of 3 sessions');
  await main.keyboard.press('Shift+Space');
  await expect(card).toHaveClass(/\binverted\b/);
});

test('a session that runs to its end counts for the active task, rings and tells, and waits in a short break (FOCUS-04)', async () => {
  const before = await focusAlarms();
  await endSessionNow();
  await expect(row('fx2').locator('.focus-count-text')).toHaveText('1/2');
  await expect(main.locator('.focus-modes button.on')).toHaveText('Short break');
  await expect(main.locator('.focus-timer')).not.toHaveClass(/\binverted\b/);
  await expect(main.locator('.focus-digits')).toHaveText('05:00');
  await expect(main.locator('.focus-active')).toContainText('#2');
  await expect(main.locator('.focus-active-title')).toHaveText('Time for a break!');
  await expect.poll(focusAlarms).toBe(before + 1);
  await expect.poll(focusToasts).toContain('Focus | Focus session done | Time for a break');
  // A mode tab switches without counting.
  await main.locator('.focus-modes button', { hasText: 'Focus' }).click();
  await expect(main.locator('.focus-digits')).toHaveText('25:00');
});

test('the composer adds to Inbox and the end of the sprint; ⋯ Remove all only empties the sprint (FOCUS-02)', async () => {
  await main.locator('.composer input').fill('Plan the release');
  await main.locator('.composer input').press('Enter');
  await expect(main.locator('.card.tasks .row').last()).toContainText('Plan the release');
  await expect(main.locator('.card.tasks .row').last().locator('.chip.home-list')).toHaveText(
    'Inbox',
  );
  await expect
    .poll(() => readFile(join(flint, 'Inbox.md'), 'utf8'))
    .toContain('- [ ] Plan the release');
  await main.locator('.focus-tool[aria-label="More"]').click();
  await main.locator('.fl-menu-item', { hasText: 'Remove all from Focus' }).click();
  await expect(main.locator('.card.tasks .empty')).toBeVisible();
  expect(await readFile(join(flint, 'Backend.md'), 'utf8')).toBe(BACKEND);
  await main.keyboard.press('Control+z');
  await expect(main.locator('.card.tasks .row')).toHaveCount(3);
});

test('the gear opens Focus settings; a ready mode takes the new length; Settings has the same section (FOCUS-05)', async () => {
  await main.locator('.focus-go').click();
  await main.locator('.focus-skip').click();
  await main.locator('.focus-modes button', { hasText: 'Focus' }).click();
  await expect(main.locator('.focus-digits')).toHaveText('25:00');
  await main.locator('.focus-tool[aria-label="Focus settings"]').click();
  const card = main.locator('.focus-settings-card');
  await expect(card).toBeVisible();
  const minutes = card.locator('input[aria-label="Focus minutes"]');
  await minutes.fill('50');
  await minutes.press('Enter');
  await expect(main.locator('.focus-digits')).toHaveText('50:00');
  await card.locator('button', { hasText: 'OK' }).click();
  await expect(card).toHaveCount(0);
  await nav('Settings').click();
  await expect(main.locator('#settings-focus input[aria-label="Focus minutes"]')).toHaveValue('50');
  await nav('Focus').click();
});

test('mini: Inbox then Focus first in the picker; Focus shows the compact timer and the "1/2"; another tab shows the time (FOCUS-06)', async () => {
  await showMini();
  await expect.poll(() => app.windows().some((page) => page.url().includes('/mini/'))).toBe(true);
  const mini = app.windows().find((page) => page.url().includes('/mini/')) as Page;
  const tab = mini.locator('.mini-tabs .mini-tab-list');
  await expect(tab).toHaveText('Inbox');
  // The list tab active first (D-156: wait for it), so the next click opens its picker.
  await mini.keyboard.press('Control+2');
  await expect(tab).toHaveClass(/\bon\b/);
  await tab.click();
  const picker = mini.locator('.fl-picker');
  await expect(picker.locator('.fl-picker-search')).toBeFocused();
  await expect(picker.locator('.fl-picker-row').first()).toContainText('Focus');
  await mini.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  // From another list, Inbox and Focus come first.
  await mini.locator('.mini-tabs .mini-tab-pick').click();
  await picker.locator('.fl-picker-row', { hasText: 'Backend' }).click();
  await expect(tab).toContainText('Backend');
  await tab.click();
  await expect(picker.locator('.fl-picker-row').nth(0)).toContainText('Inbox');
  await expect(picker.locator('.fl-picker-row').nth(1)).toContainText('Focus');
  await picker.locator('.fl-picker-row', { hasText: 'Focus' }).click();
  await expect(tab).toContainText('Focus');
  await expect(mini.locator('.mini-focus .mini-focus-digits')).toHaveText('50:00');
  await expect(mini.locator(`.row[data-key="fx2"] .focus-count-text`)).toHaveText('1/2');
  await mini.locator('.mini-focus-go').click();
  await expect(main.locator('.focus-timer')).toHaveClass(/\binverted\b/);
  await expect(mini.locator('.mini-focus')).toHaveClass(/\bfocus\b/);
  await mini.keyboard.press('Control+1');
  await expect(tab.locator('.mini-tab-time')).toHaveText(/^\d\d:\d\d$/);
  await mini.keyboard.press('Control+2');
  await expect(tab.locator('.mini-tab-time')).toHaveCount(0);
  await mini.locator('.mini-focus-go').click();
  await expect(main.locator('.focus-go')).toHaveText('Resume');
});
