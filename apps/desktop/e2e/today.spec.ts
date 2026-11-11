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
 * TODAY-03, D-163: Today with reminders close together and a long list name. Reminders too close
 * to show apart share one timeline row with "+N" (a menu of all of them), so no row drifts from
 * its hour; a reminder card's list chip ends in an ellipsis. Its own Flint on the suite's fixed
 * clock (D-107: Tuesday 10 March 2026, 10:00), off-screen, never focused.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const LIST = 'Contoso service metrics and the harness pipeline';

let dataDirectory: string;
let app: ElectronApplication;
let main: Page;

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-today-'));
  const flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
  await writeFile(
    join(flint, `${LIST}.md`),
    [
      '---\nflint: 1\nid: metrics\nmode: tasks\n---',
      '- [x] Stand-up [reminder:: 2026-03-10T07:00] [completion:: 2026-03-10T07:10] [id:: r0]',
      '- [ ] Send the invoice [reminder:: 2026-03-10T08:00] [id:: r5]',
      '- [ ] Pay the rent [reminder:: 2026-03-10T09:50] [id:: r6]',
      '- [ ] Water the plants [reminder:: 2026-03-10T10:20] [id:: r7]',
      '- [ ] Review the dashboards [reminder:: 2026-03-10T14:00] [id:: r1]',
      '- [ ] Sign the pipeline [reminder:: 2026-03-10T14:00] [id:: r2]',
      '- [ ] Call Alex [reminder:: 2026-03-10T14:05] [id:: r3]',
      '- [ ] Ship the notes [reminder:: 2026-03-10T16:00] [id:: r4]',
      '- [ ] Book the room [reminder:: 2026-03-10T17:00] [id:: r8]',
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
    window.setBounds({ x: -6000, y: 0, width: 1800, height: 900 });
    window.showInactive();
  });
  await expect(main.locator('.nav', { hasText: 'Contoso' })).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('the timeline: reminders under an hour apart share a row with +N, an hour apart each has its own; none drifts from its hour (TODAY-03, D-163, D-167)', async () => {
  await main.locator('.sidebar > .nav').first().click();
  const timeline = main.locator('.today-timeline');
  const events = timeline.locator('.timeline-event');
  // 09:50 and 10:20 share a row (10:20, the next, in front); 14:00, 14:00 and 14:05 share one;
  // 07:00, 08:00, 16:00 and 17:00, each an hour from its neighbour, have their own (D-167).
  await expect(events).toHaveCount(6);
  for (const time of ['07:00', '08:00', '16:00', '17:00'])
    await expect(events.filter({ hasText: `${time} ·` })).toHaveCount(1);
  const soon = events.filter({ hasText: 'Water the plants' });
  await expect(soon).toHaveClass(/\bnext\b/);
  await expect(soon).toHaveClass(/grouped/);
  const first = events.filter({ hasText: '14:00' });
  await expect(first.locator('.timeline-text')).toHaveText('14:00 · Review the dashboards');
  await expect(first).toHaveClass(/grouped/);
  const badges = timeline.locator('.timeline-more');
  await expect(badges).toHaveText(['+1', '+2']);
  const more = badges.filter({ hasText: '+2' });
  // D-89: it fades in as rows do.
  expect(await more.evaluate((element) => getComputedStyle(element).animationName)).toBe('fade-in');
  // The 16:00 row sits on its hour's line (it used to be pushed down by the rows above).
  const line = timeline.locator('.timeline-hour', { hasText: '16:00' });
  const lineBox = await line.boundingBox();
  const last = events.filter({ hasText: '16:00' });
  await expect(last.locator('.timeline-text')).toHaveText('16:00 · Ship the notes');
  const lastBox = await last.boundingBox();
  if (!lineBox || !lastBox) throw new Error('no timeline layout');
  expect(Math.abs(lastBox.y + lastBox.height / 2 - (lineBox.y + lineBox.height / 2))).toBeLessThan(
    2,
  );

  // D-167: the now line (10:00) crosses the 09:50 row: its "+1" moves beside the time pill, and
  // the line passes under the row instead of through it.
  const near = badges.filter({ hasText: '+1' });
  await expect(near).toHaveClass(/beside-now/);
  const apart = await main.evaluate(() => {
    const badge = [...document.querySelectorAll('.timeline-more')]
      .find((each) => each.textContent === '+1')
      ?.getBoundingClientRect();
    const pill = document.querySelector('.timeline-now-time')?.getBoundingClientRect();
    const nowLine = document.querySelector('.timeline-now-line')?.getBoundingClientRect();
    const row = [...document.querySelectorAll('.timeline-event')]
      .find((each) => each.textContent?.includes('Water the plants'))
      ?.getBoundingClientRect();
    if (!badge || !pill || !nowLine || !row) return null;
    const onTop = document.elementFromPoint(row.left + row.width / 2, nowLine.top + 0.5);
    return {
      clear: badge.right <= pill.left || badge.left >= pill.right,
      crosses: nowLine.top > row.top && nowLine.top < row.bottom,
      under: !!onTop?.closest('.timeline-event'),
    };
  });
  expect(apart).toEqual({ clear: true, crosses: true, under: true });

  // +N opens a menu of all of them, each with its own time and list; one opens that reminder.
  await more.click();
  const items = main.locator('.fl-menu .fl-menu-item');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('14:00 · Review the dashboards');
  await expect(items.nth(1)).toContainText('14:00 · Sign the pipeline');
  await expect(items.nth(2)).toContainText('14:05 · Call Alex');
  await expect(items.nth(2)).toContainText(LIST);
  await items.nth(2).click();
  await expect(main.locator('.fl-menu')).toHaveCount(0);
  await expect(main.locator('.row.sel')).toContainText('Call Alex');
});

test('the timeline: a passed reminder not done is overdue, faded but not struck through (TODAY-03, D-164, D-167)', async () => {
  await main.locator('.sidebar > .nav').first().click();
  const events = main.locator('.today-timeline .timeline-event');
  const overdue = events.filter({ hasText: 'Send the invoice' });
  await expect(overdue).toHaveClass(/\boverdue\b/);
  await expect(overdue).not.toHaveClass(/\bpast\b/);
  const done = events.filter({ hasText: 'Stand-up' });
  await expect(done).toHaveClass(/\bpast\b/);
  const look = (row: typeof done): Promise<{ strike: string; color: string }> =>
    row.locator('.timeline-text').evaluate((element) => {
      const style = getComputedStyle(element);
      return { strike: style.textDecorationLine, color: style.color };
    });
  const overdueLook = await look(overdue);
  const doneLook = await look(done);
  expect(overdueLook.strike).toBe('none');
  expect(doneLook.strike).toBe('line-through');
  // Faded as a passed one is.
  expect(overdueLook.color).toBe(doneLook.color);
});

test('a reminder card keeps a long list name on one line, ending in an ellipsis (TODAY-03, D-163)', async () => {
  await main.locator('.sidebar > .nav').first().click();
  const card = main.locator('.reminder-card').first();
  await expect(card).toBeVisible();
  const chip = card.locator('.reminder-card-list');
  await expect(chip).toHaveAttribute('title', LIST);
  const fits = await chip.evaluate((element) => {
    const name = element.querySelector('.reminder-card-list-name') as HTMLElement;
    const box = element.getBoundingClientRect();
    const cardBox = (element.closest('.reminder-card') as HTMLElement).getBoundingClientRect();
    return {
      height: Math.round(box.height),
      inside: box.right <= cardBox.right,
      cut: name.scrollWidth > name.clientWidth,
    };
  });
  expect(fits).toEqual({ height: 24, inside: true, cut: true });
});
