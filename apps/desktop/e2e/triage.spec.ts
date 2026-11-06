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
 * TASK-14, D-113: Inbox triage, one task at a time by keyboard, oldest first, with a summary. Its
 * own Flint on the suite's fixed clock (D-107), off-screen, never focused.
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

const inbox = (): Promise<string> => readFile(join(flint, 'Inbox.md'), 'utf8');
const title = (): ReturnType<Page['locator']> =>
  main.locator('.triage-card.arriving .triage-title');

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-triage-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  // Captures go to the top, so the bottom one is the oldest.
  await writeFile(
    join(flint, 'Inbox.md'),
    [
      '---\nflint: 1\nid: inbox\nmode: tasks\n---',
      '- [ ] Newest thing [id:: t4]',
      '- [ ] Third thing [id:: t3]',
      '- [ ] Second thing [id:: t2]',
      '- [ ] Oldest thing [id:: t1]',
      '    with a note under it',
      '',
    ].join('\n'),
  );
  await writeFile(join(flint, 'Work.md'), '---\nflint: 1\nid: work\nmode: tasks\n---\n');
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
    window.setBounds({ x: -6000, y: 0, width: 1300, height: 860 });
    window.showInactive();
  });
  await expect(main.locator('.nav', { hasText: 'Work' })).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('triage: T in Inbox, oldest first; priority and pin stay on the card, → keeps (TASK-14, D-113)', async () => {
  await main.locator('.sidebar > .nav[data-key="inbox"]').click();
  // Inbox's title row offers it (D-114): a pill with the count, quiet under five open tasks.
  const pill = main.locator('.list-title-row .triage-pill');
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Triage');
  await expect(pill.locator('.triage-pill-count')).toHaveText('4');
  await expect(pill).not.toHaveClass(/loud/);
  await main.keyboard.press('t');
  await expect(main.locator('.triage')).toBeVisible();
  await expect(main.locator('.triage-count')).toHaveText('1 of 4');
  await expect(title()).toHaveText('Oldest thing');
  await expect(main.locator('.triage-card.arriving .triage-body')).toContainText(
    'with a note under it',
  );
  // 3 is high, as everywhere in Flint; the card stays.
  await main.keyboard.press('3');
  await expect(main.locator('.triage-card.arriving .stripe')).toHaveClass(/p-high/);
  await expect.poll(inbox).toMatch(/Oldest thing \[priority:: high\]/);
  await main.keyboard.press('p');
  await expect(main.locator('.triage-card.arriving .triage-meta')).toContainText('Pinned');
  await expect(main.locator('.triage-count')).toHaveText('1 of 4');
  // → keeps it in Inbox and goes on; the card slides away.
  await main.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { cards: Set<string> }).cards = seen;
    new MutationObserver(() => {
      for (const card of document.querySelectorAll('.triage-card.leaving'))
        seen.add(card.className);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await main.keyboard.press('ArrowRight');
  await expect(title()).toHaveText('Second thing');
  await expect(main.locator('.triage-count')).toHaveText('2 of 4');
  await expect
    .poll(() => main.evaluate(() => [...(window as unknown as { cards: Set<string> }).cards]))
    .toContain('card triage-card leaving next');
});

test('triage: M moves (the list picker), Ctrl+Z brings the card back; Space done, Delete delete, ← back (TASK-14, D-113)', async () => {
  await main.keyboard.press('m');
  await expect(main.locator('.fl-picker')).toBeVisible();
  await main.keyboard.type('Work');
  await main.keyboard.press('Enter');
  await expect(title()).toHaveText('Third thing');
  await expect.poll(() => readFile(join(flint, 'Work.md'), 'utf8')).toContain('Second thing');
  // Undone: the card comes back.
  await main.keyboard.press('Control+z');
  await expect(title()).toHaveText('Second thing');
  await expect.poll(inbox).toContain('Second thing');
  await main.keyboard.press('Space');
  await expect(title()).toHaveText('Third thing');
  await expect.poll(inbox).toContain('- [x] Second thing');
  await main.keyboard.press('Delete');
  await expect(title()).toHaveText('Newest thing');
  await expect.poll(inbox).not.toContain('Third thing');
  // Back passes the ones that left Inbox: the first card again.
  await main.keyboard.press('ArrowLeft');
  await expect(title()).toHaveText('Oldest thing');
  await main.keyboard.press('ArrowRight');
  await expect(title()).toHaveText('Newest thing');
});

test('triage: a capture meanwhile joins at the end; the summary; Esc and the other ways in (TASK-14, D-113)', async () => {
  const text = await inbox();
  await writeFile(
    join(flint, 'Inbox.md'),
    text.replace('- [ ] Newest thing', '- [ ] Just captured [id:: t5]\n- [ ] Newest thing'),
  );
  await main.keyboard.press('ArrowRight');
  await expect(title()).toHaveText('Just captured');
  await main.keyboard.press('Enter');
  const summary = main.locator('.triage-summary');
  await expect(summary).toContainText('Inbox sorted');
  await expect(summary).toContainText('0 moved · 1 done · 1 deleted · 3 kept');
  await main.keyboard.press('Enter');
  await expect(main.locator('.triage')).toHaveCount(0);
  await expect(main.locator('h1')).toContainText('Inbox');
  // The palette's command, and Esc partway leaves at once.
  await main.keyboard.press('Control+k');
  await main.keyboard.type('triage');
  await main.locator('.palette-item', { hasText: 'Triage Inbox' }).click();
  await expect(main.locator('.triage')).toBeVisible();
  await main.keyboard.press('Escape');
  await expect(main.locator('.triage')).toHaveCount(0);
  // Today's "Sort Inbox" opens it there.
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
  // D-114: Today's Timeline is there without reminders too, quietly.
  await expect(main.locator('.today-timeline')).toContainText('No reminders today.');
  await main.locator('.today-sort-inbox .primary-button').click();
  await expect(main.locator('.triage')).toBeVisible();
  await expect(main.locator('h1')).toContainText('Inbox');
  await main.keyboard.press('Escape');
});

test('triage: left partway it opens there again; Start over; the progress line jumps (D-114)', async () => {
  await main.locator('.sidebar > .nav[data-key="inbox"]').click();
  await main.keyboard.press('t');
  await expect(main.locator('.triage-count')).toHaveText('1 of 3');
  await main.keyboard.press('ArrowRight');
  await expect(main.locator('.triage-count')).toHaveText('2 of 3');
  // Leaving slides back to Inbox as a page does.
  await main.keyboard.press('Escape');
  await expect(main.locator('.content.back')).toBeVisible();
  await expect(main.locator('.triage')).toHaveCount(0);
  // Back again: where it was, with Start over.
  await main.locator('.list-title-row .triage-pill').click();
  await expect(main.locator('.triage-count')).toHaveText('2 of 3');
  await expect(main.locator('.content.forward')).toBeVisible();
  await main.locator('.triage-restart').click();
  await expect(main.locator('.triage-count')).toHaveText('1 of 3');
  // Hovering the line shows the task at that point; a click goes there.
  const line = main.locator('.triage-progress');
  const box = await line.boundingBox();
  if (!box) throw new Error('no progress line');
  await main.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  await expect(main.locator('.triage-progress-tip')).toHaveText('3 of 3');
  await main.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  await expect(main.locator('.triage-count')).toHaveText('3 of 3');
  await main.mouse.move(box.x + box.width * 0.1, box.y + 200);
  await expect(main.locator('.triage-progress-tip')).toHaveCount(0);
});

test('triage: editing the title moves nothing; the card eases its height; the notes open the side panel (D-114)', async () => {
  // Start over put the queue in order again; the card with notes, by the keys.
  for (let step = 0; step < 3 && (await title().textContent()) !== 'Oldest thing'; step++) {
    const count = await main.locator('.triage-count').textContent();
    await main.keyboard.press(count?.startsWith('3') ? 'ArrowLeft' : 'ArrowRight');
    await expect(main.locator('.triage-count')).not.toHaveText(count ?? '');
  }
  await expect(title()).toHaveText('Oldest thing');
  await main.waitForTimeout(600);
  const before = await title().boundingBox();
  await title().click();
  const field = main.locator('.triage-title-input');
  await expect(field).toBeFocused();
  const after = await field.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1);
  await main.keyboard.press('Escape');
  await expect(title()).toHaveText('Oldest thing');
  // The next card is a different height: the stage eases to it.
  await main.evaluate(() => {
    const stage = document.querySelector('.triage-stage');
    const seen: string[] = [];
    (window as unknown as { eased: string[] }).eased = seen;
    new MutationObserver(() => {
      for (const each of stage?.getAnimations() ?? []) if (each.id) seen.push(each.id);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  // A narrow window: the notes unfold on the card (and fold again).
  await main.locator('.triage-body').click();
  await expect(main.locator('.triage-body.whole')).toBeVisible();
  await main.locator('.triage-body').click();
  await expect(main.locator('.triage-body.whole')).toHaveCount(0);
  // A wide one: the side panel shows the task, and follows the card.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.getTitle() === 'Flint');
    window?.setBounds({ x: -6000, y: 0, width: 1700, height: 860 });
  });
  await expect(main.locator('.context-panel')).toBeVisible();
  await main.locator('.triage-body').click();
  await expect(main.locator('.context-panel')).toContainText('Oldest thing');
  await main.keyboard.press('ArrowRight');
  await expect(title()).not.toHaveText('Oldest thing');
  const next = (await title().textContent()) ?? '';
  await expect(main.locator('.context-panel')).toContainText(next);
  // A taller card (long notes) joins at the end: going there, the stage eases to its height.
  const text = await inbox();
  const notes = Array.from({ length: 12 }, (_, line) => `    note line ${line + 1}`).join('\n');
  const head = 'mode: tasks\n---\n';
  await writeFile(
    join(flint, 'Inbox.md'),
    text.replace(head, `${head}- [ ] Long one [id:: t9]\n${notes}\n`),
  );
  await expect(main.locator('.triage-count')).toHaveText(/of 4$/);
  const line = await main.locator('.triage-progress').boundingBox();
  if (!line) throw new Error('no progress line');
  await main.mouse.click(line.x + line.width - 2, line.y + line.height / 2);
  await expect(title()).toHaveText('Long one');
  await expect
    .poll(() => main.evaluate(() => (window as unknown as { eased: string[] }).eased))
    .toContain('triage-height');
  await main.keyboard.press('Escape');
});
