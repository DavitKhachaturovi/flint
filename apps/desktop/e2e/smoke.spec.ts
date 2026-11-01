import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/**
 * Smoke test (docs/05 §6): the app starts, its windows exist, a capture reaches the main process,
 * and it makes no network requests at all (APP-09).
 *
 * The no-network check is strict and layered (verified with a deliberate request per layer):
 * 1. the app records every request it attempts and refuses it: Chromium requests from any session
 *    (renderers, Electron net), and every Node-level connection or DNS lookup in the main process
 *    (fetch, http, https, tls, any library), instrumented in test mode;
 * 2. Chromium's whole network stack is pointed at a recording proxy here, so a request that bypasses
 *    the request filter is still seen;
 * 3. TCP connections owned by Flint processes are polled from the OS as a coarse extra check (it can
 *    miss short-lived connections, which layer 1 cannot). Only Playwright's own channel is exempt.
 * Renderers are also limited by their Content Security Policy, which stops requests even earlier.
 *
 * A future network feature (e.g. auto-update, APP-06) must add exactly its own endpoint to
 * ALLOWED_ENDPOINTS, with a decision-log entry, never loosen these checks (D-31).
 */
const ALLOWED_ENDPOINTS: readonly string[] = [];

const appDirectory = join(import.meta.dirname, '..');
const electronPath = execFileSync(process.execPath, ['-p', "require('electron')"], {
  cwd: appDirectory,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
}).trim();

interface Connection {
  readonly local: string;
  readonly remote: string;
  readonly state: string;
  readonly pid: number;
}

function tcpConnections(): Connection[] {
  const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[0] === 'TCP' && parts.length >= 5)
    .map(([, local = '', remote = '', state = '', pid = '0']) => ({
      local,
      remote,
      state,
      pid: Number(pid),
    }));
}

/** PIDs of the Flint processes: the main process and every Electron child using the test's data. */
function flintPids(mainPid: number, dataDirectory: string): Set<number> {
  const output = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
    ],
    { encoding: 'utf8' },
  );
  const pids = new Set([mainPid]);
  for (const line of output.split(/\r?\n/)) {
    const [pid, commandLine = ''] = line.split('\t');
    if (pid && commandLine.includes(dataDirectory)) pids.add(Number(pid));
  }
  return pids;
}

/**
 * What a run could change on the machine: the flint:// and flint-dev:// handlers (toast buttons,
 * D-33) and the development Start Menu shortcut. A test run must leave them alone.
 */
function machineState(): string {
  const handler = (scheme: string): string => {
    try {
      return execFileSync(
        'reg',
        [
          'query',
          ['HKCU', 'Software', 'Classes', scheme, 'shell', 'open', 'command'].join('\\'),
          '/ve',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch {
      return 'none';
    }
  };
  const shortcut = join(
    process.env.APPDATA ?? '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Flint (development).lnk',
  );
  const stamp = statSync(shortcut, { throwIfNoEntry: false })?.mtimeMs ?? 'none';
  return `flint:// ${handler('flint')}; flint-dev:// ${handler('flint-dev')}; development shortcut ${String(stamp)}`;
}

const port = (address: string): string => address.slice(address.lastIndexOf(':') + 1);
const isLoopback = (address: string): boolean => /^(127\.|\[::1\])/.test(address);

let dataDirectory: string;
let machineBefore: string;
let proxy: Server;
const proxied: string[] = [];
let app: ElectronApplication;
const violations = new Set<string>();
let poller: NodeJS.Timeout | undefined;

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-'));
  machineBefore = machineState();
  proxy = createServer((request, response) => {
    proxied.push(`${request.method} ${request.url}`);
    response.destroy();
  });
  proxy.on('connect', (request, socket) => {
    proxied.push(`CONNECT ${request.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = (proxy.address() as AddressInfo).port;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  app = await electron.launch({
    executablePath: electronPath,
    args: [
      appDirectory,
      '--hidden',
      `--proxy-server=http://127.0.0.1:${proxyPort}`,
      // Loopback through the proxy too: nothing may skip the recorder.
      '--proxy-bypass-list=<-loopback>',
    ],
    env: { ...env, FLINT_E2E: '1', FLINT_DATA_DIR: dataDirectory },
  });
  const mainPid = app.process().pid ?? 0;
  let pids = flintPids(mainPid, dataDirectory);
  let ticks = 0;
  poller = setInterval(() => {
    if (++ticks % 5 === 0) pids = flintPids(mainPid, dataDirectory);
    const connections = tcpConnections();
    // Playwright's channel: a loopback connection to a port the test runner itself holds.
    const runnerPorts = new Set(
      connections
        .filter((connection) => connection.pid === process.pid)
        .map((connection) => port(connection.local)),
    );
    for (const connection of connections) {
      if (!pids.has(connection.pid) || connection.state === 'LISTENING') continue;
      if (isLoopback(connection.remote) && runnerPorts.has(port(connection.remote))) continue;
      if (ALLOWED_ENDPOINTS.includes(connection.remote)) continue;
      violations.add(
        `${connection.local} -> ${connection.remote} (${connection.state}, pid ${connection.pid})`,
      );
    }
  }, 200);
});

test.afterAll(async () => {
  clearInterval(poller);
  await app?.close();
  proxy?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('starts with the main window and the pre-warmed capture popup, hidden', async () => {
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .map((window) => window.getTitle())
          .sort(),
      ),
    )
    .toEqual(['Flint', 'Flint capture']);
  const visible = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length,
  );
  expect(visible).toBe(0);
});

test('creates the Flint folder with Inbox', async () => {
  await expect
    .poll(() => readFile(join(dataDirectory, 'Flint', 'Inbox.md'), 'utf8').catch(() => ''))
    .toBe('---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
});

test('a capture typed in the popup is saved at the top of Inbox on Enter (CAP-02, D-27)', async () => {
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  // Playwright may see the window before its page has reached app://flint/capture-popup.
  const popupPage = () => app.windows().find((page) => page.url().includes('capture-popup'));
  await expect.poll(() => popupPage() !== undefined, { timeout: 15_000 }).toBe(true);
  const popup = popupPage();
  if (!popup) throw new Error('capture popup page not found');
  await popup.locator('#capture').fill('check the e2e capture !h');
  await popup.locator('#capture').press('Enter');
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as { __flintE2E?: { captured: string[] } }).__flintE2E?.captured ?? [],
      ),
    )
    .toEqual(['check the e2e capture !h']);
  await expect(popup.locator('#capture')).toHaveValue('');
  expect(await readFile(join(dataDirectory, 'Flint', 'Inbox.md'), 'utf8')).toMatch(
    /^---\nflint: 1\nid: inbox\nmode: tasks\n---\n- \[ \] check the e2e capture \[priority:: high\] \[id:: [a-z0-9]{4,6}\]\n$/,
  );
});

test('shorthand chips, the ## menu and the close-match card (CAP-04, CAP-05, D-25)', async () => {
  // A list added outside Flint is picked up by the watcher (DATA-06).
  await writeFile(
    join(dataDirectory, 'Flint', 'Unicorn.md'),
    '---\nflint: 1\nid: uni1\nmode: tasks\n---\n',
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  const box = popup.locator('#capture');

  await box.fill('x ##');
  await expect(popup.locator('.suggestion').first()).toBeVisible();
  await box.press('ArrowDown');
  await expect(box).toHaveValue(/^x ##(Inbox|Unicorn)$/);
  // A click takes a suggestion like Enter does: the menu closes.
  await box.fill('x ##uni');
  await popup.locator('.suggestion', { hasText: 'Unicorn' }).click();
  await expect(box).toHaveValue('x ##Unicorn');
  await expect(popup.locator('#suggestions')).toBeHidden();
  // Esc works anywhere in the popup, e.g. after clicking the card's background (D-46).
  await popup.locator('.card').click({ position: { x: 300, y: 8 } });
  await popup.keyboard.press('Escape');
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.getTitle() === 'Flint capture')
          ?.isVisible(),
      ),
    )
    .toBe(false);
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );

  await box.fill('fix token refresh !h ##unis @tomorrow 10');
  await expect(popup.locator('.chip')).toHaveText(['High', 'Unicorn', 'Tomorrow 10:00']);
  await expect(popup.locator('.option')).toHaveText(['UnicornEnter', 'New list "unis"Tab']);
  await box.press('Tab');
  await expect(popup.locator('.option')).toHaveText(['New list "unis"Enter', 'UnicornTab']);
  await expect(popup.locator('.target-name')).toHaveText('New list "unis"');
  await box.press('Tab');
  // D-40: the first Enter accepts the close match (the token takes its spelling), the next saves.
  await box.press('Enter');
  await expect(box).toHaveValue('fix token refresh !h ##Unicorn @tomorrow 10');
  await expect(popup.locator('.choice')).toBeHidden();
  await box.press('Enter');
  await expect
    .poll(() => readFile(join(dataDirectory, 'Flint', 'Unicorn.md'), 'utf8'))
    .toMatch(/- \[ \] fix token refresh \[reminder:: \d{4}-\d\d-\d\dT10:00\] \[priority:: high\]/);
});

test('paste-to-capture: stack trace to the selection area, screenshot to attachments (CAP-06, D-38)', async () => {
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  const box = popup.locator('#capture');
  const trace =
    'System.NullReferenceException: Object reference not set\n   at A.B() in C:\\a.cs:line 1\n   at C.D() in C:\\c.cs:line 2';
  // A 1x1 PNG.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await box.fill('');
  await popup.evaluate(
    ([text, image]) => {
      const area = document.querySelector('#capture');
      const paste = (data: DataTransfer): void => {
        area?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      };
      const textData = new DataTransfer();
      textData.setData('text/plain', text);
      paste(textData);
      const bytes = Uint8Array.from(atob(image), (char) => char.charCodeAt(0));
      const imageData = new DataTransfer();
      imageData.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
      paste(imageData);
    },
    [trace, png] as const,
  );
  // D-38, D-45: the task line stays empty; the trace is a compact block below it.
  await expect(box).toHaveValue('');
  await expect(box).toHaveAttribute('placeholder', 'Capture a task…');
  await expect(popup.locator('.block-label')).toHaveText(['Stack trace · 3 lines']);
  await expect(popup.locator('.chip')).toHaveText(['screenshot.png']);
  // Shorthand still works in the title with code in the selection area (the R-2 JSON finding).
  await box.fill('!h');
  await expect(popup.locator('.chip')).toHaveText(['High', 'screenshot.png']);
  await box.press('Enter');
  const inbox = (): Promise<string> => readFile(join(dataDirectory, 'Flint', 'Inbox.md'), 'utf8');
  await expect
    .poll(inbox)
    .toMatch(
      /- \[ \] \[priority:: high\] \[id:: \w+\]\n {4}```\n {4}System\.NullReferenceException/,
    );
  const text = await inbox();
  const link = /!\[\]\((attachments\/[\w-]+\.png)\)/.exec(text)?.[1];
  if (!link) throw new Error(`no attachment link in:\n${text}`);
  expect((await readFile(join(dataDirectory, 'Flint', link))).length).toBeGreaterThan(60);
});

test('pasted or selected text is never shorthand; typed text is (D-45, CAP-03)', async () => {
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  const box = popup.locator('#capture');
  await box.fill('');
  const message = 'deploy hotfix @15:00, see ##infra !l';
  await popup.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document
      .querySelector('#capture')
      ?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, message);
  await expect(box).toHaveValue(message);
  await expect(popup.locator('.chip')).toHaveCount(0);
  // Editing inside the pasted text keeps it plain text.
  await box.press('Home');
  for (let step = 0; step < 6; step++) await box.press('ArrowRight');
  await box.pressSequentially(' the');
  await expect(box).toHaveValue('deploy the hotfix @15:00, see ##infra !l');
  await expect(popup.locator('.chip')).toHaveCount(0);
  // Typed after it: live.
  await box.press('End');
  await box.pressSequentially(' !h');
  await expect(popup.locator('.chip')).toHaveText(['High']);
  await box.press('Enter');
  await expect
    .poll(() => readFile(join(dataDirectory, 'Flint', 'Inbox.md'), 'utf8'))
    .toContain('- [ ] deploy the hotfix @15:00, see ##infra !l [priority:: high] [id:: ');
});

test('rebinding a hotkey in the Hotkeys window (APP-08)', async () => {
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showHotkeys?: () => void } }).__flintE2E?.showHotkeys?.(),
  );
  const page = () => app.windows().find((window) => window.url().includes('/hotkeys/'));
  await expect.poll(() => page() !== undefined, { timeout: 15_000 }).toBe(true);
  const hotkeys = page();
  if (!hotkeys) throw new Error('hotkeys page not found');
  const capture = hotkeys.locator('.row[data-name="capture"] .record');
  await expect(capture).toHaveText('Ctrl+Shift+Space');
  await capture.click();
  await expect(capture).toHaveText('Press the new keys…');
  await hotkeys.keyboard.press('Shift+K');
  await expect(hotkeys.locator('.message')).toHaveText('Use Ctrl, Alt or Win together with a key.');
  await capture.click();
  await hotkeys.keyboard.press('Control+Shift+F9');
  await expect(hotkeys.locator('.message')).toHaveText(
    'Saved: Ctrl+Shift+F9 opens the capture popup.',
  );
  await expect(capture).toHaveText('Ctrl+Shift+F9');
  await expect
    .poll(() => readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8').catch(() => ''))
    .toContain('"captureHotkey": "Control+Shift+F9"');
});

test('main window: a list from the sidebar, complete with Space, undo with Ctrl+Z (TASK-06, D-48)', async () => {
  const file = join(dataDirectory, 'Flint', 'Errands.md');
  const original =
    '---\nflint: 1\nid: err1\nmode: tasks\n---\n- [ ] Renew the parking permit [priority:: medium] [id:: e1]\n- [ ] Book the dentist [id:: e2]\n';
  await writeFile(file, original);
  const mainPage = () => app.windows().find((page) => page.url().includes('main-window'));
  await expect.poll(() => mainPage() !== undefined, { timeout: 15_000 }).toBe(true);
  const main = mainPage();
  if (!main) throw new Error('main window page not found');
  // A window that was never shown doesn't render, which makes every click wait for its stability
  // check. So the main window is shown for the tests, but off-screen, without the focus and without
  // a taskbar button: nothing appears on the desktop (Davit's machine runs these).
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => candidate.getTitle() === 'Flint',
    );
    if (!window) return;
    window.setSkipTaskbar(true);
    window.setBounds({ x: -6000, y: 0, width: 1120, height: 780 });
    window.showInactive();
  });

  // D-79: motion must not silently disappear. Animation and transition events are recorded, and
  // the list switch must play the page's arrival and the sidebar highlight's glide to their ends.
  await main.evaluate(() => {
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
  const motion = (): Promise<string[]> =>
    main.evaluate(() => [...(window as unknown as { motion: string[] }).motion]);
  const resetMotion = (): Promise<unknown> =>
    main.evaluate(() => (window as unknown as { motion: string[] }).motion.splice(0));

  // The watcher picks the new list up.
  await main.locator('.nav', { hasText: 'Errands' }).click();
  await expect(main.locator('h1')).toHaveText('Errands · 2 open');
  await expect
    .poll(motion)
    .toEqual(
      expect.arrayContaining(['animationend content view-in', 'transitionend nav-glide transform']),
    );
  expect(await motion()).not.toContain('transitioncancel nav-glide transform');
  // D-77: nothing is selected when a list opens; the first ↓ selects the first row.
  await expect(main.locator('.row.sel')).toHaveCount(0);
  await main.keyboard.press('ArrowDown');
  await expect(main.locator('.row.sel .title')).toHaveText('Renew the parking permit');
  // The row highlight glides to the next row and gets there.
  await resetMotion();
  await main.keyboard.press('ArrowDown');
  await expect.poll(motion).toEqual(expect.arrayContaining(['transitionend sel-glide transform']));
  await main.keyboard.press('ArrowUp');

  // D-75: the task is completed at once; a ghost of its row plays out where it was. Ghosts live
  // for a moment only, so a MutationObserver records the ones that appear.
  await main.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { ghosts: string[] }).ghosts = seen;
    new MutationObserver(() => {
      for (const ghost of document.querySelectorAll('.row.leaving'))
        seen.push(
          `${ghost.closest('.completed') ? 'completed' : 'tasks'} ${ghost.className} ${ghost.querySelector('.title')?.textContent ?? ''}`,
        );
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const ghosts = (): Promise<string[]> =>
    main.evaluate(() => (window as unknown as { ghosts: string[] }).ghosts.splice(0));
  await main.keyboard.press('Space');
  await expect(main.locator('h1')).toHaveText('Errands · 1 open');
  await expect
    .poll(async () =>
      (await ghosts()).some((ghost) => /^tasks .*complete Renew the parking permit$/.test(ghost)),
    )
    .toBe(true);
  await expect(main.locator('.row.leaving')).toHaveCount(0);
  await expect(main.locator('.toast')).toContainText('Completed');
  await expect(main.locator('.completed .row .title')).toHaveText(['Renew the parking permit']);
  expect(await readFile(file, 'utf8')).toMatch(
    /^- \[ \] Book the dentist \[id:: e2\]\n\n## Completed\n- \[x\] Renew the parking permit \[completion:: [0-9T:-]+\] \[priority:: medium\] \[id:: e1\]\n$/m,
  );

  // Undo reopens it the same way (D-69, D-75).
  await ghosts();
  await main.keyboard.press('Control+z');
  await expect(main.locator('h1')).toHaveText('Errands · 2 open');
  await expect
    .poll(async () =>
      (await ghosts()).some((ghost) => /^completed .*reopen Renew the parking permit$/.test(ghost)),
    )
    .toBe(true);
  await expect.poll(() => readFile(file, 'utf8')).toBe(original);
});

test('main window: composer, priority keys, Edit-state Enter, Tab, undo and redo (TASK-02..04, docs/03 §2)', async () => {
  const file = join(dataDirectory, 'Flint', 'Errands.md');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const titles = main.locator('.tasks .row .title');

  // Ctrl+N: the composer; typed shorthand shows as a chip and applies.
  await main.keyboard.press('Control+n');
  await expect(main.locator('.composer-input')).toBeFocused();
  await main.keyboard.type('Water the plants !h');
  await expect(main.locator('.composer-chips .chip')).toHaveText(['High']);
  await main.keyboard.press('Enter');
  await expect(main.locator('h1')).toHaveText('Errands · 3 open');
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(
      /---\n- \[ \] Water the plants \[priority:: high\] \[id:: [a-z0-9]{4,6}\]\n- \[ \] Renew/,
    );
  await main.keyboard.press('Escape');
  await expect(main.locator('.row.sel .title')).toHaveText('Water the plants');

  // Navigate: 1 sets low priority.
  await main.keyboard.press('1');
  await expect.poll(() => readFile(file, 'utf8')).toContain('Water the plants [priority:: low]');

  // Enter edits; Enter again saves and opens a new row below; Esc on an empty row leaves it.
  await main.keyboard.press('Enter');
  await expect(main.locator('.title-input')).toHaveValue('Water the plants');
  await main.keyboard.press('End');
  await main.keyboard.type(' twice');
  await main.keyboard.press('Enter');
  await expect(main.locator('.title-input')).toHaveAttribute('placeholder', 'New task');
  await main.keyboard.type('Buy soil');
  await main.keyboard.press('Enter');
  await expect(titles).toHaveText([
    'Water the plants twice',
    'Buy soil',
    'Renew the parking permit',
    'Book the dentist',
  ]);
  await main.keyboard.press('Escape');
  await expect(main.locator('.title-input')).toHaveCount(0);
  await expect(main.locator('.row.sel .title')).toHaveText('Buy soil');

  // Tab nests it under the task above; undo and redo.
  await main.keyboard.press('Tab');
  await expect(main.locator('.row.subtask .title')).toHaveText(['Buy soil']);
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(/Water the plants twice \[priority:: low\] \[id:: \w+\]\n +- \[ \] Buy soil/);
  await main.keyboard.press('Control+z');
  await expect(main.locator('.row.subtask')).toHaveCount(0);
  await main.keyboard.press('Control+Shift+z');
  await expect(main.locator('.row.subtask .title')).toHaveText(['Buy soil']);

  // Typing straight on after Enter, faster than the saves: nothing is lost, the order holds.
  await main.locator('.row', { hasText: 'Book the dentist' }).click();
  await main.keyboard.press('Enter');
  await main.keyboard.press('End');
  await main.keyboard.type('\nRake the leaves\nMow the lawn\nFix the gate\n', { delay: 0 });
  await main.keyboard.press('Escape');
  await expect(titles).toHaveText([
    'Water the plants twice',
    'Buy soil',
    'Renew the parking permit',
    'Book the dentist',
    'Rake the leaves',
    'Mow the lawn',
    'Fix the gate',
  ]);
  await expect(main.locator('.row.sel .title')).toHaveText('Fix the gate');

  // D-71: a click on the title text edits with the caret there; beside the text only selects;
  // a double-click anywhere edits; Esc goes back to the selected row.
  const field = main.locator('.title-input');
  const caret = (): Promise<number | null> =>
    field.evaluate((input: HTMLInputElement) => input.selectionStart);
  const lawn = main.locator('.row', { hasText: 'Mow the lawn' });
  const lawnText = await lawn.locator('.title').evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    const rect = range.getBoundingClientRect();
    return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
  });
  await main.mouse.click(lawnText.left + 1, lawnText.y);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Mow the lawn');
  expect(await caret()).toBe(0);
  await expect(main.locator('.row.editing')).toHaveClass(/\bsel\b/);
  await main.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await main.mouse.click(lawnText.right - 1, lawnText.y);
  expect(await caret()).toBe('Mow the lawn'.length);
  await main.keyboard.press('Escape');
  await main.locator('.row', { hasText: 'Fix the gate' }).click();
  await main.mouse.click(lawnText.right + 60, lawnText.y);
  await expect(field).toHaveCount(0);
  await expect(main.locator('.row.sel .title')).toHaveText('Mow the lawn');
  await main.mouse.dblclick(lawnText.right + 60, lawnText.y);
  await expect(field).toHaveValue('Mow the lawn');
  // D-78: a click on another task's blank space saves this edit and selects that task.
  await main.keyboard.press('End');
  await main.keyboard.type(' now');
  await main.locator('.row', { hasText: 'Fix the gate' }).click({ position: { x: 600, y: 10 } });
  await expect(field).toHaveCount(0);
  await expect(main.locator('.row.sel .title')).toHaveText('Fix the gate');
  await expect.poll(() => readFile(file, 'utf8')).toContain('Mow the lawn now');
});

test('menus, delete to trash, move between lists, list and note actions (M4 step 4: UI-08, TASK-11, TASK-12, LIST-01, D-64)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const menu = main.locator('.fl-menu');
  const menuItems = menu.locator('.fl-menu-item > span:first-child');
  await main.locator('.nav', { hasText: 'Errands' }).click();
  await expect(main.locator('h1')).toHaveText(/^Errands/);

  // Delete (Del): the task goes to .flint/trash, with Undo.
  await main.locator('.row', { hasText: 'Mow the lawn' }).click();
  await main.keyboard.press('Delete');
  await expect(main.locator('.toast')).toContainText('Deleted');
  await expect
    .poll(() => readFile(join(flint, 'Errands.md'), 'utf8'))
    .not.toContain('Mow the lawn');
  await expect
    .poll(async () => (await readdir(join(flint, '.flint', 'trash'))).join())
    .toMatch(/-task-[a-z0-9]+\.md/);
  await main.keyboard.press('Control+z');
  await expect.poll(() => readFile(join(flint, 'Errands.md'), 'utf8')).toContain('Mow the lawn');

  // Right-click a task: its menu; Move to… opens the list picker; a new name makes a new list.
  await main.locator('.row', { hasText: 'Fix the gate' }).click({ button: 'right' });
  await expect(menuItems).toContainText(['Edit', 'Complete', 'Priority', 'Move to…', 'Delete']);
  // D-78: Priority is a submenu.
  await menu.getByText('Priority', { exact: true }).hover();
  await expect(main.locator('.fl-submenu .fl-menu-item')).toContainText([
    'High',
    'Medium',
    'Low',
    'None',
  ]);
  // D-79: a diagonal move across the next items to the submenu keeps it open (menu aim).
  const priorityBox = await menu.getByText('Priority', { exact: true }).boundingBox();
  const lowBox = await main.locator('.fl-submenu').getByText('Low').boundingBox();
  if (!priorityBox || !lowBox) throw new Error('no menu boxes');
  await main.mouse.move(priorityBox.x + 20, priorityBox.y + priorityBox.height / 2);
  await main.mouse.move(lowBox.x + 30, lowBox.y + lowBox.height / 2, { steps: 12 });
  await expect(main.locator('.fl-submenu .fl-menu-item.active')).toHaveText(/Low/);
  await menu.getByText('Move to…').click();
  await expect(main.locator('.fl-picker .fl-picker-search')).toBeFocused();
  await main.keyboard.type('Garden');
  await expect(main.locator('.fl-picker .fl-picker-row.active')).toHaveText('New list "Garden"');
  await main.keyboard.press('Enter');
  await expect(main.locator('.toast')).toContainText('Moved to Garden');
  await expect
    .poll(() => readFile(join(flint, 'Garden.md'), 'utf8').catch(() => ''))
    .toContain('Fix the gate');
  expect(await readFile(join(flint, 'Errands.md'), 'utf8')).not.toContain('Fix the gate');

  // The + next to "Lists": a new task list, typed in place, then opened.
  await main.locator('.add-list').click();
  await menu.getByText('New task list').click();
  await main.keyboard.type('Groceries');
  await main.keyboard.press('Enter');
  await expect(main.locator('h1')).toHaveText('Groceries · 0 open');
  await expect.poll(() => readFile(join(flint, 'Groceries.md'), 'utf8')).toContain('mode: tasks');

  // Rename and delete from the list's right-click menu; Undo brings the file back.
  await main.locator('.nav', { hasText: 'Groceries' }).click({ button: 'right' });
  await menu.getByText('Rename').click();
  await main.keyboard.press('Control+a');
  await main.keyboard.type('Shopping');
  await main.keyboard.press('Enter');
  await expect(main.locator('.nav', { hasText: 'Shopping' })).toBeVisible();
  await expect
    .poll(() => readFile(join(flint, 'Shopping.md'), 'utf8').catch(() => ''))
    .toContain('mode: tasks');
  await main.locator('.nav', { hasText: 'Shopping' }).click({ button: 'right' });
  await menu.getByText('Delete list').click();
  await expect(main.locator('h1')).toHaveText(/^Inbox/);
  await expect(main.locator('.nav', { hasText: 'Shopping' })).toHaveCount(0);
  await main.locator('.toast button').click();
  await expect(main.locator('.nav', { hasText: 'Shopping' })).toBeVisible();

  // A new note, edited as plain text and saved as it is typed (D-64).
  await main.locator('.add-list').click();
  await menu.getByText('New note').click();
  await main.keyboard.type('Scratch');
  await main.keyboard.press('Enter');
  await expect(main.locator('.note-editor')).toBeVisible();
  await main.locator('.note-editor').click();
  await main.keyboard.type('# Standup\nNika: DNS');
  await expect
    .poll(() => readFile(join(flint, 'Scratch.md'), 'utf8'), { timeout: 5000 })
    .toMatch(/mode: note\n---\n# Standup\nNika: DNS$/);

  // Every text field keeps Cut / Copy / Paste / Select all, in the page (UI-08, D-64).
  await main.locator('.note-editor').click({ button: 'right' });
  await expect(menuItems).toHaveText(['Cut', 'Copy', 'Paste', 'Select all']);
  await main.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  await popup.locator('#capture').fill('menu check');
  await popup.locator('#capture').click({ button: 'right' });
  await expect(popup.locator('.fl-menu .fl-menu-item > span:first-child')).toHaveText([
    'Cut',
    'Copy',
    'Paste',
    'Select all',
  ]);
  await popup.keyboard.press('Escape');
  await expect(popup.locator('.fl-menu')).toHaveCount(0);
  await popup.locator('#capture').fill('');
  await popup.keyboard.press('Escape');
});

test('reminders fire once, missed ones say so; Done and Snooze change the task (REM-05, D-64)', async () => {
  const file = join(dataDirectory, 'Flint', 'Calls.md');
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  await writeFile(
    file,
    [
      '---\nflint: 1\nid: cal1\nmode: tasks\n---',
      `- [ ] Call the bank [reminder:: ${stamp(hourAgo)}] [id:: rem1]`,
      `- [ ] Call Alex [reminder:: ${stamp(now)}] [id:: rem2]`,
      `- [x] Old call [reminder:: ${stamp(hourAgo)}] [completion:: ${stamp(hourAgo)}] [id:: rem3]`,
      '',
    ].join('\n'),
  );
  const toasts = () =>
    app.evaluate(
      () => (globalThis as { __flintE2E?: { toasts: string[] } }).__flintE2E?.toasts ?? [],
    );
  // The watcher picks the list up and the scheduler shows what is due; the toasts are recorded.
  await expect
    .poll(toasts, { timeout: 15_000 })
    .toEqual(expect.arrayContaining([`Missed reminder | Call the bank`, `Reminder | Call Alex`]));
  const shown = (await toasts()).filter((toast) => toast.includes('Call'));
  expect(shown).toHaveLength(2);

  const activate = (url: string) =>
    app.evaluate((_electron, argument) => {
      (globalThis as { __flintE2E?: { activate?: (url: string) => void } }).__flintE2E?.activate?.(
        argument,
      );
    }, url);
  await activate('flint-dev://reminder/done?id=rem2');
  await expect.poll(() => readFile(file, 'utf8')).toMatch(/- \[x\] Call Alex \[reminder::/);
  await activate('flint-dev://reminder/snooze?id=rem1');
  await expect
    .poll(() => readFile(file, 'utf8'))
    .not.toContain(`Call the bank [reminder:: ${stamp(hourAgo)}]`);
  // Each reminder is shown once: nothing repeats after the changes.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect((await toasts()).filter((toast) => toast.includes('Call'))).toHaveLength(2);
});

test('an overdue reminder, and the bell that turns it off and on (REM-11, REM-12, D-66)', async () => {
  const file = join(dataDirectory, 'Flint', 'Calls.md');
  const pad = (value: number): string => String(value).padStart(2, '0');
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const stamp = `${hourAgo.getFullYear()}-${pad(hourAgo.getMonth() + 1)}-${pad(hourAgo.getDate())}T${pad(hourAgo.getHours())}:${pad(hourAgo.getMinutes())}`;
  await writeFile(
    file,
    `${await readFile(file, 'utf8')}- [ ] Pay the invoice [reminder:: ${stamp}] [id:: rem4]\n`,
  );
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.nav', { hasText: 'Calls' }).click();
  // D-68: no "Overdue" word; the bell stays, with a dot, and the time is brighter.
  const reminder = main.locator('.row', { hasText: 'Pay the invoice' }).locator('.reminder');
  await expect(reminder).toHaveText(
    `Today ${pad(hourAgo.getHours())}:${pad(hourAgo.getMinutes())}`,
  );
  await expect(reminder).toHaveClass(/overdue/);

  await reminder.locator('.reminder-bell').click();
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toContain(`[reminder:: ${stamp}] [muted:: true] [id:: rem4]`);
  await expect(reminder).toHaveClass(/muted/);
  await main.keyboard.press('Control+z');
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('[muted:: true]');
  await expect(reminder).toHaveClass(/overdue/);

  // REM-01, D-68: the time opens the date/time picker; a new time also turns a muted reminder on.
  await reminder.locator('.reminder-bell').click();
  await expect.poll(() => readFile(file, 'utf8')).toContain('[muted:: true] [id:: rem4]');
  await reminder.locator('.reminder-time').click();
  await expect(main.locator('.fl-picker')).toBeVisible();
  await main.keyboard.type('tomorrow 9');
  await main.keyboard.press('Enter');
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(/Pay the invoice \[reminder:: \d{4}-\d{2}-\d{2}T09:00\] \[id:: rem4\]/);
  await expect(reminder).toHaveText('Tomorrow 09:00');
  await expect(reminder).toHaveClass(/ on$/);
});

test('auto-closing brackets and quotes in the composer and the popup (UI-09, D-57)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('h1')).toHaveText(/^Inbox/);
  const composer = main.locator('.composer-input');
  await main.keyboard.press('Control+n');
  await expect(composer).toBeFocused();
  await main.keyboard.type('fn(x');
  await expect(composer).toHaveValue('fn(x)');
  await main.keyboard.type(')');
  await expect(composer).toHaveValue('fn(x)');
  await composer.fill('');
  await main.keyboard.type("don't [skip");
  await expect(composer).toHaveValue("don't [skip]");
  await composer.fill('');
  await main.keyboard.press('Escape');

  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  await popup.locator('#capture').fill('');
  await popup.keyboard.type('say "hi');
  await expect(popup.locator('#capture')).toHaveValue('say "hi"');
  await popup.locator('#capture').fill('');
  await popup.keyboard.press('Escape');
});

test('pickers: priority, list and date/time insert the shorthand, replacing the old token (CAP-11, D-57)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('h1')).toHaveText(/^Inbox/);
  const composer = main.locator('.composer-input');
  await main.keyboard.press('Control+n');
  await expect(composer).toBeFocused();
  await main.keyboard.type('Plan the rollout');

  // D-76: a picker opens with nothing highlighted, the first arrow reveals the current value
  // (None), Enter acts only on a visible highlight, and its own button closes it.
  await main.getByRole('button', { name: 'Set priority' }).click();
  await expect(main.locator('.fl-picker')).toBeVisible();
  await expect(main.locator('.fl-picker .fl-picker-row.active')).toHaveCount(0);
  await main.keyboard.press('ArrowDown');
  await expect(main.locator('.fl-picker .fl-picker-row.active')).toHaveText(/None/);
  await main.getByRole('button', { name: 'Set priority' }).click();
  await expect(main.locator('.fl-picker')).toHaveCount(0);

  // D-77: switching pickers leaves one picker, under its own button, every time.
  for (const name of [
    'Set priority',
    'Choose list',
    'Set reminder',
    'Set priority',
    'Set reminder',
  ]) {
    const button = main.getByRole('button', { name });
    await button.click();
    await expect(main.locator('.fl-picker')).toHaveCount(1);
    await main.waitForTimeout(300);
    const box = await main.locator('.fl-picker').boundingBox();
    const anchor = await button.boundingBox();
    expect(box && anchor && box.y >= anchor.y + anchor.height && box.y - anchor.y < 60, name).toBe(
      true,
    );
  }
  await main.keyboard.press('Escape');
  await expect(main.locator('.fl-picker')).toHaveCount(0);

  // Priority: 3 picks High; picking again replaces it instead of leaving "!h" behind as text.
  await main.getByRole('button', { name: 'Set priority' }).click();
  await expect(main.locator('.fl-picker')).toBeVisible();
  await main.keyboard.press('3');
  await expect(composer).toHaveValue('Plan the rollout !h');
  await expect(composer).toBeFocused();
  await main.getByRole('button', { name: 'Set priority' }).click();
  await main.keyboard.press('2');
  await expect(composer).toHaveValue('Plan the rollout !m');

  // List: search and Enter.
  await main.getByRole('button', { name: 'Choose list' }).click();
  await main.keyboard.type('erra');
  await expect(main.locator('.fl-picker .fl-picker-row.active')).toHaveText('Errands');
  await main.keyboard.press('Enter');
  await expect(composer).toHaveValue('Plan the rollout !m ##Errands');

  // Date and time: natural language, then Enter.
  await main.getByRole('button', { name: 'Set reminder' }).click();
  await main.keyboard.type('tomorrow 10');
  await expect(main.locator('.fl-picker .fl-picker-row.active')).toContainText('Tomorrow 10:00');
  await main.keyboard.press('Enter');
  await expect(composer).toHaveValue(/^Plan the rollout !m ##Errands @\d{4}-\d{2}-\d{2} 10:00$/);
  await expect(main.locator('.composer-chips .chip')).toHaveText([
    'Medium',
    '→ Errands',
    'Tomorrow 10:00',
  ]);
  await main.keyboard.press('Enter');
  await expect(main.locator('.toast')).toContainText('Added to Errands');
  await expect
    .poll(() => readFile(join(dataDirectory, 'Flint', 'Errands.md'), 'utf8'))
    .toMatch(
      /- \[ \] Plan the rollout \[reminder:: \d{4}-\d{2}-\d{2}T10:00\] \[priority:: medium\]/,
    );

  // The capture popup has the same pickers.
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  await popup.locator('#capture').fill('check logs');
  await popup.locator('[data-picker="priority"]').click();
  await popup.keyboard.press('1');
  await expect(popup.locator('#capture')).toHaveValue('check logs !l');

  // D-70: a day from the calendar opens the wheels at 10:00; ← from the hours goes back to the
  // calendar; ↓/↑ move a wheel, digits type a value (37 joins the 5-minute stops), Enter sets.
  await popup.locator('[data-picker="time"]').click();
  await popup.getByRole('button', { name: 'Next month' }).click();
  await popup.locator('.fl-picker .fl-cal-day', { hasText: /^15$/ }).click();
  const hours = popup.getByRole('listbox', { name: 'Hours' });
  await expect(hours).toBeFocused();
  await expect(popup.locator('.fl-picker .fl-wheels-set')).toHaveText(
    /^Set · \w{3} 15 \w{3}, 10:00$/,
  );
  await popup.keyboard.press('ArrowLeft');
  await expect(popup.locator('.fl-picker .fl-cal-day.on')).toBeFocused();
  await popup.keyboard.press('Enter');
  await expect(hours).toBeFocused();
  await popup.keyboard.press('ArrowDown');
  await popup.keyboard.press('ArrowDown');
  await popup.keyboard.press('ArrowUp');
  await popup.keyboard.press('Tab');
  await expect(popup.getByRole('listbox', { name: 'Minutes' })).toBeFocused();
  // D-76: typing edits the value: 3_ then 37; Enter commits it, the next Enter sets the time.
  await popup.keyboard.type('3');
  await expect(popup.locator('.fl-picker .fl-wheel-item.editing')).toHaveText('3_');
  await popup.keyboard.type('7');
  await expect(popup.locator('.fl-picker .fl-wheel-item.editing')).toHaveText('37');
  await popup.keyboard.press('Enter');
  await expect(popup.locator('.fl-picker .fl-wheels-set')).toHaveText(/, 11:37$/);
  await popup.keyboard.press('Enter');
  await expect(popup.locator('#capture')).toHaveValue(/^check logs !l @\d{4}-\d{2}-15 11:37$/);
  await popup.locator('#capture').fill('');
  await popup.keyboard.press('Escape');
});

test('bodies: inline when small, a page when large, back and forward (TASK-05, NAV-04, D-49, D-53)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const file = join(flint, 'Bodies.md');
  // Thirty paragraphs: far more than eight rendered lines.
  const long = Array.from({ length: 30 }, (_, index) => `    line ${index + 1}`).join('\n\n');
  await mkdir(join(flint, 'attachments'), { recursive: true });
  await writeFile(
    join(flint, 'attachments', 'dot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  await writeFile(
    file,
    `---\nflint: 1\nid: bod1\nmode: tasks\n---\n- [ ] Short body [id:: b1]\n    A **bold** note.\n\n    \`\`\`json\n    {"a": 1}\n    \`\`\`\n- [ ] Long body [id:: b2]\n${long}\n- [ ] Shot [id:: b3]\n    ![dot](attachments/dot.png)\n    ![dot 2](attachments/dot.png)\n`,
  );
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.nav', { hasText: 'Bodies' }).click();
  await expect(main.locator('h1')).toHaveText(/^Bodies/);

  // D-78: Shift+Enter in the composer adds notes: the new task's body.
  await main.keyboard.press('Control+n');
  await main.keyboard.type('With notes');
  await main.keyboard.press('Shift+Enter');
  await expect(main.locator('.composer-notes')).toBeFocused();
  await main.keyboard.type('first line');
  await main.keyboard.press('Enter');
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(/- \[ \] With notes \[id:: \w+\]\n {4}first line\n/);
  // D-79, CAP-06 in the composer: pasted JSON goes into the notes fenced, a pasted image is saved
  // to attachments/ and linked there; pasted markdown stays as it is.
  await main.keyboard.type('Pasted');
  await main.evaluate(
    ([json, image]) => {
      const field = document.activeElement;
      const paste = (data: DataTransfer): void => {
        field?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      };
      const text = new DataTransfer();
      text.setData('text/plain', json);
      paste(text);
      const picture = new DataTransfer();
      const bytes = Uint8Array.from(atob(image), (char) => char.charCodeAt(0));
      picture.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
      paste(picture);
    },
    [
      '{"b": 2}',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    ] as const,
  );
  const notes = main.locator('.composer-notes');
  await expect(notes).toHaveValue(
    /^```json\n\{"b": 2\}\n```\n\n!\[\]\(attachments\/[\w-]+\.png\)$/,
  );
  await expect(main.locator('.composer-input')).toHaveValue('Pasted');
  await main.keyboard.press('Enter');
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(
      /- \[ \] Pasted \[id:: \w+\]\n {4}```json\n {4}\{"b": 2\}\n {4}```\n\s*\n {4}!\[\]\(attachments/,
    );
  await main.keyboard.press('Escape');

  // A small body opens inline, rendered and highlighted; a click edits it, Esc saves.
  const short = main.locator('.row', { hasText: 'Short body' });
  await short.locator('.body-toggle').click();
  const inline = main.locator('.row-body .body-view');
  await expect(inline.locator('strong')).toHaveText('bold');
  await expect(inline.locator('.tok-key')).toHaveText('"a"');
  await inline.locator('p').click();
  const editor = main.locator('.body-editor');
  await expect(editor).toBeFocused();
  await main.keyboard.press('Control+End');
  await main.keyboard.type('\nMore.');
  await main.keyboard.press('Escape');
  await expect.poll(() => readFile(file, 'utf8')).toContain('    ```\n    More.\n- [ ] Long body');
  await expect(inline.locator('p').last()).toHaveText('More.');

  // D-76: a long body opens inline cut off, with Open as page; Esc goes back from the page to
  // the list with the task selected.
  await main.locator('.row', { hasText: 'Long body' }).click({ position: { x: 600, y: 10 } });
  await main.keyboard.press('ArrowRight');
  await expect(main.locator('.body-block.long')).toBeVisible();
  await main.getByRole('button', { name: 'Open as page' }).click();
  await expect(main.locator('.page-title')).toHaveText('Long body');
  await expect(main.locator('.body-view')).toContainText('line 30');
  await main.keyboard.press('Escape');
  await expect(main.locator('h1')).toHaveText(/^Bodies/);
  await expect(main.locator('.row.sel .title')).toHaveText('Long body');

  // Shift+Enter opens any task as a page; the mouse's back and forward buttons move through them.
  const mouseButton = (button: number): Promise<void> =>
    main.evaluate((which) => {
      window.dispatchEvent(new MouseEvent('mouseup', { button: which }));
    }, button);
  await main.locator('.row', { hasText: 'Shot' }).click({ position: { x: 600, y: 10 } });
  await main.keyboard.press('Shift+Enter');
  await expect(main.locator('.page-title')).toHaveText('Shot');
  // The image loads from the Flint folder (app://media), not the network.
  await expect
    .poll(() =>
      main
        .locator('.body-view img')
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  // D-79: a click on an image opens the lightbox on the task's images; ←/→ go through them, Esc
  // closes it and nothing else (the page stays).
  await main.locator('.body-view img').first().click();
  const lightbox = main.locator('.lightbox');
  await expect(lightbox.locator('.lightbox-count')).toHaveText('1 / 2');
  await main.keyboard.press('ArrowRight');
  await expect(lightbox.locator('.lightbox-count')).toHaveText('2 / 2');
  await main.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(main.locator('.page-title')).toHaveText('Shot');
  await mouseButton(3);
  await expect(main.locator('h1')).toHaveText(/^Bodies/);
  await mouseButton(4);
  await expect(main.locator('.page-title')).toHaveText('Shot');
  // The page lists the subtasks; Add subtask opens a new row there (D-76).
  await main.getByRole('button', { name: 'Add subtask' }).click();
  await main.keyboard.type('Crop it');
  await main.keyboard.press('Escape');
  await expect(main.locator('.page-subtasks .row .title')).toHaveText(['Crop it']);
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(
      /- \[ \] Shot \[id:: b3\]\n {4}!\[dot\]\(attachments\/dot\.png\)\n {4}!\[dot 2\]\(attachments\/dot\.png\)\n {4}- \[ \] Crop it/,
    );
  await main.locator('.page-back').click();
  await expect(main.locator('h1')).toHaveText(/^Bodies/);

  // D-79: the row shows the image icon for images and the body icon for text; the image icon
  // opens the lightbox.
  const shot = main.locator('.row', { hasText: 'Shot' });
  await expect(shot.locator('.image-toggle')).toHaveCount(1);
  await expect(shot.locator('.body-toggle:not(.image-toggle)')).toHaveCount(0);
  await expect(short.locator('.image-toggle')).toHaveCount(0);
  await expect(short.locator('.body-toggle')).toHaveCount(1);
  await shot.locator('.image-toggle').click();
  await expect(lightbox.locator('.lightbox-count')).toHaveText('1 / 2');
  await main.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(main.locator('h1')).toHaveText(/^Bodies/);

  // D-76: a second single click on a selected row (beside its text) edits it.
  await short.click({ position: { x: 600, y: 10 } });
  await expect(main.locator('.row.sel .title')).toHaveText('Short body');
  await main.waitForTimeout(600);
  await short.click({ position: { x: 600, y: 10 } });
  await expect(main.locator('.title-input')).toHaveValue('Short body');
  await main.keyboard.press('Escape');
});

test('multi-select, bulk actions, duplicate and convert (TASK-07, TASK-16, LIST-01, LIST-04, D-59, D-74)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const file = join(flint, 'Bulk.md');
  const original =
    '---\nflint: 1\nid: blk1\nmode: tasks\n---\n- [ ] one [id:: k1]\n- [ ] two [reminder:: 2030-01-01T10:00] [id:: k2]\n- [ ] three [id:: k3]\n';
  await writeFile(file, original);
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.nav', { hasText: 'Bulk' }).click();
  await expect(main.locator('h1')).toHaveText(/^Bulk/);
  const row = (name: string) => main.locator('.tasks .row', { hasText: name });

  // Click, then Shift+click: three marked, the action bar shows; 3 sets them all high, one Undo.
  // (Esc first: the list opens with its first row selected, and a click on it would edit it.)
  await main.keyboard.press('Escape');
  await row('one').click({ position: { x: 600, y: 10 } });
  await row('three').click({ position: { x: 600, y: 10 }, modifiers: ['Shift'] });
  await expect(main.locator('.action-count')).toHaveText('3 selected');
  await expect(main.locator('.row.marked')).toHaveCount(3);
  // D-77: next to each other they are one highlight.
  await expect(main.locator('.row.marked.mark-down')).toHaveCount(2);
  await expect(main.locator('.row.marked.mark-up')).toHaveCount(2);
  expect(await main.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await main.keyboard.press('3');
  await expect.poll(() => readFile(file, 'utf8')).toContain('three [priority:: high]');
  expect(await readFile(file, 'utf8')).toContain('one [priority:: high]');
  await main.keyboard.press('Control+z');
  await expect.poll(() => readFile(file, 'utf8')).toBe(original);

  // D-77: opening any other list, Inbox too, clears the marks.
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('.action-bar')).toHaveCount(0);
  await main.locator('.nav', { hasText: 'Bulk' }).click();
  await expect(main.locator('h1')).toHaveText(/^Bulk/);
  await row('one').click({ position: { x: 600, y: 10 } });
  await row('two').click({ position: { x: 600, y: 10 }, modifiers: ['Shift'] });

  // Esc clears the marks; Ctrl+A marks all; Delete removes them all, one Undo brings them back.
  await main.keyboard.press('Escape');
  await expect(main.locator('.action-bar')).toHaveCount(0);
  await main.keyboard.press('Control+a');
  await expect(main.locator('.action-count')).toHaveText('3 selected');
  await main.getByRole('toolbar').getByRole('button', { name: 'Delete' }).click();
  await expect(main.locator('.tasks .row')).toHaveCount(0);
  await main.keyboard.press('Control+z');
  await expect(main.locator('.tasks .row')).toHaveCount(3);

  // Duplicate a task: a copy right below it, without the reminder (D-74).
  await row('two').click({ button: 'right', position: { x: 600, y: 10 } });
  await main.locator('.fl-menu').getByText('Duplicate').click();
  await expect(main.locator('.tasks .row .title')).toHaveText(['one', 'two', 'two', 'three']);
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(
      /- \[ \] two \[reminder:: [^\]]+\] \[id:: k2\]\n- \[ \] two \[id:: \w+\]\n- \[ \] three/,
    );

  // Duplicate and convert the list from the sidebar.
  await main.locator('.nav', { hasText: 'Bulk' }).click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Duplicate').click();
  await expect(main.locator('.nav', { hasText: 'Bulk copy' })).toBeVisible();
  await main.locator('.nav', { hasText: 'Bulk copy' }).click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Convert to note').click();
  await expect.poll(() => readFile(join(flint, 'Bulk copy.md'), 'utf8')).toMatch(/mode: note\n/);

  // Ctrl+click marks lists in the sidebar; their menu deletes them together, one Undo restores.
  await main.locator('.nav', { hasText: 'Bulk copy' }).click({ modifiers: ['Control'] });
  await expect(main.locator('.nav.marked')).toHaveCount(2);
  await main.locator('.nav', { hasText: 'Bulk copy' }).click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Delete 2 lists and notes').click();
  await expect(main.locator('.nav', { hasText: 'Bulk' })).toHaveCount(0);
  await main.keyboard.press('Control+z');
  await expect(main.locator('.nav', { hasText: /^Bulk/ })).toHaveCount(2);
});

test('leaves the machine alone: toast schemes and the Start Menu are untouched (D-32, D-33)', () => {
  expect(machineState()).toBe(machineBefore);
});

test('makes no network requests at all (APP-09)', async () => {
  // Give background activity a moment to show itself.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const blocked = await app.evaluate(
    () =>
      (globalThis as { __flintE2E?: { blockedRequests: string[] } }).__flintE2E
        ?.blockedRequests ?? ['hooks missing'],
  );
  expect(blocked, 'requests the app attempted').toEqual([]);
  expect(proxied, 'requests that reached the network stack').toEqual([]);
  expect([...violations], 'TCP connections owned by Flint processes').toEqual([]);
});
