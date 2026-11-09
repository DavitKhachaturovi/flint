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
 * UI-10, D-89, D-133: the motion census. Every action of Flint's windows, step by step (something
 * appearing, going, changing state), and what animated during it: CSS animations, CSS transitions,
 * animations started from script and smooth scrolls (a colour change on what the pointer is over
 * is its hover, not counted). Each step also checks that its action happened. A step that should move
 * and didn't fails; a step instant by a documented decision says which. The table is written to
 * test-results/motion-census.md. Its own Flint, on the suite's fixed clock (D-107), off-screen,
 * never focused.
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

/** Records what animates in a page from now on (once per page). */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const census = window as unknown as { __motion?: { on: boolean; seen: string[] } };
    if (census.__motion) return;
    const state = { on: false, seen: [] as string[] };
    census.__motion = state;
    const name = (target: EventTarget | null): string => {
      if (!(target instanceof Element)) return '?';
      const classes = [...target.classList].slice(0, 2).join('.');
      return `${target.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    };
    document.addEventListener(
      'animationstart',
      (event) => {
        // The editor's caret blink isn't an action's motion.
        if (state.on && !event.animationName.startsWith('cm-'))
          state.seen.push(`${name(event.target)} ${event.animationName}`);
      },
      true,
    );
    document.addEventListener(
      'transitionrun',
      (event) => {
        // A colour change on what the pointer is over is its hover (a click moves the pointer).
        const colour = /color$|^box-shadow$|^fill$|^stroke$/.test(event.propertyName);
        if (colour && event.target instanceof Element && event.target.matches(':hover')) return;
        if (state.on) state.seen.push(`${name(event.target)} ~${event.propertyName}`);
      },
      true,
    );
    // A smooth scroll is motion too (it fires no animation event).
    document.addEventListener(
      'scroll',
      (event) => {
        if (state.on) state.seen.push(`${name(event.target)} scroll`);
      },
      true,
    );
    // Wrapped, then called on the element it was called on (apply), so `this` stays right.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      if (state.on) state.seen.push(`${name(this)} animate()`);
      return animate.apply(this, args);
    };
  });
}

async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as { __motion: { on: boolean; seen: string[] } }).__motion;
    state.seen = [];
    state.on = true;
  });
}

async function stopRecording(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = (window as unknown as { __motion: { on: boolean; seen: string[] } }).__motion;
    state.on = false;
    return [...new Set(state.seen)];
  });
}

/** A step: `motion` must animate; `instant` is so by the decision named. */
interface Result {
  readonly name: string;
  readonly expect: 'motion' | { readonly instant: string };
  readonly seen: readonly string[];
  readonly error?: string;
}
const results: Result[] = [];

async function step(
  page: Page,
  name: string,
  expected: Result['expect'],
  act: () => Promise<void>,
): Promise<void> {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(150);
  await startRecording(page);
  let error: string | undefined;
  try {
    await act();
    await page.waitForTimeout(450);
  } catch (caught) {
    error = caught instanceof Error ? caught.message.split('\n')[0] : String(caught);
  }
  const seen = await stopRecording(page);
  results.push({ name, expect: expected, seen, ...(error !== undefined && { error }) });
}

const INBOX = [
  '---\nflint: 1\nid: inbox\nmode: tasks\n---',
  '- [ ] Call the bank [id:: m1]',
  '- [ ] Book the venue [id:: m2]',
  '    Two rooms, one with a projector.',
  '- [ ] Renew the passport [reminder:: 2026-03-10T15:00] [id:: m3]',
  '- [ ] Water the plants [id:: m4]',
  '- [x] Paid the rent [id:: m5]',
  '',
].join('\n');

async function launch(): Promise<{ app: ElectronApplication; main: Page }> {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-motion-'));
  const flint = join(dataDirectory, 'Flint');
  await mkdir(join(flint, '.flint'), { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), INBOX);
  await writeFile(
    join(flint, 'Work.md'),
    '---\nflint: 1\nid: work\nmode: tasks\n---\n- [ ] Ship the report [id:: w1]\n',
  );
  await writeFile(
    join(flint, 'Shop.md'),
    '---\nflint: 1\nid: shop\nmode: tasks\n---\n- [ ] Milk [id:: s1]\n',
  );
  await writeFile(
    join(flint, 'Plans.md'),
    '---\nflint: 1\nid: plans\nmode: note\n---\n# Plans\n\n## Spring\n\nTrips.\n\n![](attachments/dot.png)\n\n## Summer\n\nBeach.\n\n- [ ] Book the hotel\n\n| City | Days |\n| ---- | ---- |\n| Rome | 3    |\n',
  );
  await mkdir(join(flint, 'attachments'), { recursive: true });
  await writeFile(
    join(flint, 'attachments', 'dot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  await writeFile(
    join(flint, '.flint', 'sidebar.json'),
    JSON.stringify({
      flint: 1,
      items: [
        { list: 'work' },
        { list: 'plans' },
        { group: 'g1', name: 'Errands', lists: ['shop'] },
      ],
    }),
  );
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

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('the motion census: every action moves, or is instant by a decision (UI-10, D-89, D-133)', async () => {
  test.setTimeout(240_000);
  const { app: running, main } = await launch();
  await record(main);
  const nav = (name: string) => main.locator('.nav:not(.flip-ghost)', { hasText: name }).first();
  const row = (text: string) => main.locator('.main .row', { hasText: text }).first();
  await nav('Inbox').click();
  await expect(row('Call the bank')).toBeVisible();

  // Moving around.
  await step(main, 'Open another list (page and sidebar highlight)', 'motion', () =>
    nav('Work').click(),
  );
  await step(main, 'Back to Inbox', 'motion', () => nav('Inbox').click());
  await step(main, 'Select a task (selection glides)', 'motion', () =>
    row('Call the bank').click(),
  );
  await step(main, 'Move the selection with ↓', 'motion', () => main.keyboard.press('ArrowDown'));
  await step(main, 'Hide the side panel (Ctrl+\\)', 'motion', () =>
    main.keyboard.press('Control+\\'),
  );
  await step(main, 'Show the side panel', 'motion', () => main.keyboard.press('Control+\\'));
  await step(main, 'Open a note', 'motion', () => nav('Plans').click());
  await step(main, 'Today', 'motion', () => nav('Today').click());
  await nav('Inbox').click();
  await expect(row('Call the bank')).toBeVisible();

  // Task actions. These go through main (the change, the file, the view sent back), so each act
  // waits for the row to show its result: on a slow machine the change (and its motion) can
  // otherwise land after the step's recording has closed. An open task's row (a leaving ghost has
  // no data-key).
  const openRow = (text: string) =>
    main.locator('.main .row[data-key]:not(.done)', { hasText: text });
  await row('Water the plants').click();
  await step(main, 'Complete a task (Space)', 'motion', async () => {
    await main.keyboard.press(' ');
    await expect(openRow('Water the plants')).toHaveCount(0);
  });
  await step(main, 'Undo it (Ctrl+Z)', 'motion', async () => {
    await main.keyboard.press('Control+z');
    await expect(openRow('Water the plants')).toHaveCount(1);
  });
  await row('Water the plants').click();
  await step(main, 'Pin a task (P)', 'motion', async () => {
    await main.keyboard.press('p');
    await expect(row('Water the plants').locator('.pin-ind')).toBeVisible();
  });
  await step(main, 'Change its priority (3)', 'motion', async () => {
    await main.keyboard.press('3');
    // TASK-03: 3 is high.
    await expect(row('Water the plants').locator('.stripe')).toHaveClass(/\bp-high\b/);
  });
  await step(main, 'Open a task’s notes (Enter edits; its body)', 'motion', async () => {
    await row('Book the venue').click();
    await main.keyboard.press('Enter');
  });
  await step(main, 'Stop editing (Esc)', 'motion', async () => {
    await main.keyboard.press('Escape');
    await expect(main.locator('.main .row-edit, .main .row.editing')).toHaveCount(0);
  });
  await step(main, 'Delete a task (row goes, toast comes)', 'motion', async () => {
    await row('Call the bank').click();
    await main.keyboard.press('Delete');
    await expect(openRow('Call the bank')).toHaveCount(0);
  });
  await step(main, 'Undo the delete (row comes back)', 'motion', async () => {
    await main.keyboard.press('Control+z');
    await expect(openRow('Call the bank')).toHaveCount(1);
  });
  await step(main, 'Add a task from the composer', 'motion', async () => {
    await main.locator('.main .composer-input').click();
    await main.keyboard.type('Buy stamps');
    await main.keyboard.press('Enter');
    await expect(row('Buy stamps')).toBeVisible();
  });
  await main.keyboard.type('Plan the trip');
  await step(main, 'Composer: the ## list menu opens', 'motion', () => main.keyboard.type(' ##'));
  await step(main, 'Composer: cleared (Esc)', 'motion', async () => {
    await main.keyboard.press('Escape');
    await main.keyboard.press('Escape');
  });

  // Menus and pickers.
  await step(main, 'A task’s right-click menu opens', 'motion', () =>
    row('Book the venue').click({ button: 'right' }),
  );
  await step(main, 'The menu closes (Esc)', 'motion', () => main.keyboard.press('Escape'));
  await step(main, 'A sidebar list’s right-click menu opens', 'motion', () =>
    nav('Work').click({ button: 'right' }),
  );
  await step(main, 'It closes', 'motion', () => main.keyboard.press('Escape'));
  await step(main, 'The priority picker opens', 'motion', async () => {
    await main.locator('.main .composer-input').click();
    await main.locator('.main .composer [aria-label="Set priority"]').click();
  });
  await step(main, 'It closes (Esc)', 'motion', () => main.keyboard.press('Escape'));
  await step(main, 'The reminder picker opens', 'motion', () =>
    main.locator('.main .composer [aria-label="Set reminder"]').click(),
  );
  await step(main, 'It closes', 'motion', () => main.keyboard.press('Escape'));
  await step(main, 'The list picker opens', 'motion', () =>
    main.locator('.main .composer [aria-label="Choose list"]').click(),
  );
  await step(main, 'It closes', 'motion', () => main.keyboard.press('Escape'));
  await main.locator('.main .composer-input').blur();

  // Overlays.
  await step(main, 'The palette opens (Ctrl+K)', 'motion', () => main.keyboard.press('Control+k'));
  await step(main, 'It closes (Esc)', 'motion', () => main.keyboard.press('Escape'));
  await nav('Work').click();
  await step(main, 'The cheat sheet opens (?)', 'motion', async () => {
    await main.keyboard.press('Shift+Slash');
    await expect(main.locator('.cheat-sheet')).toBeVisible();
  });
  await step(main, 'The cheat sheet closes (Esc)', 'motion', async () => {
    await main.keyboard.press('Escape');
    await expect(main.locator('.cheat-sheet')).toHaveCount(0);
  });
  // TASK-18, D-151: Give to Claude's card, the palette's motion.
  await main.locator('.main .row').first().click();
  await step(main, 'Give to Claude’s card opens (G)', 'motion', async () => {
    await main.keyboard.press('g');
    await expect(main.locator('.give-to-claude')).toBeVisible();
  });
  await step(main, 'It closes (Esc)', 'motion', async () => {
    await main.keyboard.press('Escape');
    await expect(main.locator('.give-to-claude')).toHaveCount(0);
  });
  await step(main, 'Find opens (Ctrl+F)', 'motion', () => main.keyboard.press('Control+f'));
  await step(main, 'It closes (Esc)', 'motion', () => main.keyboard.press('Escape'));
  await step(main, 'What’s new opens', 'motion', async () => {
    await main.keyboard.press('Control+k');
    await main.keyboard.type('what');
    await main.keyboard.press('Enter');
  });
  await step(main, 'It closes', 'motion', () => main.keyboard.press('Escape'));
  await nav('Inbox').click();
  await step(main, 'Triage opens (T)', 'motion', async () => {
    await main.keyboard.press('t');
    await expect(main.locator('.triage')).toBeVisible();
  });
  await step(main, 'Triage: the next card (→)', 'motion', () => main.keyboard.press('ArrowRight'));
  await step(main, 'Triage closes (Esc)', 'motion', async () => {
    await main.keyboard.press('Escape');
    await expect(main.locator('.triage')).toHaveCount(0);
  });

  // The sidebar.
  await step(main, 'New list: the name field appears (Ctrl+Shift+N, List)', 'motion', async () => {
    await main.keyboard.press('Control+Shift+n');
    await main.locator('.fl-menu .fl-menu-item').first().click();
  });
  await step(main, 'The name field goes (Esc)', 'motion', () => main.keyboard.press('Escape'));
  await step(main, 'A group folds', 'motion', () =>
    main.locator('.nav-group .group-head, .nav-group [aria-expanded]').first().click(),
  );
  await step(main, 'It unfolds', 'motion', () =>
    main.locator('.nav-group .group-head, .nav-group [aria-expanded]').first().click(),
  );
  await step(main, 'A quick note (a row appears, the note opens)', 'motion', async () => {
    await main.keyboard.press('Control+Shift+j');
    // Made by main: wait for the note to open.
    await expect(main.locator('.main .note-card .cm-content')).toBeVisible();
  });
  await main.locator('.main .note-card .cm-content').click();
  await step(main, 'The note’s slash menu opens', 'motion', async () => {
    await main.keyboard.type('/');
    await expect(main.locator('.fl-slash-menu')).toBeVisible();
  });
  await step(main, 'The slash menu closes (Esc)', 'motion', async () => {
    await main.keyboard.press('Escape');
    await expect(main.locator('.fl-slash-menu')).toHaveCount(0);
  });

  // A note's picture and the side panel's extra sections.
  await nav('Plans').click();
  await expect(main.locator('.main .fl-media img').first()).toBeVisible();
  // D-141 Q3: a marker's raw markdown shows at once (typing never waits, D-75).
  await main.locator('.main .note-card .cm-line', { hasText: 'Spring' }).click();
  await main.keyboard.press('End');
  for (let at = 0; at < 'Spring'.length; at++) await main.keyboard.press('ArrowLeft');
  await step(main, 'A note: ← steps into a heading’s marks', { instant: 'D-141 Q3, D-75' }, () =>
    main.keyboard.press('ArrowLeft'),
  );
  // D-141 Q8: the note's checkbox pops as a task row's, the text fades to muted and back.
  const hotel = main.locator('.main .note-card .cm-line', { hasText: 'Book the hotel' });
  await step(main, 'A note: a checkbox ticks (pop, the text fades)', 'motion', () =>
    hotel.locator('.cm-fl-task-box .check').click(),
  );
  await step(main, 'A note: it unticks (the text comes back)', 'motion', () =>
    hotel.locator('.cm-fl-task-box .check').click(),
  );
  // NOTE-09, D-141 Q12: Source mode fades the note's text over, on and off.
  await main.locator('.main .note-card .cm-line', { hasText: 'Beach' }).click();
  await step(main, 'A note: Source mode on (Ctrl+Shift+E, the text fades over)', 'motion', () =>
    main.keyboard.press('Control+Shift+E'),
  );
  await step(main, 'A note: Source mode off', 'motion', () =>
    main.keyboard.press('Control+Shift+E'),
  );
  // NOTE-10, D-141 Q12: a table's active cell has a ring that glides; a new row fades in.
  const tableCell = (row: number, column: number) =>
    main.locator(`.main .note-card .cm-fl-table [data-row="${row}"][data-column="${column}"]`);
  await step(main, 'A table: a cell is edited (its ring fades in)', 'motion', () =>
    tableCell(1, 0).click(),
  );
  await step(main, 'A table: Tab (the ring glides to the next cell)', 'motion', () =>
    main.keyboard.press('Tab'),
  );
  await step(
    main,
    'A table: Tab in the last cell (a row fades in, the table grows)',
    'motion',
    () => main.keyboard.press('Tab'),
  );
  await main.keyboard.press('Control+z');
  await main.keyboard.press('Escape');
  // D-144: the table's handles fade in under the pointer; a drag grows a ghost of what it adds.
  const tableHandle = main.locator('.main .note-card .cm-fl-table-edge-right');
  await step(main, 'A table: the pointer over it (its "+" handles fade in)', 'motion', async () => {
    await main.locator('.main .note-card .cm-fl-table').hover();
    await expect(tableHandle).toHaveCSS('opacity', '1');
  });
  await step(
    main,
    'A table: its right handle dragged (a ghost column grows)',
    'motion',
    async () => {
      const handle = await tableHandle.boundingBox();
      if (!handle) throw new Error('no handle');
      await main.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await main.mouse.down();
      await main.mouse.move(handle.x + 120, handle.y + handle.height / 2, { steps: 4 });
      await expect(main.locator('.main .note-card .cm-fl-table-ghost.adding')).toHaveCount(1);
    },
  );
  await main.keyboard.press('Escape');
  await main.mouse.up();
  // D-144: cells selected (Shift+→ from the end of the active cell): their soft fill fades in. By
  // key, so the pointer isn't over the cell (a colour change under it counts as its hover).
  await tableCell(1, 0).click();
  await main.keyboard.press('End');
  await step(main, 'A table: Shift+→ selects cells (their fill fades in)', 'motion', async () => {
    await main.keyboard.press('Shift+ArrowRight');
    await expect(main.locator('.main .note-card .cm-fl-cell-selected')).toHaveCount(1);
  });
  // Esc clears the selected cells, the next one leaves the table.
  await main.keyboard.press('Escape');
  await main.keyboard.press('Escape');
  await step(main, 'The side panel: an extra section opens (Attachments)', 'motion', () =>
    main.locator('.context-panel .panel-extra-head').first().click(),
  );
  await step(main, 'It folds again', 'motion', () =>
    main.locator('.context-panel .panel-extra-head').first().click(),
  );
  await step(main, 'The lightbox opens (a click on a picture)', 'motion', async () => {
    await main.locator('.main .fl-media img').first().click();
    await expect(main.locator('.lightbox')).toBeVisible();
  });
  await step(main, 'The lightbox closes (Esc)', 'motion', async () => {
    await main.keyboard.press('Escape');
    await expect(main.locator('.lightbox')).toHaveCount(0);
  });
  // Something in Trash.
  await nav('Inbox').click();
  await row('Buy stamps').click();
  await main.keyboard.press('Delete');

  // Settings, Trash, Snapshots.
  await step(main, 'Settings opens', 'motion', () => nav('Settings').click());
  await step(main, 'A switch changes', 'motion', async () => {
    // The setting is saved by main and comes back: wait for the switch to show it.
    const pins = main.locator('.switch[aria-label="Ask about unfinished pins"]');
    const was = await pins.getAttribute('aria-checked');
    await pins.click();
    await expect(pins).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
  });
  await step(main, 'Settings’ index jumps to a section', 'motion', () =>
    main.locator('.settings-index-item', { hasText: 'Data' }).click(),
  );
  await step(main, 'Settings: the link pattern editor opens', 'motion', () =>
    main.locator('#settings-links .trash-action', { hasText: 'Add a link pattern' }).click(),
  );
  await step(main, 'It closes (Cancel)', 'motion', () =>
    main.locator('#settings-links .link-editor').getByRole('button', { name: 'Cancel' }).click(),
  );
  // APP-06, D-136: the update status line and the "Update ready" toast (the fake updater).
  const emitUpdate = (event: string, arg?: unknown): Promise<void> =>
    running.evaluate(
      (_, { name, value }) =>
        (
          globalThis as {
            __flintE2E?: { updater?: { emit: (event: string, arg?: unknown) => void } };
          }
        ).__flintE2E?.updater?.emit(name, value ?? undefined),
      { name: event, value: arg ?? null },
    );
  await step(main, 'About: Check for updates (the status line changes)', 'motion', async () => {
    await main.locator('.settings-index-item', { hasText: 'About' }).click();
    await main
      .locator('#settings-about')
      .getByRole('button', { name: 'Check for updates' })
      .click();
    await expect(main.locator('#settings-about .update-status')).toHaveText(
      'Checking for updates…',
    );
  });
  await step(main, 'An update is ready (the toast rises)', 'motion', async () => {
    await emitUpdate('update-downloaded', { version: '9.9.9' });
    await expect(main.locator('.toast')).toContainText('Update ready');
  });
  await step(main, 'Later (the toast goes)', 'motion', async () => {
    await main.locator('.toast').getByRole('button', { name: 'Later' }).click();
    await expect(main.locator('.toast')).toHaveCount(0);
  });
  await step(main, 'Trash opens', 'motion', () => nav('Trash').click());
  const trashed = main.locator('.trash-row', { hasText: 'Buy stamps' });
  await step(main, 'Trash: Delete now asks inline', 'motion', () =>
    trashed.getByRole('button', { name: 'Delete now' }).click(),
  );
  await step(main, 'The question goes (Cancel)', 'motion', () =>
    trashed.getByRole('button', { name: 'Cancel' }).click(),
  );
  await step(main, 'Trash: Restore (the row goes)', 'motion', async () => {
    await trashed.getByRole('button', { name: 'Restore' }).click();
    // Restored by main, the row starts leaving when Trash's view comes back.
    await expect(main.locator('.trash-row:not(.leaving)', { hasText: 'Buy stamps' })).toHaveCount(
      0,
    );
  });
  await step(main, 'Snapshots open', 'motion', async () => {
    await main.keyboard.press('Control+k');
    await main.keyboard.type('snapshots');
    await main.keyboard.press('Enter');
  });

  // The other windows.
  await running.evaluate(() =>
    (globalThis as { __flintE2E?: { showMini?: () => void } }).__flintE2E?.showMini?.(),
  );
  await expect.poll(() => running.windows().some((page) => page.url().includes('mini'))).toBe(true);
  const miniPage = running.windows().find((page) => page.url().includes('mini')) as Page;
  await record(miniPage);
  await step(miniPage, 'Mini: another tab', 'motion', () =>
    miniPage.locator('[role="tab"]').nth(1).click(),
  );
  await step(miniPage, 'Mini: back to the first tab', 'motion', () =>
    miniPage.locator('[role="tab"]').nth(0).click(),
  );
  await running.evaluate(() =>
    (globalThis as { __flintE2E?: { hideMini?: () => void } }).__flintE2E?.hideMini?.(),
  );
  await running.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  await expect
    .poll(() => running.windows().some((page) => page.url().includes('capture-popup')))
    .toBe(true);
  const popup = running.windows().find((page) => page.url().includes('capture-popup')) as Page;
  await record(popup);
  await step(popup, 'The capture popup: a chip appears (!h)', 'motion', () =>
    popup.locator('#capture').fill('call the bank !h'),
  );
  // Esc reaches the popup only while it has the keyboard (tests never give it): main's message
  // that it hides, as editing.spec.ts sends it.
  await step(popup, 'The capture popup closes (main says hiding)', 'motion', () =>
    running.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((each) =>
        each.webContents.getURL().includes('capture-popup'),
      );
      window?.webContents.send('popup:hiding');
    }),
  );

  // The table, and the verdict.
  const lines = [
    '# Motion census (UI-10, D-133)',
    '',
    '| Step | Expected | What moved |',
    '|---|---|---|',
    ...results.map(
      (result) =>
        `| ${result.name} | ${result.expect === 'motion' ? 'motion' : `instant (${result.expect.instant})`} | ${
          result.error
            ? `ERROR: ${result.error}`
            : result.seen.length === 0
              ? '**nothing**'
              : result.seen.slice(0, 20).join('; ')
        } |`,
    ),
  ];
  await mkdir(join(appDirectory, 'test-results'), { recursive: true });
  await writeFile(join(appDirectory, 'test-results', 'motion-census.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  const still = results.filter(
    (result) => result.expect === 'motion' && (result.error || result.seen.length === 0),
  );
  expect(still.map((result) => result.name)).toEqual([]);
});
