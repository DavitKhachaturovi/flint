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
 * MINI-01, REM-06, D-109, D-110: mini mode, beside the main window, built from the main window's
 * parts. Its own Flint on the suite's fixed clock (Tuesday 10 March 2026 from 10:00, D-107); both
 * windows off-screen and never focused (Davit's machine runs these); Alt is never pressed for real
 * (Alt+keys are dispatched as page events). One run in order: a failure stops the rest.
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

/** Mini's rows (not the ones playing their way out). */
const rows = (): ReturnType<Page['locator']> => mini.locator('.mini-rows .row:not(.leaving)');
const row = (text: string): ReturnType<Page['locator']> =>
  mini.locator('.mini-rows .row:not(.leaving)', { hasText: text });

/** D-79: animation and transition events in mini, so its motion can't silently disappear. */
const motion = (): Promise<string[]> =>
  mini.evaluate(() => [...(window as unknown as { motion: string[] }).motion]);
const resetMotion = (): Promise<unknown> =>
  mini.evaluate(() => (window as unknown as { motion: string[] }).motion.splice(0));

/** Alt+key as a page event (the tests never press Alt for real, D-93). */
const altKey = (key: 'ArrowUp' | 'ArrowDown'): Promise<void> =>
  mini.evaluate((which) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: which, altKey: true }));
  }, key);

/** A row dragged by the mouse to another row's place (the locked, springy drag). */
const drag = async (from: string, to: string): Promise<void> => {
  const start = await row(from).boundingBox();
  const end = await row(to).boundingBox();
  if (!start || !end) throw new Error('rows not found');
  const x = start.x + start.width / 2;
  await mini.mouse.move(x, start.y + start.height / 2);
  await mini.mouse.down();
  await mini.mouse.move(x, start.y + start.height / 2 - 6, { steps: 3 });
  await mini.mouse.move(x, end.y + end.height / 2 - (end.y < start.y ? 8 : -8), { steps: 10 });
  await mini.waitForTimeout(300);
  await mini.mouse.up();
};

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
    '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] Inbox thing one [id:: in1]\n- [ ] Inbox thing two [id:: in2]\n- [ ] Inbox thing three [id:: in3]\n',
  );
  await hook('showMini');
  await expect.poll(() => page('/mini/') !== undefined, { timeout: 15_000 }).toBe(true);
  mini = page('/mini/') as Page;
  await mini.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { motion: string[] }).motion = seen;
    for (const type of ['animationend', 'transitionend', 'transitioncancel'])
      document.addEventListener(
        type,
        (event) => {
          const target = event.target as Element;
          const name =
            event instanceof AnimationEvent
              ? event.animationName
              : (event as TransitionEvent).propertyName;
          seen.push(`${type} ${target.classList[0] ?? ''} ${name}`);
        },
        true,
      );
  });
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
  // D-110: the pin shows its state, filled while on top, an outline when not, the change eased.
  const pin = mini.locator('.mini-pin');
  const fill = (): Promise<string> =>
    pin.evaluate(
      (button) => getComputedStyle(button.querySelectorAll('path')[1] as Element).fillOpacity,
    );
  await expect(pin).toHaveClass(/\bon\b/);
  await expect.poll(fill).toBe('1');
  await resetMotion();
  await pin.click();
  await expect.poll(() => miniWindow('onTop')).toBe(false);
  await expect(pin).not.toHaveClass(/\bon\b/);
  await expect.poll(fill).toBe('0');
  await expect.poll(motion).toContain('transitionend  fill-opacity');
  await pin.click();
  await expect.poll(() => miniWindow('onTop')).toBe(true);
  await expect.poll(fill).toBe('1');
  // D-109: Ctrl+Alt+Space by default.
  expect((await main.evaluate(() => window.flintMain.hotkeys()))?.mini.accelerator).toBe(
    'Control+Alt+Space',
  );
});

test("the card: mockup 05's look on a transparent window, the main window's parts in their compact size (D-110)", async () => {
  // The window is larger than the card (its stage) and paints nothing around it.
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((each) => each.getTitle() === 'Flint mini')
        ?.getSize(),
    ),
  ).toEqual([804, 824]);
  expect(await mini.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );
  const card = mini.locator('.mini-card');
  const look = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: element.getBoundingClientRect().width,
      radius: style.borderTopLeftRadius,
      maxHeight: style.maxHeight,
      ground: style.backgroundColor,
    };
  });
  expect(look).toEqual({
    width: 364,
    radius: '22px',
    maxHeight: '460px',
    ground: 'rgb(21, 22, 25)',
  });
  // Its height fits its content (well under the limit with three rows).
  expect((await card.boundingBox())?.height ?? 0).toBeLessThan(400);
  // The rows are the main window's (`.row`, its checkbox and stripe), compact: 13 px, 17 px, 9 px.
  const first = row('Write the mini report');
  expect(
    await first.evaluate((element) => ({
      size: getComputedStyle(element).fontSize,
      padding: getComputedStyle(element).paddingTop,
      check: (element.querySelector('.check') as HTMLElement).getBoundingClientRect().width,
    })),
  ).toEqual({ size: '13px', padding: '9px', check: 17 });
  // The grip and the header drag the window; the tabs are the main window's segmented control.
  expect(
    await mini
      .locator('.mini-grip')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region')),
  ).toBe('drag');
  await expect(mini.locator('.mini-tabs.trash-tabs .trash-tab')).toHaveText([
    'Today',
    'Inbox',
    'Note',
  ]);
  // D-111: resize handles left, right and on the edge away from its corner (it hangs from the
  // top right): nothing above it takes the mouse.
  await expect(mini.locator('.mini-handle')).toHaveCount(5);
  await expect(mini.locator('.mini-handle.edge-left')).toHaveCount(1);
  await expect(mini.locator('.mini-handle.edge-right')).toHaveCount(1);
  await expect(mini.locator('.mini-handle.edge-bottom')).toHaveCount(1);
  await expect(mini.locator('.mini-handle[class*="top"]')).toHaveCount(0);
  // The default size: no reset button.
  await expect(mini.locator('.mini-reset.on')).toHaveCount(0);
});

test("Today: pinned tasks, then today's later reminders; no high-priority group (D-109, Q4)", async () => {
  await expect(mini.locator('.mini-rows .row:not(.leaving) .title')).toHaveText([
    'Write the mini report',
    'Urgent and pinned',
    'Call the vendor',
  ]);
  await expect(row('Call the vendor').locator('.reminder-time')).toHaveText('15:00');
  await expect(row('Urgent and pinned').locator('.stripe')).toHaveClass(/p-high/);
  // D-110: the next reminder today, with its live countdown, on the card at the top.
  const card = mini.locator('.mini-reminder');
  await expect(card).toContainText('Next · 15:00');
  await expect(card).toContainText('Call the vendor');
  await expect(card.locator('.mini-reminder-until')).toHaveText(/^in (5 h|4 h 5\d min)$/);
});

test('a click selects (the highlight glides), a double-click opens it in the main window, mini stays (D-109, Q4)', async () => {
  await row('Write the mini report').click();
  await expect(row('Write the mini report')).toHaveClass(/(^| )sel( |$)/);
  // The main window's gliding highlight.
  await resetMotion();
  await mini.keyboard.press('ArrowDown');
  await expect(row('Urgent and pinned')).toHaveClass(/(^| )sel( |$)/);
  await expect.poll(motion).toContain('transitionend sel-glide transform');
  // A single click never brings the main window to the task.
  await expect(main.locator('h1')).not.toContainText('Work');
  await row('Write the mini report').dblclick();
  await expect(main.locator('h1')).toContainText('Work');
  await expect(main.locator('.row.sel')).toContainText('Write the mini report');
  expect(await hook('miniVisible')).toBe(true);
  // Enter does the same (Today again first).
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
  await mini.keyboard.press('Enter');
  await expect(main.locator('h1')).toContainText('Work');
});

test('Space completes with the completion animation, Ctrl+Z brings it back; keys stay in a text field (D-109, Q7)', async () => {
  const file = join(flint, 'Work.md');
  await row('Write the mini report').click();
  // The main window's completion: a ghost of the row plays out where it was (ghosts live for a
  // moment only, so a MutationObserver records the ones that appear).
  await mini.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { ghosts: string[] }).ghosts = seen;
    new MutationObserver(() => {
      for (const ghost of document.querySelectorAll('.mini-rows .row.leaving'))
        seen.push(`${ghost.className} ${ghost.querySelector('.title')?.textContent ?? ''}`);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await mini.keyboard.press('Space');
  await expect(row('Write the mini report')).toHaveCount(0);
  await expect
    .poll(() =>
      mini.evaluate(() =>
        (window as unknown as { ghosts: string[] }).ghosts.some((ghost) =>
          /complete Write the mini report$/.test(ghost),
        ),
      ),
    )
    .toBe(true);
  await expect.poll(() => readFile(file, 'utf8')).toContain('- [x] Write the mini report');
  await mini.keyboard.press('Control+z');
  await expect(row('Write the mini report')).toHaveCount(1);
  await expect.poll(() => readFile(file, 'utf8')).toContain('- [ ] Write the mini report');
  // N goes to the composer; a letter typed there is text, not a command.
  await row('Urgent and pinned').click();
  await mini.keyboard.press('n');
  const field = mini.locator('.composer-input');
  await expect(field).toBeFocused();
  // D-110: focused and empty, the shorthand hint shows; it goes as soon as something is typed.
  await expect(mini.locator('.composer .hint')).toBeVisible();
  await mini.keyboard.type('p');
  await expect(field).toHaveValue('p');
  await expect(mini.locator('.composer .hint')).toBeHidden();
  expect(await readFile(file, 'utf8')).toContain(
    'Urgent and pinned [priority:: high] [pinned:: true]',
  );
  // The main window's composer: the shorthand's chips while typing.
  await field.fill('Added from mini !h');
  await expect(mini.locator('.composer-chips .chip')).toHaveText(['High']);
  await mini.keyboard.press('Enter');
  await expect(row('Added from mini')).toHaveCount(1);
  await expect
    .poll(() => readFile(join(flint, 'Inbox.md'), 'utf8'))
    .toMatch(/- \[ \] Added from mini \[pinned:: true\] \[priority:: high\]/);
  await mini.keyboard.press('Escape');
  await expect(field).not.toBeFocused();
});

test('Today: pinned rows reorder by drag and Alt+↑/↓; its reminders keep their time order (D-110)', async () => {
  const today = async (): Promise<string[]> =>
    (await mini.locator('.mini-rows .row:not(.leaving) .title').allTextContents()).map((text) =>
      text.trim(),
    );
  const [a, b, c, reminder] = await today();
  if (!a || !b || !c) throw new Error('three pinned rows expected');
  expect(reminder).toBe('Call the vendor');
  await drag(c, a);
  await expect.poll(today).toEqual([c, a, b, 'Call the vendor']);
  // Alt+↓ moves the selected task down among the pinned ones.
  await row(c).click();
  await altKey('ArrowDown');
  await expect.poll(today).toEqual([a, c, b, 'Call the vendor']);
  // A reminder row doesn't move: it nudges.
  await row('Call the vendor').click();
  await altKey('ArrowUp');
  await mini.waitForTimeout(300);
  expect(await today()).toEqual([a, c, b, 'Call the vendor']);
});

test('Inbox: its open tasks, the tab arriving as a page does; drag reorders; P pins (D-109, D-110)', async () => {
  await resetMotion();
  await mini.keyboard.press('Control+2');
  await expect(mini.locator('.mini-tabs .trash-tab.on')).toHaveText('Inbox');
  await expect.poll(motion).toContain('animationend mini-view view-in');
  await expect(row('Inbox thing one')).toHaveCount(1);
  await drag('Inbox thing three', 'Inbox thing one');
  await expect
    .poll(() => readFile(join(flint, 'Inbox.md'), 'utf8'))
    .toMatch(/Inbox thing three[\s\S]*Inbox thing one[\s\S]*Inbox thing two/);
  await row('Inbox thing two').click();
  await mini.keyboard.press('p');
  await expect
    .poll(() => readFile(join(flint, 'Inbox.md'), 'utf8'))
    .toContain('- [ ] Inbox thing two [pinned:: true]');
  await mini.keyboard.press('Control+1');
  await expect(row('Inbox thing two')).toHaveCount(1);
  // Right-click: Complete, Pin/Unpin, Open in Flint.
  await row('Inbox thing two').click({ button: 'right' });
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
  // D-110: the upcoming card turns into the alert.
  const card = mini.locator('.mini-reminder.alert');
  await expect(card).toBeVisible({ timeout: 40_000 });
  await expect(card).toContainText('1 of 2');
  await expect(card.locator('button')).toHaveText([/Done\s*D/, /Snooze 10m\s*S/, /Open\s*O/]);
  expect(
    ((await hook('toasts')) as string[]).filter((each) => each.includes('Ring the')),
  ).toHaveLength(2);
  const first = (await card.locator('.mini-reminder-title').innerText()).trim();
  await rows().first().click();
  await mini.keyboard.press('d');
  await expect(card).not.toContainText('1 of 2');
  await expect(card.locator('.mini-reminder-title')).not.toHaveText(first);
  await expect.poll(() => readFile(join(flint, 'Calls.md'), 'utf8')).toContain(`- [x] ${first}`);
  expect(((await hook('closedToasts')) as string[]).length).toBe(1);
  // Acting on the toast (Windows hands Flint its button) clears the card too; the upcoming one
  // comes back in its place.
  const id = first === 'Ring the bank' ? 'rs1' : 'rb1';
  await app.evaluate(
    (_electron, target) =>
      (globalThis as { __flintE2E?: { activate?: (url: string) => void } }).__flintE2E?.activate?.(
        `flint-dev://reminder/done?id=${target}`,
      ),
    id,
  );
  await expect(mini.locator('.mini-reminder.alert')).toHaveCount(0);
  await expect(mini.locator('.mini-reminder')).toContainText('Next · 15:00');
});

test('the Note tab: made on the first keystroke, one window edits it at a time (D-109, Q5)', async () => {
  const before = (await readdir(flint)).length;
  await mini.keyboard.press('Control+3');
  const editor = mini.locator('.mini-editor .cm-content');
  await expect(editor).toBeVisible();
  // Just looking makes nothing; with the note empty, "New quick note" waits (D-110).
  await mini.waitForTimeout(400);
  expect((await readdir(flint)).length).toBe(before);
  await mini.locator('.mini-note-head .tool').click();
  await expect(mini.locator('.fl-menu-item', { hasText: 'New quick note' })).toBeDisabled();
  await mini.keyboard.press('Escape');
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

test('the Note tab: a reminder never takes the caret, typing goes on; D/S/O stay text (D-110)', async () => {
  const editor = mini.locator('.mini-editor .cm-content');
  await editor.click();
  await mini.keyboard.press('Control+End');
  await mini.keyboard.type(' abc');
  const at = stamp(appNow());
  await writeFile(
    join(flint, 'Later.md'),
    `---\nflint: 1\nid: later\nmode: tasks\n---\n- [ ] Stand up [reminder:: ${at}] [id:: su1]\n`,
  );
  const card = mini.locator('.mini-reminder.alert');
  await expect(card).toBeVisible({ timeout: 70_000 });
  // The caret stayed: typing (D, S, O too) goes on into the note.
  await mini.keyboard.type('dso');
  await expect(editor).toContainText('Sticky from mini and more! abcdso');
  expect(await mini.evaluate(() => document.activeElement?.closest('.cm-content') !== null)).toBe(
    true,
  );
  await expect(card).toBeVisible();
  // Out of the field, D is Done.
  await mini.keyboard.press('Escape');
  await mini.keyboard.press('d');
  await expect.poll(() => readFile(join(flint, 'Later.md'), 'utf8')).toContain('- [x] Stand up');
  // Nothing else to show on this tab: the card folds away.
  await expect(mini.locator('.mini-reminder-fold.open')).toHaveCount(0);
  await expect(mini.locator('.mini-reminder')).toHaveCount(0);
});

test('the Note tab: a title before any text; a removed empty note never leaves the tab dead (D-110)', async () => {
  // New quick note (the current one has text), then a title first: the note is made with it.
  await mini.locator('.mini-note-head .tool').click();
  await mini.locator('.fl-menu-item', { hasText: 'New quick note' }).click();
  const title = mini.locator('.quick-title-input');
  await expect(title).toBeEnabled();
  await expect(title).toHaveValue('');
  await title.click();
  await mini.keyboard.type('Title first');
  await mini.keyboard.press('Enter');
  await expect
    .poll(async () => (await readdir(flint)).some((name) => name.startsWith('Title first')))
    .toBe(true);
  // Another new one, typed into and emptied again, then left: it is removed after a moment,
  // while the tab is shown again; the tab still takes the title and the text.
  await mini.locator('.mini-note-head .tool').click();
  await mini.locator('.fl-menu-item', { hasText: 'New quick note' }).click();
  const editor = mini.locator('.mini-editor .cm-content');
  await editor.click();
  await mini.keyboard.type('x');
  await expect
    .poll(async () => (await readdir(flint)).filter((name) => name.startsWith('Quick note')).length)
    .toBe(2);
  await mini.keyboard.press('Backspace');
  await mini.waitForTimeout(800);
  await mini.keyboard.press('Escape');
  await mini.keyboard.press('Control+1');
  await mini.keyboard.press('Control+3');
  await mini.waitForTimeout(2600);
  await expect(editor).toBeVisible();
  await expect(title).toBeEnabled();
  await editor.click();
  await mini.keyboard.type('Still works');
  await expect(editor).toContainText('Still works');
  await mini.keyboard.press('Escape');
  await mini.keyboard.press('Control+1');
});

/** Drags a resize handle by (dx, dy). */
const resize = async (handle: string, dx: number, dy: number): Promise<void> => {
  const box = await mini.locator(`.mini-handle.${handle}`).boundingBox();
  if (!box) throw new Error(`no ${handle}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await mini.mouse.move(x, y);
  await mini.mouse.down();
  await mini.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await mini.mouse.move(x + dx, y + dy, { steps: 4 });
  await mini.mouse.up();
};
const cardBox = async (): Promise<{ x: number; width: number; height: number }> => {
  const box = await mini.locator('.mini-card').boundingBox();
  if (!box) throw new Error('no card');
  return { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) };
};

test('one size for every tab: Note takes the whole height; resized from either side, back near the default it snaps; Reset size (D-111)', async () => {
  await mini.keyboard.press('Control+1');
  // Settled (the last test's tab switch eases the height and folds the reminder card in).
  await mini.waitForTimeout(800);
  const today = await cardBox();
  expect(today.width).toBe(364);
  expect(today.height).toBeLessThan(460);
  // The Note tab always takes the height limit; the width stays.
  await mini.keyboard.press('Control+3');
  await expect.poll(async () => (await cardBox()).height).toBe(460);
  expect((await cardBox()).width).toBe(364);
  await mini.keyboard.press('Control+1');
  await expect.poll(async () => (await cardBox()).height).toBe(today.height);
  // The right edge is its hang side (top right): it resizes too, the left edge staying.
  await resize('edge-right', 40, 0);
  await expect.poll(async () => (await cardBox()).width).toBe(404);
  expect((await cardBox()).x).toBe(today.x);
  await expect(mini.locator('.mini-reset.on')).toHaveCount(1);
  // The same size on every tab.
  await mini.keyboard.press('Control+2');
  expect((await cardBox()).width).toBe(404);
  await mini.keyboard.press('Control+1');
  // Back near the default, it snaps to it and the reset button goes.
  await resize('edge-left', 37, 0);
  await expect.poll(async () => (await cardBox()).width).toBe(364);
  await expect(mini.locator('.mini-reset.on')).toHaveCount(0);
  // Larger again, then Reset size: back to the default, eased.
  await resize('edge-left', -60, 0);
  await resize('edge-bottom', 0, -60);
  await expect.poll(async () => (await cardBox()).width).toBe(424);
  await mini.locator('.mini-reset.on').click();
  await expect.poll(async () => (await cardBox()).width).toBe(364);
  await expect(mini.locator('.mini-reset.on')).toHaveCount(0);
  expect(
    await mini.locator('.mini-card').evaluate((card) => getComputedStyle(card).maxHeight),
  ).toBe('460px');
});

test('a slow second click on a selected row opens it; the bell turns a reminder off and on, the row staying (D-111)', async () => {
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
  await row('Call the vendor').click();
  await mini.waitForTimeout(700);
  await row('Call the vendor').click({ position: { x: 120, y: 10 } });
  await expect(main.locator('h1')).toContainText('Work');
  await expect(main.locator('.row.sel')).toContainText('Call the vendor');
  // The bell: off (struck), the row stays in Today to turn it back on.
  const file = join(flint, 'Work.md');
  await row('Call the vendor').locator('.reminder-bell').click();
  await expect.poll(() => readFile(file, 'utf8')).toMatch(/Call the vendor .*\[muted::/);
  await expect(row('Call the vendor').locator('.reminder')).toHaveClass(/muted/);
  await row('Call the vendor').locator('.reminder-bell').click();
  await expect.poll(() => readFile(file, 'utf8')).not.toMatch(/Call the vendor .*\[muted::/);
  await expect(row('Call the vendor').locator('.reminder')).not.toHaveClass(/muted/);
});

test('× hides mini mode (fading out first); the palette and the cheat sheet know it (D-109, D-106, D-111)', async () => {
  await mini.locator('.tool[aria-label="Hide mini mode"]').click();
  await expect.poll(() => hook('miniVisible')).toBe(false);
  // D-111: the window hides once the card has faded out; hidden, the card waits unseen.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((each) => each.getTitle() === 'Flint mini')
          ?.isVisible(),
      ),
    )
    .toBe(false);
  await expect
    .poll(() => mini.locator('.mini-card').evaluate((card) => card.style.opacity))
    .toBe('0');
  await main.keyboard.press('Control+k');
  await main.keyboard.type('mini mode');
  // Go to → Settings: Mini mode comes first (D-107's order); the command is under Commands.
  await main
    .locator('.palette-group', { hasText: 'Commands' })
    .locator('.palette-item', { hasText: /^Mini mode/ })
    .click();
  await expect.poll(() => hook('miniVisible')).toBe(true);
  // Shown, it rises in.
  await expect
    .poll(() => mini.locator('.mini-card').evaluate((card) => card.style.opacity))
    .toBe('');
  await main.keyboard.press('Shift+Slash');
  await expect(main.locator('.cheat-sheet .cheat-group[aria-label="Mini mode"]')).toHaveCount(1);
  await main.keyboard.press('Escape');
});
