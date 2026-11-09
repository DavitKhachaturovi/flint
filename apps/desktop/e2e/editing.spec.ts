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
 * D-111: the main window's editing fixes after 0.8.9: the composer's notes field, its drafts per
 * list, typed shorthand shown live on the row being edited, an empty new row leaving with the
 * remove animation, a note renamed from its title, and the note editor's own text selection. Its
 * own Flint on the suite's fixed clock (D-107), off-screen, never focused.
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

const open = async (name: string): Promise<void> => {
  await main.locator('.nav:not(.flip-ghost)', { hasText: name }).first().click();
  await expect(main.locator('.content h1, .content .note-title').first()).toContainText(name);
};

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-editing-'));
  flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await writeFile(
    join(flint, 'Work.md'),
    [
      '---\nflint: 1\nid: work\nmode: tasks\n---',
      '- [ ] Write the report [id:: w1]',
      '- [ ] Plan the sprint [id:: w2]',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(flint, 'Errands.md'),
    '---\nflint: 1\nid: errands\nmode: tasks\n---\n- [ ] Buy milk [id:: e1]\n',
  );
  await writeFile(
    join(flint, 'Plan.md'),
    '---\nflint: 1\nid: plan\nmode: note\n---\nFirst line of the plan.\nSecond line, a little longer.\n',
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
    window.setBounds({ x: -6000, y: 0, width: 1400, height: 860 });
    window.showInactive();
  });
  await expect(main.locator('.nav', { hasText: 'Work' })).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('the composer: both fields take a click; each list keeps its unsent draft for the session (D-111)', async () => {
  await open('Work');
  const title = main.locator('.composer-input');
  await title.click();
  await main.keyboard.type('Call the bank !h');
  await main.keyboard.press('Shift+Enter');
  const notes = main.locator('.composer-notes');
  await expect(notes).toBeFocused();
  await main.keyboard.type('about the card');
  // Back into the title, then into the notes again: both take the click.
  await title.click();
  await expect(title).toBeFocused();
  await notes.click();
  await expect(notes).toBeFocused();
  await main.keyboard.type(' fee');
  // Another list has its own (empty) composer; back here, the draft is as it was.
  await open('Errands');
  await expect(title).toHaveValue('');
  await expect(notes).toHaveCount(0);
  await open('Work');
  await expect(title).toHaveValue('Call the bank !h');
  await expect(notes).toHaveValue('about the card fee');
  await expect(main.locator('.composer-chips .chip')).toHaveText(['High']);
  // Sent, the draft goes.
  await title.click();
  await main.keyboard.press('Enter');
  await expect(main.locator('.row', { hasText: 'Call the bank' })).toHaveCount(1);
  await open('Errands');
  await open('Work');
  await expect(title).toHaveValue('');
  await main.keyboard.press('Escape');
});

test('typed shorthand shows on the row being edited: the stripe, the time, the list chip (D-111)', async () => {
  await main.locator('.row', { hasText: 'Write the report' }).click();
  const row = main.locator('.row[data-key="w1"]');
  await main.keyboard.press('Enter');
  const field = row.locator('.title-input');
  await expect(field).toBeFocused();
  await main.keyboard.press('End');
  await main.keyboard.type(' !h');
  await expect(row.locator('.stripe')).toHaveClass(/p-high/);
  await main.keyboard.type(' @15:00');
  await expect(row.locator('.reminder')).toContainText('Today 15:00');
  await main.keyboard.type(' ##Errands');
  await expect(row.locator('.chip.live-list')).toHaveText('→ Errands');
  // Taken back out, the chip goes (animated) and the stripe stays.
  for (let i = 0; i < ' ##Errands'.length; i++) await main.keyboard.press('Backspace');
  await expect(row.locator('.chip.live-list')).toHaveCount(0);
  await expect(row.locator('.stripe')).toHaveClass(/p-high/);
  // Saved as usual.
  await main.keyboard.press('Escape');
  await expect
    .poll(() => readFile(join(flint, 'Work.md'), 'utf8'))
    .toMatch(/Write the report .*\[priority:: high\]/);
  await expect
    .poll(() => readFile(join(flint, 'Work.md'), 'utf8'))
    .toMatch(/Write the report .*\[reminder:: 2026-03-10T15:00\]/);
  await main.keyboard.press('Escape');
});

test("an empty new row that is left plays the remove animation, on a task's page too (D-111)", async () => {
  await main.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { gone: string[] }).gone = seen;
    new MutationObserver(() => {
      for (const ghost of document.querySelectorAll('.row.leaving.remove'))
        seen.push(ghost.className);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const gone = (): Promise<number> =>
    main.evaluate(() => (window as unknown as { gone: string[] }).gone.splice(0).length);
  // In the list: Enter on a task in Edit state opens a new row; left empty, it plays out.
  const row = main.locator('.row', { hasText: 'Plan the sprint' });
  await row.click();
  await main.keyboard.press('Enter');
  await main.keyboard.press('Enter');
  await expect(main.locator('.row.editing[data-key="new-row"]')).toHaveCount(1);
  await main.keyboard.press('Escape');
  await expect.poll(gone).toBeGreaterThan(0);
  // On the task's page (the row is still selected): Add subtask, then Esc.
  await expect(row).toHaveClass(/(^| )sel( |$)/);
  await main.keyboard.press('Shift+Enter');
  await main.getByRole('button', { name: 'Add subtask' }).click();
  await expect(main.locator('.row.editing[data-key="new-row"]')).toHaveCount(1);
  await main.keyboard.press('Escape');
  await expect.poll(gone).toBeGreaterThan(0);
  await expect(main.locator('.row.leaving')).toHaveCount(0);
  await main.keyboard.press('Escape');
});

test('a note is renamed from its title, as in the sidebar; its text selects only the characters (D-111)', async () => {
  await open('Plan');
  const heading = main.locator('.note-title');
  await heading.click();
  const field = main.locator('.note-title-input');
  await expect(field).toBeFocused();
  // A name already taken: the problem shows and the field stays.
  await field.fill('Errands');
  await main.keyboard.press('Enter');
  await expect(main.locator('.note-title-problem')).toBeVisible();
  await expect(field).toBeVisible();
  // Esc cancels.
  await main.keyboard.press('Escape');
  await expect(heading).toHaveText('Plan');
  // A new name: Enter saves it (the file and the sidebar follow).
  await heading.click();
  await field.fill('Plan for March');
  await main.keyboard.press('Enter');
  await expect(main.locator('.note-title')).toHaveText('Plan for March');
  await expect.poll(async () => (await readdir(flint)).includes('Plan for March.md')).toBe(true);
  await expect(main.locator('.nav', { hasText: 'Plan for March' })).toHaveCount(1);
  // The editor's own selection: no drawn line boxes; Ctrl+A selects the text itself.
  await main.locator('.note-editor .cm-content').click();
  await main.keyboard.press('Control+a');
  expect(await main.locator('.cm-selectionLayer').count()).toBe(0);
  expect(await main.evaluate(() => window.getSelection()?.toString() ?? '')).toContain(
    'First line of the plan.',
  );
});

test("the side panel's subtasks move as the list's rows do: in, out, and an empty new one (D-112)", async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((each) => each.getTitle() === 'Flint')
      ?.setBounds({ x: -6000, y: 0, width: 1700, height: 900 });
  });
  await open('Work');
  await main.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { panelMotion: Set<string> }).panelMotion = seen;
    new MutationObserver(() => {
      for (const sub of document.querySelectorAll('.panel-subtask.enter, .panel-subtask.leaving'))
        seen.add(sub.className);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const motion = (): Promise<string[]> =>
    main.evaluate(() => [...(window as unknown as { panelMotion: Set<string> }).panelMotion]);
  await main.locator('.row', { hasText: 'Plan the sprint' }).click({ position: { x: 300, y: 12 } });
  const panel = main.locator('.context-panel');
  await panel.locator('.panel-add', { hasText: 'Add subtask' }).click();
  await main.keyboard.type('Draft the agenda');
  await main.keyboard.press('Enter');
  await expect(
    panel.locator('.panel-subtask:not(.adding)', { hasText: 'Draft the agenda' }),
  ).toHaveCount(1);
  await expect.poll(motion).toContain('panel-subtask enter');
  // The empty field, left, plays out.
  await main.keyboard.press('Escape');
  await expect.poll(motion).toContain('panel-subtask adding leaving');
  await expect(panel.locator('.panel-subtask.adding')).toHaveCount(0);
  // Deleted, the subtask folds away where it was.
  await panel.locator('.panel-subtask', { hasText: 'Draft the agenda' }).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: /^Delete/ }).click();
  await expect.poll(motion).toContain('panel-subtask leaving');
  await expect(panel.locator('.panel-subtask', { hasText: 'Draft the agenda' })).toHaveCount(0);
  await main.keyboard.press('Escape');
});

test('the capture popup fades in and out: main says hiding, hides after the fade; the page fades (D-111)', async () => {
  // The popup is made at startup (pre-warmed): watch it before it is shown. Animations are counted
  // as they start (the fades are short); main's messages are logged in order.
  const popup = app.windows().find((page) => page.url().includes('capture-popup')) as Page;
  const watch = (): Promise<void> =>
    popup.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { log: string[] }).log = log;
      const card = document.querySelector('.card') as HTMLElement;
      card.animate = (...args: Parameters<Element['animate']>): Animation => {
        log.push('animate');
        return Element.prototype.animate.apply(card, args);
      };
      const bridge = (
        window as unknown as {
          flintPopup: { onHiding: (f: () => void) => void; onHidden: (f: () => void) => void };
        }
      ).flintPopup;
      bridge.onHiding(() => log.push('hiding'));
      bridge.onHidden(() => log.push('hidden'));
    });
  const log = (): Promise<string[]> =>
    popup.evaluate(() => [...(window as unknown as { log: string[] }).log]);
  const send = (channel: string): Promise<void> =>
    app.evaluate(({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()
        .find((each) => each.webContents.getURL().includes('capture-popup'))
        ?.webContents.send(name);
    }, channel);
  const visible = (): Promise<boolean | undefined> =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((each) => each.webContents.getURL().includes('capture-popup'))
        ?.isVisible(),
    );
  await watch();
  // The page: hiding fades the card out; hidden, it waits faded, ready to rise in.
  await send('popup:hiding');
  await expect.poll(log).toEqual(['animate', 'hiding']);
  await send('popup:hidden');
  await expect(popup.locator('.card')).toHaveClass(/waiting/);
  // Main: shown, then closed (Esc; in the tests, where it never keeps the focus, an empty popup
  // closes itself, D-41): "hiding" first, the window hidden only after the fade.
  await watch();
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  // D-156: typed once the popup has taken in being shown (its field focused, its draft applied),
  // not before: once the field held " x" (8 Nov 2026).
  await expect(popup.locator('#capture')).toBeFocused();
  await popup.locator('#capture').pressSequentially('x');
  await expect(popup.locator('#capture')).toHaveValue('x');
  if (await visible()) await popup.locator('#capture').press('Escape');
  await expect.poll(log).toContain('hidden');
  const events = await log();
  expect(events.indexOf('hiding')).toBeGreaterThan(-1);
  expect(events.indexOf('hiding')).toBeLessThan(events.indexOf('hidden'));
  expect(await visible()).toBe(false);
  await expect(popup.locator('.card')).toHaveClass(/waiting/);
  // D-112: the same softer shadow as mini mode's card.
  expect(
    await popup.locator('.card').evaluate((card) => getComputedStyle(card).boxShadow),
  ).toContain('0px 12px 30px -10px');
});

test("a quick note's title: Enter, Tab, ↓ and Shift+Enter save it and go on into its text; no new note (D-115)", async () => {
  for (const key of ['Enter', 'Tab', 'ArrowDown', 'Shift+Enter']) {
    const name = `Titled by ${key.replace('+', ' ')}`;
    await main.locator('.nav.quick-new').click();
    const editor = main.locator('.note-card .cm-content');
    // The new quick note is open (not the one before it, still shown for a moment).
    await expect(main.locator('.quick-title-input')).toHaveValue('');
    await expect(editor).toBeFocused();
    await main.keyboard.type('First line');
    const head = main.locator('.quick-title .subtitle');
    const made = await head.textContent();
    await main.locator('.quick-title-input').click();
    await main.keyboard.type(name);
    await main.keyboard.press(key);
    // The caret goes on into the note's text, and stays there once the title is saved.
    await expect(editor).toBeFocused();
    await expect.poll(async () => (await readdir(flint)).includes(`${name}.md`)).toBe(true);
    await expect(editor).toBeFocused();
    await main.keyboard.type(' and more');
    await expect
      .poll(() => readFile(join(flint, `${name}.md`), 'utf8'))
      .toContain('First line and more');
    // Still the same quick note, from when it was made.
    await expect(head).toHaveText(made ?? '');
    expect((await readdir(flint)).filter((file) => file.startsWith('Quick note'))).toEqual([]);
  }
});

test("a note given its ID by its first save, opened again after another note: its own editor, and Ctrl+Z never brings in the other note's text or undoes a change from outside (D-115, D-143)", async () => {
  // D-23: a file without Flint's header gets it (and an ID) on its first save.
  await writeFile(join(flint, 'Loose.md'), 'Loose text\n');
  // Notes of its own (an earlier test renames Plan).
  await writeFile(
    join(flint, 'Second note.md'),
    '---\nflint: 1\nid: second\nmode: note\n---\nFirst line of the second note.\n',
  );
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'Loose' })).toBeVisible();
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'Second note' })).toBeVisible();
  await open('Loose');
  const editor = main.locator('.note-card .cm-content');
  await editor.click();
  await main.keyboard.press('Control+Home');
  await main.keyboard.press('End');
  await main.keyboard.type(' typed');
  await expect
    .poll(() => readFile(join(flint, 'Loose.md'), 'utf8'))
    .toMatch(/^---\n[\s\S]*\bid: [\s\S]*Loose text typed/);
  // Another note, its editor marked, then the first one again: a new editor, not that one.
  await open('Second note');
  await expect(editor).toContainText('First line of the second note.');
  await main.locator('.note-card .cm-editor').evaluate((element) => {
    (element as HTMLElement).dataset.e2eNote = 'second';
  });
  await open('Loose');
  await expect(editor).toContainText('Loose text typed');
  await expect(main.locator('.note-card .cm-editor[data-e2e-note]')).toHaveCount(0);
  // Ctrl+Z has nothing of the other note's to bring back.
  await editor.click();
  for (let undo = 0; undo < 3; undo += 1) await main.keyboard.press('Control+z');
  await main.waitForTimeout(1200);
  await expect(editor).toContainText('Loose text');
  await expect(editor).not.toContainText('First line of the second note.');
  expect(await readFile(join(flint, 'Loose.md'), 'utf8')).not.toContain('second note');

  // A change from outside (the file edited elsewhere) shows, and Ctrl+Z doesn't undo it.
  await open('Second note');
  const second = await readFile(join(flint, 'Second note.md'), 'utf8');
  await writeFile(join(flint, 'Second note.md'), second.replace('First line', 'Changed outside'));
  await expect(editor).toContainText('Changed outside of the second note.');
  await editor.click();
  for (let undo = 0; undo < 3; undo += 1) await main.keyboard.press('Control+z');
  await main.waitForTimeout(1200);
  await expect(editor).toContainText('Changed outside of the second note.');
  expect(await readFile(join(flint, 'Second note.md'), 'utf8')).toContain(
    'Changed outside of the second note.',
  );
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
});
