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
 * D-107: the day change, on purpose. Flint starts at 23:59:30 on Tuesday 10 March 2026 (its own test
 * clock, which keeps running) and crosses into Wednesday while Today is open: the date and greeting,
 * the rollover card, done pins losing their pin, a reminder moving from Tomorrow to Today (cards,
 * timeline, Up next), the Overdue card's "Yesterday", and the countdowns. The rest of the suite runs
 * on a daytime clock (smoke.spec.ts), so nothing else depends on when the tests run.
 */

// One crossing per run: a failure stops the rest (a relaunched Flint would be back before midnight).
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();

const START = new Date(2026, 2, 10, 23, 59, 30).getTime();
const MIDNIGHT = new Date(2026, 2, 11, 0, 0, 0).getTime();
let offset = 0;
const appNow = (): number => Date.now() + offset;

let dataDirectory: string;
let app: ElectronApplication;
let main: Page;

const WORK = [
  '---\nflint: 1\nid: work\nmode: tasks\n---',
  '- [ ] Write the report [pinned:: true] [id:: dc1]',
  '- [x] Ship the build [pinned:: true] [completion:: 2026-03-10T15:00] [id:: dc2]',
  '- [ ] Call the bank [reminder:: 2026-03-11T00:30] [id:: dc3]',
  '- [ ] Pay the invoice [reminder:: 2026-03-10T23:00] [id:: dc4]',
  '',
].join('\n');

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-day-'));
  await mkdir(join(dataDirectory, 'Flint'), { recursive: true });
  await writeFile(join(dataDirectory, 'Flint', 'Work.md'), WORK);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  offset = START - Date.now();
  app = await electron.launch({
    executablePath: electronPath,
    args: [appDirectory, '--hidden'],
    env: {
      ...env,
      FLINT_E2E: '1',
      FLINT_DATA_DIR: dataDirectory,
      FLINT_E2E_CLOCK_OFFSET: String(offset),
    },
  });
  const mainPage = (): Page | undefined =>
    app.windows().find((page) => page.url().includes('main-window'));
  await expect.poll(() => mainPage() !== undefined, { timeout: 15_000 }).toBe(true);
  const page = mainPage();
  if (!page) throw new Error('main window page not found');
  main = page;
  // Shown off-screen, without the focus or a taskbar button (as in smoke.spec.ts); wide enough for
  // Today's own column.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => candidate.getTitle() === 'Flint',
    );
    if (!window) return;
    window.setSkipTaskbar(true);
    window.setBounds({ x: -6000, y: 0, width: 1800, height: 900 });
    window.showInactive();
  });
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('Flint, its windows and the test share the day-change clock (D-107)', async () => {
  const [mainTime, pageTime] = await Promise.all([
    app.evaluate(() => Date.now()),
    main.evaluate(() => Date.now()),
  ]);
  expect(Math.abs(mainTime - appNow())).toBeLessThan(2000);
  expect(Math.abs(pageTime - appNow())).toBeLessThan(2000);
  expect(appNow()).toBeLessThan(MIDNIGHT);
});

test('before midnight: Tuesday evening, the done pin, the reminder still tomorrow (D-107)', async () => {
  await expect(main.locator('.today-greeting')).toContainText('Good evening');
  await expect(main.locator('.today-date')).toContainText('Tuesday, 10 March');
  await expect(main.locator('.card.rollover')).toHaveCount(0);
  await expect(main.locator('.card.tasks .row', { hasText: 'Ship the build' })).toHaveCount(1);
  await expect(main.locator('.card.tasks .row', { hasText: 'Write the report' })).toHaveCount(1);
  // The 23:00 reminder is today's overdue one; the 00:30 one isn't today's yet.
  await expect(main.locator('.card.overdue')).toContainText('Pay the invoice');
  await expect(main.locator('.overdue-meta')).toContainText('23:00');
  await expect(main.locator('.overdue-meta')).not.toContainText('Yesterday');
  await expect(main.locator('.reminder-card', { hasText: 'Call the bank' })).toHaveCount(0);
  await expect(main.locator('.today-timeline')).not.toContainText('Call the bank');
  expect(appNow()).toBeLessThan(MIDNIGHT);
});

test('after midnight: Wednesday, the rollover card, the pin gone, the reminder today (D-107)', async () => {
  // Nothing is touched: the open Today view follows the day change by itself, promptly.
  await expect.poll(appNow, { timeout: 40_000, intervals: [250] }).toBeGreaterThan(MIDNIGHT);
  const soon = { timeout: 6000 };
  await expect.soft(main.locator('.today-date')).toContainText('Wednesday, 11 March', soon);
  // D-107: still the evening until 04:00.
  await expect.soft(main.locator('.today-greeting')).toContainText('Good evening', soon);
  // TODAY-02: yesterday's unfinished pin is asked about.
  await expect.soft(main.locator('.card.rollover')).toContainText('Write the report', soon);
  // D-85: the pin of a task done yesterday is gone, in the file too.
  await expect
    .soft(main.locator('.card.tasks .row', { hasText: 'Ship the build' }))
    .toHaveCount(0, soon);
  await expect.soft
    .poll(() => readFile(join(dataDirectory, 'Flint', 'Work.md'), 'utf8'), soon)
    .toContain('- [x] Ship the build [completion:: 2026-03-10T15:00] [id:: dc2]');
  // TODAY-03: the 00:30 reminder is today's next card, counting down, and on the timeline.
  const card = main.locator('.reminder-card.next', { hasText: 'Call the bank' });
  await expect.soft(card).toHaveCount(1, soon);
  await expect.soft(card.locator('.reminder-card-until')).toHaveText(/^in (2\d|30) min$/);
  await expect.soft(main.locator('.today-timeline')).toContainText('Call the bank');
  // REM-07: yesterday's 23:00 reminder says so.
  await expect.soft(main.locator('.overdue-meta')).toContainText('Yesterday 23:00', soon);
  // TODAY-02: Roll over keeps the pin and the card folds away.
  await main.locator('.card.rollover').getByRole('button', { name: 'Roll over' }).click();
  await expect(main.locator('.card.rollover')).toHaveCount(0);
  expect(await readFile(join(dataDirectory, 'Flint', 'Work.md'), 'utf8')).toContain(
    '- [ ] Write the report [pinned:: true] [id:: dc1]',
  );
});

test('after midnight, in a list: Up next has the reminder under Today, not Tomorrow (D-107)', async () => {
  await main.locator('.nav', { hasText: 'Work' }).first().click();
  await expect(main.locator('.list-header h1')).toContainText('Work');
  await expect(main.locator('.panel-item.today', { hasText: 'Call the bank' })).toHaveCount(1);
  await expect(main.locator('.panel-item.tomorrow')).toHaveCount(0);
  await expect(main.locator('.panel-item.overdue', { hasText: 'Pay the invoice' })).toContainText(
    'Yest 23:00',
  );
});
