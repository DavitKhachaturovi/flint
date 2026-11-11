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
  miniSurface?: { rects: Box[] };
  // MINI-04, D-177.
  miniEdge?: () => unknown;
  miniStartCollapsed?: () => void;
  miniToggle?: () => void;
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

type Box = { x: number; y: number; width: number; height: number };
/**
 * Where two rows are once the list holds still: no motion running in mini (a row just added still
 * opening its place, the highlight gliding) and the same boxes on two reads in a row. Measured
 * mid-motion, the press can land on the row next to the one meant (a slow machine, CI).
 */
const settledBoxes = async (from: string, to: string): Promise<[Box, Box]> => {
  let last = '';
  let boxes: [Box, Box] | null = null;
  await expect
    .poll(
      async () => {
        const moving = await mini.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (each) =>
                  each.playState === 'running' &&
                  each.effect?.getComputedTiming().iterations !== Infinity,
              ).length,
        );
        const start = await row(from).boundingBox();
        const end = await row(to).boundingBox();
        const seen = JSON.stringify([start, end]);
        const still = moving === 0 && start !== null && end !== null && seen === last;
        last = seen;
        if (still) boxes = [start, end];
        return still;
      },
      { intervals: [50] },
    )
    .toBe(true);
  if (!boxes) throw new Error('rows not found');
  return boxes;
};

/** A row's own drag shift (the drag sets `translateY(…)` inline; empty or 0 when it rests). */
const shift = (text: string): Promise<string> =>
  row(text).evaluate((element) => (element as HTMLElement).style.transform);

/**
 * A row dragged by the mouse to another row's place (the locked, springy drag): pressed once the
 * list holds still, lifted past the threshold (the right row is the one lifted), moved in steps
 * until the target row has made way, and only then dropped.
 */
const drag = async (from: string, to: string): Promise<void> => {
  const [start, end] = await settledBoxes(from, to);
  const x = start.x + start.width / 2;
  await mini.mouse.move(x, start.y + start.height / 2);
  await mini.mouse.down();
  await mini.mouse.move(x, start.y + start.height / 2 - 6, { steps: 3 });
  await expect(row(from)).toHaveClass(/\bdrag-lift\b/);
  await mini.mouse.move(x, end.y + end.height / 2 - (end.y < start.y ? 8 : -8), { steps: 10 });
  // The row it passed has slid out of its way: the drop lands in that row's place.
  await expect(row(to)).toHaveClass(/\bdrag-peer\b/);
  await expect.poll(() => shift(to)).not.toMatch(/^(translateY\(0px\))?$/);
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
    // 520 (the widest card) + 200 (D-160: the hang-side edge's reach, max − min) + 2 × 32 (shadow).
  ).toEqual([784, 824]);
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

test("the composer's toast: Go to opens the list a ##list task went to in the main window, mini stays (D-147)", async () => {
  await mini.keyboard.press('Control+2');
  await expect(mini.locator('.mini-tabs .trash-tab.on')).toHaveText('Inbox');
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
  await mini.locator('.composer-input').click();
  await mini.keyboard.type('Send the mini notes ##Wor');
  await expect(mini.locator('.composer-suggestion').first()).toContainText('Work');
  await mini.keyboard.press('Enter');
  await expect(mini.locator('.composer-input')).toHaveValue('Send the mini notes ##Work');
  await mini.keyboard.press('Enter');
  const toast = mini.locator('.toast');
  await expect(toast).toContainText('Added to Work');
  await expect(toast.locator('button')).toHaveText(['Go to Work', 'Undo']);
  await toast.locator('button', { hasText: 'Go to Work' }).click();
  await expect(main.locator('h1')).toContainText('Work');
  await expect(main.locator('.row.sel')).toContainText('Send the mini notes');
  expect(await hook('miniVisible')).toBe(true);
  await mini.keyboard.press('Control+1');
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
  await expect(
    mini.locator('.fl-menu .fl-menu-item', { hasText: 'New quick note' }),
  ).toBeDisabled();
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
  await mini.locator('.fl-menu .fl-menu-item', { hasText: 'New quick note' }).click();
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
  await mini.locator('.fl-menu .fl-menu-item', { hasText: 'New quick note' }).click();
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

test('the Note tab: a title first, then Enter: the caret goes on into the text, one note (D-115)', async () => {
  await mini.keyboard.press('Control+3');
  await mini.locator('.mini-note-head .tool').click();
  await mini.locator('.fl-menu .fl-menu-item', { hasText: 'New quick note' }).click();
  const title = mini.locator('.quick-title-input');
  await expect(title).toHaveValue('');
  const before = (await readdir(flint)).length;
  await title.click();
  await mini.keyboard.type('Title then text');
  await mini.keyboard.press('Enter');
  const editor = mini.locator('.mini-editor .cm-content');
  await expect(editor).toBeFocused();
  // Typed at once, before the note exists: still one note, with its title and the text.
  await mini.keyboard.type('Right after');
  await expect
    .poll(() => readFile(join(flint, 'Title then text.md'), 'utf8').catch(() => ''))
    .toContain('Right after');
  await mini.waitForTimeout(600);
  expect((await readdir(flint)).length).toBe(before + 1);
  await mini.keyboard.press('Escape');
  await mini.keyboard.press('Control+1');
});

test("menus open where they fit: the Note tab's ⋯ menu stays on the screen (D-115)", async () => {
  await mini.keyboard.press('Control+3');
  const more = mini.locator('.mini-note-head .tool');
  await more.click();
  const menu = mini.locator('.fl-menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const visible = await mini.evaluate(async () => {
    const layout = await (
      window as unknown as {
        flintMini: { layout: () => Promise<{ visible?: { right: number; bottom: number } }> };
      }
    ).flintMini.layout();
    return layout.visible ?? null;
  });
  expect(visible).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(visible?.right ?? 0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(visible?.bottom ?? 0);
  // It opened toward the screen, ending at the button (the card hangs from the right corner).
  const button = await more.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (button?.x ?? 0) + (button?.width ?? 0),
  );
  await mini.keyboard.press('Escape');
  await mini.keyboard.press('Control+1');
});

test('the Note tab: Open a note… lists every note, newest first, five in view; the chosen one opens here (D-122)', async () => {
  for (const name of ['Plan', 'Ideas', 'Recipes', 'Books', 'Travel', 'Garden', 'Music'])
    await writeFile(
      join(flint, `${name}.md`),
      `---
flint: 1
id: n${name.toLowerCase()}
mode: note
---
${name} text here.
`,
    );
  await expect(main.locator('.nav', { hasText: 'Music' })).toBeVisible();
  await mini.keyboard.press('Control+3');
  await mini.locator('.mini-note-head .tool').click();
  await mini.locator('.fl-menu .fl-menu-item', { hasText: 'Open a note…' }).click();
  const picker = mini.locator('.fl-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.fl-picker-search')).toBeFocused();
  // Five in view, the rest scroll.
  const rows = picker.locator('.fl-picker-rows.five');
  const sizes = await rows.evaluate((element) => ({
    client: element.clientHeight,
    scroll: element.scrollHeight,
    row: element.querySelector('.fl-picker-row')?.getBoundingClientRect().height ?? 0,
  }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  expect(Math.round(sizes.client / sizes.row)).toBe(5);
  // Typing narrows it; Enter opens the note in the Note tab, as a note (not a quick note). The
  // pointer resting over the rows (as on CI) doesn't take the highlight when they shrink under it.
  const third = await picker.locator('.fl-picker-row').nth(2).boundingBox();
  if (third) await mini.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
  await mini.keyboard.type('plan');
  await expect(picker.locator('.fl-picker-label')).toHaveText(['Plan']);
  await mini.waitForTimeout(400);
  await expect(picker.locator('.fl-picker-row.active')).toHaveCount(1);
  await mini.keyboard.press('Enter');
  await expect(mini.locator('.mini-editor .cm-content')).toContainText('Plan text here.');
  await expect(mini.locator('.quick-title .subtitle')).toContainText('Note ·');
  await expect(mini.locator('.quick-title-input')).toHaveValue('Plan');
  await mini.locator('.mini-note-head .tool').click();
  await expect(
    mini.locator('.fl-menu .fl-menu-item', { hasText: 'Keep as a note' }).last(),
  ).toBeDisabled();
  await mini.keyboard.press('Escape');
  // The caret is in the note (where Ctrl+1 is a heading): the tab by a click.
  await mini.locator('.mini-tabs .trash-tab', { hasText: 'Today' }).click();
});

test("the Note tab: a quick note made here, opened again after another note: its own editor; Ctrl+Z never brings in the other note's text (D-115, D-143)", async () => {
  // A click: Today's composer may have the keys.
  await mini.locator('.mini-tabs .trash-tab', { hasText: 'Note' }).click();
  const editor = mini.locator('.mini-editor .cm-content');
  await expect(editor).toContainText('Plan text here.');
  await mini.locator('.mini-note-head .tool').click();
  await mini.locator('.fl-menu .fl-menu-item', { hasText: 'New quick note' }).click();
  await expect(mini.locator('.quick-title-input')).toHaveValue('');
  await editor.click();
  await mini.keyboard.type('Mini alpha text');
  const alphaFile = async (): Promise<string | null> => {
    for (const file of await readdir(flint)) {
      if (!file.endsWith('.md')) continue;
      const text = await readFile(join(flint, file), 'utf8').catch(() => '');
      if (text.includes('Mini alpha')) return file;
    }
    return null;
  };
  await expect.poll(alphaFile).not.toBeNull();
  const alpha = (await alphaFile()) ?? '';
  // Another note (Plan), its editor marked, then the quick note again: a new editor.
  await mini.locator('.mini-note-head .tool').click();
  await mini.locator('.fl-menu .fl-menu-item', { hasText: 'Open a note…' }).click();
  await mini.keyboard.type('plan');
  await expect(mini.locator('.fl-picker .fl-picker-label')).toHaveText(['Plan']);
  await mini.keyboard.press('Enter');
  await expect(editor).toContainText('Plan text here.');
  await mini.locator('.mini-editor .cm-editor').evaluate((element) => {
    (element as HTMLElement).dataset.e2eNote = 'plan';
  });
  await mini.locator('.mini-note-head .tool').click();
  await mini.locator('.fl-menu .fl-menu-item', { hasText: 'Mini alpha' }).click();
  await expect(editor).toContainText('Mini alpha text');
  await expect(mini.locator('.mini-editor .cm-editor[data-e2e-note]')).toHaveCount(0);
  await editor.click();
  for (let undo = 0; undo < 3; undo += 1) await mini.keyboard.press('Control+z');
  await mini.waitForTimeout(1200);
  await expect(editor).not.toContainText('Plan text here.');
  expect(await readFile(join(flint, alpha), 'utf8')).not.toContain('Plan text here.');
  await mini.locator('.mini-tabs .trash-tab', { hasText: 'Today' }).click();
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
  // The Note tab always takes the height limit; the width stays. D-112: no scrollbar while the
  // height eases there, and the title sits a little below the tabs.
  await mini.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { sizing: string[] }).sizing = seen;
    const body = document.querySelector('.mini-body') as HTMLElement;
    new MutationObserver(() => {
      if (document.querySelector('.mini-card.sizing')) seen.push(getComputedStyle(body).overflowY);
    }).observe(document.querySelector('.mini-card') as HTMLElement, { attributes: true });
  });
  // D-114: frame by frame through the switch, the body never shows a scrollbar and the note's ⋯
  // button never moves sideways.
  await mini.evaluate(() => {
    const frames: { bar: number; x: number | null }[] = [];
    (window as unknown as { frames: typeof frames }).frames = frames;
    const body = document.querySelector('.mini-body') as HTMLElement;
    const started = performance.now();
    const sample = (): void => {
      const more = document.querySelector('.mini-note-head .tool');
      frames.push({
        // A thumb shows: the body can scroll and its content is taller than it.
        bar:
          getComputedStyle(body).overflowY !== 'hidden' && body.scrollHeight > body.clientHeight
            ? 1
            : 0,
        x: more ? Math.round(more.getBoundingClientRect().right) : null,
      });
      if (performance.now() - started < 1200) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await mini.keyboard.press('Control+3');
  await expect.poll(async () => (await cardBox()).height).toBe(460);
  expect(await mini.evaluate(() => (window as unknown as { sizing: string[] }).sizing)).toContain(
    'hidden',
  );
  await expect(mini.locator('.mini-card.sizing')).toHaveCount(0);
  await mini.waitForTimeout(1300);
  const frames = await mini.evaluate(
    () => (window as unknown as { frames: { bar: number; x: number | null }[] }).frames,
  );
  expect(frames.length).toBeGreaterThan(10);
  expect(frames.filter((frame) => frame.bar > 0)).toEqual([]);
  expect(new Set(frames.flatMap((frame) => (frame.x === null ? [] : [frame.x]))).size).toBe(1);
  // D-114: the "Quick note" line 2 px lower than before D-112; the title and text a little lower.
  expect(
    await mini.locator('.mini-note').evaluate((note) => getComputedStyle(note).paddingTop),
  ).toBe('2px');
  expect(
    await mini
      .locator('.mini-note .quick-title')
      .evaluate((title) => getComputedStyle(title).rowGap),
  ).toBe('7px');
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

test('a long Inbox (a scrollbar) to Note and back: nothing moves sideways, no scrollbar flashes (D-114)', async () => {
  const before = await readFile(join(flint, 'Inbox.md'), 'utf8');
  const many = Array.from({ length: 30 }, (_, at) => `- [ ] Long inbox ${at + 1} [id:: lo${at}]`);
  await writeFile(join(flint, 'Inbox.md'), `${before.trimEnd()}\n${many.join('\n')}\n`);
  await mini.keyboard.press('Control+2');
  await expect(mini.locator('.mini-view .row', { hasText: 'Long inbox 30' })).toHaveCount(1);
  // D-156: measured once the new rows have settled (their motion over), not after a fixed wait.
  // Only finite ones: an endless one (a caret's blink) never ends.
  await expect
    .poll(() =>
      mini.evaluate(
        () =>
          document
            .getAnimations()
            .filter((each) => each.effect?.getTiming().iterations !== Infinity).length,
      ),
    )
    .toBe(0);
  // Its content width with the list scrolling: the same on every tab, every frame.
  const width = await mini.locator('.mini-view').evaluate((view) => view.clientWidth);
  await mini.evaluate(() => {
    const frames: { width: number; x: number | null; bar: boolean }[] = [];
    (window as unknown as { frames: typeof frames }).frames = frames;
    const state = window as unknown as { sampled: boolean; stop: boolean };
    state.sampled = false;
    state.stop = false;
    // Until the test says the switch back has drawn, then 30 frames more (no fixed duration: a
    // slow runner's switches take longer, and every frame of them is recorded).
    let after = 0;
    const sample = (): void => {
      const view = document.querySelector<HTMLElement>('.mini-view');
      const body = document.querySelector('.mini-body') as HTMLElement;
      const more = document.querySelector('.mini-note-head .tool');
      frames.push({
        width: view?.clientWidth ?? 0,
        x: more ? Math.round(more.getBoundingClientRect().right) : null,
        bar:
          view?.classList.contains('note') === true &&
          getComputedStyle(body).overflowY !== 'hidden' &&
          body.scrollHeight > body.clientHeight,
      });
      if (state.stop) after++;
      if (after < 30) requestAnimationFrame(sample);
      else state.sampled = true;
    };
    requestAnimationFrame(sample);
  });
  // To Note and back, each once the tab has changed; the frames are read once all are recorded.
  await mini.keyboard.press('Control+3');
  // The Note tab drawn in full and recorded: a frame with its head's ⋯ (what the frames measure)
  // is in the recording before going back (shown for less than a frame, it never was, on CI).
  await expect(mini.locator('.mini-view.note .mini-note-head .tool')).toBeVisible();
  await expect
    .poll(() =>
      mini.evaluate(() =>
        (window as unknown as { frames: { x: number | null }[] }).frames.some(
          (frame) => frame.x !== null,
        ),
      ),
    )
    .toBe(true);
  await mini.keyboard.press('Control+2');
  await expect(mini.locator('.mini-view .row', { hasText: 'Long inbox 30' })).toHaveCount(1);
  await mini.evaluate(() => {
    (window as unknown as { stop: boolean }).stop = true;
  });
  await expect
    .poll(() => mini.evaluate(() => (window as unknown as { sampled: boolean }).sampled))
    .toBe(true);
  const frames = await mini.evaluate(
    () =>
      (window as unknown as { frames: { width: number; x: number | null; bar: boolean }[] }).frames,
  );
  expect(frames.length).toBeGreaterThan(20);
  expect(new Set(frames.map((frame) => frame.width))).toEqual(new Set([width]));
  expect(frames.filter((frame) => frame.bar)).toEqual([]);
  expect(new Set(frames.flatMap((frame) => (frame.x === null ? [] : [frame.x]))).size).toBe(1);
  await writeFile(join(flint, 'Inbox.md'), before);
  await expect(mini.locator('.mini-view .row', { hasText: 'Long inbox 30' })).toHaveCount(0);
  await mini.keyboard.press('Control+1');
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

/** D-157: the hotkey into mini's note after its copy step (tests never send keys to another app). */
const captureIntoMini = (
  selection: { kind: 'text'; text: string } | { kind: 'empty' | 'elevated' },
): Promise<void> =>
  app.evaluate((_electron, which) => {
    type Hook = (s: typeof which) => void;
    (globalThis as { __flintE2E?: { captureIntoMini?: Hook } }).__flintE2E?.captureIntoMini?.(
      which,
    );
  }, selection);

/** The note files' text, joined (the capture lands in whichever note the Note tab shows). */
const notesText = async (): Promise<string> => {
  const names = (await readdir(flint)).filter((name) => name.endsWith('.md'));
  const texts = await Promise.all(names.map((name) => readFile(join(flint, name), 'utf8')));
  return texts.join('\n=====\n');
};

test("Ctrl+Alt+X: the selection goes to the end of the Note tab's note as a paragraph, code fenced; open, mini keeps the focus where it was; hidden, it opens and takes it (MINI-02, D-157)", async () => {
  await mini.keyboard.press('Control+1');
  await expect(mini.locator('.mini-tabs .trash-tab.on')).toHaveText('Today');
  const editor = mini.locator('.mini-editor .cm-content');
  // Mini is on screen: the text goes in, the Note tab shows, nothing takes the caret.
  await captureIntoMini({ kind: 'text', text: 'From the chat: ship on Friday' });
  await expect(mini.locator('.mini-tabs .trash-tab.on')).toHaveText('Note');
  await expect(editor).toContainText('From the chat: ship on Friday');
  await expect.poll(notesText).toContain('From the chat: ship on Friday');
  expect(
    await mini.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false),
  ).toBe(false);
  // Code is fenced, after a blank line.
  await captureIntoMini({ kind: 'text', text: 'const a = 1;\nfoo(a);\nbar(a);\n' });
  await expect
    .poll(notesText)
    .toMatch(
      /From the chat: ship on Friday\r?\n\r?\n```\r?\nconst a = 1;\r?\nfoo\(a\);\r?\nbar\(a\);\r?\n```/,
    );
  // Nothing selected: the Note tab, no message. An admin window: the popup's hint, as a toast.
  await captureIntoMini({ kind: 'empty' });
  await expect(mini.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
  await captureIntoMini({ kind: 'elevated' });
  await expect(mini.locator('.toast')).toContainText('admin window');
  // Hidden, mini opens for it and the caret goes after the text.
  await hook('hideMini');
  await expect.poll(() => hook('miniVisible')).toBe(false);
  await captureIntoMini({ kind: 'text', text: 'Second thought' });
  await expect.poll(() => hook('miniVisible')).toBe(true);
  await expect(editor).toContainText('Second thought');
  await expect
    .poll(() =>
      mini.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false),
    )
    .toBe(true);
  await expect.poll(notesText).toMatch(/```\r?\n\r?\nSecond thought/);
  await mini.keyboard.press('Control+1');
});

test('the list tab shows any task list: a click on the active tab (or its chevron) opens the picker, no New list; the choice is remembered and shown in the file (MINI-03, D-158)', async () => {
  await mini.keyboard.press('Control+2');
  const tab = mini.locator('.mini-tabs .mini-tab-list');
  await expect(tab).toHaveClass(/\bon\b/);
  await expect(tab).toHaveText('Inbox');
  // The active tab, clicked: the picker; the list shown is left out, Inbox is not a "New list".
  await tab.click();
  const picker = mini.locator('.fl-picker');
  await expect(picker.locator('.fl-picker-search')).toBeFocused();
  await expect(picker.locator('.fl-picker-row', { hasText: 'Work' })).toHaveCount(1);
  await expect(picker.locator('.fl-picker-row', { hasText: 'Inbox' })).toHaveCount(0);
  await mini.keyboard.type('Zzz');
  await expect(picker.locator('.fl-picker-row')).toHaveCount(0);
  await expect(picker.locator('.fl-picker-empty')).toHaveText('No other task lists');
  await mini.keyboard.press('Backspace');
  await mini.keyboard.press('Backspace');
  await mini.keyboard.press('Backspace');
  await resetMotion();
  await picker.locator('.fl-picker-row', { hasText: 'Work' }).click();
  await expect(tab).toHaveText('Work');
  await expect.poll(motion).toContain('animationend mini-tab-name mini-tab-name-in');
  await expect(row('Not for mini')).toHaveCount(1);
  await expect(row('Inbox thing one')).toHaveCount(0);
  await expect(mini.locator('.composer-input')).toHaveAttribute('placeholder', 'Add to Work…');
  const stateFile = join(dataDirectory, 'appdata', 'mini-state.json');
  await expect.poll(() => readFile(stateFile, 'utf8')).toContain('"listId": "work"');
  // The composer adds to the chosen list.
  await mini.locator('.composer-input').click();
  await mini.keyboard.type('Added from mini to Work');
  await mini.keyboard.press('Enter');
  await expect
    .poll(() => readFile(join(flint, 'Work.md'), 'utf8'))
    .toContain('- [ ] Added from mini to Work');
  await expect(row('Added from mini to Work')).toHaveCount(1);
  // From another tab, the chevron opens the picker; the pick shows the tab. Inbox comes back.
  await mini.keyboard.press('Control+1');
  await expect(mini.locator('.mini-tabs .trash-tab.on')).toHaveText('Today');
  await mini.locator('.mini-tab-pick').click();
  await expect(picker.locator('.fl-picker-row', { hasText: 'Inbox' })).toHaveCount(1);
  await expect(picker.locator('.fl-picker-row', { hasText: 'Work' })).toHaveCount(0);
  await picker.locator('.fl-picker-row', { hasText: 'Inbox' }).click();
  await expect(tab).toHaveClass(/\bon\b/);
  await expect(tab).toHaveText('Inbox');
  await expect(row('Inbox thing one')).toHaveCount(1);
  await expect.poll(() => readFile(stateFile, 'utf8')).toContain('"listId": null');
  await mini.keyboard.press('Control+1');
});

/** D-159: the rects mini's page last told main it takes clicks over (page pixels). */
const surfaceRects = async (): Promise<Box[]> => {
  const surface = (await hook('miniSurface')) as { rects?: Box[] } | undefined;
  return surface?.rects ?? [];
};
/** Whether one reported rect holds the whole element. */
const takesClicks = async (target: ReturnType<Page['locator']>): Promise<boolean> => {
  const box = await target.boundingBox();
  if (!box) return false;
  const rects = await surfaceRects();
  return rects.some(
    (rect) =>
      rect.x <= box.x + 0.5 &&
      rect.y <= box.y + 0.5 &&
      rect.x + rect.width >= box.x + box.width - 0.5 &&
      rect.y + rect.height >= box.y + box.height - 0.5,
  );
};

test('whatever opens outside the card takes clicks too: the list picker, the Note tab’s ⋯ menu, a row’s menu; the region shrinks back when it closes (D-159)', async () => {
  await mini.keyboard.press('Control+2');
  const tab = mini.locator('.mini-tabs .mini-tab-list');
  await expect(tab).toHaveClass(/\bon\b/);
  await expect.poll(async () => (await surfaceRects()).length).toBe(1);
  await tab.click();
  const picker = mini.locator('.fl-picker');
  await expect(picker.locator('.fl-picker-search')).toBeFocused();
  await expect.poll(() => takesClicks(picker)).toBe(true);
  // Typing changes the rows, so the picker's height: still covered.
  await mini.keyboard.type('Zzz');
  await expect(picker.locator('.fl-picker-empty')).toBeVisible();
  await expect.poll(() => takesClicks(picker)).toBe(true);
  await mini.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect.poll(async () => (await surfaceRects()).length).toBe(1);
  // The Note tab's ⋯ menu.
  await mini.keyboard.press('Control+3');
  await mini.locator('.mini-note-head .tool').click();
  const menu = mini.locator('.fl-menu');
  await expect(menu).toBeVisible();
  await expect.poll(() => takesClicks(menu)).toBe(true);
  await mini.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await surfaceRects()).length).toBe(1);
  // A row's right-click menu.
  await mini.keyboard.press('Control+1');
  await row('Inbox thing two').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect.poll(() => takesClicks(menu)).toBe(true);
  await mini.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await surfaceRects()).length).toBe(1);
});

test('the header never overflows: a long list name shortens first, the buttons stay at the minimum width; a taller limit over short content is no resize, on the Note tab it is (D-160)', async () => {
  await mini.keyboard.press('Control+1');
  await expect(mini.locator('.mini-tabs .trash-tab.on')).toHaveText('Today');
  await mini.waitForTimeout(800);
  const today = await cardBox();
  expect(today.width).toBe(364);
  expect(today.height).toBeLessThan(460);
  // A taller limit over short content: nothing visible changes, so no reset button.
  // (A height drag starts from the card's visible height: the limit becomes that plus the drag.)
  await resize('edge-bottom', 0, 160);
  expect((await cardBox()).height).toBe(today.height);
  await expect(mini.locator('.mini-reset.on')).toHaveCount(0);
  // The Note tab takes the limit: there the size differs, and Reset size brings it back.
  await mini.keyboard.press('Control+3');
  await expect.poll(async () => (await cardBox()).height).toBe(today.height + 160);
  await expect(mini.locator('.mini-reset.on')).toHaveCount(1);
  await mini.locator('.mini-reset.on').click();
  await expect.poll(async () => (await cardBox()).height).toBe(460);
  await expect(mini.locator('.mini-reset.on')).toHaveCount(0);
  // A list with a long name in the tab, at the narrowest width: the name shortens, the buttons stay.
  await writeFile(
    join(flint, 'Service metrics api gateway.md'),
    '---\nflint: 1\nid: svcmetrics\nmode: tasks\n---\n- [ ] Long name task [id:: lm1]\n',
  );
  await expect(main.locator('.nav', { hasText: 'Service metrics api gateway' })).toHaveCount(1);
  await mini.keyboard.press('Control+2');
  const tab = mini.locator('.mini-tabs .mini-tab-list');
  await tab.click();
  await mini.keyboard.type('Service');
  await mini.locator('.fl-picker .fl-picker-row', { hasText: 'Service metrics' }).click();
  await expect(tab).toHaveText('Service metrics api gateway');
  await expect(row('Long name task')).toHaveCount(1);
  await resize('edge-left', 80, 0);
  await expect.poll(async () => (await cardBox()).width).toBe(320);
  const card = await cardBox();
  const head = mini.locator('.mini-head');
  expect(await head.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  for (const label of [
    'Hide mini mode',
    'Always on top (on)',
    'Collapse to the edge',
    'Reset size',
  ]) {
    const button = mini.locator(`.mini-head [aria-label="${label}"]`);
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
  }
  expect(
    await tab.locator('.mini-tab-name').evaluate((name) => name.scrollWidth > name.clientWidth),
  ).toBe(true);
  await mini.locator('.mini-reset.on').click();
  await expect.poll(async () => (await cardBox()).width).toBe(364);
  // Inbox back for the tests after this one.
  await tab.click();
  await mini.locator('.fl-picker .fl-picker-row', { hasText: 'Inbox' }).click();
  await expect(tab).toHaveText('Inbox');
  await mini.keyboard.press('Control+1');
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

/** MINI-04, D-177: mini at the screen's edge, as main has it. */
type Edge = {
  mode: 'card' | 'tab';
  view: string;
  tab: { side: 'left' | 'right'; x: number; y: number } | null;
};
const edgeNow = (): Promise<Edge> => hook('miniEdge') as Promise<Edge>;
const view = async (): Promise<string> => {
  const now = await edgeNow();
  return now.mode === 'tab' ? now.view : 'card';
};
/** Where the cursor is for main (the test windows are off-screen); null: the real cursor. */
const pointer = (where: 'tab' | 'zone' | 'away' | null): Promise<void> =>
  app.evaluate((_electron, value) => {
    const found = (globalThis as { __flintE2E?: Record<string, unknown> }).__flintE2E;
    if (!found) return;
    if (value) found['miniPointer'] = value;
    else delete found['miniPointer'];
  }, where);
const edgeTab = (): ReturnType<Page['locator']> => mini.locator('.mini-edge-tab');
const miniCard = (): ReturnType<Page['locator']> => mini.locator('.mini-card');
/** A point on the tab's half on screen (the window ends at the edge, through the tab's middle). */
const onTab = async (): Promise<{ x: number; y: number }> => {
  const box = await edgeTab().boundingBox();
  if (!box) throw new Error('no tab');
  const width = await mini.evaluate(() => window.innerWidth);
  return {
    x: box.x + box.width / 2 >= width - 1 ? box.x + 12 : box.x + box.width - 12,
    y: box.y + 24,
  };
};

test('Collapse to the edge: the card slides into its nearer edge, the tab comes out at the corner spot; only the tab takes clicks, on top (MINI-04, D-177)', async () => {
  await expect.poll(() => hook('miniVisible')).toBe(true);
  expect(await view()).toBe('card');
  await resetMotion();
  await mini.locator('.mini-head .mini-collapse').click();
  await expect.poll(view).toBe('collapsed');
  await expect(miniCard()).toHaveClass(/\btucked\b/);
  await expect(edgeTab()).toBeVisible();
  await expect(edgeTab()).toHaveClass(/\bright\b/);
  await expect(edgeTab()).not.toHaveClass(/\btucked\b/);
  // Snapped into the top-right corner, the card collapses to that corner's spot (Q3), and the
  // window is the strip along that edge: it ends in the tab's middle.
  await expect(edgeTab()).toHaveCSS('top', '120px');
  // Once it has slid out of the edge (D-89: its slide-in plays first).
  const width = await mini.evaluate(() => window.innerWidth);
  await expect
    .poll(async () => {
      const box = await edgeTab().boundingBox();
      return box && Math.round(box.x + box.width / 2);
    })
    .toBe(width);
  // D-89: the card slid away.
  await expect.poll(motion).toContain('transitionend mini-card translate');
  // Only the tab's half on screen takes clicks: the card is out of the surface.
  await expect
    .poll(async () => {
      const surface = (await hook('miniSurface')) as { rects: Box[]; tab: Box | null };
      return surface.tab && surface.rects.length === 0 ? surface.tab.width : null;
    })
    .toBe(24);
  expect(await miniWindow('onTop')).toBe(true);
});

test('resting on the tab peeks without the keyboard; away from it, it slides back; a click opens it, Ctrl+M collapses it (D-177 Q1, Q7)', async () => {
  await pointer('tab');
  await expect.poll(view).toBe('peek');
  await expect(miniCard()).not.toHaveClass(/\btucked\b/);
  await expect(edgeTab()).toHaveClass(/\btucked\b/);
  // The card comes out level with the tab, 24 px from the edge.
  await expect
    .poll(async () => {
      const card = await miniCard().boundingBox();
      const width = await mini.evaluate(() => window.innerWidth);
      return card ? [Math.round(card.y), Math.round(width - card.x - card.width)] : null;
    })
    .toEqual([120, 24]);
  // In the card's place (or the strip to the edge) it stays; away, it slides back.
  await pointer('zone');
  expect(await view()).toBe('peek');
  await pointer('away');
  await expect.poll(view).toBe('collapsed');
  await expect(miniCard()).toHaveClass(/\btucked\b/);
  // A click on the tab opens it; it stays, whatever the cursor does.
  await pointer(null);
  const at = await onTab();
  await mini.mouse.click(at.x, at.y);
  await expect.poll(view).toBe('open');
  await expect(miniCard()).not.toHaveClass(/\btucked\b/);
  await pointer('away');
  // Ctrl+M collapses, also with the caret in the composer.
  await mini.locator('.mini-card .composer input').focus();
  await mini.keyboard.press('Control+m');
  await expect.poll(view).toBe('collapsed');
  await pointer(null);
});

test('the hotkey goes back where it came from: from the tab it opens and collapses; from hidden it opens and hides (D-177 Q4)', async () => {
  await hook('miniToggle');
  await expect.poll(view).toBe('open');
  await hook('miniToggle');
  await expect.poll(view).toBe('collapsed');
  expect(await hook('miniVisible')).toBe(true);
  await hook('hideMini');
  await expect.poll(() => hook('miniVisible')).toBe(false);
  await hook('miniToggle');
  await expect.poll(() => hook('miniVisible')).toBe(true);
  // From hidden: an ordinary card, at the tab's level (one position).
  expect(await view()).toBe('card');
  await expect(miniCard()).not.toHaveClass(/\btucked\b/);
  await expect(edgeTab()).toHaveCount(0);
  await hook('miniToggle');
  await expect.poll(() => hook('miniVisible')).toBe(false);
});

test('Flint starting shows the tab; dragged, the corner spots show; let go it stays, near a spot it snaps; past the middle it moves to the other edge (D-177 Q2, Q8)', async () => {
  await hook('miniStartCollapsed');
  await expect.poll(() => hook('miniVisible')).toBe(true);
  await expect.poll(view).toBe('collapsed');
  await expect(edgeTab()).toBeVisible();
  const dragBy = async (dx: number, dy: number, check?: () => Promise<void>): Promise<void> => {
    const start = await onTab();
    await mini.mouse.move(start.x, start.y);
    await mini.mouse.down();
    await mini.mouse.move(start.x + dx / 2, start.y + dy / 2, { steps: 4 });
    await mini.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
    if (check) await check();
    await mini.mouse.up();
  };
  const top = (): Promise<string> => edgeTab().evaluate((tab) => getComputedStyle(tab).top);
  await expect.poll(top).toBe('120px');
  await dragBy(0, 200, async () => {
    await expect(mini.locator('.mini-edge-spot')).toHaveCount(2);
  });
  await expect(mini.locator('.mini-edge-spot')).toHaveCount(0);
  await expect.poll(top).toBe('320px');
  // A drag never peeks or opens.
  expect(await view()).toBe('collapsed');
  // Let go 30 px from the top spot: it snaps there.
  await dragBy(0, -170, async () => {
    await expect(mini.locator('.mini-edge-spot.near')).toHaveCount(1);
  });
  await expect.poll(top).toBe('120px');
  // Past the screen's middle: the other edge.
  await dragBy(-6000, 100);
  await expect.poll(async () => (await edgeNow()).tab?.side).toBe('left');
  await expect(edgeTab()).toHaveClass(/\bleft\b/);
  await expect.poll(top).toBe('220px');
  // The card comes out of it on the left now.
  await pointer('tab');
  await expect.poll(view).toBe('peek');
  await expect(miniCard()).toHaveAttribute('data-corner', 'top-left');
  await pointer('away');
  await expect.poll(view).toBe('collapsed');
  await pointer(null);
});

test('a reminder while collapsed: the white dot and one pulse on the tab; a peek shows its card; dealt with, the dot goes (D-177 Q5)', async () => {
  const at = stamp(appNow());
  await writeFile(
    join(flint, 'Errands.md'),
    `---\nflint: 1\nid: errands\nmode: tasks\n---\n- [ ] Ring the garage [reminder:: ${at}] [id:: rg1]\n`,
  );
  await expect(mini.locator('.mini-edge-tab .mini-edge-dot')).toBeVisible({ timeout: 40_000 });
  await expect(mini.locator('.mini-edge-tab .mini-edge-pulse')).toHaveCount(1);
  // The card never comes out by itself (Show reminders in Flint: when it is open, the default).
  expect(await view()).toBe('collapsed');
  await pointer('tab');
  await expect.poll(view).toBe('peek');
  const card = mini.locator('.mini-reminder.alert');
  await expect(card).toContainText('Ring the garage');
  await card.locator('button', { hasText: 'Done' }).click();
  await expect(mini.locator('.mini-edge-dot')).toHaveCount(0);
  await expect.poll(() => readFile(join(flint, 'Errands.md'), 'utf8')).toContain('- [x] Ring');
  await pointer('away');
  await expect.poll(view).toBe('collapsed');
  await pointer(null);
});

test('Settings, Mini mode: Open on hover off, the tab shows the cursor but only a click opens; Start collapsed with Flint; both on by default (D-177)', async () => {
  const settings = await main.evaluate(() => window.flintMain.settings());
  expect(settings?.miniHoverOpens).toBe(true);
  expect(settings?.miniStartCollapsed).toBe(true);
  await main.evaluate(() => window.flintMain.setSetting({ key: 'miniHoverOpens', value: false }));
  await pointer('tab');
  await expect(edgeTab()).toHaveClass(/\bhover\b/);
  // Resting there: the tab nudged out, the card still in the edge. A click opens it.
  expect(await view()).toBe('collapsed');
  await pointer(null);
  const at = await onTab();
  await mini.mouse.click(at.x, at.y);
  await expect.poll(view).toBe('open');
  await mini.keyboard.press('Control+m');
  await expect.poll(view).toBe('collapsed');
  await main.evaluate(() => window.flintMain.setSetting({ key: 'miniHoverOpens', value: true }));
  await main.evaluate(() =>
    window.flintMain.setSetting({ key: 'miniStartCollapsed', value: false }),
  );
  expect((await main.evaluate(() => window.flintMain.settings()))?.miniStartCollapsed).toBe(false);
  await main.evaluate(() =>
    window.flintMain.setSetting({ key: 'miniStartCollapsed', value: true }),
  );
});
