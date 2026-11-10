import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
 * APP-10, APP-13, APP-15 (D-113, D-115 to D-120): onboarding. A fresh install's walkthrough, each
 * step moving on when it is done and only its target taking clicks; Remove what I created during
 * the tour as one undoable step; Esc; a tour cut short; going on after step 1's folder change;
 * What's new after an update. Each test starts its own Flint (onboarding is off in the other
 * suites: FLINT_E2E_ONBOARDING turns it on), on the suite's fixed clock (D-107), off-screen, never
 * focused.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const VERSION = (
  JSON.parse(readFileSync(join(appDirectory, 'package.json'), 'utf8')) as { version: string }
).version;

let dataDirectory = '';
let app: ElectronApplication | undefined;

/** A Flint on `dataDirectory`, its main window shown off-screen without the focus. */
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
      FLINT_E2E_ONBOARDING: '1',
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

async function fresh(settings?: object, tour?: object): Promise<void> {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-onboarding-'));
  await mkdir(join(dataDirectory, 'Flint'), { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
  if (settings)
    await writeFile(join(dataDirectory, 'appdata', 'settings.json'), JSON.stringify(settings));
  if (tour) await writeFile(join(dataDirectory, 'appdata', 'tour.json'), JSON.stringify(tour));
}

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

/** A click where `selector` is on screen, wherever the dim lets it land (not Playwright's). */
async function clickAt(main: Page, selector: string): Promise<void> {
  const box = await main.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not on screen`);
  await main.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('a fresh install: the walkthrough, each step moving on when it is done; Remove what I created, undoable (APP-10, D-116, D-117, D-120)', async () => {
  await fresh();
  const { main } = await launch();
  const card = main.locator('.spotlight-card');
  const inbox = (): Promise<string> => readFile(join(dataDirectory, 'Flint', 'Inbox.md'), 'utf8');

  // 1: welcome, the folder, nothing ringed; under the dim nothing takes a click.
  await expect(card).toContainText('Welcome to Flint');
  await expect(card).toContainText('1 / 8');
  await expect(card).toContainText(join(dataDirectory, 'Flint'));
  await expect(card).toContainText('Nothing leaves your computer.');
  await expect(main.locator('.spotlight-ring')).toHaveCount(0);
  const before = await main.locator('.nav.on').textContent();
  await clickAt(main, `.nav[data-key="@today"]`);
  await expect(main.locator('.nav.on')).toHaveText(before ?? '');
  // The card never takes the keyboard.
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('2 / 8');
  expect(await main.evaluate(() => document.activeElement?.closest('.spotlight-card'))).toBeNull();
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(dataDirectory, 'appdata', 'tour.json'), 'utf8')) as object,
    )
    .toMatchObject({ step: 1, restart: false });

  // 2: a capture from the popup; D-122: the dim and the card stay while it is open.
  await expect(card).toContainText('Capture from anywhere');
  await app?.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  await main.waitForTimeout(300);
  await expect(main.locator('.spotlight-dim')).toHaveCount(1);
  await expect(card).toContainText('2 / 8');
  const popupPage = (): Page | undefined =>
    app?.windows().find((page) => page.url().includes('capture-popup'));
  await expect.poll(() => popupPage() !== undefined, { timeout: 15_000 }).toBe(true);
  const popup = popupPage() as Page;
  await popup.locator('#capture').fill('call the bank');
  await popup.locator('#capture').press('Enter');

  // 3: on Inbox, the composer ringed and live; shorthand moves it on.
  await expect(card).toContainText('3 / 8');
  await expect(card).toContainText('Shorthand as you type');
  await expect(main.locator('.spotlight-dim')).toHaveCount(1);
  await expect(main.locator('.spotlight-ring')).toHaveCount(1);
  await main.locator('.main .composer-input').click();
  await main.keyboard.type('water the plants !h');
  await main.keyboard.press('Enter');

  // 4: the sidebar's + and Quick note. D-122: an empty quick note isn't "made": the step waits,
  // the note stays open; its text moves it on once the typing pauses.
  await expect(card).toContainText('4 / 8');
  await expect(main.locator('.spotlight-ring')).toHaveCount(2);
  await clickAt(main, '[title="Quick note (Ctrl+Shift+J)"]');
  const editor = main.locator('.note-card .cm-content');
  await expect(editor).toBeVisible();
  await main.waitForTimeout(800);
  await expect(card).toContainText('4 / 8');
  // D-125: the card never covers the ringed targets or where you type: it moved out of the way.
  const covers = (): Promise<string[]> =>
    main.evaluate(() => {
      const box = document.querySelector('.spotlight-card')?.getBoundingClientRect();
      if (!box) return ['no card'];
      const kept = document.querySelectorAll(
        '.spotlight-ring, .note-card .list-header, .note-card .cm-line',
      );
      return [...kept].flatMap((element) => {
        const other = element.getBoundingClientRect();
        const apart =
          box.right <= other.left ||
          other.right <= box.left ||
          box.bottom <= other.top ||
          other.bottom <= box.top;
        return apart ? [] : [element.className];
      });
    });
  await expect.poll(covers).toEqual([]);
  await editor.click();
  await main.keyboard.type('buy stamps');
  await expect(card).toContainText('4 / 8');
  expect(await covers()).toEqual([]);
  await expect(card).toContainText('5 / 8', { timeout: 6000 });
  const notes = async (): Promise<string[]> =>
    (await readdir(join(dataDirectory, 'Flint'))).filter((name) => name.startsWith('Quick note'));
  await expect.poll(notes).toHaveLength(1);

  // 5: back on Inbox, the faint pin of the first task ringed; a click on it pins.
  await expect(main.locator('h1')).toContainText('Inbox');
  await expect(main.locator('.spotlight-ring')).toHaveCount(1);
  // It settles in with a pop (D-89, D-122). D-156: the pop's start is waited for, not its class,
  // which is there for about a second: polled on a slow runner, the check could miss it.
  await main.evaluate(() => {
    const page = window as { popped?: boolean };
    page.popped = false;
    document.addEventListener('animationstart', (event) => {
      if (event.animationName === 'pin-pop') page.popped = true;
    });
  });
  await clickAt(main, '.main .row[data-key]:not(.done) .pin-hover');
  await expect.poll(() => main.evaluate(() => (window as { popped?: boolean }).popped)).toBe(true);
  await expect(main.locator('.main .row .pin-ind')).toHaveCount(1);

  // 6: the composer's bell; a reminder set moves it on.
  await expect(card).toContainText('6 / 8');
  // Each step waits for what it acts on (a slower machine opens the picker later, D-138).
  await main.getByRole('button', { name: 'Set reminder' }).click();
  await expect(main.locator('.fl-picker')).toHaveCount(1);
  await main.keyboard.type('tomorrow 10');
  await expect(main.locator('.fl-picker .fl-picker-row.active')).toContainText('Tomorrow 10:00');
  await main.keyboard.press('Enter');
  await expect(main.locator('.fl-picker')).toHaveCount(0);
  await expect(main.locator('.main .composer-input')).toHaveValue(/@\d{4}-\d{2}-\d{2} 10:00$/);
  await main.keyboard.type(' pay the rent');
  await main.keyboard.press('Enter');
  await expect.poll(inbox).toMatch(/- \[ \] pay the rent \[reminder:: \d{4}-\d{2}-\d{2}T10:00\]/);

  // 7: the palette's button; the palette opening moves it on. Esc then closes the palette only.
  await expect(card).toContainText('7 / 8');
  await main.keyboard.press('Control+k');
  await expect(card).toContainText('8 / 8');
  await main.keyboard.press('Escape');
  await expect(main.locator('.palette-layer')).toHaveCount(0);
  await expect(card).toContainText('Mini mode');

  // 8: the title bar's mini button; mini opening ends the tour: You're set.
  await expect(main.locator('.spotlight-ring')).toHaveCount(1);
  await main.locator('.mini-toggle').click();
  await expect(card).toContainText('You’re set');
  await expect(card).toContainText('you can turn tips off in Settings');
  await app?.evaluate(() =>
    (globalThis as { __flintE2E?: { hideMini?: () => void } }).__flintE2E?.hideMini?.(),
  );

  // Remove what I created during the tour: the captures, the tasks, the quick note; one undo.
  expect(await inbox()).toContain('call the bank');
  expect(await notes()).toHaveLength(1);
  await card.getByRole('button', { name: 'Remove what I created during the tour' }).click();
  await expect(card).toHaveCount(0);
  await expect(main.locator('.toast')).toContainText('Removed 4 items from the tour');
  // Each item goes in turn: wait for all of them.
  const made = /call the bank|water the plants|pay the rent/g;
  await expect.poll(async () => (await inbox()).match(made)?.length ?? 0).toBe(0);
  await expect.poll(notes).toHaveLength(0);
  expect(await exists(join(dataDirectory, 'appdata', 'tour.json'))).toBe(false);
  await main.keyboard.press('Control+z');
  await expect.poll(async () => (await inbox()).match(made)?.length ?? 0).toBe(3);
  await expect.poll(notes).toHaveLength(1);
});

test('Esc ends the walkthrough and says where to replay it; a tour cut short says so once, with Replay (D-115, D-119)', async () => {
  await fresh(
    { lastSeenVersion: VERSION },
    { step: 3, restart: false, baseline: { lists: ['inbox'], tasks: [] } },
  );
  const { main } = await launch();
  const toast = main.locator('.toast');
  await expect(toast).toContainText('The walkthrough was interrupted');
  await expect(main.locator('.spotlight-card')).toHaveCount(0);
  expect(await exists(join(dataDirectory, 'appdata', 'tour.json'))).toBe(false);
  await toast.getByRole('button', { name: 'Replay' }).click();
  await expect(main.locator('.spotlight-card')).toContainText('1 / 8');
  await main.keyboard.press('Escape');
  await expect(main.locator('.spotlight-card')).toHaveCount(0);
  await expect(main.locator('.spotlight-dim')).toHaveCount(0);
  await expect(toast).toContainText('Replay it any time from Settings');
  await expect.poll(() => exists(join(dataDirectory, 'appdata', 'tour.json'))).toBe(false);
  // Settings and the palette start it again.
  await main.locator('.nav', { hasText: 'Settings' }).click();
  await main.getByRole('button', { name: 'Replay walkthrough' }).click();
  await expect(main.locator('.spotlight-card')).toContainText('Welcome to Flint');
  await main.locator('.spotlight-card').getByRole('button', { name: 'Skip all' }).click();
  await expect(main.locator('.spotlight-card')).toHaveCount(0);
});

test('step 1’s folder change restarts Flint and the tour goes on at step 2 (D-119)', async () => {
  // As a restart left it: the tour at step 2, going on.
  await fresh(
    { lastSeenVersion: VERSION },
    { step: 1, restart: true, baseline: { lists: ['inbox'], tasks: [] } },
  );
  const { main } = await launch();
  await expect(main.locator('.spotlight-card')).toContainText('Capture from anywhere');
  await expect(main.locator('.spotlight-card')).toContainText('2 / 8');
  // Going on, not cut short: a quit now would be.
  expect(
    JSON.parse(await readFile(join(dataDirectory, 'appdata', 'tour.json'), 'utf8')),
  ).toMatchObject({ step: 1, restart: false });
});

test('an update shows What’s new once, in plain words; the palette and Settings show it again (APP-15, D-117)', async () => {
  await fresh({ lastSeenVersion: '0.8.10' });
  const { main } = await launch();
  const card = main.locator('.whats-new');
  await expect(card).toContainText('What’s new');
  await expect(card.locator('.whats-new-version').first()).toContainText(`Flint ${VERSION}`);
  // Plain language: no decision numbers.
  expect(await card.textContent()).not.toMatch(/D-\d+/);
  await expect
    .poll(
      async () =>
        (
          JSON.parse(await readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8')) as {
            lastSeenVersion?: string;
          }
        ).lastSeenVersion,
    )
    .toBe(VERSION);
  // D-122: a comfortable size; Got it at the bottom closes it (Esc and × too).
  const box = await card.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(560);
  // D-126: its middle at the optical centre, 45 % of the window's height.
  const height = await main.evaluate(() => window.innerHeight);
  await expect
    .poll(async () => {
      const now = await card.boundingBox();
      return now ? Math.round(((now.y + now.height / 2) / height) * 100) : 0;
    })
    .toBe(45);
  // D-125: the app dimmed behind it; nothing there takes a click until it is closed.
  await expect(main.locator('.whats-new-dim')).toHaveCount(1);
  const before = await main.locator('.nav.on').textContent();
  await clickAt(main, '.nav:has-text("Settings")');
  await expect(main.locator('.nav.on')).toHaveText(before ?? '');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Got it' }).click();
  await expect(card).toHaveCount(0);
  await expect(main.locator('.whats-new-dim')).toHaveCount(0);
  await main.keyboard.press('Control+k');
  await main.keyboard.type('what');
  await main.locator('.palette-layer').getByText('What’s new').first().click();
  await expect(card).toBeVisible();
  await main.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await main.locator('.nav', { hasText: 'Settings' }).click();
  // D-122: Settings → About has What's new and Replay walkthrough.
  const about = main.locator('#settings-about');
  await expect(about.getByRole('button', { name: 'Replay walkthrough' })).toBeVisible();
  // APP-09, D-132, D-136: stated plainly, first in About.
  await expect(about.locator('.settings-row').first()).toContainText('Privacy');
  await expect(about.locator('.settings-row').first()).toContainText(
    // D-161: with Google Drive sync, the row says what syncs and where.
    'Your notes stay on this PC unless you sync them: synced lists and notes go only to your own Google Drive, and Flint has no server of its own. Flint sends no telemetry and only contacts GitHub to check for updates, which you can turn off.',
  );
  await about
    .locator('.settings-row', { hasText: 'What changed in each version' })
    .getByRole('button')
    .click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toHaveCount(0);
});

test('a tip: once its pattern happened, after a quiet moment; seen after 3 s or closed; two a session, ten minutes apart; Reset tips; Don’t show tips (APP-14, D-118, D-125)', async () => {
  await fresh({ lastSeenVersion: VERSION });
  await writeFile(
    join(dataDirectory, 'Flint', 'Inbox.md'),
    [
      '---\nflint: 1\nid: inbox\nmode: tasks\n---',
      '- [ ] first to go [id:: tp1]',
      '- [ ] second to go [id:: tp2]',
      '- [ ] third to go [id:: tp3]',
      '',
    ].join('\n'),
  );
  const { app: running, main } = await launch();
  const tip = main.locator('.tip-card');
  const tips = async (): Promise<Record<string, number>> =>
    JSON.parse(
      await readFile(join(dataDirectory, 'appdata', 'tips.json'), 'utf8').catch(() => '{}'),
    ) as Record<string, number>;
  await main.locator('.nav', { hasText: 'Inbox' }).click();

  // The palette opened with the mouse 3 times: the Ctrl+K tip, after a quiet moment.
  for (let time = 0; time < 3; time++) {
    await main.locator('.palette-button').click();
    await expect(main.locator('.palette-layer')).toHaveCount(1);
    await main.keyboard.press('Escape');
    await expect(main.locator('.palette-layer')).toHaveCount(0);
  }
  await main.waitForTimeout(1000);
  await expect(tip).toHaveCount(0);
  await expect(tip).toContainText('Ctrl+K', { timeout: 4000 });
  await expect(tip.locator('.keycap')).toHaveText(['Ctrl+K']);
  expect(
    await main.evaluate(() => document.activeElement?.closest('.tip-card') ?? null),
  ).toBeNull();
  // Seen after about 3 s on screen.
  await expect.poll(async () => (await tips())['shown:paletteKey'], { timeout: 6000 }).toBe(1);
  // D-125: as far from the right edge as from the bottom.
  const corner = await main.evaluate(() => {
    const box = document.querySelector('.tip-card')?.getBoundingClientRect();
    return box
      ? {
          right: Math.round(window.innerWidth - box.right),
          bottom: Math.round(window.innerHeight - box.bottom),
        }
      : null;
  });
  expect(corner).not.toBeNull();
  expect(corner?.right).toBe(corner?.bottom);
  await tip.getByRole('button', { name: 'Got it' }).click();
  await expect(tip).toHaveCount(0);

  // D-125: two a session, ten minutes apart. Within the ten minutes the first delete's tip waits.
  await main.locator('.row', { hasText: 'first to go' }).click();
  await main.keyboard.press('Delete');
  await expect(main.locator('.row', { hasText: 'first to go' })).toHaveCount(0);
  await main.waitForTimeout(3500);
  await expect(tip).toHaveCount(0);
  // Ten minutes on, the next delete brings it.
  await running.evaluate(() =>
    (globalThis as { __flintE2E?: { tipGapPassed?: () => void } }).__flintE2E?.tipGapPassed?.(),
  );
  await main.locator('.row', { hasText: 'second to go' }).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Delete' }).click();
  await expect(tip).toContainText('Trash for 30 days', { timeout: 5000 });
  await tip.getByRole('button', { name: 'Close' }).click();
  await expect(tip).toHaveCount(0);
  expect((await tips())['shown:trash']).toBe(1);
  // A third waits for another session, however long it has been: a link pasted (D-93: a
  // synthetic paste, the clipboard untouched).
  await running.evaluate(() =>
    (globalThis as { __flintE2E?: { tipGapPassed?: () => void } }).__flintE2E?.tipGapPassed?.(),
  );
  await main.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://github.com/flint/flint/pull/7');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
  });
  await main.waitForTimeout(3500);
  await expect(tip).toHaveCount(0);

  // Reset tips: every tip again. The delete's tip; hidden with the window before it was seen,
  // it comes back.
  await main.keyboard.press('Control+k');
  await main.keyboard.type('reset tips');
  await main.locator('.palette-layer').getByText('Reset tips').first().click();
  await expect(main.locator('.toast')).toContainText('Tips reset');
  await main.locator('.row', { hasText: 'third to go' }).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Delete' }).click();
  await expect(tip).toContainText('Trash for 30 days', { timeout: 5000 });
  await running.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((each) => each.getTitle() === 'Flint')
      ?.hide(),
  );
  await expect(tip).toHaveCount(0);
  expect((await tips())['shown:trash']).toBeUndefined();
  await running.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((each) => each.getTitle() === 'Flint')
      ?.showInactive(),
  );
  await expect(tip).toContainText('Trash for 30 days', { timeout: 5000 });

  // Don't show tips: gone, and off in the settings.
  await tip.getByRole('button', { name: 'Don’t show tips' }).click();
  await expect(tip).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          JSON.parse(await readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8')) as {
            tipsOff?: boolean;
          }
        ).tipsOff,
    )
    .toBe(true);
  await main.locator('.nav', { hasText: 'Settings' }).click();
  await expect(
    main.locator('#settings-about').getByRole('switch', { name: 'Show tips' }),
  ).toHaveAttribute('aria-checked', 'false');
});
