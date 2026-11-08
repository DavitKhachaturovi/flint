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
  await expect(line('A task').locator('.cm-fl-checkbox')).toHaveCount(1);
  await main.keyboard.press('ArrowLeft');
  await expect(line('A task').locator('.cm-fl-checkbox')).toHaveCount(0);
  await expect(line('A task')).toContainText('[ ]');
  await caretAtEnd('Heading');
  await left('Heading'.length);
  await expect(line('Heading')).toHaveText('Heading');
  await main.keyboard.press('ArrowLeft');
  await expect(line('Heading')).toHaveText('## Heading');
});

test('numbered markers keep their gray mono look, with and without the caret (D-141 Q3)', async () => {
  await expect(editor().locator('.cm-fl-number')).toHaveCount(2);
  await caretAtEnd('One');
  await expect(line('One').locator('.cm-fl-number')).toHaveText('1.');
});

test('a picture stays drawn beside the caret; ← steps into its markdown (D-141 Q3, problem 3)', async () => {
  const picture = line('After the picture.').locator('xpath=preceding-sibling::div[1]');
  // From the next line, ← puts the caret right after the picture: still only the picture.
  await caretAtEnd('After the picture.');
  await main.keyboard.press('Home');
  await main.keyboard.press('ArrowLeft');
  await expect(picture.locator('.cm-fl-image img')).toHaveCount(1);
  await expect(picture).not.toContainText('![picture]');
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

test('Tab nests a numbered item at its parent’s text column, Shift+Tab takes it back; the first item nudges (D-141 Q6, Q7)', async () => {
  await caretAtEnd('Two');
  await main.keyboard.press('Tab');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('\n1. One\n   1. Two\n');
  await main.keyboard.press('Shift+Tab');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('\n1. One\n2. Two\n');
  // The list's first item has nothing above to nest under: the text stays as it is.
  await caretAtEnd('One');
  await main.keyboard.press('Tab');
  await main.keyboard.press('Shift+Tab');
  expect(await readFile(join(flint, 'Preview.md'), 'utf8')).toContain('\n1. One\n2. Two\n');
  // Moving a line renumbers the list in the same step (Alt+↑ as a page event, D-93).
  await caretAtEnd('Two');
  await main.evaluate(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        code: 'ArrowUp',
        altKey: true,
        bubbles: true,
      }),
    ),
  );
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('\n1. Two\n2. One\n');
  await main.keyboard.press('Control+z');
  await expect
    .poll(() => readFile(join(flint, 'Preview.md'), 'utf8'))
    .toContain('\n1. One\n2. Two\n');
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
  await expect(editor().locator('.cm-fl-checkbox')).toHaveCount(1);
  await expect(line('Heading')).toHaveText('Heading');
  await expect(editor()).not.toContainText('![picture]');
});
