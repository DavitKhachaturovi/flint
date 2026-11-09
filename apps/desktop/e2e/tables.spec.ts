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
/** D-144: a table in a quote, the quote's blank line (`>`) and a picture under it. */
const QUOTED = `---\nflint: 1\nid: quoted\nmode: note\n---\nIntro.\n\n> | a | b |\n> | - | - |\n> | c | d |\n>\n> ${PICTURE}\n\nabove\n`;
/** D-144: a table whose cells fill the note's width (their words wrap), so it is exactly as wide. */
const WIDE_ROW = (word: string): string =>
  `| ${Array.from({ length: 14 }, (_, n) => `${word}${n} lorem ipsum`).join(' | ')} |`;
/** D-144: a 3 × 3 table for selecting cells. */
const GRID = '| A  | B  | C  |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |';
const GRID_NOTE = `---\nflint: 1\nid: grid\nmode: note\n---\nGrid.\n\n${GRID}\n\nEnd.\n`;
const WIDE = `---\nflint: 1\nid: wide\nmode: note\n---\nWide.\n\n${WIDE_ROW('h')}\n|${' --- |'.repeat(14)}\n${WIDE_ROW('c')}\n\nEnd.\n`;
/** D-144: a table without edge pipes. */
const PLAIN_TABLE = 'Name | Age\n--- | ---\nAlex | 30';
const PLAIN = `---\nflint: 1\nid: plain\nmode: note\n---\nPlain.\n\n${PLAIN_TABLE}\n\nEnd.\n`;
/** D-144: a note that ends with a table (and its line break). */
const ENDING = `---\nflint: 1\nid: ending\nmode: note\n---\nIntro.\n\n${INSERTED}\n`;
/** D-144: two tables, a paragraph between them (each table's height must count exactly). */
/** D-144: a note that ends with a table, no line break after it, the caret far above it. */
const TAIL = `---\nflint: 1\nid: tail\nmode: note\n---\nFirst line here.\n\nSecond line.\n\n| a | b |\n| - | - |\n| c | d |`;
/** D-144: a table right above a heading (no blank line between). */
const HEADING = `---\nflint: 1\nid: heading\nmode: note\n---\nIntro.\n\n| a | b |\n| - | - |\n| c | d |\n# Heading\n`;
/** D-144: a read-only note (a newer format) that ends with a table, no line break after it. */
const NEWER = `---\nflint: 2\nid: newer\nmode: note\n---\nIntro.\n\n| a | b |\n| - | - |\n| c | d |`;
/** D-144: a table outside any container, a line of four spaces under it. */
const SPACES = `---\nflint: 1\nid: spaces\nmode: note\n---\nIntro.\n\n| a | b |\n| - | - |\n| c | d |\n    \nbelow\n`;
/** D-144: a table with a short row (only its first cell). */
const SHORT = `---\nflint: 1\nid: short\nmode: note\n---\nShort.\n\n| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 |\n\nEnd.\n`;
const TWICE = `---\nflint: 1\nid: twice\nmode: note\n---\nIntro.\n\n${INSERTED}\n\nmiddle\n\n${INSERTED}\n\nabove\n`;

let dataDirectory: string;
let flint: string;
let app: ElectronApplication;
let main: Page;

const editor = (): Locator => main.locator('.note-editor .cm-content').first();
const table = (): Locator => main.locator('.note-editor .cm-fl-table');
const cell = (row: number, column: number): Locator =>
  table().locator(`[data-row="${row}"][data-column="${column}"]`);
/** A click into a cell; its editor takes the keys in the same step (D-152), so keys can follow. */
const editCell = async (row: number, column: number): Promise<void> => {
  await cell(row, column).click();
};
/**
 * The table's box, once one table is drawn: a note that was open before may still be leaving with
 * its own table for a moment (a check on a cell's text can pass on that one).
 */
const tableBox = async (): Promise<{ x: number; y: number; width: number; height: number }> => {
  await expect(table()).toHaveCount(1);
  await expect.poll(async () => (await table().boundingBox()) !== null).toBe(true);
  const box = await table().boundingBox();
  if (!box) throw new Error('no table');
  return box;
};
const file = (): Promise<string> => readFile(join(flint, 'Tables.md'), 'utf8');
const line = (text: string): Locator => editor().locator('.cm-line', { hasText: text }).first();

/** Q11: drags a table's right or bottom edge by `steps` cells (`finish`: lets go at the end). */
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

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-tables-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await writeFile(join(flint, 'Tables.md'), NOTE);
  await writeFile(join(flint, 'Pictures.md'), PICTURES);
  await writeFile(join(flint, 'Quoted.md'), QUOTED);
  await writeFile(join(flint, 'Wide.md'), WIDE);
  await writeFile(join(flint, 'Grid.md'), GRID_NOTE);
  await writeFile(join(flint, 'Twice.md'), TWICE);
  await writeFile(join(flint, 'Plain.md'), PLAIN);
  await writeFile(join(flint, 'Ending.md'), ENDING);
  await writeFile(join(flint, 'Tail.md'), TAIL);
  await writeFile(join(flint, 'Short.md'), SHORT);
  await writeFile(join(flint, 'Heading.md'), HEADING);
  await writeFile(join(flint, 'Newer.md'), NEWER);
  await writeFile(join(flint, 'Spaces.md'), SPACES);
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
  // The caret goes where the click was (D-152: also with keys typed right after): before the A.
  const first = await cell(0, 1).evaluate((element) => {
    const range = document.createRange();
    const text = element.firstChild ?? element;
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const box = range.getBoundingClientRect();
    return { x: box.left + 1, y: box.top + box.height / 2 };
  });
  await main.mouse.click(first.x, first.y);
  await expect(cell(0, 1)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.type('Q');
  await expect.poll(file).toBe(NOTE.replace('| Age |', '| QAge |'));
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
  await cell(1, 0).click();
  // Shift+Enter: no line break in a cell, nothing written.
  await main.keyboard.press('Shift+Enter');
  expect(await file()).toBe(NOTE);
});

test('Tab goes to the next cell and, in the last one, adds a row in the table’s style (Q9)', async () => {
  await editCell(1, 0);
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
  // D-152: keys typed right after it go into the header cell.
  await main.keyboard.type('H');
  await expect(cell(0, 0)).toHaveClass(/cm-fl-cell-active/);
  await expect.poll(file).toBe(NOTE.replace('| Name    |', '| NameH    |'));
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
  await main.keyboard.press('ArrowUp');
  await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
  await editCell(1, 1);
  await main.keyboard.press('Escape');
  await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
  await main.keyboard.type('x');
  // D-144: a blank line keeps it out of the table (GFM would make it a row).
  await expect.poll(file).toContain(`${TABLE}\n\nx\nAfter the table.`);
  await expect(table().locator('tr')).toHaveCount(2);
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
});

test('a / typed in a cell is just a slash: no slash menu in a table (D-149)', async () => {
  await editCell(1, 0);
  await main.keyboard.press('End');
  await main.keyboard.type(' /');
  await expect.poll(file).toContain('Alex /');
  await expect(cell(1, 0)).toContainText('Alex /');
  // The menu would open a moment after the slash.
  await main.waitForTimeout(300);
  await expect(main.locator('.fl-slash-menu')).toHaveCount(0);
  // Arrows still move between cells.
  await main.keyboard.press('ArrowDown');
  await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
  for (let undo = 0; undo < 3 && (await file()) !== NOTE; undo += 1) {
    await main.keyboard.press('Control+z');
    await main.waitForTimeout(300);
  }
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
  await editCell(1, 1);
  await main.keyboard.press('Control+k');
  await main.keyboard.type('Add column right');
  await expect(main.locator('.palette-item.on')).toContainText('Add column right');
  await main.keyboard.press('Enter');
  await expect
    .poll(file)
    .toContain('| Name    | Age |  |\n| ------- | --: | --- |\n| Alex    | 30  |  |');
  await editCell(1, 0);
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
});

test('dragging the edges adds and removes columns and rows; text asks first, in a toast (Q11, D-144)', async () => {
  // One step right: a column; one step back: it goes at once (empty).
  await drag('right', 1);
  await expect.poll(file).toContain('| Name    | Age |  |');
  await drag('right', -1);
  await expect.poll(file).toBe(NOTE);
  // Over a column with text: the warning first, as the window's toast (D-144), never in the note;
  // the column stays dimmed while it is up. Cancel keeps it, and so do Esc and the time running
  // out; Delete takes it, Ctrl+Z undoes.
  const warning = main.locator('.toast', { hasText: 'This deletes content in 2 cells' });
  const going = table().locator('.cm-fl-cell-going');
  const asked = async (): Promise<void> => {
    await drag('right', -1);
    await expect(warning).toHaveCount(1);
    await expect(warning).toHaveAttribute('role', 'alert');
    await expect(going).toHaveCount(2);
    await expect(main.locator('.note-editor .toast')).toHaveCount(0);
    await expect(editor()).not.toContainText('This deletes');
  };
  const keptAll = async (): Promise<void> => {
    await expect(warning).toHaveCount(0);
    await expect(going).toHaveCount(0);
    expect(await file()).toBe(NOTE);
  };
  await asked();
  await warning.getByRole('button', { name: 'Cancel' }).click();
  await keptAll();
  await asked();
  await main.keyboard.press('Escape');
  await keptAll();
  await expect(table()).toHaveCount(1);
  await asked();
  await expect(warning).toHaveCount(0, { timeout: 12_000 });
  await keptAll();
  await asked();
  await warning.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(file).toContain('| Name    |\n| ------- |\n| Alex    |');
  await expect(warning).toHaveCount(0);
  await expect(going).toHaveCount(0);
  await editCell(0, 0);
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

/** D-144: the edge drag's question for the Tables note's Age column, and its dimmed cells. */
const question = (): Locator =>
  main.locator('.toast', { hasText: 'This deletes content in 2 cells' });
const going = (): Locator => table().locator('.cm-fl-cell-going');
const raiseQuestion = async (): Promise<void> => {
  await line('After the table.').click();
  // The table's box at rest (no reshape still gliding) before the drag measures it.
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await table().boundingBox());
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  await drag('right', -1);
  await expect(question()).toHaveCount(1);
  await expect(going()).toHaveCount(2);
};

test("the drag's question leaves Esc to a layer on top of it first (D-144)", async () => {
  const warning = question();
  const palette = main.locator('.palette-layer');
  // The palette opened over it: the first Esc closes the palette and the question stays; the
  // next one, in the note, cancels it.
  await raiseQuestion();
  await main.keyboard.press('Control+k');
  await expect(palette).toHaveCount(1);
  await main.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(warning).toHaveCount(1);
  await expect(going()).toHaveCount(2);
  await line('After the table.').click();
  await main.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  await expect(going()).toHaveCount(0);
  expect(await file()).toBe(NOTE);
  // The note's find bar (Ctrl+F) over it: its Esc closes the bar first.
  const find = main.locator('.note-editor .fl-find');
  await raiseQuestion();
  await main.keyboard.press('Control+f');
  await expect(main.locator('.note-editor .fl-find-input')).toBeFocused();
  await main.keyboard.press('Escape');
  await expect(find).toHaveCount(0);
  await expect(warning).toHaveCount(1);
  await expect(going()).toHaveCount(2);
  await main.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  expect(await file()).toBe(NOTE);
  // The slash menu open in the note: its Esc closes the menu first.
  const slash = main.locator('.fl-slash-menu');
  await raiseQuestion();
  await main.keyboard.press('End');
  await main.keyboard.press('Enter');
  await main.keyboard.type('/');
  await expect(slash).toHaveCount(1);
  await main.keyboard.press('Escape');
  await expect(slash).toHaveCount(0);
  await expect(warning).toHaveCount(1);
  await expect(going()).toHaveCount(2);
  await main.keyboard.press('Escape');
  await expect(warning).toHaveCount(0);
  // Saved first (the slash typed), then undone step by step.
  await expect.poll(file).toBe(NOTE.replace('After the table.\n', 'After the table.\n/\n'));
  for (let tries = 0; tries < 4 && (await file()) !== NOTE; tries++) {
    const now = await file();
    await main.keyboard.press('Control+z');
    await expect.poll(file).not.toBe(now);
  }
  await expect.poll(file).toBe(NOTE);
});

test("the drag's question goes with its note's editor, as Cancel (D-144)", async () => {
  // Another note opened while it is up: the editor it would change is gone, so it goes (a Delete
  // left over the other note would do nothing).
  await raiseQuestion();
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Pictures' }).first().click();
  await expect(editor()).toContainText('above');
  await expect(question()).toHaveCount(0);
  expect(await file()).toBe(NOTE);
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Tables' }).first().click();
  await expect(table()).toHaveCount(1);
  await expect(going()).toHaveCount(0);
});

test('the edge handles: a "+" chip beside each edge on hover, a ghost of what a drag adds or takes (D-144)', async () => {
  const right = main.locator('.note-editor .cm-fl-table-edge-right');
  const bottom = main.locator('.note-editor .cm-fl-table-edge-bottom');
  const ghost = main.locator('.note-editor .cm-fl-table-ghost');
  await line('After the table.').click();
  await main.mouse.move(2, 2);
  await expect(right).toHaveCSS('opacity', '0');
  await table().hover();
  await expect(right).toHaveCSS('opacity', '1');
  await expect(bottom).toHaveCSS('opacity', '1');
  // Beside the middle of the right edge and of the bottom edge, outside the cells; a drawn "+".
  const edges = await tableBox();
  const at = await right.boundingBox();
  const below = await bottom.boundingBox();
  if (!edges || !at || !below) throw new Error('no handles');
  expect(at.x).toBeGreaterThanOrEqual(edges.x + edges.width);
  expect(Math.abs(at.y + at.height / 2 - (edges.y + edges.height / 2))).toBeLessThan(2);
  expect(below.y).toBeGreaterThanOrEqual(edges.y + edges.height);
  expect(Math.abs(below.x + below.width / 2 - (edges.x + edges.width / 2))).toBeLessThan(2);
  await expect(right.locator('svg path')).toHaveCount(2);
  // A click just inside the last column's right edge, or the last row's bottom edge, is the cell's.
  const last = await cell(1, 1).boundingBox();
  const first = await cell(1, 0).boundingBox();
  if (!last || !first) throw new Error('no cells');
  await main.mouse.click(edges.x + edges.width - 3, last.y + last.height / 2);
  await expect(cell(1, 1)).toHaveClass(/cm-fl-cell-active/);
  await main.mouse.click(first.x + first.width / 2, edges.y + edges.height - 3);
  await expect(cell(1, 0)).toHaveClass(/cm-fl-cell-active/);
  // Mid-drag adding: dashed new cells beside the table (2 columns × 2 rows), the count in them.
  await drag('right', 2, false);
  await expect(ghost).toHaveClass(/adding/);
  await expect(ghost.locator('.cm-fl-ghost-cell')).toHaveCount(4);
  await expect(main.locator('.note-editor .cm-fl-table-badge')).toHaveText('+2 columns');
  await expect(right).toHaveClass(/\bon\b/);
  await expect(bottom).toHaveCSS('opacity', '0');
  await main.keyboard.press('Escape');
  await main.mouse.up();
  await expect(ghost).toHaveCount(0);
  expect(await file()).toBe(NOTE);
  // Mid-drag taking away: the row dimmed inside an outline, the handle's "+" a "−".
  await drag('bottom', -1, false);
  await expect(ghost).toHaveClass(/going/);
  await expect(going()).toHaveCount(2);
  await expect(bottom).toHaveClass(/removing/);
  await main.keyboard.press('Escape');
  await main.mouse.up();
  await expect(ghost).toHaveCount(0);
  await expect(going()).toHaveCount(0);
  await expect(bottom).not.toHaveClass(/removing/);
  expect(await file()).toBe(NOTE);
});

test('a click under or beside a table, off its cells and handles, puts the caret on the line after it (D-144)', async () => {
  // The blank line under the table, typed on as any line under a table is (the blank line that
  // ends the table written before the text).
  const after = NOTE.replace(`${TABLE}\n\n`, `${TABLE}\n\nQ\n`);
  // In the handles' gutter (and the line's own space under the box), beside the table, and from a
  // cell being edited.
  for (const [dx, dy, from] of [
    [10, 4, line('After the table.')],
    [10, 12, line('After the table.')],
    [10, 20, line('After the table.')],
    ['beside', 0, line('After the table.')],
    [10, 12, cell(1, 0)],
  ] as const) {
    await from.click();
    const edges = await tableBox();
    if (!edges) throw new Error('no table');
    const x = dx === 'beside' ? edges.x + edges.width + 120 : edges.x + dx;
    const y = dx === 'beside' ? edges.y + edges.height / 2 : edges.y + edges.height + dy;
    await main.mouse.click(x, y);
    await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
    await expect(editor()).toBeFocused();
    await main.keyboard.type('Q');
    await expect.poll(file).toBe(after);
    await main.keyboard.press('Control+z');
    await expect.poll(file).toBe(NOTE);
  }
});

test('a click near the bottom of the line under a table lands on that line, under one table or two (D-144)', async () => {
  // A vertical margin on a table's block would be left out of the editor's height map: clicks
  // under the table landed a line too low (on the picture's line, or "above").
  const cases = [
    ['Pictures', PICTURES, 0, `${INSERTED}\n\n${PICTURE}`],
    ['Twice', TWICE, 0, `${INSERTED}\n\nmiddle`],
    ['Twice', TWICE, 1, `${INSERTED}\n\nabove`],
  ] as const;
  let open = '';
  for (const [name, source, index, around] of cases) {
    const read = (): Promise<string> => readFile(join(flint, `${name}.md`), 'utf8');
    if (open !== name) {
      await main.locator('.nav:not(.flip-ghost)', { hasText: name }).first().click();
      await expect(editor()).toContainText('above');
      open = name;
    }
    const under = main.locator('.note-editor .cm-fl-table-wrap + .cm-line').nth(index);
    // Laid out and at rest (the picture loaded, no table still easing to its size).
    let last = '';
    await expect
      .poll(async () => {
        const now = JSON.stringify(await under.boundingBox());
        const same = now === last;
        last = now;
        return same;
      })
      .toBe(true);
    const box = await under.boundingBox();
    if (!box) throw new Error('no line under the table');
    const after = source.replace(around, around.replace('\n\n', '\n\nw\n'));
    for (const dy of [Math.min(20, box.height - 3), box.height - 2]) {
      await main.mouse.click(box.x + 10, box.y + dy);
      await main.keyboard.type('w');
      await expect.poll(read).toBe(after);
      await main.keyboard.press('Control+z');
      await expect.poll(read).toBe(source);
    }
  }
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

test('Backspace under a table, Source mode and a table in a quote keep text out too (D-144)', async () => {
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Pictures' }).first().click();
  await expect(editor()).toContainText('above');
  const pictures = (): Promise<string> => readFile(join(flint, 'Pictures.md'), 'utf8');
  const picture = main.locator('.note-editor .cm-fl-image img');
  const under = main.locator('.note-editor .cm-fl-table-wrap + .cm-line');
  const above = editor().locator('.cm-line', { hasText: /^above$/ });
  await expect.poll(pictures).toBe(PICTURES);
  // Backspace and Ctrl+Backspace on the blank line under the table: the text stays as it is (the
  // picture would be a row), the caret goes up into the table's last row.
  for (const key of ['Backspace', 'Control+Backspace']) {
    await under.click();
    await main.keyboard.press(key);
    // The keys go on into that cell, typed right after the key (D-152).
    await main.keyboard.type('z');
    await expect(cell(1, 2)).toHaveClass(/cm-fl-cell-active/);
    await expect(table().locator('.cm-fl-cell-active')).toHaveCount(1);
    await expect.poll(pictures).toBe(PICTURES.replace('| test |  |  |', '| test |  | z |'));
    await main.keyboard.press('Control+z');
    await expect.poll(pictures).toBe(PICTURES);
    await above.click();
    await expect(table().locator('tr')).toHaveCount(2);
    await expect(cell(1, 0)).toHaveText('test');
    await expect(picture).toHaveCount(1);
    await expect(under).toHaveText('');
  }
  // Source mode: a word typed on the blank line under the table gets the blank line above it, so
  // the picture is still drawn when the preview comes back.
  await under.click();
  await main.keyboard.press('Control+Shift+E');
  await expect(table()).toHaveCount(0);
  await editor()
    .locator('.cm-line', { hasText: /^\| test/ })
    .locator('xpath=following-sibling::*[1]')
    .click();
  await main.keyboard.type('word');
  const typed = PICTURES.replace(`${INSERTED}\n\n`, `${INSERTED}\n\nword\n`);
  await expect.poll(pictures).toBe(typed);
  await main.keyboard.press('Control+Shift+E');
  await expect(table().locator('tr')).toHaveCount(2);
  await expect(picture).toHaveCount(1);
  await main.keyboard.press('Control+z');
  await expect.poll(pictures).toBe(PICTURES);
  // A table in a quote: read without the quote's marks; a word typed on the quote's blank line
  // under it gets a blank quote line (`>`) above it and stays in the quote, out of the table.
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Quoted' }).first().click();
  await expect(editor()).toContainText('above');
  const quoted = (): Promise<string> => readFile(join(flint, 'Quoted.md'), 'utf8');
  await expect(table().locator('tr')).toHaveCount(2);
  await expect(cell(0, 0)).toHaveText('a');
  await expect(cell(0, 1)).toHaveText('b');
  await expect(cell(0, 2)).toHaveCount(0);
  const shown = await picture.count();
  await under.click();
  await main.keyboard.press('End');
  await main.keyboard.type('x');
  await expect.poll(quoted).toBe(QUOTED.replace('| c | d |\n>\n', '| c | d |\n>\n>x\n'));
  await above.click();
  await expect(table().locator('tr')).toHaveCount(2);
  await expect(cell(1, 1)).toHaveText('d');
  await expect(picture).toHaveCount(shown);
  await main.keyboard.press('Control+z');
  await expect.poll(quoted).toBe(QUOTED);
});

test('a table as wide as the note has no scrollbar under it: its handles stay inside (D-144)', async () => {
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Wide' }).first().click();
  await expect(cell(0, 13)).toHaveText('h13 lorem ipsum');
  const wrap = main.locator('.note-editor .cm-fl-table-wrap');
  const sizes = (): Promise<string> =>
    wrap.evaluate(
      (element) =>
        `${element.scrollWidth - element.clientWidth} ${element.scrollHeight - element.clientHeight}`,
    );
  // The cells wrap their words, so the table is as wide as the note, no wider.
  expect(await wrap.evaluate((element) => element.clientWidth)).toBeLessThan(14 * 100);
  await expect.poll(sizes).toBe('0 0');
  await table().hover();
  await expect.poll(sizes).toBe('0 0');
});

/** D-144: selecting cells, in the Grid note (3 columns, a header and two rows). */
const grid = (): Promise<string> => readFile(join(flint, 'Grid.md'), 'utf8');
const selected = (): Locator => table().locator('.cm-fl-cell-selected');
const openGrid = async (): Promise<void> => {
  // Only when another note is open: a click on the open note's own entry moves the focus to its
  // name, later.
  if ((await line('Grid.').count()) === 0)
    await main.locator('.nav:not(.flip-ghost)', { hasText: 'Grid' }).first().click();
  await expect(cell(2, 2)).toHaveText('c2');
  await expect.poll(grid).toBe(GRID_NOTE);
};
/** A synthetic clipboard event on an editor's text (never the real clipboard, D-93). */
const clipboard = (
  target: Locator,
  type: 'copy' | 'cut' | 'paste',
  put: Record<string, string> = {},
): Promise<Record<string, string>> =>
  target.evaluate(
    (element, [kind, data]) => {
      const transfer = new DataTransfer();
      for (const [format, text] of Object.entries(data)) transfer.setData(format, text);
      element.dispatchEvent(
        new ClipboardEvent(kind, { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
      return Object.fromEntries(transfer.types.map((format) => [format, transfer.getData(format)]));
    },
    [type, put] as const,
  );
const activeCell = (): Locator => table().locator('.cm-fl-cell-active .cm-content');
const center = async (target: Locator): Promise<{ x: number; y: number }> => {
  const box = await target.boundingBox();
  if (!box) throw new Error('no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('a drag across cells selects a rectangle; a click or Esc clears it (D-144)', async () => {
  await openGrid();
  const from = await center(cell(1, 0));
  const to = await center(cell(2, 1));
  await main.mouse.move(from.x, from.y);
  await main.mouse.down();
  await main.mouse.move(to.x, to.y, { steps: 6 });
  await main.mouse.up();
  // The anchor keeps the ring (no fill); the other three cells of the rectangle are filled.
  await expect(cell(1, 0)).toHaveClass(/cm-fl-cell-active/);
  await expect(selected()).toHaveCount(3);
  for (const [row, column] of [
    [1, 1],
    [2, 0],
    [2, 1],
  ] as const)
    await expect(cell(row, column)).toHaveClass(/cm-fl-cell-selected/);
  await expect(cell(1, 0)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // A plain click clears it.
  await cell(2, 2).click();
  await expect(selected()).toHaveCount(0);
  await expect(cell(2, 2)).toHaveClass(/cm-fl-cell-active/);
  // Shift+click from the active cell selects again; Esc clears it, the cell still being edited.
  await cell(1, 1).click({ modifiers: ['Shift'] });
  await expect(selected()).toHaveCount(3);
  await expect(cell(2, 2)).toHaveClass(/cm-fl-cell-active/);
  await expect(cell(2, 2).locator('.cm-content')).toBeFocused();
  await main.keyboard.press('Escape');
  await expect(selected()).toHaveCount(0);
  await expect(cell(2, 2)).toHaveClass(/cm-fl-cell-active/);
  expect(await grid()).toBe(GRID_NOTE);
});

test('Shift+arrows select cells from the text’s edge on; a plain arrow clears them (D-144)', async () => {
  await openGrid();
  await editCell(1, 0);
  await main.keyboard.press('End');
  // Inside the text first: Shift+← selects a character, no cells.
  await main.keyboard.press('Shift+ArrowLeft');
  await expect(selected()).toHaveCount(0);
  await main.keyboard.press('End');
  await main.keyboard.press('Shift+ArrowRight');
  await expect(selected()).toHaveCount(1);
  await expect(cell(1, 1)).toHaveClass(/cm-fl-cell-selected/);
  await main.keyboard.press('Shift+ArrowDown');
  await expect(selected()).toHaveCount(3);
  await main.keyboard.press('Shift+ArrowRight');
  await expect(selected()).toHaveCount(5);
  await main.keyboard.press('Shift+ArrowUp');
  await main.keyboard.press('Shift+ArrowUp');
  await expect(selected()).toHaveCount(5);
  await expect(cell(0, 2)).toHaveClass(/cm-fl-cell-selected/);
  await expect(cell(1, 0)).toHaveClass(/cm-fl-cell-active/);
  await expect(cell(1, 0).locator('.cm-content')).toBeFocused();
  await main.keyboard.press('ArrowLeft');
  await expect(selected()).toHaveCount(0);
  await expect(cell(1, 0)).toHaveClass(/cm-fl-cell-active/);
  expect(await grid()).toBe(GRID_NOTE);
});

test('Ctrl+C copies selected cells as tab-separated text and a markdown table (D-144)', async () => {
  await openGrid();
  await cell(1, 0).click();
  await cell(2, 1).click({ modifiers: ['Shift'] });
  await expect(selected()).toHaveCount(3);
  const copied = await clipboard(activeCell(), 'copy');
  expect(copied['text/plain']).toBe('a1\tb1\na2\tb2');
  expect(copied['text/markdown']).toBe('| a1 | b1 |\n| --- | --- |\n| a2 | b2 |');
  expect(await grid()).toBe(GRID_NOTE);
  // Pasted into the note, outside the table: a table of its own.
  await line('End.').click();
  await main.keyboard.press('End');
  await clipboard(editor(), 'paste', copied);
  await expect
    .poll(grid)
    .toBe(GRID_NOTE.replace('End.\n', `End.\n\n${copied['text/markdown'] ?? ''}\n`));
  await expect(table()).toHaveCount(2);
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
});

test('Delete clears selected cells at once, in one undo step, with an Undo toast (D-144)', async () => {
  await openGrid();
  const cleared = GRID_NOTE.replace('| a1 | b1 | c1 |', '|  |  | c1 |').replace(
    '| a2 | b2 | c2 |',
    '|  |  | c2 |',
  );
  await cell(1, 0).click();
  await cell(2, 1).click({ modifiers: ['Shift'] });
  await main.keyboard.press('Delete');
  await expect.poll(grid).toBe(cleared);
  // The cells stay selected; the toast's Undo brings their text back.
  await expect(selected()).toHaveCount(3);
  const toast = main.locator('.toast', { hasText: 'Cells cleared' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(grid).toBe(GRID_NOTE);
  // Backspace too, and Ctrl+Z undoes it in one step.
  await cell(1, 0).click();
  await cell(2, 1).click({ modifiers: ['Shift'] });
  await main.keyboard.press('Backspace');
  await expect.poll(grid).toBe(cleared);
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
  // The palette's Clear selected cells, while cells are selected.
  await cell(1, 0).click();
  await cell(2, 1).click({ modifiers: ['Shift'] });
  await main.keyboard.press('Control+k');
  await main.keyboard.type('Clear selected cells');
  await expect(main.locator('.palette-item.on')).toContainText('Clear selected cells');
  await main.keyboard.press('Enter');
  await expect.poll(grid).toBe(cleared);
  await main
    .locator('.toast', { hasText: 'Cells cleared' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect.poll(grid).toBe(GRID_NOTE);
});

test('the Undo toast goes once the note is edited again; its Undo gives the note the keys back (D-144)', async () => {
  await openGrid();
  const cleared = GRID_NOTE.replace('| a1 | b1 | c1 |', '|  |  | c1 |').replace(
    '| a2 | b2 | c2 |',
    '|  |  | c2 |',
  );
  const toast = main.locator('.toast:not(.leaving)', { hasText: 'Cells cleared' });
  const select = async (): Promise<void> => {
    await cell(1, 0).click();
    await cell(2, 1).click({ modifiers: ['Shift'] });
    await expect(selected()).toHaveCount(3);
  };
  // Typed on after the clear: the toast goes, so its Undo can't take back the typing instead.
  await select();
  await main.keyboard.press('Delete');
  await expect.poll(grid).toBe(cleared);
  await expect(toast).toHaveCount(1);
  await main.keyboard.type('Q');
  await expect.poll(grid).toBe(cleared.replace('|  |  | c1 |', '| Q |  | c1 |'));
  // At once, well before its own time (5 s) runs out.
  await expect(toast).toHaveCount(0, { timeout: 1500 });
  for (let tries = 0; tries < 4 && (await grid()) !== GRID_NOTE; tries++) {
    const now = await grid();
    await main.keyboard.press('Control+z');
    await expect.poll(grid).not.toBe(now);
  }
  await expect.poll(grid).toBe(GRID_NOTE);
  // The toast's Undo: the note (its cell) has the keys again, and Ctrl+Z is the note's own.
  await select();
  await main.keyboard.press('Delete');
  await expect.poll(grid).toBe(cleared);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(grid).toBe(GRID_NOTE);
  await expect
    .poll(() => main.evaluate(() => document.activeElement?.closest('.note-editor') !== null))
    .toBe(true);
  await main.keyboard.press('End');
  await main.keyboard.type('Z');
  await expect.poll(grid).toBe(GRID_NOTE.replace('| a1 |', '| a1Z |'));
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
});

test('Delete or a paste right after typing is its own undo step: the typing stays (D-144)', async () => {
  await openGrid();
  // Typed, then at once (well within history's 500 ms) b1 selected and cleared.
  await editCell(1, 0);
  await main.keyboard.press('End');
  await main.keyboard.type('x');
  await main.keyboard.press('Shift+ArrowRight');
  await main.keyboard.press('Delete');
  await expect.poll(grid).toBe(GRID_NOTE.replace('| a1 | b1 | c1 |', '|  |  | c1 |'));
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE.replace('| a1 |', '| a1x |'));
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
  // Typed, then a block pasted at once: Ctrl+Z takes back the paste only.
  await editCell(2, 0);
  await main.keyboard.press('End');
  await main.keyboard.type('y');
  await clipboard(activeCell(), 'paste', { 'text/plain': 'p\tq' });
  await expect.poll(grid).toBe(GRID_NOTE.replace('| a2 | b2 |', '| p | q |'));
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE.replace('| a2 |', '| a2y |'));
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
});

test('Shift+↑ in the header and Shift+↓ in the last row select the cell’s text (D-144)', async () => {
  await openGrid();
  // No row above the header, none below the last: the keys select text, no cells.
  await editCell(0, 0);
  await main.keyboard.press('End');
  await main.keyboard.press('Shift+ArrowUp');
  await expect(selected()).toHaveCount(0);
  await main.keyboard.type('Z');
  await expect.poll(grid).toBe(GRID_NOTE.replace('| A  |', '| Z  |'));
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
  await editCell(2, 1);
  await main.keyboard.press('Home');
  await main.keyboard.press('Shift+ArrowDown');
  await expect(selected()).toHaveCount(0);
  await main.keyboard.type('W');
  await expect.poll(grid).toBe(GRID_NOTE.replace('| b2 |', '| W |'));
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
});

test('pasting tab-separated text fills cells from the active one, growing the table (D-144)', async () => {
  await openGrid();
  // A 2 × 2 block from Excel (\r\n, a line break at the end) into b1.
  await cell(1, 1).click();
  await clipboard(activeCell(), 'paste', { 'text/plain': 'x\ty\r\nz\tw\r\n' });
  await expect
    .poll(grid)
    .toBe(
      GRID_NOTE.replace('| a1 | b1 | c1 |', '| a1 | x | y |').replace(
        '| a2 | b2 | c2 |',
        '| a2 | z | w |',
      ),
    );
  // What was pasted is selected, the caret in its first cell.
  await expect(cell(1, 1)).toHaveClass(/cm-fl-cell-active/);
  await expect(selected()).toHaveCount(3);
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
  // Larger than the table from c2: a column and a row added in its style, in the same step. Both
  // fade in (Q12): the new row's cells and the new column's (every `animate` on a cell recorded).
  await cell(2, 2).click();
  await main.evaluate(() => {
    const spy = window as unknown as { faded: string[]; animate: PropertyDescriptor };
    spy.faded = [];
    spy.animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate') ?? {};
    const original = spy.animate.value as (
      this: Element,
      ...args: Parameters<Element['animate']>
    ) => Animation;
    Element.prototype.animate = function (this: Element, frames, options) {
      const row = this.getAttribute('data-row');
      if (row !== null && JSON.stringify(frames).includes('opacity'))
        spy.faded.push(`${row}:${this.getAttribute('data-column') ?? ''}`);
      return original.call(this, frames, options);
    };
  });
  await clipboard(activeCell(), 'paste', { 'text/plain': '1\t2\n3\t4' });
  await expect
    .poll(grid)
    .toBe(
      GRID_NOTE.replace(
        GRID,
        '| A  | B  | C  |  |\n| --- | --- | --- | --- |\n| a1 | b1 | c1 |  |\n| a2 | b2 | 1 | 2 |\n|    |    | 3 | 4 |',
      ),
    );
  await expect(table().locator('tr')).toHaveCount(4);
  await expect(cell(3, 3)).toHaveText('4');
  const faded = await main.evaluate(() => {
    const spy = window as unknown as { faded: string[]; animate: PropertyDescriptor };
    Object.defineProperty(Element.prototype, 'animate', spy.animate);
    return spy.faded;
  });
  expect(faded).toEqual(expect.arrayContaining(['0:3', '1:3', '2:3', '3:0', '3:3']));
  expect(faded).not.toContain('1:1');
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
  // Text without a tab or a line break goes into the cell, as before.
  await editCell(1, 0);
  await main.keyboard.press('End');
  await clipboard(activeCell(), 'paste', { 'text/plain': 'Q' });
  await expect.poll(grid).toBe(GRID_NOTE.replace('| a1 |', '| a1Q |'));
  await expect(selected()).toHaveCount(0);
  await main.keyboard.press('Control+z');
  await expect.poll(grid).toBe(GRID_NOTE);
});

test('a table without edge pipes: Enter and Tab add a row that keeps its cells, a paste grows it (D-144)', async () => {
  const plain = (): Promise<string> => readFile(join(flint, 'Plain.md'), 'utf8');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Plain' }).first().click();
  await expect(cell(1, 0)).toHaveText('Alex');
  await expect.poll(plain).toBe(PLAIN);
  const undoAll = async (): Promise<void> => {
    for (let tries = 0; tries < 8 && (await plain()) !== PLAIN; tries++) {
      const now = await plain();
      await main.keyboard.press('Control+z');
      await expect.poll(plain).not.toBe(now);
    }
    await expect.poll(plain).toBe(PLAIN);
  };
  // Enter on the last row: a new row, written with its edge pipes (an empty first and last cell
  // need them); the keys go into its first cell.
  await editCell(1, 0);
  await main.keyboard.press('Enter');
  await expect(cell(2, 0)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.type('Zed');
  await expect.poll(plain).toBe(PLAIN.replace(PLAIN_TABLE, `${PLAIN_TABLE}\n| Zed |   |`));
  // Tab on to the next cell, and from the last cell a new row (never the row indented).
  await main.keyboard.press('Tab');
  await expect(cell(2, 1)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.type('7');
  await main.keyboard.press('Tab');
  await expect(cell(3, 0)).toHaveClass(/cm-fl-cell-active/);
  await main.keyboard.type('Ann');
  await expect
    .poll(plain)
    .toBe(PLAIN.replace(PLAIN_TABLE, `${PLAIN_TABLE}\n| Zed | 7 |\n| Ann |   |`));
  await expect(table().locator('tr')).toHaveCount(4);
  await undoAll();
  // A block larger than the table pasted into Alex: every cell lands, none lost.
  await cell(1, 0).click();
  await clipboard(activeCell(), 'paste', { 'text/plain': 'p\tq\nr\ts' });
  await expect
    .poll(plain)
    .toBe(PLAIN.replace(PLAIN_TABLE, 'Name | Age\n--- | ---\np | q\n| r | s |'));
  await expect(cell(2, 0)).toHaveText('r');
  await expect(cell(2, 1)).toHaveText('s');
  await undoAll();
});

test('Backspace under a table that ends the note leaves the text as it is, the caret in its last cell (D-144)', async () => {
  const ending = (): Promise<string> => readFile(join(flint, 'Ending.md'), 'utf8');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Ending' }).first().click();
  await expect(cell(1, 0)).toHaveText('test');
  for (const key of ['Backspace', 'Control+Backspace']) {
    await main.locator('.note-editor .cm-fl-table-wrap + .cm-line').click();
    // D-152: the keys typed right after it, with no wait, go into the cell it lights up.
    await main.keyboard.press(key);
    await main.keyboard.type('zq');
    await expect(cell(1, 2)).toHaveClass(/cm-fl-cell-active/);
    await expect.poll(ending).toBe(ENDING.replace('| test |  |  |', '| test |  | zq |'));
    await main.keyboard.press('Control+z');
    await expect.poll(ending).toBe(ENDING);
  }
});

test('a click under a table at the note’s end, in a quote or over a heading: the keys go on a line under it (D-144)', async () => {
  const cases = [
    // At the note's end: the line made as Esc makes it (the editor not focused before).
    ['Tail', TAIL, `${TAIL}\n\nQ`],
    // In a quote: after the quote's mark, the text stays in the quote.
    ['Quoted', QUOTED, QUOTED.replace('| c | d |\n>\n', '| c | d |\n>\n>Q\n')],
    // Right above a heading: a new line, not the heading's start.
    ['Heading', HEADING, HEADING.replace('| c | d |\n', '| c | d |\n\nQ\n')],
  ] as const;
  for (const [name, source, after] of cases) {
    const read = (): Promise<string> => readFile(join(flint, `${name}.md`), 'utf8');
    // Opened from the sidebar: the note's editor has no caret the user placed.
    await main.locator('.nav:not(.flip-ghost)', { hasText: name }).first().click();
    await expect(cell(1, 1)).toHaveText('d');
    // ↓ from the last row shares the way out (at the note's end it stays: Esc makes the line).
    for (const how of name === 'Tail' ? (['click'] as const) : (['click', 'down'] as const)) {
      if (how === 'click') {
        const edges = await tableBox();
        await main.mouse.click(edges.x + 10, edges.y + edges.height + 12);
      } else {
        await editCell(1, 1);
        await main.keyboard.press('ArrowDown');
      }
      await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
      await expect(editor()).toBeFocused();
      await main.keyboard.type('Q');
      await expect.poll(read).toBe(after);
      await expect(table().locator('tr')).toHaveCount(2);
      for (let tries = 0; tries < 4 && (await read()) !== source; tries++) {
        const now = await read();
        await main.keyboard.press('Control+z');
        await expect.poll(read).not.toBe(now);
      }
      await expect.poll(read).toBe(source);
    }
  }
});

test('a paste from a cell a short row hasn’t got selects what it filled, the caret in a cell it has (D-144)', async () => {
  const short = (): Promise<string> => readFile(join(flint, 'Short.md'), 'utf8');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Short' }).first().click();
  await expect(cell(2, 2)).toHaveText('4');
  await cell(2, 2).click();
  await cell(1, 1).click({ modifiers: ['Shift'] });
  await expect(selected()).toHaveCount(3);
  await clipboard(activeCell(), 'paste', { 'text/plain': '\t\nx\ty' });
  // The short row stays as it is (nothing to write there); the row below gets x and y.
  await expect.poll(short).toBe(SHORT.replace('| 2 | 3 | 4 |', '| 2 | x | y |'));
  await expect(cell(2, 1)).toHaveClass(/cm-fl-cell-active/);
  await expect(selected()).toHaveCount(3);
  for (const [row, column] of [
    [1, 1],
    [1, 2],
    [2, 2],
  ] as const)
    await expect(cell(row, column)).toHaveClass(/cm-fl-cell-selected/);
  await main.keyboard.press('Control+z');
  await expect.poll(short).toBe(SHORT);
});

test('an edge drag in a note just opened from the sidebar: Ctrl+Z undoes it (D-144)', async () => {
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Tables' }).first().click();
  await expect(cell(1, 0)).toHaveText('Alex');
  await expect.poll(file).toBe(NOTE);
  await drag('right', 1);
  await expect.poll(file).toContain('| Name    | Age |  |');
  await expect
    .poll(() => main.evaluate(() => document.activeElement?.closest('.note-editor') !== null))
    .toBe(true);
  await main.keyboard.press('Control+z');
  await expect.poll(file).toBe(NOTE);
});

test('the Undo toast goes with its note’s editor: another note opened (D-144)', async () => {
  await openGrid();
  const cleared = GRID_NOTE.replace('| a1 | b1 | c1 |', '|  |  | c1 |').replace(
    '| a2 | b2 | c2 |',
    '|  |  | c2 |',
  );
  const toast = main.locator('.toast:not(.leaving)', { hasText: 'Cells cleared' });
  await cell(1, 0).click();
  await cell(2, 1).click({ modifiers: ['Shift'] });
  await expect(selected()).toHaveCount(3);
  await main.keyboard.press('Delete');
  await expect.poll(grid).toBe(cleared);
  await expect(toast).toHaveCount(1);
  // Its Undo would run on an editor that is gone: the toast goes with it, as the drag's question.
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Pictures' }).first().click();
  await expect(editor()).toContainText('above');
  await expect(toast).toHaveCount(0, { timeout: 1500 });
  expect(await grid()).toBe(cleared);
  // Put back from outside (the note opened again has no history of the clear).
  await writeFile(join(flint, 'Grid.md'), GRID_NOTE);
  await openGrid();
  await expect(cell(1, 0)).toHaveText('a1');
});

test('a click under a read-only note’s table never changes its text: no line is made (D-144)', async () => {
  const read = (): Promise<string> => readFile(join(flint, 'Newer.md'), 'utf8');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Newer' }).first().click();
  await expect(cell(1, 1)).toHaveText('d');
  await expect(main.locator('.note-editor .cm-content').first()).toHaveAttribute(
    'aria-readonly',
    'true',
  );
  const under = main.locator('.note-editor .cm-fl-table-wrap ~ .cm-line');
  await expect(under).toHaveCount(0);
  // A line would be made in the same press: two frames later it would be drawn.
  const frames = (): Promise<void> =>
    main.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  const edges = await tableBox();
  if (!edges) throw new Error('no table');
  await main.mouse.click(edges.x + 10, edges.y + edges.height + 12);
  await frames();
  expect(await under.count()).toBe(0);
  // Esc from a cell, the other way out that makes a line at the note's end: none either (a
  // read-only note's cell has no editor to wait for).
  await cell(1, 1).click();
  await main.keyboard.press('Escape');
  await frames();
  expect(await under.count()).toBe(0);
  expect(await read()).toBe(NEWER);
});

test('a click under a table, a line of spaces under it: the text starts that line, a paragraph (D-144)', async () => {
  const read = (): Promise<string> => readFile(join(flint, 'Spaces.md'), 'utf8');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Spaces' }).first().click();
  await expect(cell(1, 1)).toHaveText('d');
  for (const how of ['click', 'down'] as const) {
    if (how === 'click') {
      const edges = await tableBox();
      if (!edges) throw new Error('no table');
      await main.mouse.click(edges.x + 10, edges.y + edges.height + 12);
    } else {
      await editCell(1, 1);
      await main.keyboard.press('ArrowDown');
    }
    await expect(table().locator('.cm-fl-cell-active')).toHaveCount(0);
    await main.keyboard.type('Q');
    // Not after the spaces: four of them would make it an indented code block.
    await expect.poll(read).toBe(SPACES.replace('| c | d |\n    \n', '| c | d |\n\nQ    \n'));
    await expect(line('Q')).not.toHaveClass(/cm-fl-code/);
    for (let tries = 0; tries < 4 && (await read()) !== SPACES; tries++) {
      const now = await read();
      await main.keyboard.press('Control+z');
      await expect.poll(read).not.toBe(now);
    }
    await expect.poll(read).toBe(SPACES);
  }
});
