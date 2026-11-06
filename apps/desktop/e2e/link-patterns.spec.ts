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
 * NOTE-07, D-84, D-111: a custom link pattern that is already in the settings when Flint starts
 * (as on Davit's machine) links its short form and its full URL in a task's title, in a task's
 * notes and in a note. Its own Flint on the suite's fixed clock (D-107), off-screen, never focused.
 */
test.describe.configure({ mode: 'serial' });

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const URL = 'https://tracker.example.com/browse/DEV-117';

let dataDirectory: string;
let app: ElectronApplication;
let main: Page;

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-links-'));
  const flint = join(dataDirectory, 'Flint');
  await mkdir(flint, { recursive: true });
  await mkdir(join(dataDirectory, 'appdata'), { recursive: true });
  await writeFile(
    join(dataDirectory, 'appdata', 'settings.json'),
    JSON.stringify({
      linkPatterns: [
        {
          short: 'DEV-{id}',
          url: 'https://tracker.example.com/browse/DEV-{id}',
          kinds: { id: 'digits' },
        },
        {
          short: '{id}-repo',
          url: 'https://dev.azure.com/acme/web/_git/{id}',
          kinds: { id: 'word' },
          examples: [
            { url: 'https://dev.azure.com/acme/web/_git/platform', short: 'platform-repo' },
            { url: 'https://dev.azure.com/acme/web/_git/web-api', short: 'web-api-repo' },
          ],
        },
        {
          // D-111: two parts that change, fixed text between them.
          short: '{name}-PR-{id}',
          url: 'https://dev.azure.com/acme/web/_git/{name}/pullrequest/{id}',
          kinds: { name: 'word', id: 'digits' },
        },
        {
          short: 'de:{id}',
          url: 'https://share.example.com/{id}',
          kinds: { id: 'word' },
          examples: [{ url: 'https://share.example.com/Sa4Uc5SdhEju', short: 'de:Sa4Uc5SdhEju' }],
        },
      ],
    }),
  );
  await writeFile(
    join(flint, 'Work.md'),
    [
      '---\nflint: 1\nid: work\nmode: tasks\n---',
      '- [ ] check DEV-123 today [id:: lk1]',
      `    see ${URL} in the notes`,
      '- [ ] review https://dev.azure.com/acme/web/_git/platform and de:Sa4Uc5SdhEju [id:: lk2]',
      '- [ ] fix backend web-api-repo [pinned:: true] [id:: lk3]',
      '- [ ] merge web-api-PR-45 then https://dev.azure.com/acme/web/_git/platform/pullrequest/12 [id:: lk4]',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(flint, 'Plan.md'),
    `---\nflint: 1\nid: plan\nmode: note\n---\nThe fix is DEV-118, and ${URL} too.\n`,
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
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('a custom link pattern from the settings links in a task title, its notes and a note (NOTE-07, D-111)', async () => {
  await main.locator('.nav', { hasText: 'Work' }).click();
  const row = main.locator('.row', { hasText: 'check' });
  // The title: the short form is a link to its URL.
  const titleLink = row.locator('.title.md a');
  await expect(titleLink).toHaveText('DEV-123');
  await expect(titleLink).toHaveAttribute('href', 'https://tracker.example.com/browse/DEV-123');
  const second = main.locator('.row', { hasText: 'review' }).locator('.title.md a');
  await expect(second).toHaveText(['platform-repo', 'de:Sa4Uc5SdhEju']);
  // A short form typed into a title, its placeholder a hyphenated word.
  const typed = main.locator('.row', { hasText: 'fix backend' }).locator('.title.md a');
  await expect(typed).toHaveText('web-api-repo');
  await expect(typed).toHaveAttribute('href', 'https://dev.azure.com/acme/web/_git/web-api');
  // D-111: a pattern with two changing parts, typed and as a full link.
  const pr = main.locator('.row', { hasText: 'merge' }).locator('.title.md a');
  await expect(pr).toHaveText(['web-api-PR-45', 'platform-PR-12']);
  await expect(pr.first()).toHaveAttribute(
    'href',
    'https://dev.azure.com/acme/web/_git/web-api/pullrequest/45',
  );
  // The task's notes: the full URL shows as its short form.
  await row.locator('.body-toggle').click();
  const notesLink = main.locator('.row-body a', { hasText: 'DEV-117' });
  await expect(notesLink).toHaveCount(1);
  // A note: the short form and the URL both link.
  await main.locator('.nav', { hasText: 'Plan' }).click();
  const note = main.locator('.note-editor .cm-content');
  await expect(note).toBeVisible();
  await expect(note.locator('a, .cm-fl-link, [data-href]', { hasText: 'DEV-118' })).toHaveCount(1);
  await expect(note.locator('a, .cm-fl-link, [data-href]', { hasText: 'DEV-117' })).toHaveCount(1);
});
