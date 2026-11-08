import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

/**
 * D-141 (1.1.0): the note editor's live preview made reliable. Block markers and embedded objects
 * stay drawn with the caret beside them and show raw only with the caret strictly inside (← / →
 * step in; clicks and selections never reveal); a picture's Edit markdown; numbered markers in
 * their gray mono look. Its own Flint on the suite's fixed clock (D-107), off-screen, never focused.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
/** A 1×1 PNG. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const NOTE = [
  '---\nflint: 1\nid: preview\nmode: note\n---',
  '- First item',
  '- [ ] A task',
  '1. One',
  '2. Two',
  '## Heading',
  '![picture](attachments/image-01.png)',
  'After the picture.',
  '',
].join('\n');

let dataDirectory: string;
let flint: string;
let app: ElectronApplication;
let main: Page;
type Box = { x: number; y: number; width: number; height: number };

const editor = (): Locator => main.locator('.note-editor .cm-content');
const line = (text: string): Locator => editor().locator('.cm-line', { hasText: text }).first();
/** The caret at the end of the line holding `text`. */
const caretAtEnd = async (text: string): Promise<void> => {
  await line(text).click();
  await main.keyboard.press('End');
};
const left = async (times: number): Promise<void> => {
  for (let at = 0; at < times; at++) await main.keyboard.press('ArrowLeft');
};

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-preview-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(join(flint, 'attachments'), { recursive: true });
  await writeFile(join(flint, 'attachments', 'image-01.png'), PIXEL);
  await writeFile(join(flint, 'Preview.md'), NOTE);
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
    window.setBounds({ x: -6000, y: 0, width: 1400, height: 860 });
    window.showInactive();
  });
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Preview' }).first().click();
  await expect(editor()).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('block markers stay drawn beside the caret; ← steps into one, → back out (D-141 Q3)', async () => {
  // The caret at the item's text: the bullet is drawn, not `- `.
  await caretAtEnd('First item');
  await left('First item'.length);
  await expect(line('First item').locator('.cm-fl-bullet')).toHaveCount(1);
  await expect(line('First item')).not.toContainText('- First');
  // ← steps into the marker: raw, in the mono look of marks.
  await main.keyboard.press('ArrowLeft');
  await expect(line('First item').locator('.cm-fl-bullet')).toHaveCount(0);
  await expect(line('First item').locator('.cm-fl-mark')).toHaveText('-');
  // → back to the text: drawn again.
  await main.keyboard.press('ArrowRight');
  await expect(line('First item').locator('.cm-fl-bullet')).toHaveCount(1);

  // A task's checkbox and a heading's marks likewise.
  await caretAtEnd('A task');
  await left('A task'.length);
  await expect(line('A task').locator('.cm-fl-task-box')).toHaveCount(1);
  await main.keyboard.press('ArrowLeft');
  await expect(line('A task').locator('.cm-fl-task-box')).toHaveCount(0);
  await expect(line('A task')).toContainText('[ ]');
  await caretAtEnd('Heading');
  await left('Heading'.length);
  await expect(line('Heading')).toHaveText('Heading');
  await main.keyboard.press('ArrowLeft');
  await expect(line('Heading')).toHaveText('## Heading');
});

test("numbers are plain text in the note's font, the same with the caret on the line or not (D-141)", async () => {
  await line('First item').click();
  expect(await line('One').evaluate((element) => element.innerHTML)).toBe('1. One');
  await caretAtEnd('One');
  expect(await line('One').evaluate((element) => element.innerHTML)).toBe('1. One');
});

test('a picture stays drawn beside the caret; ← steps into its markdown (D-141 Q3, problem 3)', async () => {
  const picture = line('After the picture.').locator('xpath=preceding-sibling::div[1]');
  // From the next line, ← puts the caret right after the picture: still only the picture.
  await caretAtEnd('After the picture.');
  await main.keyboard.press('Home');
  await main.keyboard.press('ArrowLeft');
  await expect(picture.locator('.cm-fl-image img')).toHaveCount(1);
  await expect(picture).not.toContainText('![picture]');
  // One caret, where the cursor is: Flint's, the browser's hidden beside the picture (D-141).
  const carets = main.locator('.note-editor .cm-fl-caret');
  await expect(carets).toHaveCount(1);
  await expect(editor()).toHaveClass(/cm-fl-caret-hidden/);
  // Each measure is polled: the caret is drawn on the editor's next measure, so on a slow machine
  // its first box can still be the previous position (CI read the other side of the picture).
  // A missing box measures as Infinity and fails.
  const measure = async (read: (caret: Box, image: Box) => number): Promise<number> => {
    const caret = await carets.boundingBox();
    const image = await picture.locator('.cm-fl-image img').boundingBox();
    return caret && image ? read(caret, image) : Number.POSITIVE_INFINITY;
  };
  await expect
    .poll(() => measure((caret, image) => Math.abs(caret.x - (image.x + image.width))))
    .toBeLessThanOrEqual(8);
  // As tall as a text caret (a body character's box), on the picture's first text line, not the
  // picture's height (D-142).
  const textHeight = await line('After the picture.').evaluate((element) => {
    const text = element.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    return range.getBoundingClientRect().height;
  });
  await expect
    .poll(() => measure((caret) => Math.abs(caret.height - textHeight)))
    .toBeLessThanOrEqual(2);
  // The caret's top at or below the picture's top - 8 px, its bottom within the picture's top 40 px.
  await expect.poll(() => measure((caret, image) => image.y - 8 - caret.y)).toBeLessThanOrEqual(0);
  await expect
    .poll(() => measure((caret, image) => caret.y + caret.height - (image.y + 40)))
    .toBeLessThanOrEqual(0);
  // Right before it, likewise; away from it, the browser's own caret again. The caret is already
  // one before Home moves it, so wait for its position, not its count.
  await main.keyboard.press('Home');
  await expect(carets).toHaveCount(1);
  await expect
    .poll(() => measure((caret, image) => Math.abs(caret.x - image.x)))
    .toBeLessThanOrEqual(8);
  await main.keyboard.press('End');
  await main.keyboard.press('ArrowRight');
  await expect(carets).toHaveCount(0);
  await expect(editor()).not.toHaveClass(/cm-fl-caret-hidden/);
  await main.keyboard.press('ArrowLeft');
  // ← again: inside its markdown, which shows raw (the picture after it).
  await main.keyboard.press('ArrowLeft');
  await expect(picture).toContainText('![picture](attachments/image-01.png)');
  await main.keyboard.press('ArrowRight');
  await expect(picture).not.toContainText('![picture]');
});

test("a picture's Edit markdown reveals its raw link with the caret in the address (D-141 Q3)", async () => {
  await line('First item').click();
  await main.locator('.note-editor .cm-fl-image img').click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Edit markdown' }).click();
  const picture = line('After the picture.').locator('xpath=preceding-sibling::div[1]');
  await expect(picture).toContainText('![picture](attachments/image-01.png)');
  // The caret is where the address starts: typing goes there.
  await main.keyboard.type('x');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('![picture](xattachments/image-01.png)');
  await main.keyboard.press('Control+z');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('![picture](attachments/image-01.png)');
});

test("the checkbox is the task row's in its compact size, its tick centred; a click ticks it (D-141 Q8)", async () => {
  await line('First item').click();
  const box = line('A task').locator('.cm-fl-task-box .check');
  const size = await box.boundingBox();
  expect(Math.round(size?.width ?? 0)).toBe(17);
  expect(Math.round(size?.height ?? 0)).toBe(17);
  await box.click();
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('\n- [x] A task\n');
  await expect(box).toHaveClass(/\bon\b/);
  // Checked: the text dimmed and struck through, from the text on (D-142).
  const done = line('A task').locator('.cm-fl-done');
  await expect(done).toHaveText('A task');
  expect(await done.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe(
    'line-through',
  );
  // The tick fills the box as the task row's does: its 12 px tick (D-141, after Davit's test).
  expect(Math.round((await box.locator('svg').boundingBox())?.width ?? 0)).toBe(12);
  // The tick sits in the box's centre (by geometry, not margins).
  const outer = await box.boundingBox();
  const tick = await box.locator('svg').boundingBox();
  expect(outer && tick).toBeTruthy();
  if (outer && tick) {
    expect(Math.abs(outer.x + outer.width / 2 - (tick.x + tick.width / 2))).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(outer.y + outer.height / 2 - (tick.y + tick.height / 2))).toBeLessThanOrEqual(
      0.5,
    );
  }
  await box.click();
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('\n- [ ] A task\n');
});

test('Source mode shows the whole note raw (Ctrl+Shift+E, the menu, the palette); the file never changes (NOTE-09, D-141)', async () => {
  const before = await readFile(join(flint, 'Preview.md'), 'utf8');
  await line('First item').click();
  await main.keyboard.press('Control+Shift+E');
  await expect(editor().locator('.cm-fl-bullet')).toHaveCount(0);
  await expect(line('First item')).toHaveText('- First item');
  await expect(line('Heading')).toHaveText('## Heading');
  await expect(editor()).toContainText('![picture](attachments/image-01.png)');
  // Checked in the note's right-click menu, next to Monospace.
  await line('First item').click({ button: 'right' });
  await expect(
    main.locator('.fl-menu .fl-menu-item', { hasText: 'Source mode' }).first(),
  ).toBeVisible();
  await main.keyboard.press('Escape');
  // The palette switches it off again.
  await main.keyboard.press('Control+k');
  await main.keyboard.type('Source mode off');
  await main.keyboard.press('Enter');
  await expect(line('First item').locator('.cm-fl-bullet')).toHaveCount(1);
  expect(await readFile(join(flint, 'Preview.md'), 'utf8')).toBe(before);
});

test('Ctrl+E makes the word at the caret inline code; Ctrl+Z undoes it (D-106, D-141 Q5)', async () => {
  await caretAtEnd('After the picture.');
  await left(3);
  await main.keyboard.press('Control+e');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('After the `picture`.');
  await main.keyboard.press('Control+z');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('After the picture.');
});

test('a click puts the caret after a bullet, and a selection reveals nothing (D-141 Q3)', async () => {
  // A click on the bullet: the caret goes after it, so the bullet stays drawn.
  await line('First item').locator('.cm-fl-bullet').click();
  await expect(line('First item').locator('.cm-fl-bullet')).toHaveCount(1);
  await main.keyboard.type('Z');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('\n- ZFirst item\n');
  await main.keyboard.press('Control+z');
  // Everything selected: every marker stays drawn.
  await main.keyboard.press('Control+a');
  await expect(editor().locator('.cm-fl-bullet')).toHaveCount(1);
  await expect(editor().locator('.cm-fl-task-box')).toHaveCount(1);
  await expect(line('Heading')).toHaveText('Heading');
  await expect(editor()).not.toContainText('![picture]');
});

test('a pasted picture: the caret is beside it at once, not inside it while it loads (D-144)', async () => {
  // A 480×160 screenshot, pasted with a synthetic paste event (D-93: never the real clipboard),
  // at the end of the note: saved to attachments/ and drawn, the caret right after it.
  await caretAtEnd('After the picture.');
  await main.keyboard.press('Enter');
  await main.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = 'gray';
      context.fillRect(0, 0, 480, 160);
    }
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (!blob) throw new Error('no picture');
    const data = new DataTransfer();
    data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  const image = editor().locator('.cm-fl-image img').last();
  await expect(editor().locator('.cm-fl-image img')).toHaveCount(2);
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.width))
    .toBe(480);
  // No key, click or scroll after the paste: the caret is drawn at the loaded picture's right edge
  // (it was at the 64 px placeholder's edge, inside the picture, until the next action).
  const carets = main.locator('.note-editor .cm-fl-caret');
  await expect(carets).toHaveCount(1);
  const gap = async (): Promise<number> => {
    const caret = await carets.boundingBox();
    const box = await image.boundingBox();
    return caret && box ? Math.abs(caret.x - (box.x + box.width)) : Number.POSITIVE_INFINITY;
  };
  await expect.poll(gap, { timeout: 2_000 }).toBeLessThanOrEqual(8);
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toMatch(/After the picture\.\n\n?!\[\]\(attachments\/[\w-]+\.png\)\n?$/);
  // Its size changing later for any reason (a "File not found" card in its place, a video's
  // player): the caret follows at once, with no key or click (D-144).
  await image.evaluate((element: HTMLImageElement) => {
    element.style.width = '240px';
    element.style.height = '80px';
  });
  await expect.poll(() => image.evaluate((element) => element.clientWidth)).toBe(240);
  await expect.poll(gap, { timeout: 2_000 }).toBeLessThanOrEqual(8);
});
