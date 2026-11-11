import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * SYNC-01, D-161: Google Drive sync against the fake Drive (test runs never reach Google, APP-09).
 * Connecting and What should sync?, a list synced from its right-click menu, another PC's edits
 * arriving (a task added, the same note line changed: the conflict card), stopping with and
 * without "Also remove from Drive", an item removed from Drive elsewhere, a list deleted on another
 * PC, a linked file on this PC and on another, offline, the palette, Disconnect. Another PC is
 * Drive written to directly, as its sync would. Its own Flint on the suite's fixed clock (D-107).
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
let video: string;
let app: ElectronApplication;
let main: Page;

const head = (id: string, mode = 'tasks'): string =>
  `---\nflint: 1\nid: ${id}\nmode: ${mode}\n---\n`;
const GROCERIES = `${head('groc')}- [ ] Oat milk [id:: aaaaaa]\n- [ ] Dry cleaning [id:: bbbbbb]\n`;
const TRIP = `${head('trip', 'note')}# Kazbegi weekend\n\nLeave Friday after work.\n\nWhere to stay\n`;
const READING = `${head('read')}- [ ] Designing Data-Intensive Applications [id:: rrrrrr]\n`;
const WATCH = `${head('watch')}- [ ] Dune [id:: wwwwww]\n`;

interface Hooks {
  blockedRequests: string[];
  opened: string[];
  syncNow?: () => Promise<void>;
}

const hooks = (): Promise<Hooks> =>
  app.evaluate(() => (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E);

/** One sync run, waited for (the hook resolves when it is done). */
const syncNow = (): Promise<void> =>
  app.evaluate(async () => {
    await (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E.syncNow?.();
  });

/** Drive's lists by name (what other PCs would read). */
const drive = (): Promise<Record<string, string>> =>
  app.evaluate(() => {
    const fake = (
      globalThis as unknown as { __flintE2E: { syncDrive: { contents(): Map<string, string> } } }
    ).__flintE2E.syncDrive;
    return Object.fromEntries(fake.contents());
  });

/** Another PC writes a list in Drive (its sync's upload), a minute later by Google's clock. */
const writeAsLaptop = (name: string, text: string): Promise<void> =>
  app.evaluate(
    (_electron, args) => {
      type File = { name: string };
      const fake = (
        globalThis as unknown as {
          __flintE2E: {
            syncDrive: {
              clock: number;
              fileNamed(name: string): File | undefined;
              update(file: File, content: Uint8Array, options: { device: string }): void;
            };
          };
        }
      ).__flintE2E.syncDrive;
      fake.clock += 60_000;
      const file = fake.fileNamed(args.name);
      if (!file) throw new Error(`no ${args.name} in Drive`);
      fake.update(file, new TextEncoder().encode(args.text), { device: 'DAVIT-LAPTOP' });
    },
    { name, text },
  );

/** Another PC sets a value in a bookkeeping file in Drive (`removed.json`, `items.json`). */
const setMeta = (name: string, path: readonly string[], value: unknown): Promise<void> =>
  app.evaluate(
    (_electron, args) => {
      type File = { name: string; id: string };
      const fake = (
        globalThis as unknown as {
          __flintE2E: {
            syncDrive: {
              fileNamed(name: string): File | undefined;
              read(file: File): Uint8Array;
              update(file: File, content: Uint8Array, options: { device: string }): void;
            };
          };
        }
      ).__flintE2E.syncDrive;
      const file = fake.fileNamed(args.name);
      if (!file) throw new Error(`no ${args.name} in Drive`);
      const root = JSON.parse(new TextDecoder().decode(fake.read(file))) as Record<string, unknown>;
      let at = root;
      for (const key of args.path.slice(0, -1)) {
        at[key] ??= {};
        at = at[key] as Record<string, unknown>;
      }
      at[args.path[args.path.length - 1] as string] = args.value;
      fake.update(file, new TextEncoder().encode(JSON.stringify(root)), { device: 'DAVIT-LAPTOP' });
    },
    { name, path, value },
  );

const setDrive = (values: Record<string, unknown>): Promise<void> =>
  app.evaluate((_electron, changes) => {
    Object.assign(
      (globalThis as unknown as { __flintE2E: { syncDrive: object } }).__flintE2E.syncDrive,
      changes,
    );
  }, values);

const file = (name: string): Promise<string> => readFile(join(flint, name), 'utf8');
const nav = (name: string): ReturnType<Page['locator']> =>
  main.locator('.sidebar .nav', { hasText: name }).first();
const menu = (): ReturnType<Page['locator']> => main.locator('.fl-menu:not(.fl-submenu)');
const dialog = (): ReturnType<Page['locator']> => main.locator('.sync-dialog');
const statusButton = (): ReturnType<Page['locator']> => main.locator('.sync-button');

/** Right-click → Sync with Google Drive on a sidebar item. */
async function syncMenu(name: string): Promise<void> {
  await nav(name).click({ button: 'right' });
  await menu().getByText('Sync with Google Drive', { exact: true }).click();
}

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-sync-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(join(flint, '.flint'), { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), head('inbox'));
  await writeFile(join(flint, 'Groceries.md'), GROCERIES);
  await writeFile(join(flint, 'Trip ideas.md'), TRIP);
  await writeFile(join(flint, 'Reading.md'), READING);
  await writeFile(join(flint, 'Watch list.md'), WATCH);
  video = join(dataDirectory, 'Videos', 'kazbegi-flight.mp4');
  await mkdir(join(dataDirectory, 'Videos'), { recursive: true });
  await writeFile(video, 'not really a video');
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
    window.setBounds({ x: -6000, y: 0, width: 1600, height: 1000 });
    window.showInactive();
  });
  await expect(nav('Groceries')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('before connecting, the status button opens Settings → Sync with Connect Google Drive', async () => {
  await expect(statusButton()).toHaveAttribute('aria-label', 'Sync with Google Drive');
  await statusButton().click();
  const section = main.locator('#settings-sync');
  await expect(section).toBeVisible();
  await expect(section).toContainText('Sync with Google Drive');
  await expect(section).toContainText(
    'Keep chosen lists and notes in step across your devices, through your own Drive.',
  );
  await expect(section.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible();
});

test('connecting asks What should sync?, Only what I choose preselected', async () => {
  await main
    .locator('#settings-sync')
    .getByRole('button', { name: 'Connect Google Drive' })
    .click();
  await expect(dialog()).toBeVisible();
  await expect(dialog()).toContainText('Connected to Google Drive');
  await expect(dialog()).toContainText('you@gmail.com · folder My Drive › Flint (development)');
  await expect(dialog().getByRole('radio', { name: /Only what I choose/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(dialog()).toContainText('You can change this any time in Settings → Sync.');
  await dialog().getByRole('button', { name: 'Continue' }).click();
  await expect(dialog()).toHaveCount(0);
  const section = main.locator('#settings-sync');
  await expect(section).toContainText('Connected as you@gmail.com');
  await expect(section.getByRole('radio', { name: 'Chosen items' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(section).toContainText('My Drive › Flint (development)');
  await expect(section.getByRole('button', { name: 'Open in Drive' })).toBeVisible();
  // Nothing chosen: nothing went to Drive.
  await syncNow();
  expect(await drive()).toEqual({});
});

test('right-click → Sync with Google Drive: the list goes up, with its header line (no sidebar cloud, D-163)', async () => {
  await syncMenu('Groceries');
  await syncNow();
  expect(await drive()).toEqual({ Groceries: GROCERIES });
  // D-163: a synced row carries no cloud; only a conflict marks it.
  await expect(nav('Groceries').locator('.nav-cloud')).toHaveCount(0);
  await nav('Groceries').click();
  await expect(main.locator('.list-header .sync-line')).toHaveText(/Synced with Google Drive · /);
  // The menu shows it checked.
  await nav('Groceries').click({ button: 'right' });
  await expect(
    menu().getByRole('menuitemradio', { name: /Sync with Google Drive/ }),
  ).toHaveAttribute('aria-checked', 'true');
  // Open in Google Drive: the list's own file, in the browser (recorded in tests).
  await menu().getByText('Open in Google Drive', { exact: true }).click();
  await expect
    .poll(async () =>
      (await hooks()).opened.filter((url) => url.includes('drive.google.com/file/d/')),
    )
    .toHaveLength(1);
  // A list that doesn't sync has no such item.
  await nav('Reading').click({ button: 'right' });
  await expect(menu().getByText('Open in Google Drive', { exact: true })).toHaveCount(0);
  await main.keyboard.press('Escape');
});

test('another PC adds a task: it arrives here', async () => {
  await writeAsLaptop('Groceries', `${GROCERIES}- [ ] Light bulbs [id:: cccccc]\n`);
  await syncNow();
  await expect
    .poll(() => file('Groceries.md'))
    .toBe(`${GROCERIES}- [ ] Light bulbs [id:: cccccc]\n`);
  await expect(main.locator('.row', { hasText: 'Light bulbs' })).toBeVisible();
});

test('the same note line changed on two PCs: both kept, the conflict card resolves it', async () => {
  await syncMenu('Trip ideas');
  await syncNow();
  expect((await drive())['Trip ideas']).toBe(TRIP);
  // Both PCs change the same line before syncing.
  await writeFile(join(flint, 'Trip ideas.md'), TRIP.replace('after work', 'at six'));
  await writeAsLaptop(
    'Trip ideas',
    TRIP.replace('Leave Friday after work.', 'Leave Saturday morning.'),
  );
  await expect.poll(async () => (await file('Trip ideas.md')).includes('at six')).toBe(true);
  await syncNow();
  await expect
    .poll(() => file('Trip ideas.md'))
    .toContain('> [!conflict] Also changed on DAVIT-LAPTOP');
  await nav('Trip ideas').click();
  const card = main.locator('.cm-fl-conflict');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Also changed on DAVIT-LAPTOP');
  await expect(card).toContainText('Leave Saturday morning.');
  await expect(main.locator('.note-card .sync-line')).toContainText('1 conflict');
  // D-163: the sidebar row shows the cloud with "!" while the conflict lasts.
  await expect(nav('Trip ideas').locator('.nav-cloud')).toHaveAttribute('title', '1 sync conflict');
  // The popover lists it.
  await statusButton().click();
  await expect(main.locator('.sync-popover')).toContainText('1 conflict in Trip ideas');
  await main.keyboard.press('Escape');
  await expect(card.getByRole('button')).toHaveText([
    "Use DAVIT-LAPTOP's",
    'Keep mine',
    'Keep both',
  ]);
  await card.getByRole('button', { name: "Use DAVIT-LAPTOP's" }).click();
  await expect(card).toHaveCount(0);
  await expect
    .poll(() => file('Trip ideas.md'))
    .toBe(TRIP.replace('Leave Friday after work.', 'Leave Saturday morning.'));
  // A note just typed in waits for the next run (it never lands under unsaved typing).
  await expect
    .poll(
      async () => {
        await syncNow();
        return (await drive())['Trip ideas'];
      },
      { timeout: 15_000, intervals: [1000] },
    )
    .toBe(TRIP.replace('Leave Friday after work.', 'Leave Saturday morning.'));
  // Resolved: the next run clears the sidebar's mark.
  await expect(nav('Trip ideas').locator('.nav-cloud')).toHaveCount(0);
});

test('stop syncing on this PC: unticked by default; ticked reads Stop syncing everywhere', async () => {
  await syncMenu('Groceries');
  await expect(dialog()).toContainText('Stop syncing "Groceries" on this PC?');
  await expect(dialog()).toContainText(
    'It stays here as a local list. Other devices keep syncing it.',
  );
  const option = dialog().getByRole('checkbox', { name: /Also remove from Drive/ });
  await expect(option).toHaveAttribute('aria-checked', 'false');
  await option.click();
  await expect(dialog().getByRole('button', { name: 'Stop syncing everywhere' })).toBeVisible();
  await option.click();
  await dialog().getByRole('button', { name: 'Stop syncing', exact: true }).click();
  await expect(dialog()).toHaveCount(0);
  await syncNow();
  await expect(nav('Groceries').locator('.nav-cloud')).toHaveCount(0);
  // Drive keeps it for the other PCs; this PC keeps its copy.
  expect(Object.keys(await drive())).toContain('Groceries');
  expect(await file('Groceries.md')).toContain('Light bulbs');
});

test('Also remove from Drive: it leaves Drive, and stays here', async () => {
  await syncMenu('Trip ideas');
  await dialog()
    .getByRole('checkbox', { name: /Also remove from Drive/ })
    .click();
  await dialog().getByRole('button', { name: 'Stop syncing everywhere' }).click();
  await syncNow();
  expect(Object.keys(await drive())).not.toContain('Trip ideas');
  expect(await file('Trip ideas.md')).toContain('Leave Saturday morning.');
});

test('removed from Drive on another device: kept here with the quiet note', async () => {
  await syncMenu('Reading');
  await syncNow();
  expect(Object.keys(await drive())).toContain('Reading');
  await app.evaluate(() => {
    (
      globalThis as unknown as { __flintE2E: { syncDrive: { trashInDrive(name: string): void } } }
    ).__flintE2E.syncDrive.trashInDrive('Reading');
  });
  await syncNow();
  await nav('Reading').click();
  await expect(main.locator('.list-header .sync-line')).toHaveText(
    /No longer synced: removed from Drive on another device/,
  );
  expect(await file('Reading.md')).toBe(READING);
  await main.locator('.sync-notice-dismiss').click();
  await expect(main.locator('.list-header .sync-line')).toHaveCount(0);
});

test('a list deleted on another PC goes to this PC’s Trash', async () => {
  await syncMenu('Watch list');
  await syncNow();
  await app.evaluate(() => {
    (
      globalThis as unknown as { __flintE2E: { syncDrive: { trashInDrive(name: string): void } } }
    ).__flintE2E.syncDrive.trashInDrive('Watch list');
  });
  await setMeta('removed.json', ['removed', 'watch'], {
    how: 'deleted',
    at: Date.now(),
    device: 'DAVIT-LAPTOP',
  });
  await syncNow();
  await expect(nav('Watch list')).toHaveCount(0);
  await main.locator('.sidebar-foot .nav', { hasText: 'Trash' }).click();
  await expect(main.getByText('Watch list').first()).toBeVisible();
});

test('a linked file: the crossed-out cloud and why, here and on another PC', async () => {
  const link = pathToFileURL(video).href;
  await writeFile(
    join(flint, 'Trip ideas.md'),
    `${await file('Trip ideas.md')}\n![kazbegi-flight.mp4](${link})\n`,
  );
  await syncMenu('Trip ideas');
  await syncNow();
  await nav('Trip ideas').click();
  const chip = main.locator('.fl-media.linked').first();
  await expect(chip.locator('.fl-media-badge')).toHaveText(/ · Linked$/);
  await chip.locator('.fl-media-cloud').hover();
  const why = main.locator('.fl-sync-explain');
  await expect(why).toContainText('Not synced');
  await expect(why).toContainText('This file is linked from outside the Flint folder');
  await expect(why).toContainText(
    'so it stays on this PC. Other devices show this line with a note.',
  );
  await expect(why).toContainText('Copy into Flint to sync it');
  await main.mouse.move(0, 0);
  // Another PC's linked file: never here, named by its PC.
  const elsewhere = 'file:///D:/Videos/Drone/kazbegi-flight.mp4';
  const text = await file('Trip ideas.md');
  await writeAsLaptop('Trip ideas', `${text}\n![drone](${elsewhere})\n`);
  await setMeta('items.json', ['items', 'trip', 'linked', elsewhere], {
    device: 'DAVIT-LAPTOP',
    size: 1932735283,
  });
  await syncNow();
  await expect.poll(() => file('Trip ideas.md')).toContain(elsewhere);
  await nav('Reading').click();
  await nav('Trip ideas').click();
  const remote = main.locator(`.fl-media.linked[data-link="${elsewhere}"]`);
  await expect(remote.locator('.fl-media-badge')).toHaveText('1.8 GB · on DAVIT-LAPTOP');
  await remote.locator('.fl-media-cloud').hover();
  await expect(main.locator('.fl-sync-explain')).toContainText('Not synced to this device');
  await expect(main.locator('.fl-sync-explain')).toContainText(
    'On DAVIT-LAPTOP this file is linked from outside the Flint folder, so it was never synced. To have it here, open this note on DAVIT-LAPTOP and choose Copy into Flint.',
  );
  await main.mouse.move(0, 0);
});

test('offline: the cloud says so, changes wait, and go up once back', async () => {
  await setDrive({ offline: true });
  await syncMenu('Groceries');
  await syncNow();
  await expect(statusButton()).toHaveAttribute('aria-label', 'Offline');
  await statusButton().click();
  await expect(main.locator('.sync-popover')).toContainText("Changes sync when you're back");
  await main.keyboard.press('Escape');
  await setDrive({ offline: false });
  await syncNow();
  await expect(statusButton()).toHaveAttribute('aria-label', 'Synced with Google Drive');
  await statusButton().click();
  const popover = main.locator('.sync-popover');
  await expect(popover).toContainText('Synced');
  await expect(popover).toContainText('sync with Google Drive. Everything else stays on this PC.');
  await expect(popover.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await expect(popover.getByRole('button', { name: 'Sync settings…' })).toBeVisible();
  await main.keyboard.press('Escape');
});

test('the palette has Sync now and Choose what syncs…; the sort menu has Synced only', async () => {
  await main.keyboard.press('Control+k');
  await main.keyboard.type('sync now');
  await expect(main.locator('.palette-item', { hasText: 'Sync now' }).first()).toBeVisible();
  await main.keyboard.press('Escape');
  await main.keyboard.press('Escape');
  await main.locator('.sort-lists').click();
  await menu().getByText('Synced only', { exact: true }).click();
  await expect(nav('Groceries')).toBeVisible();
  await expect(nav('Reading')).toHaveCount(0);
  await main.locator('.sort-lists').click();
  await menu().getByText('Show all', { exact: true }).click();
  await expect(nav('Reading')).toBeVisible();
});

test('Disconnect keeps everything here and in Drive', async () => {
  const before = await drive();
  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  await main.locator('#settings-sync').getByRole('button', { name: 'Disconnect' }).click();
  await expect(dialog()).toContainText('Disconnect Google Drive?');
  await dialog().getByRole('button', { name: 'Disconnect' }).click();
  await expect(
    main.locator('#settings-sync').getByRole('button', { name: 'Connect Google Drive' }),
  ).toBeVisible();
  expect(await drive()).toEqual(before);
  expect(await file('Groceries.md')).toContain('Light bulbs');
});

test('no request leaves Flint (APP-09)', async () => {
  expect((await hooks()).blockedRequests).toEqual([]);
});
