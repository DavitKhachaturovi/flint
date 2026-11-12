import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
 * AGENT-05 to AGENT-07 and D-186 end to end: Settings → AI agents (the switches through to
 * agent-state.json, read-only, limits, connecting apps, the skill), Hidden from agents from the menu
 * and Settings with the header line, an agent's change flashing its row and undone from Recent
 * agent changes with its toast, the palette's commands, and the `?` sheet where the hotkeys
 * change. The development Flint on a temporary folder (never real data), the real `flint` command,
 * the test clock (D-107); it waits for what it checks (D-156) and never touches the clipboard
 * without putting it back (D-93).
 */

test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const cli = join(appDirectory, '..', 'cli', 'dist', 'flint.cjs');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();

let dataDirectory: string;
let flint: string;
let appData: string;
let app: ElectronApplication;
let main: Page;

interface Hooks {
  blockedRequests: string[];
  opened: string[];
  saveSkillTo?: string;
  saveClipboard?: () => Promise<void>;
  restoreClipboard?: () => Promise<void>;
}

/** The real command, as a script would run it (named, so the change's agent is known). */
function flintCommand(args: readonly string[]): { code: number; out: string; err: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      FLINT_APP_DATA: appData,
      FLINT_NO_START: '1',
      FLINT_AGENT: 'Script',
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}
const file = (name: string): Promise<string> => readFile(join(flint, name), 'utf8');
const json = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8').catch(() => '{}')) as Record<string, unknown>;
const agentState = (): Promise<Record<string, unknown>> => json(join(appData, 'agent-state.json'));
const settingsFile = (): Promise<Record<string, unknown>> => json(join(appData, 'settings.json'));
/** AGENT-06: the IDs `.flint/agents.json` holds hidden. */
const hiddenIds = async (): Promise<string[]> =>
  Object.keys((await json(join(flint, '.flint', 'agents.json')))['hidden'] ?? {});
const nav = (name: string): ReturnType<Page['locator']> =>
  main.locator('.sidebar .nav', { hasText: name }).first();
const section = (): ReturnType<Page['locator']> => main.locator('#settings-agents');
const status = (): ReturnType<Page['locator']> => section().locator('.agent-status-text');

async function openAgentsSettings(): Promise<void> {
  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  await main.locator('.settings-index-item', { hasText: 'AI agents' }).click();
  await expect(section()).toBeInViewport();
}

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-agents-settings-'));
  flint = join(dataDirectory, 'Flint');
  appData = join(dataDirectory, 'appdata');
  await mkdir(join(flint, '.flint'), { recursive: true });
  await mkdir(appData, { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
  await writeFile(
    join(flint, 'Unicorn.md'),
    '---\nflint: 1\nid: unicorn\nmode: tasks\n---\n- [ ] Review the PR [id:: t1]\n- [ ] Write the notes [id:: t2]\n',
  );
  await writeFile(
    join(flint, 'Groceries.md'),
    '---\nflint: 1\nid: groceries\nmode: tasks\n---\n- [ ] Milk [id:: g1]\n',
  );
  await writeFile(
    join(flint, '.flint', 'sidebar.json'),
    JSON.stringify({
      flint: 1,
      items: [{ list: 'unicorn' }, { group: 'personal', name: 'Personal', lists: ['groceries'] }],
    }),
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
    window.setBounds({ x: -6000, y: 0, width: 1700, height: 1000 });
    window.showInactive();
  });
  await expect(nav('Unicorn')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('Settings → AI agents: the switches through to agent-state.json, read-only and limits (AGENT-05)', async () => {
  await openAgentsSettings();
  // Its place in the index: after Claude, before Data (D-186).
  await expect(main.locator('.settings-index-item')).toContainText(['Claude', 'AI agents', 'Data']);
  // Off at first; nothing hidden or dimmed, the empty lists say so.
  await expect(status()).toHaveText('Off');
  await expect(section().locator('.agent-status')).toHaveAttribute('data-tone', 'off');
  await expect(section().getByText('Nothing is hidden.')).toBeVisible();
  await expect(section().getByText('No agent changes yet.')).toBeVisible();
  await expect(section().locator('.settings-row.dim')).toHaveCount(0);

  const agentsSwitch = section().getByRole('switch', { name: 'AI agents' });
  await agentsSwitch.click();
  await expect(agentsSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(status()).toHaveText('On · No app connected yet');
  await expect.poll(async () => (await agentState())['on']).toBe(true);

  // Read-only: the status says so (accent dot), Limits dims with its reason.
  const readOnly = section().getByRole('switch', { name: 'Read-only for agents' });
  await readOnly.click();
  await expect(status()).toHaveText(
    'On, read-only: agents can only find and read · No app connected yet',
  );
  await expect(section().locator('.agent-status')).toHaveAttribute('data-tone', 'ro');
  const limitsRow = section().locator('#settings-agents-limits');
  await expect(limitsRow).toHaveClass(/dim/);
  await expect(limitsRow).toContainText('Read-only: agents change nothing, so limits don’t apply.');
  await expect.poll(async () => (await agentState())['readOnly']).toBe(true);
  await readOnly.click();
  await expect(limitsRow).not.toHaveClass(/dim/);
  await expect.poll(async () => (await agentState())['readOnly']).toBe(false);

  // Limits: the numbers on hover; a level is saved at once.
  const levels = limitsRow.getByRole('radiogroup', { name: 'Limits' });
  await expect(levels.getByRole('radio', { name: 'Medium' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await levels.getByRole('radio', { name: 'High' }).hover();
  await expect(limitsRow.locator('.limit-tip')).toContainText('2,000');
  await expect(limitsRow.locator('.limit-tip')).toContainText('changes, all agents');
  await levels.getByRole('radio', { name: 'Low' }).click();
  await expect(levels.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await settingsFile())['agentsLimits']).toBe('low');
  await levels.getByRole('radio', { name: 'Medium' }).click();
  await expect.poll(async () => (await settingsFile())['agentsLimits']).toBe('medium');

  // Paused by hand (the palette), then Resume beside the switch.
  await main.keyboard.press('Control+k');
  await main.keyboard.type('pause agent');
  await main.locator('.palette-item', { hasText: 'Pause agent changes' }).click();
  await expect(section().locator('.agent-status')).toHaveAttribute('data-tone', 'paused');
  await section().getByRole('button', { name: 'Resume' }).click();
  await expect(status()).toHaveText('On · No app connected yet');
  await expect(section().getByRole('button', { name: 'Resume' })).toHaveCount(0);
});

test('Connect an app and the skill: Copy command, Add to Claude Desktop, Save for claude.ai (AGENT-03, AGENT-04)', async () => {
  const command = section().locator('.agents-command-line');
  // The development build's own name and path (D-33); an installed one's is `flint -- "…flint.exe"`.
  await expect(command).toHaveText(/^> claude mcp add --scope user flint(-dev)? -- .+mcp"?( |$)/);
  const claudeCode = section().locator('.agents-client', { hasText: 'Claude Code' });
  // D-93: the copy reaches the clipboard, so it is saved first and put back after.
  await app.evaluate(() =>
    (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E.saveClipboard?.(),
  );
  try {
    await claudeCode.getByRole('button', { name: 'Copy command' }).click();
    await expect(section().locator('.agents-said', { hasText: 'Copied' })).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(`> ${copied}`).toBe(await command.innerText());
  } finally {
    await app.evaluate(() =>
      (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E.restoreClipboard?.(),
    );
  }

  await section().getByRole('button', { name: 'Add to Claude Desktop' }).click();
  await expect(
    section().locator('.agents-said', { hasText: 'Claude Desktop asks to install it' }),
  ).toBeVisible();
  expect(
    (
      await app.evaluate(() => (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E.opened)
    ).at(-1),
  ).toMatch(/\.mcpb$/);

  const zip = join(dataDirectory, 'flint-skill.zip');
  await app.evaluate((_electron, path) => {
    (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E.saveSkillTo = path;
  }, zip);
  await section().getByRole('button', { name: 'Save for claude.ai…' }).click();
  await expect(section().locator('#settings-agents-skill .agents-said')).toContainText('Saved.');
  expect((await stat(zip)).size).toBeGreaterThan(0);
});

test('Hidden from agents: the menu, the header line, Settings’ list, never a sidebar mark (AGENT-06)', async () => {
  await nav('Unicorn').click();
  const header = main.locator('.list-header');
  await expect(header.locator('h1')).toContainText('Unicorn');
  await nav('Unicorn').click({ button: 'right' });
  const item = main.locator('.fl-menu [aria-checked]', { hasText: 'Hidden from agents' });
  await expect(item).toHaveAttribute('aria-checked', 'false');
  await item.click();
  await expect(header.locator('.agents-header-line')).toHaveText('Hidden from agents');
  await expect.poll(hiddenIds).toContain('unicorn');
  await nav('Unicorn').click({ button: 'right' });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await main.keyboard.press('Escape');

  // A hidden group hides its lists: their header says so too.
  await main.locator('.nav-group-head', { hasText: 'Personal' }).click({ button: 'right' });
  await item.click();
  await nav('Groceries').click();
  await expect(header.locator('h1')).toContainText('Groceries');
  await expect(header.locator('.agents-header-line')).toHaveText('Hidden from agents');
  // No mark in the sidebar (D-163's rule).
  await expect(main.locator('.sidebar')).not.toContainText('Hidden');

  // Settings lists them; Show to agents folds one away.
  await openAgentsSettings();
  const hidden = section().locator('ul[aria-label="Hidden from agents"] .agents-hidden');
  await expect(hidden).toHaveCount(2);
  await expect(hidden.filter({ hasText: 'Personal' })).toContainText('group');
  await hidden
    .filter({ hasText: 'Personal' })
    .getByRole('button', { name: 'Show to agents' })
    .click();
  await expect(hidden).toHaveCount(1);
  await expect(hidden).toContainText('Unicorn');
  await nav('Groceries').click();
  await expect(header.locator('h1')).toContainText('Groceries');
  await expect(header.locator('.agents-header-line')).toHaveCount(0);

  // The palette's command for the open list (D-106).
  await nav('Unicorn').click();
  await main.keyboard.press('Control+k');
  await main.keyboard.type('unicorn to agents');
  await main.locator('.palette-item', { hasText: 'Show "Unicorn" to agents' }).click();
  await expect(header.locator('.agents-header-line')).toHaveCount(0);
  await expect.poll(hiddenIds).not.toContain('unicorn');
});

test('an agent’s change flashes its row, never moving anything; undone from Recent agent changes, with Undo (AGENT-07)', async () => {
  await nav('Unicorn').click();
  const row = main.locator('.row[data-key="t2"]');
  await expect(row).toBeVisible();
  await row.click();
  await expect(main.locator('.row.sel')).toHaveCount(1);
  // Every row that gets the flash, recorded as it happens.
  await main.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { flashed: string[] }).flashed = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (target.classList.contains('fl-flash') && target.dataset['key'])
          seen.push(target.dataset['key']);
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  });
  const edited = flintCommand(['task', 'edit', 't1', '--priority', 'high']);
  expect(edited.code, edited.err || edited.out).toBe(0);
  await expect.poll(() => file('Unicorn.md')).toContain('Review the PR [priority:: high]');
  await expect
    .poll(() => main.evaluate(() => (window as unknown as { flashed: string[] }).flashed))
    .toContain('t1');
  // The selection, the open list and the focus stayed.
  await expect(main.locator('.row.sel[data-key="t2"]')).toHaveCount(1);
  await expect(main.locator('.list-header h1')).toContainText('Unicorn');

  // Recent agent changes: who, what, when (the test clock: today, so a time).
  await openAgentsSettings();
  const change = section().locator('.agents-change').first();
  await expect(change.locator('.agents-change-who')).toHaveText('Script');
  await expect(change.locator('.agents-change-when')).toHaveText(/^\d\d:\d\d$/);
  await change.getByRole('button', { name: 'Undo' }).click();
  const toast = main.locator('.toast', { hasText: 'Undone' });
  await expect(toast).toBeVisible();
  await expect(change.locator('.agents-undone')).toHaveText('Undone');
  await expect.poll(() => file('Unicorn.md')).not.toContain('[priority:: high]');
  // The toast's Undo is the window's Ctrl+Z: the agent's change comes back.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => file('Unicorn.md')).toContain('Review the PR [priority:: high]');
});

test('the shortcuts sheet: Capture’s link, Settings’ search, recording a hotkey, Esc (D-186)', async () => {
  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  // Capture & hotkeys is Capture now; its hotkey rows are one link row.
  await expect(main.locator('.settings-index-item', { hasText: /^Capture$/ })).toHaveCount(1);
  const capture = main.locator('#settings-capture');
  await expect(capture.locator('.settings-row', { hasText: 'Hotkeys' })).toContainText(
    'View and change shortcuts…',
  );
  await expect(capture.locator('.hotkey-record')).toHaveCount(0);
  await expect(main.locator('#settings-shortcuts .settings-row')).toHaveCount(1);
  await expect(main.locator('#settings-shortcuts')).toContainText('All shortcuts');

  // The search shows both link rows; a click opens the sheet filtered by it.
  await main.locator('.settings-find').fill('hotkey');
  await expect(main.locator('#settings-hotkeys')).toBeVisible();
  await expect(main.locator('#settings-all-shortcuts')).toBeVisible();
  await expect(main.locator('#settings-agents')).toHaveCount(0);
  await main
    .locator('#settings-shortcuts')
    .getByRole('button', { name: 'View and change shortcuts…' })
    .click();
  const sheet = main.locator('.cheat-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.palette-field')).toHaveValue('hotkey');
  const anywhere = sheet.locator('.cheat-group[aria-label="Anywhere in Windows"]');
  await expect(anywhere).toContainText('Click a key to change it');
  await expect(anywhere).not.toContainText('(changeable)');
  await expect(sheet.locator('.cheat-group')).toHaveCount(1);

  // Recording: Esc cancels (the sheet stays), the rules and D-102's messages as they were.
  const quick = anywhere
    .locator('.cheat-row', { hasText: 'Quick capture' })
    .locator('.hotkey-record');
  const keys = await quick.innerText();
  await quick.click();
  await expect(quick).toHaveText('Press the new keys…');
  // What the try said: the line right under its row (another app may hold the other hotkeys).
  const said = anywhere.locator('.cheat-row:has-text("Quick capture") + .cheat-said');
  await expect(said).toHaveText('Esc cancels.');
  await main.keyboard.press('Escape');
  await expect(quick).toHaveText(keys);
  await expect(sheet).toBeVisible();
  await quick.click();
  await main.keyboard.press('Shift+K');
  await expect(said).toHaveText('Use Ctrl, Alt or Win together with a key.');
  await quick.click();
  await main.keyboard.press('Control+Shift+F9');
  await expect(said).toHaveText('Saved: Ctrl+Shift+F9 opens the capture popup.');
  await expect(quick).toHaveText('Ctrl+Shift+F9');
  await expect.poll(async () => (await settingsFile())['captureHotkey']).toBe('Control+Shift+F9');
  // Esc, not recording, closes the sheet.
  await main.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await main.locator('.settings-find').fill('');
});

test('nothing goes to the network (APP-09)', async () => {
  expect(
    (await app.evaluate(() => (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E))
      .blockedRequests,
  ).toEqual([]);
});
