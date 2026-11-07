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
 * LIST-05, LIST-06, D-114: a sidebar longer than the window: a new list, note or group named out
 * of sight scrolls into view; a list in a group moves to the top of its group or of Lists. Its own
 * Flint on the suite's fixed clock (D-107), off-screen, never focused.
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

const LISTS = Array.from({ length: 36 }, (_, at) => `List ${String(at + 1).padStart(2, '0')}`);
const ERRANDS = ['Errand one', 'Errand two', 'Errand three'];
const idOf = (name: string): string => name.toLowerCase().replace(/\s+/g, '-');
type Entry = { readonly list: string } | { readonly group: string; readonly lists: string[] };
/** The sidebar's manual order as saved (`.flint/sidebar.json`). */
const saved = async (): Promise<Entry[]> =>
  (
    JSON.parse(
      await readFile(join(flint, '.flint', 'sidebar.json'), 'utf8').catch(() => '{"items":[]}'),
    ) as { items: Entry[] }
  ).items;
const groupLists = async (): Promise<string[]> => {
  const last = (await saved()).at(-1);
  return last && 'lists' in last ? last.lists : [];
};

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-sidebar-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(join(flint, '.flint'), { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
  for (const name of [...LISTS, ...ERRANDS])
    await writeFile(
      join(flint, `${name}.md`),
      `---\nflint: 1\nid: ${idOf(name)}\nmode: tasks\n---\n`,
    );
  await writeFile(
    join(flint, '.flint', 'sidebar.json'),
    `${JSON.stringify(
      {
        flint: 1,
        items: [
          ...LISTS.map((name) => ({ list: idOf(name) })),
          { group: 'errands', name: 'Errands', lists: ERRANDS.map(idOf) },
        ],
      },
      null,
      2,
    )}\n`,
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
    window.setBounds({ x: -6000, y: 0, width: 1300, height: 700 });
    window.showInactive();
  });
  await expect(main.locator('.nav', { hasText: 'Errand three' })).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

/** Whether the name field shows in the sidebar, clear of Settings and Trash at its foot. */
async function fieldInView(): Promise<boolean> {
  return main.evaluate(() => {
    const field = document.querySelector('.name-field');
    const sidebar = document.querySelector('.sidebar');
    const foot = document.querySelector('.sidebar-foot');
    if (!field || !sidebar || !foot) return false;
    const box = field.getBoundingClientRect();
    const top = sidebar.getBoundingClientRect().top;
    return box.top >= top && box.bottom <= foot.getBoundingClientRect().top;
  });
}

test('a new list, note or group named out of sight scrolls into view (D-114)', async () => {
  const sidebar = main.locator('.sidebar');
  await sidebar.evaluate((element) => element.scrollTo({ top: 0 }));
  // A new list goes at the end of Lists, below the window's edge.
  await main.locator('.add-list').click();
  await main.locator('.fl-menu').getByText('New task list').click();
  await expect(main.locator('.name-field input')).toBeFocused();
  await expect.poll(fieldInView).toBe(true);
  await main.keyboard.press('Escape');
  await expect(main.locator('.name-field')).toHaveCount(0);
  // A new group goes at the top of Lists, above it when scrolled to the end.
  await sidebar.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await main.keyboard.press('Control+k');
  await main.keyboard.type('New group');
  await main.keyboard.press('Enter');
  await expect(main.locator('.name-field input')).toBeFocused();
  await expect.poll(fieldInView).toBe(true);
  await main.keyboard.press('Escape');
  await expect(main.locator('.name-field')).toHaveCount(0);
  // A new list in a folded group out of sight: the group opens (easing) and the field comes into
  // view once it is open, clear of the foot.
  const head = main.locator('.nav-group-head', { hasText: 'Errands' });
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  // Its header just above the foot (Settings and Trash), the rest of the sidebar above it.
  await sidebar.evaluate((element) => {
    const group = [...element.querySelectorAll<HTMLElement>('.nav-group-head')].find((each) =>
      each.textContent?.includes('Errands'),
    );
    const foot = element.querySelector<HTMLElement>('.sidebar-foot');
    if (!group || !foot) return;
    const below = foot.getBoundingClientRect().top - group.getBoundingClientRect().bottom - 4;
    element.scrollTop -= below;
  });
  await head.click({ button: 'right' });
  await main.locator('.fl-menu').getByText('New task list').click();
  await expect(main.locator('.name-field input')).toBeFocused();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(fieldInView, { timeout: 2000 }).toBe(true);
  await main.keyboard.press('Escape');
});

test('in a group: Move to top of group, and Move to top (of Lists, out of the group) (LIST-06, D-114)', async () => {
  const three = main.locator('.nav:not(.flip-ghost)', { hasText: 'Errand three' });
  await three.scrollIntoViewIfNeeded();
  await three.click({ button: 'right' });
  // D-115: the one that leaves the group says so.
  await expect(main.locator('.fl-menu').getByText('Move to top', { exact: true })).toHaveCount(0);
  await expect(main.locator('.fl-menu').getByText('Move out to top of Lists')).toBeVisible();
  await main.locator('.fl-menu').getByText('Move to top of group').click();
  await expect.poll(groupLists).toEqual(['errand-three', 'errand-one', 'errand-two']);
  // A list outside a group has only Move to top.
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'List 05' }).click({ button: 'right' });
  await expect(main.locator('.fl-menu').getByText('Move to top', { exact: true })).toBeVisible();
  await expect(main.locator('.fl-menu').getByText('Move to top of group')).toHaveCount(0);
  await main.keyboard.press('Escape');
  // Move to top takes it out of the group, to the top of Lists.
  await three.click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Move out to top of Lists').click();
  await expect.poll(async () => (await saved())[0]).toEqual({ list: 'errand-three' });
  // The palette has them for the open list.
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Errand two' }).click();
  await main.keyboard.press('Control+k');
  await main.keyboard.type('top of group');
  await expect(
    main.locator('.palette-item', { hasText: 'Move list to top of group' }),
  ).toBeVisible();
  await main.keyboard.press('Enter');
  await expect.poll(groupLists).toEqual(['errand-two', 'errand-one']);
});

test('deleting a quick note: the highlight lands exactly on the list opened instead, in a group too (UI-04, D-131)', async () => {
  const errand = main.locator('.nav:not(.flip-ghost)', { hasText: 'Errand one' });
  await errand.scrollIntoViewIfNeeded();
  await errand.click();
  await expect(main.locator('.nav.on:not(.flip-ghost)')).toContainText('Errand one');
  // A quick note with something in it (an empty one goes by itself), then deleted.
  await main.keyboard.press('Control+Shift+j');
  const editor = main.locator('.main .note-card .cm-content');
  await editor.click();
  await main.keyboard.type('something to delete');
  const quick = main.locator('.quick-notes .nav:not(.flip-ghost)').first();
  await expect(quick).toBeVisible();
  await quick.click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Delete' }).last().click();
  await expect(main.locator('.nav.on:not(.flip-ghost)')).toContainText('Errand one');
  // Once the sidebar has settled, the highlight sits exactly on the open list.
  const offset = (): Promise<number | null> =>
    main.evaluate(() => {
      const on = document.querySelector('.nav.on:not(.flip-ghost)')?.getBoundingClientRect();
      const glide = document.querySelector('.nav-glide')?.getBoundingClientRect();
      return on && glide
        ? Math.round(Math.abs(on.top - glide.top) + Math.abs(on.left - glide.left))
        : null;
    });
  await main.waitForTimeout(800);
  expect(await offset()).toBe(0);
});

test('an empty quick note gone back to is kept; left again, it goes (NOTE-08, D-131)', async () => {
  const quickRows = main.locator('.quick-notes .nav:not(.flip-ghost)');
  const before = await quickRows.count();
  await main.keyboard.press('Control+Shift+j');
  await expect(quickRows).toHaveCount(before + 1);
  const label = (await quickRows.first().locator('.nav-name').textContent()) ?? '';
  // Left empty, then back within the moment it waits: it stays, also after the moment.
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await main.waitForTimeout(500);
  await quickRows.first().click();
  await expect(main.locator('.nav.on:not(.flip-ghost)')).toContainText(label);
  await main.waitForTimeout(3000);
  await expect(quickRows).toHaveCount(before + 1);
  await expect(main.locator('.nav.on:not(.flip-ghost)')).toContainText(label);
  // Left again (still empty): it goes.
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await expect(quickRows).toHaveCount(before, { timeout: 6000 });
});
