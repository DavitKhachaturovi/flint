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
 * NOTE-10 (D-141 Q9–Q12, 1.2.0): tables in the note editor: drawn as tables, cells edited in place
 * with Tab, Enter, Shift+Enter, the arrows and Esc, only the edited cell's bytes written, the
 * note's own undo. Its own Flint on the suite's fixed clock (D-107), off-screen, never focused.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const TABLE = '| Name    | Age |\n| ------- | --: |\n| Alex    | 30  |';
const NOTE = `---\nflint: 1\nid: tables\nmode: note\n---\nBefore the table.\n\n${TABLE}\n\nAfter the table.\n`;
/** A 1×1 PNG. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** D-144: Davit's note: Insert ▸ Table's table with a word in a cell, a picture, a paragraph. */
const INSERTED = '| Column | Column | Column |\n| --- | --- | --- |\n| test |  |  |';
const PICTURE = '![](attachments/pic.png)';
const PICTURES = `---\nflint: 1\nid: pictures\nmode: note\n---\nIntro.\n\n${INSERTED}\n\n${PICTURE}\n\nabove\n`;

let dataDirectory: string;
let flint: string;
let app: ElectronApplication;
let main: Page;

const editor = (): Locator => main.locator('.note-editor .cm-content').first();
const table = (): Locator => main.locator('.note-editor .cm-fl-table');
const cell = (row: number, column: number): Locator =>
  table().locator(`[data-row="${row}"][data-column="${column}"]`);
const file = (): Promise<string> => readFile(join(flint, 'Tables.md'), 'utf8');
const line = (text: string): Locator => editor().locator('.cm-line', { hasText: text }).first();

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-tables-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await writeFile(join(flint, 'Tables.md'), NOTE);
  await writeFile(join(flint, 'Pictures.md'), PICTURES);
  await mkdir(join(flint, 'attachments'), { recursive: true });
  await writeFile(join(flint, 'attachments', 'pic.png'), PIXEL);
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
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Tables' }).first().click();
  await expect(editor()).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('a table is drawn as a table, its pipes and delimiter row hidden (NOTE-10, Q9)', async () => {
  await expect(table()).toHaveCount(1);
  await expect(cell(0, 0)).toHaveText('Name');
  await expect(cell(0, 1)).toHaveText('Age');
  await expect(cell(1, 0)).toHaveText('Alex');
  await expect(cell(1, 1)).toHaveCSS('text-align', 'right');
  await expect(editor()).not.toContainText('| ---');
});

test('a click edits a cell in place; only its bytes are written; Ctrl+Z undoes (Q9, Q10)', async () => {
  await cell(1, 0).click();
  await expect(cell(1, 0)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.press('End');
  await main.keyboard.type('a');
  await expect.poll(file).toContain('| Alexa    | 30  |');
  expect(await file()).toBe(NOTE.replace('| Alex    |', '| Alexa    |'));
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
  // Shift+Enter: no line break in a cell, nothing written.
  await main.keyboard.press('Shift+Enter');
  expect(await file()).toBe(NOTE);
});

test('Tab goes to the next cell and, in the last one, adds a row in the table’s style (Q9)', async () => {
  await cell(1, 0).click();
  await main.keyboard.press('Tab');
  await expect(cell(1, 1)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.press('Tab');
  await expect.poll(file).toContain(`${TABLE}\n|         |     |\n`);
  await expect(cell(2, 0)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.type('Sam');
  await expect.poll(file).toContain(`${TABLE}\n| Sam |     |\n`);
  await main.keyboard.press('Shift+Tab');
  await expect(cell(1, 1)).toHaveClass(/cm-fl-cell-active/);
  // Enter: the cell below; on the last row, a new row.
  await main.keyboard.press('Enter');
  await expect(cell(2, 1)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.press('Control+z');
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
});

test('↓ from the line above goes into the header, ↑ leaves it, Esc leaves the table (Q9)', async () => {
  await line('Before the table.').click();
  await main.keyboard.press('End');
  await main.keyboard.press('ArrowDown');
  await main.keyboard.press('ArrowDown');
  await expect(cell(0, 0)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.press('ArrowUp');
  await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
  await cell(1, 1).click();
  await main.keyboard.press('Escape');
  await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
  await main.keyboard.type('x');
  // D-144: a blank line keeps it out of the table (GFM would make it a row).
  await expect.poll(file).toContain(`${TABLE}\n\nx\nAfter the table.`);
  await expect(table().locator('tr')).toHaveCount(2);
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
});

test("the table's right-click menu: rows, a delete with Undo, Align table, Edit markdown (Q10, Q11)", async () => {
  const menuItem = (label: string): Locator =>
    main.locator('.fl-menu .fl-menu-item', { hasText: label }).first();
  await cell(1, 0).click({ button: 'right' });
  await menuItem('Add row below').click();
  await expect.poll(file).toContain(`${TABLE}\n|         |     |\n`);
  await cell(2, 0).click({ button: 'right' });
  await menuItem('Delete row').click();
  await expect.poll(file).toBe(NOTE);
  // Deleted at once; the toast's Undo brings it back (the note's own undo).
  await cell(1, 0).click({ button: 'right' });
  await menuItem('Delete row').click();
  await expect.poll(file).not.toContain('| Alex');
  await main.locator('.toast button', { hasText: 'Undo' }).click();
  await expect.poll(file).toBe(NOTE);
  // Align table: the whole table re-padded, on request.
  await cell(1, 0).click({ button: 'right' });
  await menuItem('Align table').click();
  await expect.poll(file).toContain('| Name | Age |\n| ---- | --: |\n| Alex |  30 |');
  await main.locator('.toast button', { hasText: 'Undo' }).click();
  await expect.poll(file).toBe(NOTE);
  // Edit markdown: the table raw while the caret is in it.
  await cell(0, 0).click({ button: 'right' });
  await menuItem('Edit markdown').click();
  await expect(table()).toHaveCount(0);
  await expect(editor()).toContainText('| ------- | --: |');
  await line('After the table.').click();
  await expect(table()).toHaveCount(1);
});

test("the palette has the table's commands while the caret is in a table (D-106, Q11)", async () => {
  await cell(1, 1).click();
  await main.keyboard.press('Control+k');
  await main.keyboard.type('Add column right');
  await expect(main.locator('.palette-item.on')).toContainText('Add column right');
  await main.keyboard.press('Enter');
  await expect
    .poll(file)
    .toContain('| Name    | Age |  |\n| ------- | --: | --- |\n| Alex    | 30  |  |');
  await cell(1, 0).click();
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
});

test('dragging the edges adds and removes columns and rows; text asks first, inline (Q11)', async () => {
  const drag = async (edge: 'right' | 'bottom', steps: number, finish = true): Promise<void> => {
    const handle = main.locator(`.note-editor .cm-fl-table-edge-${edge}`);
    const box = await handle.boundingBox();
    const tableBox = await table().boundingBox();
    if (!box || !tableBox) throw new Error('no edge');
    const columns = await table().locator('th').count();
    const rows = await table().locator('tr').count();
    const step = edge === 'right' ? tableBox.width / columns : tableBox.height / rows;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await main.mouse.move(x, y);
    await main.mouse.down();
    const dx = edge === 'right' ? step * steps : 0;
    const dy = edge === 'bottom' ? step * steps : 0;
    await main.mouse.move(x + dx / 2, y + dy / 2);
    await main.mouse.move(x + dx, y + dy);
    if (finish) await main.mouse.up();
  };
  // One step right: a column; one step back: it goes at once (empty).
  await drag('right', 1);
  await expect.poll(file).toContain('| Name    | Age |  |');
  await drag('right', -1);
  await expect.poll(file).toBe(NOTE);
  // Over a column with text: the warning first; Cancel keeps it, Delete takes it, Ctrl+Z undoes.
  await drag('right', -1);
  const warning = main.locator('.note-editor .cm-fl-table-warning');
  await expect(warning).toContainText('This deletes content in 2 cells');
  await warning.locator('button', { hasText: 'Cancel' }).click();
  await expect(warning).toHaveCount(0);
  expect(await file()).toBe(NOTE);
  await drag('right', -1);
  await warning.locator('button', { hasText: 'Delete' }).click();
  await expect.poll(file).toContain('| Name    |\n| ------- |\n| Alex    |');
  await cell(0, 0).click();
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
  // The bottom edge: a row added, then taken away again without asking (it is empty).
  await drag('bottom', 1);
  await expect.poll(file).toContain(`${TABLE}\n|         |     |\n`);
  await drag('bottom', -1);
  await expect.poll(file).toBe(NOTE);
  // Esc during a drag: nothing happens.
  await drag('bottom', 2, false);
  await main.keyboard.press('Escape');
  await main.mouse.up();
  expect(await file()).toBe(NOTE);
});

test('text typed below a table stays out of it, and so does the picture after it (D-144)', async () => {
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Pictures' }).first().click();
  await expect(editor()).toContainText('above');
  const pictures = (): Promise<string> => readFile(join(flint, 'Pictures.md'), 'utf8');
  const picture = main.locator('.note-editor .cm-fl-image img');
  const under = main.locator('.note-editor .cm-fl-table-wrap + .cm-line');
  const settled = async (): Promise<void> => {
    await expect(table()).toHaveCount(1);
    await expect(table().locator('tr')).toHaveCount(2);
    await expect(cell(1, 0)).toHaveText('test');
    await expect(picture).toHaveCount(1);
    await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
    await expect(editor()).toBeFocused();
  };
  const undoTo = async (text: string): Promise<void> => {
    // One Ctrl+Z at a time, each once the file has it (no undo past the text wanted).
    for (let tries = 0; tries < 6; tries++) {
      const now = await pictures();
      if (now === text) break;
      await main.keyboard.press('Control+z');
      await expect.poll(pictures).not.toBe(now);
    }
    await expect.poll(pictures).toBe(text);
  };
  await expect(picture).toHaveCount(1);
  // Davit's report: a word typed on the line right under the table. It stays a paragraph (a blank
  // line goes between), the picture stays drawn, the table keeps its rows, the keys stay here.
  await under.click();
  await main.keyboard.type('more');
  await expect.poll(pictures).toBe(PICTURES.replace(`${INSERTED}\n\n`, `${INSERTED}\n\nmore\n`));
  await settled();
  await undoTo(PICTURES);
  // The line above "above".
  const above = editor().locator('.cm-line', { hasText: /^above$/ });
  await above.locator('xpath=preceding-sibling::*[1]').click();
  await main.keyboard.type('x');
  await expect.poll(pictures).toBe(PICTURES.replace('\n\nabove', '\nx\nabove'));
  await settled();
  await undoTo(PICTURES);
  // No blank line between the picture and "above": Backspace at the start of "above".
  await above.click();
  await main.keyboard.press('Home');
  await main.keyboard.press('Backspace');
  const joined = PICTURES.replace('\n\nabove', '\nabove');
  await expect.poll(pictures).toBe(joined);
  await under.click();
  await main.keyboard.type('more');
  await expect.poll(pictures).toBe(joined.replace(`${INSERTED}\n\n`, `${INSERTED}\n\nmore\n`));
  await settled();
  await undoTo(joined);
  // Backspace on the picture's line would take the blank line under the table away: the
  // picture would become a row. The caret moves up instead; nothing changes.
  await under.click();
  await main.keyboard.press('ArrowDown');
  await main.keyboard.press('Home');
  await main.keyboard.press('Backspace');
  await main.keyboard.type('y');
  await expect.poll(pictures).toBe(joined.replace(`${INSERTED}\n\n`, `${INSERTED}\n\ny\n`));
  await settled();
  await undoTo(joined);
  // A row written in markdown (`|` first) is a row, as GFM says: the table shows raw while the
  // caret is in it, no cell takes the keys mid-word, and the picture stays out of it.
  await under.click();
  await main.keyboard.type('| new |');
  await expect(table()).toHaveCount(0);
  await expect(editor()).toContainText('| new |');
  await expect(editor()).toBeFocused();
  await expect.poll(pictures).toBe(joined.replace(`${INSERTED}\n\n`, `${INSERTED}\n| new |\n\n`));
  await above.click();
  await expect(table().locator('tr')).toHaveCount(3);
  await expect(cell(2, 0)).toHaveText('new');
  await expect(picture).toHaveCount(1);
  await undoTo(joined);
  await undoTo(PICTURES);
});
