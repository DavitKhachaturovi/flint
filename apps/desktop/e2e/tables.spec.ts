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
  await expect.poll(file).toContain(`${TABLE}\nx\nAfter the table.`);
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
