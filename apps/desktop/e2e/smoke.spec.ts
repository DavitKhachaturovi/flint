import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
} from '@playwright/test';

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
 * Auto-update (APP-06, D-136) is the only network use, in installed builds only: a test run gets a
 * fake updater, so nothing here is allowed. A future network feature must add exactly its own
 * endpoint to ALLOWED_ENDPOINTS, with a decision-log entry, never loosen these checks (D-31).
 */
const ALLOWED_ENDPOINTS: readonly string[] = [];

/**
 * D-107: the suite runs on a fixed clock, Tuesday 10 March 2026 from 10:00 local, so nothing it sees
 * depends on when it runs. Flint gets the offset from the real time; `appNow()` is Flint's time.
 */
const CLOCK_OFFSET = new Date(2026, 2, 10, 10, 0).getTime() - Date.now();
const appNow = (): Date => new Date(Date.now() + CLOCK_OFFSET);

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
    env: {
      ...env,
      FLINT_E2E: '1',
      FLINT_DATA_DIR: dataDirectory,
      FLINT_E2E_CLOCK_OFFSET: String(CLOCK_OFFSET),
    },
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

test("runs on the suite's fixed clock: Tuesday 10 March 2026, from 10:00 (D-107)", async () => {
  const at = new Date(await app.evaluate(() => Date.now()));
  expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()]).toEqual([2026, 2, 10, 10]);
  expect(Math.abs(at.getTime() - appNow().getTime())).toBeLessThan(2000);
  for (const page of app.windows())
    expect(Math.abs((await page.evaluate(() => Date.now())) - appNow().getTime())).toBeLessThan(
      2000,
    );
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

  await box.fill('fix token refresh !h ##unic @tomorrow 10');
  await expect(popup.locator('.chip')).toHaveText(['High', 'Unicorn', 'Tomorrow 10:00']);
  await expect(popup.locator('.option')).toHaveText(['UnicornEnter', 'New list "unic"Tab']);
  await box.press('Tab');
  await expect(popup.locator('.option')).toHaveText(['New list "unic"Enter', 'UnicornTab']);
  await expect(popup.locator('.target-name')).toHaveText('New list "unic"');
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

test('recording a hotkey in Settings → Capture & hotkeys (APP-08, D-102)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  const capture = main
    .locator('.settings-row', { hasText: 'Quick capture' })
    .locator('.hotkey-record');
  const note = main
    .locator('.settings-row', { hasText: 'Quick capture' })
    .locator('.settings-note');
  await expect(capture).toHaveText('Ctrl+Shift+Space');
  await capture.click();
  await expect(capture).toHaveText('Press the new keys…');
  await main.keyboard.press('Shift+K');
  await expect(note).toHaveText('Use Ctrl, Alt or Win together with a key.');
  await capture.click();
  await main.keyboard.press('Control+Shift+F9');
  await expect(note).toHaveText('Saved: Ctrl+Shift+F9 opens the capture popup.');
  await expect(capture).toHaveText('Ctrl+Shift+F9');
  await expect
    .poll(() => readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8').catch(() => ''))
    .toContain('"captureHotkey": "Control+Shift+F9"');
  // Esc cancels a recording, the hotkey as it was.
  await capture.click();
  await main.keyboard.press('Escape');
  await expect(capture).toHaveText('Ctrl+Shift+F9');
  await main.locator('.sidebar > .nav').first().click();
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
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Errands' }).click();
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

  // D-89 (supersedes D-71's click-to-edit): a click anywhere, the title's text too, only selects;
  // a second click on the selected row edits with the caret where it landed; a double-click edits
  // too; Esc goes back to the selected row.
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
  await expect(main.locator('.row.sel .title')).toHaveText('Mow the lawn');
  await expect(field).toHaveCount(0);
  await main.mouse.click(lawnText.left + 1, lawnText.y);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Mow the lawn');
  expect(await caret()).toBe(0);
  await expect(main.locator('.row.editing')).toHaveClass(/\bsel\b/);
  await main.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await main.mouse.click(lawnText.right - 1, lawnText.y);
  await expect(field).toBeFocused();
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
  // Only when it isn't open already: a second click on the open list renames it (D-99).
  if (!/^Errands/.test((await main.locator('h1').textContent()) ?? ''))
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
  // D-91: in groups: Complete · Edit · Open as page / Priority ▸ · Reminder ▸ · Pin / Add ▸ /
  // Move to… · Duplicate · Give to Claude (D-151) / More ▸ / Delete.
  await expect(menuItems).toHaveText([
    'Complete',
    'Edit',
    'Open as page',
    'Priority',
    'Reminder',
    'Pin',
    'Add',
    'Move to…',
    'Duplicate',
    'Give to Claude',
    'More',
    'Delete',
  ]);
  await expect(main.locator('.fl-menu:not(.fl-submenu) > .fl-menu-divider')).toHaveCount(5);
  await menu.getByText('More', { exact: true }).hover();
  await expect(main.locator('.fl-submenu .fl-menu-item > span:first-child')).toHaveText([
    'Indent',
    'Outdent',
    'Convert to note',
  ]);
  // D-78: Priority is a submenu.
  await menu.getByText('Priority', { exact: true }).hover();
  await expect(main.locator('.fl-submenu .fl-menu-item')).toContainText([
    'High',
    'Medium',
    'Low',
    'None',
  ]);
  // D-79: a diagonal move across the next items to the submenu keeps it open (menu aim).
  // (Few steps: on a slow machine six took longer than the aim's grace. D-107: a machine busy
  // enough to stall the moves past the 300 ms grace gets another try; a broken aim fails them all.)
  await expect(async () => {
    await menu.getByText('Priority', { exact: true }).hover();
    const priorityBox = await menu.getByText('Priority', { exact: true }).boundingBox();
    const lowBox = await main.locator('.fl-submenu').getByText('Low').boundingBox();
    if (!priorityBox || !lowBox) throw new Error('no menu boxes');
    await main.mouse.move(priorityBox.x + 20, priorityBox.y + priorityBox.height / 2);
    await main.mouse.move(lowBox.x + 30, lowBox.y + lowBox.height / 2, { steps: 3 });
    await expect(main.locator('.fl-submenu .fl-menu-item.active')).toHaveText(/Low/, {
      timeout: 1500,
    });
  }).toPass({ timeout: 20_000 });
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

  // A new note, in the live-preview editor (M5, D-79), saved as it is typed (D-64).
  await main.locator('.add-list').click();
  await menu.getByText('New note').click();
  await main.keyboard.type('Scratch');
  await main.keyboard.press('Enter');
  await expect(main.locator('.note-editor')).toBeVisible();
  await main.locator('.note-editor').click();
  // D-156: typed once the note's editor has the keys (a slow runner's new note settles later).
  await expect(main.locator('.note-editor .cm-content')).toBeFocused();
  await main.keyboard.type('# Standup\nAlex: DNS');
  await expect
    .poll(() => readFile(join(flint, 'Scratch.md'), 'utf8'), { timeout: 5000 })
    .toMatch(/mode: note\n---\n# Standup\nAlex: DNS$/);
  // Away from the cursor the marks are hidden and the text shows formatted; on its line they show.
  await main.keyboard.type('\n**Decision:** keep');
  await main.locator('h1').click();
  await expect(main.locator('.note-editor .cm-fl-h1')).toHaveText('Standup');
  await expect(main.locator('.note-editor .cm-fl-strong')).toHaveText('Decision:');
  await expect(main.locator('.note-editor .cm-fl-mark')).toHaveCount(0);
  await main.locator('.note-editor .cm-fl-strong').click();
  await expect(main.locator('.note-editor .cm-fl-mark')).toHaveCount(2);
  await expect
    .poll(() => readFile(join(flint, 'Scratch.md'), 'utf8'), { timeout: 5000 })
    .toMatch(/# Standup\nAlex: DNS\n\*\*Decision:\*\* keep$/);

  // NOTE-03, D-82: "/" at a line's start opens the command menu; typing filters it, Enter applies.
  await main.keyboard.press('End');
  await main.keyboard.type('\n/');
  const slash = main.locator('.fl-slash-menu');
  await expect(slash).toBeVisible();
  await main.keyboard.type('h2');
  await expect(slash.locator('li')).toHaveText([/Heading 2\s*\/h2/]);
  await main.keyboard.press('Enter');
  await expect(slash).toHaveCount(0);
  await main.keyboard.type('Next');
  // In a path, "/" is just a slash.
  await main.keyboard.type(' see a/b');
  await expect(slash).toHaveCount(0);
  await expect
    .poll(() => readFile(join(flint, 'Scratch.md'), 'utf8'), { timeout: 5000 })
    .toMatch(/keep\n## Next see a\/b$/);

  // NOTE-02, D-72: the note's right-click menu: Format, Paragraph and Insert, then the text commands.
  await main.locator('.note-editor .cm-fl-strong').click({ button: 'right' });
  await expect(menuItems).toHaveText([
    'Format',
    'Paragraph',
    'Insert',
    'Cut',
    'Copy',
    'Paste',
    'Paste as plain text',
    'Select all',
    'Monospace',
    // NOTE-09, D-141: next to Monospace.
    'Source mode',
  ]);
  // NOTE-06, D-84: Monospace for this note (this machine), and back with Ctrl+Shift+M.
  await menu.getByText('Monospace', { exact: true }).click();
  await expect(main.locator('.note-editor.mono')).toHaveCount(1);
  await main.locator('.note-editor .cm-fl-strong').click();
  await main.keyboard.press('Control+Shift+M');
  await expect(main.locator('.note-editor.mono')).toHaveCount(0);
  // NAV-06, D-84: Ctrl+F finds in the note; Esc closes the bar.
  await main.keyboard.press('Control+f');
  const find = main.locator('.fl-find');
  await expect(find.locator('.fl-find-input')).toBeFocused();
  await main.keyboard.type('Standup');
  await expect(find.locator('.fl-find-count')).toHaveText('1 of 1');
  await main.keyboard.press('Escape');
  await expect(find).toHaveCount(0);
  // Insert ▸ Code block: a code card with its copy button (NOTE-05).
  await main.locator('.note-editor .cm-fl-strong').click({ button: 'right' });
  await menu.getByText('Insert', { exact: true }).hover();
  await main.locator('.fl-submenu').getByText('Code block').click();
  await main.keyboard.type('npm test');
  await main.locator('h1').click();
  await expect(main.locator('.note-editor .cm-fl-code-copy')).toHaveCount(1);
  await expect
    .poll(() => readFile(join(flint, 'Scratch.md'), 'utf8'), { timeout: 5000 })
    .toContain('```\nnpm test\n```');

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
  const now = appNow();
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
  // Up to an hour ago, but still today (just after midnight: midnight).
  const today = appNow();
  today.setHours(0, 0, 0, 0);
  const hourAgo = new Date(Math.max(today.getTime(), appNow().getTime() - 60 * 60_000));
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
  // D-79, D-80, CAP-06 in the composer: pasted JSON shows as a code card and a pasted image (saved
  // to attachments/ at once) as a thumbnail chip, never as raw text; on Enter they become the body.
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
  await expect(main.locator('.composer-notes')).toHaveCount(0);
  await expect(main.locator('.composer-code .code-kind')).toHaveText('json · 1 line');
  await expect(main.locator('.composer-code .tok-key')).toHaveText('"b"');
  await expect(main.locator('.composer-images .image-chip')).toHaveCount(1);
  await expect
    .poll(() =>
      main
        .locator('.image-chip img')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth),
    )
    .toBe(1);
  await expect(main.locator('.composer-input')).toHaveValue('Pasted');
  await main.keyboard.press('Enter');
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(
      /- \[ \] Pasted \[id:: \w+\]\n {4}```json\n {4}\{"b": 2\}\n {4}```\n\s*\n {4}!\[\]\(attachments/,
    );
  await expect(main.locator('.composer-pastes')).toHaveCount(0);
  await main.keyboard.press('Escape');

  // A small body opens inline, rendered and highlighted; a click edits it, Esc saves.
  const short = main.locator('.row', { hasText: 'Short body' });
  await short.locator('.body-toggle').click();
  const inline = main.locator('.row-body .body-view');
  await expect(inline.locator('strong')).toHaveText('bold');
  await expect(inline.locator('.tok-key')).toHaveText('"a"');
  await inline.locator('p').click();
  const editor = main.locator('.body-editor .cm-content');
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
  // D-87: a page's notes are the editor, as a note's body.
  await expect(main.locator('.task-page .cm-content')).toContainText('line 1line 2');
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
        .locator('.task-page .fl-media img')
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  // D-79: a click on an image opens the lightbox on the task's images; ←/→ go through them, Esc
  // closes it and nothing else (the page stays).
  await main.locator('.task-page .fl-media img').first().click();
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

  // D-80: the body icon for any body (images only too), the image icon as well for images; the
  // image icon opens the lightbox.
  const shot = main.locator('.row', { hasText: 'Shot' });
  await expect(shot.locator('.image-toggle')).toHaveCount(1);
  await expect(shot.locator('.body-toggle:not(.image-toggle)')).toHaveCount(1);
  await expect(short.locator('.image-toggle')).toHaveCount(0);
  await expect(short.locator('.body-toggle')).toHaveCount(1);
  await shot.locator('.image-toggle').click();
  await expect(lightbox.locator('.lightbox-count')).toHaveText('1 / 2');
  await main.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(main.locator('h1')).toHaveText(/^Bodies/);

  // D-80: the body icon opens an image-only body with its thumbnails; an image's trash button
  // removes its link (the file stays) with an undo toast, no confirmation.
  await shot.locator('.body-toggle:not(.image-toggle)').click();
  const shotBody = main.locator('.row-group', { hasText: 'Shot' }).locator('.body-view');
  await expect(shotBody.locator('img')).toHaveCount(2);
  await shotBody.locator('.body-image').first().hover();
  await shotBody.locator('.part-trash').first().click();
  await expect(main.locator('.toast')).toContainText('Deleted image');
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('![dot](attachments/dot.png)');
  await expect(shotBody.locator('img')).toHaveCount(1);
  expect(existsSync(join(flint, 'attachments', 'dot.png'))).toBe(true);
  await main.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => readFile(file, 'utf8')).toContain('![dot](attachments/dot.png)');
  // A code card's trash button removes the block with its fences.
  const shortBody = main.locator('.row-group', { hasText: 'Short body' }).locator('.body-view');
  await shortBody.locator('.code-card').hover();
  await shortBody.locator('.code-card .part-trash').click();
  await expect(main.locator('.toast')).toContainText('Deleted code block');
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('{"a": 1}');
  await main.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => readFile(file, 'utf8')).toContain('    {"a": 1}\n');
  await shot.locator('.body-toggle:not(.image-toggle)').click();

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
  // D-86: the list that became a note opens.
  await expect(main.locator('.note-card h1')).toHaveText('Bulk copy');

  // Ctrl+click marks lists in the sidebar; their menu deletes them together, one Undo restores.
  await main
    .locator('.nav', { hasText: 'Bulk' })
    .filter({ hasNotText: 'copy' })
    .click({ modifiers: ['Control'] });
  await expect(main.locator('.nav.marked')).toHaveCount(2);
  await main.locator('.nav', { hasText: 'Bulk copy' }).click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Delete 2 lists and notes').click();
  await expect(main.locator('.nav', { hasText: 'Bulk' })).toHaveCount(0);
  await main.keyboard.press('Control+z');
  await expect(main.locator('.nav', { hasText: /^Bulk/ })).toHaveCount(2);
});

test('sidebar groups, the sort menu and Alt+↑/↓ by keyboard focus (LIST-05, LIST-06, D-73, D-79)', async () => {
  const flint = join(dataDirectory, 'Flint');
  for (const [name, id] of [
    ['Garage', 'grg1'],
    ['Studio', 'std1'],
  ] as const)
    await writeFile(join(flint, `${name}.md`), `---\nflint: 1\nid: ${id}\nmode: tasks\n---\n`);
  await expect
    .poll(() => app.windows().some((page) => page.url().includes('main-window')))
    .toBe(true);
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const sidebarFile = (): Promise<string> =>
    readFile(join(flint, '.flint', 'sidebar.json'), 'utf8').catch(() => '');
  const head = main.locator('.nav-group-head');
  // Alt+↑/↓ as an in-page event (never a real Alt press, D-79 test rule).
  const altArrow = (key: 'ArrowUp' | 'ArrowDown'): Promise<void> =>
    main.evaluate((which) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: which, altKey: true }));
    }, key);
  await expect(main.locator('.nav', { hasText: 'Studio' })).toHaveCount(1);

  // D-80: a new group from the + menu goes at the top of Lists, as a card.
  await main.locator('.add-list').click();
  await main.locator('.fl-menu').getByText('New group').click();
  await main.keyboard.type('Home');
  await main.keyboard.press('Enter');
  await expect(head).toHaveText(/Home\s*0/i);
  await expect.poll(sidebarFile).toContain('"name": "Home"');

  // A list moves into it from its menu (Move to group ›), and out again.
  await main.locator('.nav', { hasText: 'Garage' }).click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Move to group', { exact: true }).hover();
  await main.locator('.fl-submenu').getByText('Home').click();
  await expect(main.locator('.nav-group .nav')).toHaveText([/Garage/]);
  await expect(head).toHaveText(/Home\s*1/i);
  // "New group" in the submenu makes a group with the list in it.
  await main.locator('.nav', { hasText: 'Studio' }).click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Move to group', { exact: true }).hover();
  await main.locator('.fl-submenu').getByText('New group').click();
  await main.keyboard.type('Work');
  await main.keyboard.press('Enter');
  await expect(head).toHaveText([/Work\s*1/i, /Home\s*1/i]);
  await main.locator('.nav', { hasText: 'Studio' }).click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Remove from group').click();
  await expect(head.first()).toHaveText(/Work\s*0/i);
  const home = main.locator('.nav-group', { hasText: 'Home' }).locator('.nav-group-head');

  // The header folds the group; its lists stay in the file. Folded, the count stays a number.
  await home.click();
  await expect(home).toHaveAttribute('aria-expanded', 'false');
  await expect(home.locator('.group-count')).toHaveText('1');
  await expect(
    main.locator('.nav-group', { hasText: 'Home' }).locator('.group-lists'),
  ).not.toHaveClass(/open/);
  await home.click();
  await expect(home).toHaveAttribute('aria-expanded', 'true');

  // D-79: with the group picked in the sidebar, Alt+↑/↓ moves the group; Ctrl+Z puts it back.
  const order = (): Promise<string[]> =>
    main
      .locator('.sidebar > .nav-group:not(.flip-ghost), .sidebar > .nav:not(.flip-ghost)')
      .evaluateAll((items) =>
        items.map((item) =>
          (item.querySelector('.group-name, .nav-name')?.textContent ?? '').trim(),
        ),
      );
  const before = await order();
  // Home, picked by its header, is last (new groups go to the top, D-80): Alt+↑ moves it up.
  await altArrow('ArrowUp');
  await expect.poll(order).not.toEqual(before);
  const at = (await order()).indexOf('Home');
  expect(at).toBe(before.indexOf('Home') - 1);
  await main.keyboard.press('Control+z');
  await expect.poll(order).toEqual(before);
  // Picking a list in the sidebar moves the keyboard there from the group.
  await main.locator('.nav', { hasText: 'Garage' }).click();
  await expect(main.locator('h1')).toHaveText(/^Garage/);

  // LIST-06: the sort menu; under a sort, reordering shows the hint.
  await main.locator('.sort-lists').click();
  await expect(main.locator('.fl-menu [aria-checked="true"]')).toHaveText('Manual');
  await main.locator('.fl-menu').getByText('Created').click();
  await expect(main.locator('.sort-lists')).toHaveAttribute('title', 'Sort: Created');
  await head.first().click();
  await altArrow('ArrowDown');
  await expect(main.locator('.toast')).toContainText(
    'Sorted by Created · switch to Manual to reorder',
  );
  await main.locator('.sort-lists').click();
  await main.locator('.fl-menu').getByText('Manual').click();
  await expect(main.locator('.sort-lists')).toHaveAttribute('title', 'Sort: Manual');
  await head.first().click();

  // Rename and delete a group; its lists stay.
  await home.click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Rename group').click();
  await main.keyboard.press('Control+a');
  await main.keyboard.type('House');
  await main.keyboard.press('Enter');
  const house = main.locator('.nav-group', { hasText: 'House' }).locator('.nav-group-head');
  await expect(house).toHaveCount(1);
  await house.click({ button: 'right' });
  await main.locator('.fl-menu').getByText('Delete group').click();
  await expect(main.locator('.toast')).toContainText('Deleted group House · its lists stay');
  await expect(head).toHaveCount(1);
  await expect(main.locator('.sidebar > .nav', { hasText: 'Garage' })).toHaveCount(1);
});

test('drag to reorder: tasks, subtasks, sidebar lists into a group, groups (TASK-01, LIST-05, D-54, D-78)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const file = join(flint, 'Drag.md');
  await writeFile(
    file,
    '---\nflint: 1\nid: drg1\nmode: tasks\n---\n- [ ] one [id:: d1]\n- [ ] two [id:: d2]\n    - [ ] two-a [id:: d2a]\n    - [ ] two-b [id:: d2b]\n- [ ] three [id:: d3]\n',
  );
  await expect
    .poll(() => app.windows().some((page) => page.url().includes('main-window')))
    .toBe(true);
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.nav', { hasText: 'Drag' }).click();
  await expect(main.locator('h1')).toHaveText(/^Drag/);
  const row = (name: string) => main.locator('.tasks .row', { hasText: new RegExp(`^${name}$`) });
  // A press, a move past the threshold, then to the target in steps, and the release.
  const drag = async (from: Locator, toY: number): Promise<void> => {
    const box = await from.boundingBox();
    if (!box) throw new Error('nothing to drag');
    const x = box.x + box.width * 0.6;
    const y = box.y + box.height / 2;
    await main.mouse.move(x, y);
    await main.mouse.down();
    await main.mouse.move(x, y + (toY > y ? 6 : -6), { steps: 2 });
    await main.mouse.move(x, toY, { steps: 10 });
    await main.mouse.up();
  };
  const top = async (locator: Locator): Promise<number> =>
    (await locator.boundingBox())?.y ?? Number.NaN;

  // D-80: while a task is dragged, the sidebar keeps its highlight and the dragged row its own
  // selected look; a task with subtasks folds them away and gets them back after the drop.
  {
    const box = await row('two').boundingBox();
    if (!box) throw new Error('nothing to drag');
    await main.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await main.mouse.down();
    await main.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2 + 12, { steps: 4 });
    await expect(main.locator('.nav-glide')).toHaveCSS('opacity', '1');
    await expect(main.locator('.sel-glide')).toHaveCSS('opacity', '0');
    await expect(row('two')).toHaveClass(/drag-lift/);
    await expect(row('two')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(row('two-a')).toHaveClass(/drag-fold/);
    await main.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 4 });
    await main.mouse.up();
    await expect(main.locator('.drag-fold, .drag-lift')).toHaveCount(0);
    await expect(row('two-a')).toBeVisible();
    // The subtasks unfold (--fl-dur-state) before the next drag measures the rows.
    await main.waitForTimeout(400);
  }

  // A task dragged to the top; the others slide; the click that ends it doesn't edit.
  await drag(row('three'), (await top(row('one'))) + 2);
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(/- \[ \] three \[id:: d3\]\n- \[ \] one \[id:: d1\]\n- \[ \] two \[id:: d2\]\n/);
  await expect(main.locator('.title-input')).toHaveCount(0);
  await expect(main.locator('.drag-lift, .drag-peer')).toHaveCount(0);
  // A subtask moves among its siblings only, even when dragged far.
  await drag(row('two-b'), (await top(row('three'))) - 40);
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toContain('- [ ] two [id:: d2]\n    - [ ] two-b [id:: d2b]\n    - [ ] two-a [id:: d2a]\n');

  // A list dragged just below an open group's header joins the group. D-81: on the way the group's
  // card gets its white ring. (A taller window: the sidebar has many lists by now, Today too.)
  const resize = (height: number): Promise<void> =>
    app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('main-window'),
      );
      const bounds = win?.getBounds();
      if (win && bounds) win.setBounds({ ...bounds, height: size });
    }, height);
  await resize(1100);
  await main.locator('.add-list').click();
  await main.locator('.fl-menu').getByText('New group').click();
  await main.keyboard.type('Dragged');
  await main.keyboard.press('Enter');
  const group = main.locator('.nav-group:not(.flip-ghost)', { hasText: 'Dragged' });
  await expect(group).toHaveCount(1);
  const head = group.locator('.nav-group-head');
  await main.waitForTimeout(400);
  const headBox = await head.boundingBox();
  if (!headBox) throw new Error('no group header');
  {
    const list = await main.locator('.sidebar > .nav', { hasText: 'Drag' }).boundingBox();
    if (!list) throw new Error('no list to drag');
    const x = list.x + list.width * 0.6;
    await main.mouse.move(x, list.y + list.height / 2);
    await main.mouse.down();
    await main.mouse.move(x, list.y + list.height / 2 - 6, { steps: 2 });
    await main.mouse.move(x, headBox.y + headBox.height + 10, { steps: 10 });
    await expect(group).toHaveClass(/drop-target/);
    await main.mouse.up();
  }
  await expect(group.locator('.nav')).toHaveText([/Drag/]);
  await expect(main.locator('.drop-target')).toHaveCount(0);
  // The whole group dragged down one place (new groups start at the top, D-80).
  const order = (): Promise<string[]> =>
    main
      .locator('.sidebar > .nav-group:not(.flip-ghost), .sidebar > .nav:not(.flip-ghost)')
      .evaluateAll((items) =>
        items.map((item) =>
          (item.querySelector('.group-name, .nav-name')?.textContent ?? '').trim(),
        ),
      );
  const before = await order();
  await main.waitForTimeout(400);
  const groupBox = await head.boundingBox();
  const nextBox = await group.locator('xpath=following-sibling::*[1]').boundingBox();
  if (!groupBox || !nextBox) throw new Error('nothing below the group');
  await drag(head, groupBox.y + groupBox.height / 2 + nextBox.height + 2);
  await expect.poll(order).not.toEqual(before);
  expect((await order()).indexOf('Dragged')).toBe(before.indexOf('Dragged') + 1);
  await resize(780);
});

test('large files linked where they are: badge, loading, File not found (MEDIA-03, D-84)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const outside = join(dataDirectory, 'Elsewhere');
  await mkdir(outside, { recursive: true });
  await writeFile(
    join(outside, 'big shot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const shot = pathToFileURL(join(outside, 'big shot.png')).href;
  const gone = pathToFileURL(join(outside, 'gone.mp4')).href;
  await writeFile(
    join(flint, 'Linked.md'),
    `---\nflint: 1\nid: lnk1\nmode: tasks\n---\n- [ ] With linked files [id:: l1]\n    ![](${shot})\n\n    ![](${gone})\n`,
  );
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  await main.locator('.nav', { hasText: 'Linked' }).click();
  await main
    .locator('.row', { hasText: 'With linked files' })
    .click({ position: { x: 600, y: 10 } });
  await main.keyboard.press('Shift+Enter');
  const media = main.locator('.task-page .fl-media');
  await expect(media).toHaveCount(2);
  await expect(media.first().locator('.fl-media-badge')).toHaveText('Linked');
  await expect
    .poll(() =>
      media
        .first()
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  await expect(media.last().locator('.fl-media-missing-title')).toHaveText('File not found');
  await expect(media.last().locator('.fl-media-missing-path')).toContainText('gone.mp4');
  await main.keyboard.press('Escape');
});

test('wide windows and the interface size (UI-12, D-81, D-82)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const sizeTo = (width: number, height: number): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('main-window'),
        );
        win?.setBounds({ x: 0, y: 0, ...size });
      },
      { width, height },
    );
  const width = (selector: string): Promise<number> =>
    main.locator(selector).evaluate((element) => element.getBoundingClientRect().width);
  // D-82: on a wide window the task list keeps its 820 px column, and so does a task's page.
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await sizeTo(1920, 1040);
  await expect.poll(() => width('.content')).toBe(820);
  await main.locator('.nav', { hasText: 'Bodies' }).click();
  await main.locator('.row', { hasText: 'Short body' }).click({ position: { x: 600, y: 10 } });
  await main.keyboard.press('Shift+Enter');
  await expect.poll(() => width('.content.task-page')).toBe(820);
  await main.keyboard.press('Escape');
  await sizeTo(1120, 780);

  // Ctrl+= / Ctrl+− / Ctrl+0 zoom the main window, show the level, and remember it per display.
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  const popupRatio = await popup?.evaluate(() => window.devicePixelRatio);
  const before = await main.evaluate(() => window.innerWidth);
  // D-156: each level pill is recorded as it appears (it shows for 1.5 s; a polled check on a
  // slow runner could look before and after it), and each step waits for its own new pill.
  await main.evaluate(() => {
    const shown: string[] = [];
    (window as unknown as { pills: string[] }).pills = shown;
    new MutationObserver(() => {
      const pill = document.querySelector('.zoom-pill');
      const text = pill?.textContent ?? null;
      if (pill && text && pill.getAttribute('data-seen') !== '1') {
        pill.setAttribute('data-seen', '1');
        shown.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const pills = (): Promise<string[]> =>
    main.evaluate(() => [...(window as unknown as { pills: string[] }).pills]);
  await main.keyboard.press('Control+Equal');
  await expect.poll(pills).toEqual(['110%']);
  await expect.poll(() => main.evaluate(() => window.innerWidth)).toBeLessThan(before * 0.95);
  // The popup has its own origin's zoom: it stays at 100 %.
  if (popup) expect(await popup.evaluate(() => window.devicePixelRatio)).toBe(popupRatio);
  await main.keyboard.press('Control+Minus');
  await expect.poll(pills).toEqual(['110%', '100%']);
  await main.keyboard.press('Control+Minus');
  await expect.poll(pills).toEqual(['110%', '100%', '90%']);
  await main.keyboard.press('Control+0');
  await expect.poll(pills).toEqual(['110%', '100%', '90%', '100%']);
});

test('the context panel: Up next, pins, the selected task, back, a note outline, Ctrl+\\ and its button (NAV-07, TODAY-01, TASK-17, D-83, D-85)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const two = (n: number): string => String(n).padStart(2, '0');
  const now = appNow();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0);
  const stamp = `${tomorrow.getFullYear()}-${two(tomorrow.getMonth() + 1)}-${two(tomorrow.getDate())}T10:00`;
  await writeFile(
    join(flint, 'Panel tasks.md'),
    `---\nflint: 1\nid: pnl1\nmode: tasks\n---\n- [ ] Check the gateway logs [reminder:: ${stamp}] [id:: p1]\n    See https://status.example.com/incidents/42\n    - [x] Pull the logs [id:: p2]\n    - [ ] Read them [id:: p3]\n- [ ] Plain task [id:: p4]\n- [ ] Write it up [id:: p5]\n    Notes for the write-up.\n`,
  );
  const lines = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}.`).join('\n\n');
  await writeFile(
    join(flint, 'Panel note.md'),
    `---\nflint: 1\nid: pnl2\nmode: note\n---\n## Goals\nShip it.\n\n\`\`\`bash\n# Check the gateway health\naz network show\n\`\`\`\n\n## Decisions\n- [x] Keep the hotfix\n- [ ] Tell the team\n\n${lines}\n\n## Brand\nKeep the leaf.\n`,
  );
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const sizeTo = (width: number, height: number): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('main-window'),
        );
        win?.setBounds({ x: 0, y: 0, ...size });
      },
      { width, height },
    );
  const motion = (): Promise<string[]> =>
    main.evaluate(() => [...(window as unknown as { motion: string[] }).motion]);
  const resetMotion = (): Promise<unknown> =>
    main.evaluate(() => (window as unknown as { motion: string[] }).motion.splice(0));
  const top = (selector: string): Promise<number> =>
    main
      .locator(selector)
      .first()
      .evaluate((element) => element.getBoundingClientRect().top);
  const panel = main.locator('.context-panel');
  const label = panel.locator('.panel-state:not(.panel-ghost) .panel-head .panel-label');
  await main.locator('.nav', { hasText: 'Panel tasks' }).click();
  // D-87 (D-51 parity): the composer's ## menu, as in the capture popup; Enter takes the list.
  await main.locator('.composer-input').click();
  await main.keyboard.type('Ship it ##Pan');
  await expect(main.locator('.composer-suggestion').first()).toContainText('Panel');
  await main.keyboard.press('Enter');
  await expect(main.locator('.composer-input')).toHaveValue(/^Ship it ##Panel-/);
  await expect(main.locator('.composer-suggestions')).toHaveCount(0);
  await main.locator('.composer-input').fill('');
  await main.locator('.composer-input').blur();
  // Narrow: no panel and no panel button.
  await expect(panel).toHaveCount(0);
  await expect(main.locator('.panel-toggle')).toHaveCount(0);

  await sizeTo(1920, 1040);
  await expect(panel).toHaveCount(1);
  // D-87: show and hide are one choreography: the column and the panel (or its copy, hiding) move
  // together, so the gap between them never closes (motion regression, D-79).
  const choreography = (): Promise<{ gap: number; moving: boolean }> =>
    main.evaluate(
      () =>
        new Promise((resolve) => {
          let gap = Infinity;
          let moving = false;
          const start = performance.now();
          const tick = (): void => {
            const column = document.querySelector('.content');
            const side =
              document.querySelector('.context-panel.panel-leaving') ??
              document.querySelector('.context-panel');
            if (column && side) {
              gap = Math.min(
                gap,
                side.getBoundingClientRect().left - column.getBoundingClientRect().right,
              );
              moving ||= column.getAnimations().length > 0 && side.getAnimations().length > 0;
            }
            if (performance.now() - start < 450) requestAnimationFrame(tick);
            else resolve({ gap: Math.round(gap), moving });
          };
          requestAnimationFrame(tick);
        }),
    );
  for (const shown of [false, true]) {
    const sampled = choreography();
    await main.keyboard.press('Control+Backslash');
    const result = await sampled;
    expect(result.moving).toBe(true);
    expect(result.gap).toBeGreaterThanOrEqual(20);
    await expect(main.locator('.context-panel:not(.panel-leaving)')).toHaveCount(shown ? 1 : 0);
  }
  // Its top lines up with the composer's (D-85).
  await expect
    .poll(async () => Math.round((await top('.context-panel')) - (await top('.composer'))))
    .toBe(0);

  // Nothing selected: Up next, with tomorrow's reminder; clicking it selects the task, and the
  // panel's back arrow (D-85) returns to Up next. The old content fades out over the new.
  await expect(label).toHaveText('Up next');
  await expect(panel).toContainText('Select a task to see its details here');
  await expect(panel).not.toContainText('hides the panel');
  const item = panel.locator('.panel-item', { hasText: 'Check the gateway logs' });
  await expect(item.locator('.panel-item-when')).toHaveText('10:00');
  await resetMotion();
  await item.click();
  await expect(label).toHaveText('Task');
  await expect
    .poll(motion)
    .toEqual(
      expect.arrayContaining([
        'animationend panel-state panel-fade-out',
        'animationend panel-state panel-crossfade',
      ]),
    );
  await expect(panel.locator('.panel-state:not(.panel-ghost) .panel-title')).toHaveText(
    'Check the gateway logs',
  );
  await expect(panel).toContainText('1 of 2');
  // D-86: the notes are edited right in the panel, and a subtask is added there.
  // (At the text's start: a click on a link opens it.)
  await panel
    .locator('.panel-state:not(.panel-ghost) .panel-notes .cm-content')
    .click({ position: { x: 3, y: 4 } });
  await main.keyboard.press('Control+End');
  await main.keyboard.type(' Then the DNS.');
  // D-87: never lost: a click on another task right away (the panel moves on) still saves it.
  await main.locator('.row', { hasText: 'Plain task' }).click({ position: { x: 600, y: 10 } });
  await expect
    .poll(() => readFile(join(flint, 'Panel tasks.md'), 'utf8'))
    .toContain('incidents/42 Then the DNS.');
  await main
    .locator('.row', { hasText: 'Check the gateway logs' })
    .click({ position: { x: 600, y: 10 } });
  await expect(panel.locator('.panel-state:not(.panel-ghost) .panel-title')).toHaveText(
    'Check the gateway logs',
  );
  await panel
    .locator('.panel-state:not(.panel-ghost) .panel-add', { hasText: 'Add subtask' })
    .click();
  await main.keyboard.type('Write the summary');
  await main.keyboard.press('Enter');
  await expect(panel).toContainText('1 of 3');
  await expect(main.locator('.row.subtask', { hasText: 'Write the summary' })).toHaveCount(1);
  await main.keyboard.press('Escape');
  // References (collapsed, one line with its count), opened with a click.
  const references = panel.locator('.panel-state:not(.panel-ghost) .panel-extra', {
    hasText: 'References',
  });
  await expect(references.locator('.panel-extra-count')).toHaveText('1');
  await expect(references).not.toHaveClass(/open/);
  await references.locator('.panel-extra-head').click();
  await expect(references).toHaveClass(/open/);
  await expect(references.locator('.panel-item')).toHaveText('status.example.com/incidents/42');
  await references.locator('.panel-extra-head').click();
  await panel.locator('.panel-state:not(.panel-ghost) .panel-back').click();
  await expect(label).toHaveText('Up next');
  await expect(panel.locator('.panel-state:not(.panel-ghost) .panel-back')).toHaveCount(0);

  // The selection drives the panel; a click on blank space clears it (D-85).
  await main.locator('.row', { hasText: 'Plain task' }).click({ position: { x: 600, y: 10 } });
  await expect(panel.locator('.panel-state:not(.panel-ghost) .panel-title')).toHaveText(
    'Plain task',
  );
  await expect(panel.locator('.panel-state:not(.panel-ghost) .panel-back')).toHaveCount(0);
  // P pins it (TODAY-01, D-85): a pin on the row, and in Up next's Pinned section, its title
  // first and the pin on the right (D-86).
  await main.keyboard.press('p');
  await expect(main.locator('.row', { hasText: 'Plain task' }).locator('.pin-ind')).toHaveCount(1);
  await expect
    .poll(() => readFile(join(flint, 'Panel tasks.md'), 'utf8'))
    .toContain('- [ ] Plain task [pinned:: true] [id:: p4]');
  const box = await main.locator('.scroller').boundingBox();
  if (!box) throw new Error('no scroller');
  await main.mouse.click(box.x + 300, box.y + box.height - 40);
  await expect(label).toHaveText('Up next');
  const pinned = panel.locator('.panel-section.pinned .panel-item', { hasText: 'Plain task' });
  await expect(pinned.locator(':scope > *').first()).toHaveClass('panel-item-title');
  // D-86: a click on the row's pin unpins.
  await main.locator('.row', { hasText: 'Plain task' }).locator('.pin-ind').click();
  await expect(main.locator('.row', { hasText: 'Plain task' }).locator('.pin-ind')).toHaveCount(0);
  await expect(pinned).toHaveCount(0);

  // D-86: right-click in a multi-selection acts on all of it and says so; outside, on one task.
  await main.locator('.row', { hasText: 'Plain task' }).click({ position: { x: 600, y: 10 } });
  await main
    .locator('.row', { hasText: 'Write it up' })
    .click({ position: { x: 600, y: 10 }, modifiers: ['Control'] });
  await main.locator('.row', { hasText: 'Plain task' }).click({ button: 'right' });
  await expect(main.locator('.fl-menu .fl-menu-item').first()).toHaveText('2 selected');
  await expect(main.locator('.fl-menu .fl-menu-item', { hasText: 'Pin 2 tasks' })).toHaveCount(1);
  await main.keyboard.press('Escape');
  await main.locator('.row', { hasText: 'Check the gateway logs' }).click({ button: 'right' });
  await expect(main.locator('.fl-menu .fl-menu-item', { hasText: 'selected' })).toHaveCount(0);
  await main.keyboard.press('Escape');
  await expect(main.locator('.row.marked')).toHaveCount(0);

  // Convert to note (TASK-17): a note named after the task; one undo brings the task back.
  await main.locator('.row', { hasText: 'Write it up' }).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'More' }).hover();
  await main.locator('.fl-submenu .fl-menu-item', { hasText: 'Convert to note' }).click();
  await expect(main.locator('.nav', { hasText: 'Write it up' })).toHaveCount(1);
  await expect(main.locator('.row', { hasText: 'Write it up' })).toHaveCount(0);
  await expect
    .poll(() => readFile(join(flint, 'Write it up.md'), 'utf8'))
    .toMatch(/mode: note\n---\nNotes for the write-up\.\n$/);
  // D-86: the note opens, the cursor in it.
  await expect(main.locator('.note-card h1')).toHaveText('Write it up');
  await expect
    .poll(() => main.evaluate(() => document.activeElement?.closest('.note-editor') !== null))
    .toBe(true);
  // Undo (the toast's) brings the task back; the window returns to its list.
  await main.locator('.toast button', { hasText: 'Undo' }).click();
  await expect(main.locator('.nav', { hasText: 'Write it up' })).toHaveCount(0);
  await expect(main.locator('h1')).toContainText('Panel tasks');
  await expect(main.locator('.row', { hasText: 'Write it up' })).toHaveCount(1);

  // A note: on its card, its outline with the blocks under their heading, the checklist, and
  // "Created … · edited …". Scrolled to the end, the last heading is current (a scroll-spy).
  await main.locator('.nav', { hasText: 'Panel note' }).click();
  await expect(label).toHaveText('Outline');
  await expect(main.locator('.note-card h1')).toHaveText('Panel note');
  await expect
    .poll(async () => Math.round((await top('.context-panel')) - (await top('.note-card'))))
    .toBe(0);
  await expect(panel.locator('.outline-heading')).toHaveText(['Goals', 'Decisions', 'Brand']);
  await expect(panel.locator('.outline-block .outline-title')).toHaveText(
    'Check the gateway health',
  );
  // D-86: clickable facts: one open checklist item, one code block.
  await expect(panel.locator('.panel-fact', { hasText: 'Open checklist items' })).toContainText(
    '1',
  );
  await expect(panel.locator('.panel-fact', { hasText: 'Code blocks' })).toContainText('1');
  await expect(panel.locator('.panel-foot')).toContainText(/^Created .* · edited /);
  await expect(panel.locator('.outline-heading.current')).toHaveText('Goals');
  await main.locator('.scroller').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(panel.locator('.outline-heading.current')).toHaveText('Brand');
  // A click on an outline entry scrolls there.
  await panel.locator('.outline-heading', { hasText: 'Goals' }).click();
  await expect(panel.locator('.outline-heading.current')).toHaveText('Goals');

  // Ctrl+\ hides it; the panel button in the title bar brings it back (D-85).
  await main.keyboard.press('Control+Backslash');
  await expect(panel).toHaveCount(0);
  await expect(main.locator('.panel-toggle')).toHaveAttribute('aria-pressed', 'false');
  await main.locator('.panel-toggle').click();
  await expect(panel).toHaveCount(1);

  // The compact pair (D-85): a 1536 px window still has the panel, 380 px wide, at 100 %.
  await main.locator('.nav', { hasText: 'Panel tasks' }).click();
  await sizeTo(1536, 864);
  await expect
    .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(380);
  await expect
    .poll(() =>
      main.locator('.content').evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(780);
  await sizeTo(1120, 780);
  await expect(panel).toHaveCount(0);
});

test('M4 step 9: smart link titles, temporary sorts, find in lists, multi-line paste, swipe, the auto-archive offer (TASK-10, TASK-08, NAV-06, TASK-09, NAV-04, TASK-06, D-88)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const two = (n: number): string => String(n).padStart(2, '0');
  const at = (days: number): string => {
    const day = new Date(appNow().getTime() - days * 86_400_000);
    return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}T09:00`;
  };
  const done = Array.from(
    { length: 50 },
    (_, index) => `- [x] Old chore ${index + 1} [completion:: ${at(30)}] [id:: oc${index}]`,
  ).join('\n');
  await writeFile(
    join(flint, 'Step nine.md'),
    `---\nflint: 1\nid: st9\nmode: tasks\n---\n- [ ] Low one [priority:: low] [id:: s1]\n- [ ] Review https://github.com/octo/flint/pull/9 [id:: s2]\n- [ ] High one [priority:: high] [id:: s3]\n    The beta notes.\n- [ ] Medium one [priority:: medium] [id:: s4]\n\n## Completed\n${done}\n`,
  );
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const titles = (): Promise<string[]> =>
    main.locator('.card.tasks .row:not(.subtask) .title').allTextContents();
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await main.locator('.nav', { hasText: 'Step nine' }).click();
  await expect(main.locator('h1')).toContainText('Step nine');

  // TASK-10: a pasted URL shows its smart title; the file keeps the URL.
  await expect(main.locator('.row', { hasText: 'Review' }).locator('.title a')).toHaveText(
    'flint!9',
  );

  // TASK-08: a temporary sort by priority from the list's menu; the file's order stays.
  await main.locator('.nav', { hasText: 'Step nine' }).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Sort tasks by' }).hover();
  await main.locator('.fl-submenu .fl-menu-item', { hasText: 'Priority' }).click();
  await expect(main.locator('.sort-indicator')).toContainText('Sorted by priority');
  await expect.poll(titles).toEqual(['High one', 'Medium one', 'Low one', 'Review flint!9']);
  await main.locator('.sort-indicator button').click();
  await expect.poll(titles).toEqual(['Low one', 'Review flint!9', 'High one', 'Medium one']);

  // NAV-06: Ctrl+F finds in titles and notes; Enter goes to the match and selects it.
  await main.keyboard.press('Control+f');
  await expect(main.locator('.list-find .fl-find-input')).toBeFocused();
  await main.keyboard.type('beta');
  await expect(main.locator('.list-find .fl-find-count')).toHaveText('1 match');
  await main.keyboard.press('Enter');
  await expect(main.locator('.list-find .fl-find-count')).toHaveText('1 of 1');
  await expect(main.locator('.row.sel .title')).toHaveText('High one');
  await main.keyboard.press('Escape');
  await expect(main.locator('.list-find')).toHaveCount(0);
  await expect(main.locator('.row.sel .title')).toHaveText('High one');

  // TASK-09: several lines pasted into the list are tasks below the selection; Keep as one.
  // D-93: a synthetic paste, never the real clipboard.
  await main.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ['- first pasted', '- second pasted !h'].join('\n'));
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(main.locator('.toast')).toContainText('Added 2 tasks');
  await expect
    .poll(titles)
    .toEqual([
      'Low one',
      'Review flint!9',
      'High one',
      'first pasted',
      'second pasted !h',
      'Medium one',
    ]);
  await main.locator('.toast button', { hasText: 'Keep as one' }).click();
  await expect
    .poll(titles)
    .toEqual(['Low one', 'Review flint!9', 'High one', 'first pasted', 'Medium one']);
  await expect
    .poll(() => readFile(join(flint, 'Step nine.md'), 'utf8'))
    .toContain('- [ ] first pasted [id:: ');
  expect(await readFile(join(flint, 'Step nine.md'), 'utf8')).toContain('    second pasted !h\n');

  // TASK-06, Q-13: 50 completed tasks offer auto-archive; Turn on archives those over 14 days.
  await expect(main.locator('.archive-offer')).toContainText('more than 14 days ago');
  await main.locator('.archive-offer button', { hasText: 'Turn on' }).click();
  await expect(main.locator('.toast')).toContainText('archived 50 tasks');
  await expect(main.locator('.card.completed')).toHaveCount(0);
  await expect
    .poll(() => readFile(join(flint, '.flint', 'archive', 'st9.md'), 'utf8'))
    .toContain('Old chore 50');

  // NAV-04, D-79: a two-finger horizontal swipe goes back (here: to Inbox), and forward again.
  const swipeBy = (deltaX: number): Promise<void> =>
    main.evaluate((delta) => {
      for (let step = 0; step < 8; step++)
        document
          .querySelector('.scroller')
          ?.dispatchEvent(new WheelEvent('wheel', { deltaX: delta / 8, deltaY: 0, bubbles: true }));
    }, deltaX);
  await swipeBy(-320);
  await expect(main.locator('h1')).toContainText('Inbox');
  await main.waitForTimeout(300);
  await swipeBy(320);
  await expect(main.locator('h1')).toContainText('Step nine');
});

test('fixes after 0.4.22: a click selects, panel subtasks, the motion of sorts and the find bar, menus (TASK-02, NAV-07, TASK-08, NAV-06, UI-08, LIST-03, CAP-05, D-89)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const lists = Array.from({ length: 7 }, (_, index) => `Ops ${index + 1}`);
  for (const [index, name] of lists.entries())
    await writeFile(
      join(flint, `${name}.md`),
      `---\nflint: 1\nid: ops${index}\nmode: tasks\n---\n- [ ] Task in ${name} [id:: oq${index}]\n`,
    );
  await writeFile(
    join(flint, 'Clicks.md'),
    '---\nflint: 1\nid: clk1\nmode: tasks\n---\n- [ ] First [priority:: low] [id:: k1]\n- [ ] Read [the runbook](https://runbook.example.com/a) [id:: k2]\n- [ ] Parent [priority:: high] [id:: k3]\n    Parent notes.\n\n    ```js\n    const a = 1;\n    ```\n    - [ ] Child one [id:: k4]\n        Child notes.\n- [ ] Last [priority:: medium] [id:: k5]\n',
  );
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const motion = (): Promise<string[]> =>
    main.evaluate(() => [...(window as unknown as { motion: string[] }).motion]);
  const resetMotion = (): Promise<unknown> =>
    main.evaluate(() => (window as unknown as { motion: string[] }).motion.splice(0));
  const opened = (): Promise<string[]> =>
    app.evaluate(() => [
      ...((globalThis as { __flintE2E?: { opened: string[] } }).__flintE2E?.opened ?? []),
    ]);
  const field = main.locator('.title-input');
  await main.locator('.nav', { hasText: 'Inbox' }).click();
  await main.locator('.nav', { hasText: 'Clicks' }).click();
  await expect(main.locator('h1')).toContainText('Clicks');

  // D-89: a click on the title text only selects; a second click there edits.
  const first = main.locator('.row', { hasText: 'First' }).locator('.title');
  await first.click();
  await expect(main.locator('.row.sel .title')).toHaveText('First');
  await expect(field).toHaveCount(0);
  await first.click();
  await expect(field).toBeFocused();
  await main.keyboard.press('Escape');

  // A link in a title: a click on an unselected row selects it, a second click opens the link;
  // Ctrl+click opens it from any state and marks nothing.
  const link = main.locator('.row', { hasText: 'Read' }).locator('.title a');
  const before = (await opened()).length;
  await link.click();
  await expect(main.locator('.row.sel .title')).toContainText('Read');
  expect((await opened()).length).toBe(before);
  await link.click();
  await expect
    .poll(async () => (await opened()).slice(before))
    .toEqual(['https://runbook.example.com/a']);
  await first.click();
  await link.click({ modifiers: ['Control'] });
  await expect.poll(async () => (await opened()).length).toBe(before + 2);
  await expect(main.locator('.row.marked')).toHaveCount(0);

  // The menu's impossible Indent nudges the row, as Tab does.
  await resetMotion();
  await main.locator('.row', { hasText: 'First' }).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'More' }).hover();
  // Watched frame by frame: the nudge starts once the change comes back (an IPC round trip).
  await main.locator('.row', { hasText: 'First' }).evaluate((row) => {
    (window as { nudged?: boolean }).nudged = false;
    const until = performance.now() + 3000;
    const look = (): void => {
      if (row.getAnimations().length > 0) (window as { nudged?: boolean }).nudged = true;
      else if (performance.now() < until) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await main.locator('.fl-submenu .fl-menu-item', { hasText: 'Indent' }).click();
  await expect.poll(() => main.evaluate(() => (window as { nudged?: boolean }).nudged)).toBe(true);

  // TASK-08, D-89: sorting moves the rows with a glide, and the line eases in and out.
  await resetMotion();
  await main.locator('.nav', { hasText: 'Clicks' }).click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Sort tasks by' }).hover();
  // The sort comes back over IPC (slower on CI): watched frame by frame until a glide shows.
  await main.evaluate(() => {
    (window as { glided?: boolean }).glided = false;
    const until = performance.now() + 4000;
    const look = (): void => {
      const gliding = document
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect | null)
            ?.getKeyframes()
            .some((frame) => 'translate' in frame),
        );
      if (gliding) (window as { glided?: boolean }).glided = true;
      else if (performance.now() < until) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await main.locator('.fl-submenu .fl-menu-item', { hasText: 'Priority' }).click();
  await expect.poll(() => main.evaluate(() => (window as { glided?: boolean }).glided)).toBe(true);
  await expect
    .poll(motion)
    .toEqual(expect.arrayContaining(['animationend sort-indicator sort-in']));
  await expect
    .poll(() => main.locator('.card.tasks .row:not(.subtask) .title').allTextContents())
    .toEqual(['Parent', 'Last', 'First', 'Read the runbook']);
  await main.locator('.sort-indicator button').click();
  await expect
    .poll(motion)
    .toEqual(expect.arrayContaining(['animationend sort-indicator sort-out']));
  await expect(main.locator('.sort-indicator')).toHaveCount(0);

  // NAV-06, D-89: the find bar opens and closes with its motion.
  await resetMotion();
  await main.keyboard.press('Control+f');
  await expect(main.locator('.list-find .fl-find-input')).toBeFocused();
  await expect.poll(motion).toEqual(expect.arrayContaining(['animationend fl-find list-find-in']));
  await main.keyboard.press('Escape');
  await expect.poll(motion).toEqual(expect.arrayContaining(['animationend fl-find list-find-out']));
  await expect(main.locator('.list-find')).toHaveCount(0);

  // CAP-05, D-89: the composer's ## menu shows every matching list and scrolls past five.
  await main.locator('.composer-input').click();
  await main.keyboard.type('Ship ##ops');
  await expect(main.locator('.composer-suggestion')).toHaveCount(7);
  expect(
    await main
      .locator('.composer-suggestions')
      .evaluate((box) => box.scrollHeight > box.clientHeight + 1),
  ).toBe(true);
  for (let step = 0; step < 7; step++) await main.keyboard.press('ArrowDown');
  await expect(main.locator('.composer-suggestion[aria-selected="true"]')).toHaveText('Ops 7');
  expect(
    await main.locator('.composer-suggestion[aria-selected="true"]').evaluate((row) => {
      const box = row.parentElement?.getBoundingClientRect();
      const own = row.getBoundingClientRect();
      return !!box && own.bottom <= box.bottom + 1 && own.top >= box.top - 1;
    }),
  ).toBe(true);
  await main.keyboard.press('Escape');
  await main.locator('.composer-input').fill('');
  await main.keyboard.press('Escape');

  // LIST-03, D-89: Inbox has a short menu of its own.
  await main.locator('.nav', { hasText: 'Inbox' }).click({ button: 'right' });
  await expect(main.locator('.fl-menu .fl-menu-item', { hasText: 'Sort tasks by' })).toHaveCount(1);
  await expect(main.locator('.fl-menu .fl-menu-item', { hasText: 'Rename' })).toHaveCount(0);
  await main.keyboard.press('Escape');

  // A copy button turns into a checkmark for a moment (D-89).
  await main.locator('.row', { hasText: 'Parent' }).locator('.body-toggle').click();
  const copy = main.locator('.row-body .code-copy, .row-body .cm-fl-code-copy').first();
  // D-93: the copy reaches the real clipboard, so it is saved first and put back after.
  await app.evaluate(() =>
    (
      globalThis as { __flintE2E?: { saveClipboard?: () => Promise<void> } }
    ).__flintE2E?.saveClipboard?.(),
  );
  await copy.click();
  await expect(copy).toHaveClass(/copied/);
  await app.evaluate(() =>
    (
      globalThis as { __flintE2E?: { restoreClipboard?: () => Promise<void> } }
    ).__flintE2E?.restoreClipboard?.(),
  );
  await expect(copy.locator('.fl-copy-done')).toHaveCount(1);
  await main.locator('.row', { hasText: 'Parent' }).locator('.body-toggle').click();

  // NAV-07, D-89: in the panel, a subtask is clickable: its details, then back to its parent.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('main-window'),
    );
    win?.setBounds({ x: 0, y: 0, width: 1600, height: 900 });
  });
  const panel = main.locator('.context-panel .panel-state:not(.panel-ghost)');
  await expect(main.locator('.context-panel')).toHaveCount(1);
  await main
    .locator('.row', { hasText: 'Parent' })
    .first()
    .click({ position: { x: 400, y: 10 } });
  await expect(panel.locator('.panel-title')).toHaveText('Parent');
  await panel.locator('.panel-subtask', { hasText: 'Child one' }).click();
  await expect(panel.locator('.panel-title')).toHaveText('Child one');
  await expect(main.locator('.row.sel .title')).toHaveText('Child one');
  await panel.locator('.panel-back').click();
  await expect(panel.locator('.panel-title')).toHaveText('Parent');

  // D-89: Shift+Enter while editing a title, with the panel: the panel's notes take the caret.
  await main.locator('.row', { hasText: 'Last' }).click({ position: { x: 400, y: 10 } });
  await main.keyboard.press('Enter');
  await expect(field).toBeFocused();
  await main.keyboard.press('Shift+Enter');
  await expect(panel.locator('.panel-notes .cm-content')).toBeFocused();
  await expect(main.locator('.row-body')).toHaveCount(0);
  await main.keyboard.press('Escape');

  // D-89: on a note, Ctrl+A selects the note's text, never the panel's.
  await main.locator('.nav', { hasText: 'Panel note' }).click();
  await main.locator('.note-card h1, .note-card .note-title').first().click();
  await main.keyboard.press('Escape');
  await main.locator('.context-panel').click({ position: { x: 30, y: 10 } });
  await main.keyboard.press('Control+a');
  expect(
    await main.evaluate(() => {
      const selection = window.getSelection();
      const panelNode = document.querySelector('.context-panel');
      return !!selection && !!panelNode && selection.containsNode(panelNode, true);
    }),
  ).toBe(false);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('main-window'),
    );
    win?.setBounds({ x: 0, y: 0, width: 1120, height: 780 });
  });
});

test('fixes after 0.4.24: a reminder opens its task, scroll memory, code from Windows, the picture menu, the note find bar (REM-05, NAV-04, CAP-06, MEDIA-02, NAV-06, D-91)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const tasks = Array.from({ length: 60 }, (_, i) => `- [ ] Long list task ${i + 1} [id:: ll${i}]`);
  await writeFile(
    join(flint, 'Long list.md'),
    `---\nflint: 1\nid: lng1\nmode: tasks\n---\n${tasks.join('\n')}\n`,
  );
  const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n\n');
  await writeFile(
    join(flint, 'Paste note.md'),
    `---\nflint: 1\nid: pst1\nmode: note\n---\nFirst line\n\n![](attachments/d91.png)\n\n${lines}\n`,
  );
  await mkdir(join(flint, 'attachments'), { recursive: true });
  await writeFile(
    join(flint, 'attachments', 'd91.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const scroller = main.locator('.scroller');
  const top = (): Promise<number> => scroller.evaluate((element) => Math.round(element.scrollTop));
  const nav = (name: string) => main.locator('.nav:not(.flip-ghost)', { hasText: name });

  // Each place keeps its scroll position for the session, restored at once.
  await nav('Long list').click();
  await expect(main.locator('h1')).toContainText('Long list');
  // (Scrolled again until it is there: on a slow machine the list may still be growing.)
  await expect
    .poll(() =>
      scroller.evaluate((element) => {
        element.scrollTo({ top: 600, behavior: 'instant' });
        return Math.round(element.scrollTop);
      }),
    )
    .toBe(600);
  await nav('Paste note').click();
  await expect(main.locator('.note-card h1')).toHaveText('Paste note');
  await expect.poll(top).toBe(0);
  await nav('Long list').click();
  await expect(main.locator('h1')).toContainText('Long list');
  await expect.poll(top).toBe(600);

  // A reminder's Open: the task's list, the task selected, in view and flashed.
  await nav('Paste note').click();
  await expect(main.locator('.note-card h1')).toHaveText('Paste note');
  // The flash is recorded as it happens (it lasts 900 ms, less than the checks before it may take).
  await main.evaluate(() => {
    const seen: string[] = [];
    (window as { revealFlashes?: string[] }).revealFlashes = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        const row = record.target as HTMLElement;
        if (row.classList.contains('fl-flash')) seen.push(row.dataset.key ?? '');
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await app.evaluate((_electron, argument) => {
    (globalThis as { __flintE2E?: { activate?: (url: string) => void } }).__flintE2E?.activate?.(
      argument,
    );
  }, 'flint-dev://reminder/open?id=ll55');
  const revealed = main.locator('.row', { hasText: 'Long list task 56' });
  await expect(revealed).toHaveClass(/\bsel\b/);
  await expect(revealed).toBeInViewport();
  await expect
    .poll(() => main.evaluate(() => (window as { revealFlashes?: string[] }).revealFlashes))
    .toContain('ll55');

  // Code copied on Windows (CRLF) pastes into a note as a code block, never as nothing.
  await nav('Paste note').click();
  const editor = main.locator('.note-editor .cm-content');
  await editor.locator('.cm-line', { hasText: 'First line' }).click();
  await main.keyboard.press('End');
  const sample = [
    '/** End-to-end tests against the built Electron app (docs/05 §6). Run `npm run build` first. */',
    'export default defineConfig({',
    "  testDir: 'e2e',",
    '  workers: 1,',
    '});',
  ].join('\r\n');
  await editor.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, sample);
  await expect
    .poll(() => readFile(join(flint, 'Paste note.md'), 'utf8'))
    .toContain('First line\n\n```\n/** End-to-end tests');
  expect(await readFile(join(flint, 'Paste note.md'), 'utf8')).toContain(
    "export default defineConfig({\n  testDir: 'e2e',\n  workers: 1,\n});\n```",
  );

  // The picture's menu: Open in viewer opens the viewer, as its click does.
  await main.locator('.note-editor .cm-fl-image img').click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Open in viewer' }).click();
  await expect(main.locator('.lightbox')).toBeVisible();
  await main.keyboard.press('Escape');
  await expect(main.locator('.lightbox')).toHaveCount(0);

  // The note's find bar: level with the title at the top, takes no room; scrolled, 16 px below
  // the top (the panel's line).
  await scroller.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
  await editor.locator('.cm-line', { hasText: 'Line 3' }).first().click();
  await scroller.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
  const before = await editor.locator('.cm-line').first().boundingBox();
  await main.keyboard.press('Control+f');
  const bar = main.locator('.note-editor .fl-find');
  await expect(bar).toBeVisible();
  const centre = async (selector: string): Promise<number> => {
    const box = await main.locator(selector).first().boundingBox();
    return box ? box.y + box.height / 2 : Number.NaN;
  };
  await expect
    .poll(async () =>
      Math.abs((await centre('.note-editor .fl-find')) - (await centre('.note-card h1'))),
    )
    .toBeLessThan(3);
  expect((await editor.locator('.cm-line').first().boundingBox())?.y).toBe(before?.y);
  const area = await scroller.boundingBox();
  await scroller.evaluate((element) => element.scrollTo({ top: 400, behavior: 'instant' }));
  await expect
    .poll(async () => Math.round(((await bar.boundingBox())?.y ?? 0) - (area?.y ?? 0)))
    .toBe(16);
  await main.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
});

test('Today: pinned tasks of every list, its order, its composer, reminder cards (TODAY-01, TODAY-03, M6, D-90)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const two = (n: number): string => String(n).padStart(2, '0');
  const now = appNow();
  const soon = new Date(now.getTime() + 60 * 60_000);
  const today = soon.getDate() === now.getDate();
  const at = `${soon.getFullYear()}-${two(soon.getMonth() + 1)}-${two(soon.getDate())}T${two(soon.getHours())}:${two(soon.getMinutes())}`;
  await writeFile(
    join(flint, 'Focus work.md'),
    `---\nflint: 1\nid: fcs1\nmode: tasks\n---\n- [ ] Write the design note [pinned:: true] [id:: fw1]\n- [ ] Review the pull request [reminder:: ${at}] [id:: fw2]\n- [ ] Not for today [id:: fw3]\n`,
  );
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const focus = (): Promise<string[]> =>
    main.locator('.card.tasks .row:not(.subtask) .title').allTextContents();
  await main.locator('.nav', { hasText: 'Focus work' }).click();
  await expect(main.locator('h1')).toContainText('Focus work');

  // P pins a task; Today (first in the sidebar) has it, with its home list on the row.
  await main.locator('.row', { hasText: 'Not for today' }).click({ position: { x: 400, y: 10 } });
  await main.keyboard.press('p');
  await expect(main.locator('.row', { hasText: 'Not for today' }).locator('.pin-ind')).toHaveCount(
    1,
  );
  const todayNav = main.locator('.sidebar > .nav').first();
  await expect(todayNav).toContainText('Today');
  await todayNav.click();
  await expect(main.locator('.today-greeting')).toContainText('in focus');
  await expect
    .poll(focus)
    .toEqual(expect.arrayContaining(['Write the design note', 'Not for today']));
  expect((await focus())[0]).toBe('Not for today');
  await expect(
    main.locator('.row', { hasText: 'Write the design note' }).locator('.home-list'),
  ).toHaveText('Focus work');
  if (today) {
    await expect(
      main.locator('.reminder-card', { hasText: 'Review the pull request' }),
    ).toContainText(/in (1 h|5\d min)/);
  }

  // Alt+↓ reorders Today only (the list's file keeps its order), undoably.
  const file = (): Promise<string> => readFile(join(flint, 'Focus work.md'), 'utf8');
  const listBefore = await file();
  await main.locator('.row', { hasText: 'Not for today' }).click({ position: { x: 400, y: 10 } });
  const first = (await focus())[0];
  await main.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
    ),
  );
  await expect.poll(async () => (await focus())[0]).not.toBe(first);
  expect(await file()).toBe(listBefore);
  await main.keyboard.press('Control+z');
  await expect.poll(async () => (await focus())[0]).toBe(first);

  // Its composer adds to Inbox, pinned, at the top of Today.
  await main.locator('.composer-input').click();
  await main.keyboard.type('Call the vendor');
  await main.keyboard.press('Enter');
  await expect.poll(async () => (await focus())[0]).toBe('Call the vendor');
  await expect
    .poll(() => readFile(join(flint, 'Inbox.md'), 'utf8'))
    .toContain('- [ ] Call the vendor [pinned:: true] [id:: ');
  await main.keyboard.press('Escape');

  // Completing a task in Today completes it in its list.
  await main.locator('.row', { hasText: 'Write the design note' }).locator('.check').click();
  await expect.poll(file).toMatch(/- \[x\] Write the design note/);
  await main.keyboard.press('Control+z');
  await expect.poll(file).toMatch(/- \[ \] Write the design note/);
});

test('Today redesign: high priority not pinned, progress, the column and its sections, details in the column (TODAY-01, TODAY-02, TODAY-03, D-92)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const two = (n: number): string => String(n).padStart(2, '0');
  const now = appNow();
  const soon = new Date(now.getTime() + 90 * 60_000);
  const today = soon.getDate() === now.getDate();
  const at = `${soon.getFullYear()}-${two(soon.getMonth() + 1)}-${two(soon.getDate())}T${two(soon.getHours())}:${two(soon.getMinutes())}`;
  const urgent = Array.from(
    { length: 6 },
    (_, i) => `- [ ] Urgent thing ${i + 1} [priority:: high] [id:: trh${i}]`,
  );
  await writeFile(
    join(flint, 'Redesign.md'),
    `---\nflint: 1\nid: rdsg\nmode: tasks\n---\n- [ ] Pinned for the redesign [pinned:: true] [id:: trp1]\n- [ ] Remind me later [reminder:: ${at}] [id:: trr1]\n${urgent.join('\n')}\n`,
  );
  const size = (width: number, height: number) =>
    app.evaluate(
      ({ BrowserWindow }, bounds) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('main-window'),
        );
        win?.setBounds({ x: -6000, y: 0, ...bounds });
      },
      { width, height },
    );
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Redesign' }).click();
  await expect(main.locator('h1')).toContainText('Redesign');
  await main.locator('.sidebar > .nav').first().click();
  await expect(main.locator('.today-greeting')).toContainText('in focus');

  // The composer adds to today; the day's progress line; Focus's two groups.
  await expect(main.locator('.composer-input')).toHaveAttribute(
    'placeholder',
    'Add a task to today…',
  );
  await expect(main.locator('.today-progress-text')).toHaveText(/^\d+ of \d+ done$/);
  await expect(main.locator('.focus-head').first()).toContainText('Focus · pinned');
  const high = main.locator('.focus-high');
  await expect(high).toContainText('High priority · not pinned');
  const more = high.locator('.focus-more');
  await expect(more).toHaveText(/^Show all \d+$/);
  await expect(main.locator('.row', { hasText: 'Urgent thing 6' })).toHaveCount(0);
  await more.click();
  await expect(more).toHaveText('Show fewer');
  await expect(main.locator('.row', { hasText: 'Urgent thing 6' })).toHaveCount(1);
  // Only the pinned tasks reorder: Alt+↑ on a high-priority row nudges it.
  const urgentRow = main.locator('.row', { hasText: 'Urgent thing 2' });
  await urgentRow.click({ position: { x: 400, y: 10 } });
  // Watched in the page, frame by frame: the nudge is short enough to end between two polls.
  expect(
    await urgentRow.evaluate(
      (row) =>
        new Promise<boolean>((resolve) => {
          const until = performance.now() + 2000;
          const look = (): void => {
            if (row.getAnimations().length > 0) resolve(true);
            else if (performance.now() > until) resolve(false);
            else requestAnimationFrame(look);
          };
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }),
          );
          look();
        }),
    ),
  ).toBe(true);
  // P pins it: it joins the pinned tasks, above the high-priority group.
  await main.keyboard.press('p');
  await expect(urgentRow.locator('.pin-ind')).toHaveCount(1);
  expect(
    await main.evaluate(() => {
      const row = [...document.querySelectorAll('.card.tasks .row')].find((each) =>
        each.textContent?.includes('Urgent thing 2'),
      );
      const head = document.querySelector('.focus-high');
      return (
        !!row && !!head && !!(row.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  await main.keyboard.press('Control+z');
  await expect(urgentRow.locator('.pin-ind')).toHaveCount(0);

  // Narrow: Timeline, Done and Captured stack under Focus; the next reminder's card stands out.
  // D-93: the column is always there (Done and Captured always show).
  await expect(main.locator('.today-column.stacked')).toHaveCount(1);
  if (today) {
    await expect(main.locator('.today-column.stacked .today-timeline')).toContainText(
      'Remind me later',
    );
    await expect(main.locator('.timeline-now')).toHaveCount(1);
    await expect(main.locator('.reminder-card.next')).toHaveCount(1);
  }

  // Wide: the column in the panel's place; notes put the task's details there, Esc and back return.
  await size(1800, 900);
  const column = main.locator('.today-column:not(.stacked)');
  // D-93: the selected task's details are in the column; Esc brings Today's sections back.
  await expect(column).toHaveCount(0);
  await main.keyboard.press('Escape');
  await expect(column).toBeVisible();
  const pinned = main.locator('.row', { hasText: 'Pinned for the redesign' });
  await pinned.click({ button: 'right', position: { x: 400, y: 10 } });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Add' }).hover();
  await main.locator('.fl-submenu .fl-menu-item', { hasText: 'Notes' }).click();
  const panel = main.locator('.context-panel .panel-state:not(.panel-ghost)');
  await expect(panel).toContainText('Pinned for the redesign');
  await expect(column).toHaveCount(0);
  await main.locator('.context-panel .panel-back').click();
  await expect(main.locator('.context-panel')).toHaveCount(0);
  await expect(column).toBeVisible();
  // D-93: selecting another task shows its details in the column.
  await urgentRow.click({ position: { x: 400, y: 10 } });
  await expect(panel).toContainText('Urgent thing 2');
  await main.keyboard.press('Escape');
  await expect(main.locator('.context-panel')).toHaveCount(0);
  await size(1120, 780);
});

test('fixes after 0.4.26: a reminder opens and flashes at once, the column follows the selection, Done and Captured always, the list chip, the timeline drag (REM-05, TODAY-01, TODAY-03, D-93)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const two = (n: number): string => String(n).padStart(2, '0');
  const stamp = (d: Date): string =>
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
  const now = appNow();
  const soon = new Date(now.getTime() + 2 * 3600_000);
  const today = soon.getDate() === now.getDate() && now.getHours() >= 1;
  const tasks = Array.from({ length: 50 }, (_, i) => `- [ ] Flash filler ${i + 1} [id:: ff${i}]`);
  await writeFile(
    join(flint, 'Flash.md'),
    `---\nflint: 1\nid: fls1\nmode: tasks\n---\n${tasks.join('\n')}\n- [ ] Drag me on the timeline [reminder:: ${stamp(soon)}] [pinned:: true] [id:: drg1]\n`,
  );
  const activate = (url: string): Promise<void> =>
    app.evaluate(
      (_electron, link) =>
        (
          globalThis as { __flintE2E?: { activate?: (url: string) => void } }
        ).__flintE2E?.activate?.(link),
      url,
    );
  // REM-05: Open, while the same task is already selected in its list: at once, and flashed.
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Flash' }).click();
  await expect(main.locator('h1')).toContainText('Flash');
  const last = main.locator('.row', { hasText: 'Drag me on the timeline' });
  await last.click({ position: { x: 400, y: 10 } });
  await main.evaluate(() =>
    document.querySelector('.scroller')?.scrollTo({ top: 0, behavior: 'instant' }),
  );
  await main.evaluate(() => {
    (window as { flashes?: string[] }).flashes = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const row = record.target as HTMLElement;
        if (row.classList.contains('fl-flash'))
          (window as { flashes?: string[] }).flashes?.push(row.dataset.key ?? '');
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await activate('flint-dev://reminder/open?id=drg1');
  await expect
    .poll(() => main.evaluate(() => (window as { flashes?: string[] }).flashes))
    .toContain('drg1');
  await expect(last).toBeInViewport();

  // Today on a wide screen: Done and Captured always show; Sort Inbox is the primary button.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('main-window'),
    );
    win?.setBounds({ x: -6000, y: 0, width: 1800, height: 900 });
  });
  await main.locator('.sidebar > .nav').first().click();
  await expect(main.locator('.today-greeting')).toContainText('in focus');
  const column = main.locator('.today-column:not(.stacked)');
  await expect(column.locator('.today-done .panel-label')).toHaveText(/^Done today · \d+$/);
  await expect(column.locator('.today-captured .panel-label')).toHaveText(/^Captured today · \d+$/);
  expect(
    await column
      .locator('.today-sort-inbox button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.classList.contains('primary-button')),
      ),
  ).toBe(true);

  // TODAY-01: a click on a Focus task puts its details in the column; Esc and back return.
  const row = main.locator('.card.tasks .row', { hasText: 'Drag me on the timeline' });
  await row.click({ position: { x: 300, y: 10 } });
  const panel = main.locator('.context-panel .panel-state:not(.panel-ghost)');
  await expect(panel).toContainText('Drag me on the timeline');
  await expect(column).toHaveCount(0);
  await main.keyboard.press('Escape');
  await expect(column).toBeVisible();
  await expect(main.locator('.row.sel')).toContainText('Drag me on the timeline');
  await row.click({ position: { x: 300, y: 10 } });
  await expect(panel).toContainText('Drag me on the timeline');
  await main.locator('.context-panel .panel-back').click();
  await expect(column).toBeVisible();
  // The panel's content never narrows for a scrollbar: its gutter is kept.
  expect(
    await main.evaluate(
      () => getComputedStyle(document.querySelector('.today-column') as Element).scrollbarGutter,
    ),
  ).toBe('stable');

  if (today) {
    // D-93: a reminder dragged on the timeline: a new time in quarter hours, saved, undoable.
    const event = column.locator('.timeline-event', { hasText: 'Drag me on the timeline' });
    const box = await event.boundingBox();
    if (!box) throw new Error('no timeline event');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await main.mouse.move(x, y);
    await main.mouse.down();
    for (let step = 1; step <= 8; step++) await main.mouse.move(x, y + step * 6);
    await expect(event).toHaveClass(/dragging/);
    await expect(event.locator('.timeline-text')).toHaveText(/^\d\d:(00|15|30|45) · /);
    await main.mouse.up();
    await expect(event).not.toHaveClass(/dragging/);
    await expect
      .poll(
        async () =>
          /\[reminder:: [^\]]+\]/.exec(await readFile(join(flint, 'Flash.md'), 'utf8'))?.[0],
      )
      .toMatch(/T\d\d:(00|15|30|45)\]/);
    const moved = /\[reminder:: [^\]]+\]/.exec(
      await readFile(join(flint, 'Flash.md'), 'utf8'),
    )?.[0];
    expect(moved).not.toBe(`[reminder:: ${stamp(soon)}]`);
    await expect(main.locator('.toast')).toContainText('Reminder set');
    // The task row's time follows at once.
    await expect(row.locator('.reminder-time')).toContainText(/(00|15|30|45)$/);
    // Dropped in the past: it slides back, nothing changes.
    const again = await event.boundingBox();
    if (!again) throw new Error('no timeline event');
    await main.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
    await main.mouse.down();
    for (let step = 1; step <= 10; step++)
      await main.mouse.move(again.x + again.width / 2, again.y + again.height / 2 - step * 60);
    await expect(event).toHaveClass(/past/);
    await main.mouse.up();
    await expect(event).not.toHaveClass(/past/);
    expect(/\[reminder:: [^\]]+\]/.exec(await readFile(join(flint, 'Flash.md'), 'utf8'))?.[0]).toBe(
      moved,
    );
    // One undo step brings the old time back.
    await main.keyboard.press('Control+z');
    await expect
      .poll(
        async () =>
          /\[reminder:: [^\]]+\]/.exec(await readFile(join(flint, 'Flash.md'), 'utf8'))?.[0],
      )
      .toBe(`[reminder:: ${stamp(soon)}]`);
  }

  // D-93: the list chip on a Focus row opens that list, the task selected and flashed there.
  await main
    .locator('.card.tasks .row', { hasText: 'Drag me on the timeline' })
    .locator('.chip.home-list')
    .click();
  await expect(main.locator('h1')).toContainText('Flash');
  await expect(main.locator('.row.sel')).toContainText('Drag me on the timeline');
  // D-96: scrolled into view at once (the same task's row in Today isn't the one).
  await expect(main.locator('.row.sel')).toBeInViewport();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('main-window'),
    );
    win?.setBounds({ x: -6000, y: 0, width: 1120, height: 780 });
  });
});

test('the rest of M6: the Overdue card, Snooze, the missed toast, R, the chime (REM-07, REM-11, REM-04, REM-01, REM-06, D-94)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const two = (n: number): string => String(n).padStart(2, '0');
  const stamp = (d: Date): string =>
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
  const hooks = (): Promise<{ chimes: number; toasts: string[] }> =>
    app.evaluate(() => {
      const found = (globalThis as { __flintE2E?: { chimes?: number; toasts: string[] } })
        .__flintE2E;
      return { chimes: found?.chimes ?? 0, toasts: found?.toasts ?? [] };
    });
  // REM-06: Flint's own sound is off by default; on (as from settings.json), a firing asks for it.
  await app.evaluate(() => {
    const found = (globalThis as { __flintE2E?: { reminderSound?: boolean } }).__flintE2E;
    if (found) found.reminderSound = true;
  });
  const chimesBefore = (await hooks()).chimes;
  const yesterday = new Date(appNow().getTime() - 24 * 3600_000);
  const earlier = new Date(appNow().getTime() - 2 * 3600_000);
  const file = join(flint, 'Overdue.md');
  await writeFile(
    file,
    [
      '---\nflint: 1\nid: ovd0\nmode: tasks\n---',
      `- [ ] Missed while away [reminder:: ${stamp(yesterday)}] [id:: ovd1]`,
      `- [ ] Overdue this morning [reminder:: ${stamp(earlier)}] [id:: ovd2]`,
      `- [ ] Third overdue one [reminder:: ${stamp(earlier)}] [id:: ovd3]`,
      '- [ ] No reminder yet [id:: ovd4]',
      '',
    ].join('\n'),
  );
  await expect
    .poll(async () => (await hooks()).toasts.filter((toast) => toast.includes('Missed')).length)
    .toBeGreaterThan(0);
  await expect.poll(async () => (await hooks()).chimes).toBeGreaterThan(chimesBefore);
  await app.evaluate(() => {
    const found = (globalThis as { __flintE2E?: { reminderSound?: boolean } }).__flintE2E;
    if (found) found.reminderSound = false;
  });

  // REM-07, REM-11: Today's Overdue card, under the rollover card, oldest first.
  await main.locator('.sidebar > .nav').first().click();
  const card = main.locator('.card.overdue');
  await expect(card.locator('.panel-label')).toHaveText(/^Overdue · \d+$/);
  const row = (title: string) => card.locator('.overdue-row:not(.leaving)', { hasText: title });
  await expect(row('Missed while away')).toContainText('Yesterday');
  await expect(row('Overdue this morning')).toHaveCount(1);
  // It folds, and stays folded (remembered).
  await card.locator('.overdue-head').click();
  await expect(card.locator('.today-fold')).not.toHaveClass(/open/);
  expect(await main.evaluate(() => localStorage.getItem('flint.today.overdue'))).toBe('closed');
  await card.locator('.overdue-head').click();
  await expect(card.locator('.today-fold')).toHaveClass(/open/);

  // REM-04: Snooze ▸ In 1 hour: a new time, the reminder on; the row leaves.
  await row('Missed while away').locator('.overdue-action', { hasText: 'Snooze' }).click();
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'In 1 hour' }).click();
  await expect(row('Missed while away')).toHaveCount(0);
  await expect.poll(() => readFile(file, 'utf8')).not.toContain(`[reminder:: ${stamp(yesterday)}]`);
  await expect(main.locator('.toast')).toContainText('Snoozed');
  // Done completes it in its own list.
  await row('Overdue this morning').locator('.overdue-action', { hasText: 'Done' }).click();
  await expect(row('Overdue this morning')).toHaveCount(0);
  await expect.poll(() => readFile(file, 'utf8')).toMatch(/- \[x\] Overdue this morning/);

  // The missed-reminders toast's Open: Today, the card open (even folded) and in view.
  await card.locator('.overdue-head').click();
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Overdue' }).click();
  await expect(main.locator('h1')).toContainText('Overdue');
  await app.evaluate((_electron, url) => {
    (globalThis as { __flintE2E?: { activate?: (url: string) => void } }).__flintE2E?.activate?.(
      url,
    );
  }, 'flint-dev://reminder/open?id=*');
  await expect(main.locator('.today-greeting')).toBeVisible();
  await expect(card.locator('.today-fold')).toHaveClass(/open/);
  await expect(row('Third overdue one')).toBeInViewport();
  // A click on a row opens its task (in its own list, selected).
  await row('Third overdue one').locator('.overdue-open').click();
  await expect(main.locator('h1')).toContainText('Overdue');
  await expect(main.locator('.row.sel')).toContainText('Third overdue one');

  // REM-01: R on a selected task opens the date and time picker for it.
  await main.locator('.row', { hasText: 'No reminder yet' }).click({ position: { x: 300, y: 10 } });
  await main.keyboard.press('r');
  await expect(main.locator('.fl-picker')).toBeVisible();
  await main.keyboard.press('Escape');
  await expect(main.locator('.fl-picker')).toHaveCount(0);
});

test('Trash and Archived: restore, undo, Delete now, Empty Trash, an archived task back (DATA-02, TASK-06, D-97)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const file = join(flint, 'Bin test.md');
  await writeFile(
    file,
    '---\nflint: 1\nid: bin1\nmode: tasks\n---\n- [ ] Throw me away [id:: bin2]\n- [ ] And me too [id:: bin3]\n',
  );
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Bin test' }).click();
  await expect(main.locator('h1')).toContainText('Bin test');
  // Delete, then Delete again: the selection moves on to the next task.
  await main.locator('.row', { hasText: 'Throw me away' }).click({ position: { x: 300, y: 10 } });
  await main.keyboard.press('Delete');
  await expect(main.locator('.row', { hasText: 'Throw me away' })).toHaveCount(0);
  await expect(main.locator('.row.sel')).toContainText('And me too');
  await main.keyboard.press('Delete');
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('And me too');

  // The sidebar's Trash row, with its count, opens the view: deleted things by day.
  const nav = main.locator('.sidebar-foot .nav', { hasText: 'Trash' });
  // D-105: the button is just "Trash"; the count is inside.
  await expect(nav.locator('.nav-count')).toHaveCount(0);
  await nav.click();
  await expect(main.locator('h1')).toHaveText('Trash');
  const row = (title: string) => main.locator('.trash-row:not(.leaving)', { hasText: title });
  await expect(row('Throw me away')).toContainText('from Bin test');
  await expect(main.locator('.trash-group-label').first()).toHaveText('Today');

  // Restore: back at the top of its list; Ctrl+Z puts it back in the trash.
  await row('Throw me away').locator('.trash-action', { hasText: 'Restore' }).click();
  await expect(main.locator('.toast')).toContainText('Restored to Bin test');
  await expect(row('Throw me away')).toHaveCount(0);
  await expect.poll(() => readFile(file, 'utf8')).toContain('- [ ] Throw me away [id:: bin2]');
  await main.keyboard.press('Control+z');
  await expect(row('Throw me away')).toHaveCount(1);
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('Throw me away');

  // Delete now asks first; then it is gone for good.
  await row('And me too').locator('.trash-action', { hasText: 'Delete now' }).click();
  await expect(row('And me too').locator('.trash-confirm')).toContainText('Delete forever?');
  await row('And me too').locator('.trash-confirm .trash-action', { hasText: 'Delete' }).click();
  await expect(row('And me too')).toHaveCount(0);

  // Empty Trash asks too; afterwards the count is 0.
  await main.locator('.trash-bar .trash-action', { hasText: 'Empty Trash' }).click();
  await expect(main.locator('.trash-bar .trash-confirm')).toContainText('forever?');
  await main.locator('.trash-bar .trash-confirm .trash-action', { hasText: 'Empty Trash' }).click();
  await expect(main.locator('.trash-empty')).toHaveText('Trash is empty.');
  await expect(main.locator('.trash-tab', { hasText: 'Deleted' })).toContainText('0');

  // Archived: the auto-archived tasks by list; one goes back to its list, still completed.
  await main.locator('.trash-tab', { hasText: 'Archived' }).click();
  const archived = main.locator('.trash-row:not(.leaving)').first();
  await expect(archived).toContainText('completed');
  const title = (await archived.locator('.trash-title').textContent()) ?? '';
  await archived.locator('.trash-action', { hasText: 'Restore' }).click();
  await expect(main.locator('.toast')).toContainText('Restored to');
  await expect(
    main.locator('.trash-row:not(.leaving) .trash-title').getByText(title, { exact: true }),
  ).toHaveCount(0);
});

test('fixes after 0.4.30: a new list in a group, the pinned Trash row, back to top, a trash item opened, Go to (LIST-05, DATA-02, D-98)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const size = (width: number, height: number) =>
    app.evaluate(
      ({ BrowserWindow }, bounds) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('main-window'),
        );
        win?.setBounds({ x: -6000, y: 0, ...bounds });
      },
      { width, height },
    );

  // LIST-05: a group's right-click menu makes a new list right inside it; one undo step.
  await main.evaluate(() => window.flintMain.sidebarAction({ kind: 'newGroup', name: 'Errands' }));
  const group = main.locator('.nav-group', { hasText: 'Errands' });
  await group.locator('.nav-group-head').click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'New task list' }).click();
  await expect(group.locator('.name-field input')).toBeFocused();
  await main.keyboard.type('Groceries');
  await main.keyboard.press('Enter');
  await expect(main.locator('h1')).toContainText('Groceries');
  await expect(group.locator('.nav', { hasText: 'Groceries' })).toHaveCount(1);
  await main.keyboard.press('Control+z');
  await expect(main.locator('.nav', { hasText: 'Groceries' })).toHaveCount(0);

  // The Trash row stays at the bottom while the lists scroll.
  await main.evaluate(() => document.querySelector('.sidebar')?.scrollTo({ top: 0 }));
  await expect(main.locator('.sidebar-foot .nav', { hasText: 'Trash' })).toBeInViewport();

  // Back to top: shown once scrolled down, back at the top on a click.
  const tasks = Array.from({ length: 60 }, (_, i) => `- [ ] Scroll task ${i + 1} [id:: sc${i}]`);
  const file = join(flint, 'Scroll me.md');
  await writeFile(file, `---\nflint: 1\nid: scr1\nmode: tasks\n---\n${tasks.join('\n')}\n`);
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Scroll me' }).click();
  // Its rows first: a scroll before they are there goes nowhere (CI is slower).
  await expect(main.locator('.row', { hasText: 'Scroll task 60' })).toHaveCount(1);
  await expect(main.locator('.to-top')).not.toHaveClass(/shown/);
  await expect
    .poll(async () => {
      await main.evaluate(() =>
        document.querySelector('.scroller')?.scrollTo({ top: 1200, behavior: 'instant' }),
      );
      return main.locator('.to-top').getAttribute('class');
    })
    .toContain('shown');
  await main.locator('.to-top').click();
  await expect
    .poll(() => main.evaluate(() => document.querySelector('.scroller')?.scrollTop ?? -1))
    .toBe(0);
  await expect(main.locator('.to-top')).not.toHaveClass(/shown/);

  // DATA-02: two tasks deleted; in Trash, Restore's toast offers Go to the list.
  await main
    .locator('.row', { hasText: 'Scroll task 1' })
    .first()
    .click({ position: { x: 300, y: 10 } });
  await main.keyboard.press('Delete');
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('Scroll task 1 [');
  await main.keyboard.press('Delete');
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('Scroll task 2 [');
  await main.locator('.sidebar-foot .nav', { hasText: 'Trash' }).click();
  const row = (title: string) =>
    main.locator('.trash-row:not(.leaving)').filter({
      has: main.locator('.trash-title').getByText(title, { exact: true }),
    });
  await row('Scroll task 2').locator('.trash-action', { hasText: 'Restore' }).click();
  await expect(main.locator('h1')).toHaveText('Trash');
  await main.locator('.toast button', { hasText: 'Go to Scroll me' }).click();
  await expect(main.locator('h1')).toContainText('Scroll me');
  await expect(main.locator('.row.sel')).toContainText('Scroll task 2');

  // Narrow: a trash item opens as a page, read-only; Esc goes back.
  await main.locator('.sidebar-foot .nav', { hasText: 'Trash' }).click();
  await row('Scroll task 1').locator('.trash-title').click();
  await expect(main.locator('.trash-preview.page .trash-preview-title')).toHaveText(
    'Scroll task 1',
  );
  await main.keyboard.press('Escape');
  await expect(main.locator('.trash-preview')).toHaveCount(0);

  // Wide: in the side panel; trying to edit asks to restore; Restore opens it to edit.
  await size(1800, 900);
  await row('Scroll task 1').locator('.trash-title').click();
  const panel = main.locator('.trash-panel');
  await expect(panel.locator('.trash-preview-title')).toHaveText('Scroll task 1');
  await expect(row('Scroll task 1')).toHaveClass(/\bsel\b/);
  await panel.locator('.trash-preview-title').click();
  await expect(panel.locator('.trash-locked')).toContainText('Restore to edit');
  await panel.locator('.trash-locked button', { hasText: 'Restore' }).click();
  await expect(main.locator('h1')).toContainText('Scroll me');
  await expect(main.locator('.row.editing')).toContainText('', { timeout: 5000 });
  await expect(
    main
      .locator('.row.editing input, .row.editing textarea, .row.editing [contenteditable]')
      .first(),
  ).toBeFocused();
  await main.keyboard.press('Escape');
  await expect.poll(() => readFile(file, 'utf8')).toContain('Scroll task 1 [id:: sc0]');
  await size(1120, 780);
});

test('M7 step 2: snapshots restored one list or everything, undoable; export as zip (DATA-04, DATA-05, D-97)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  type Hooks = {
    snapshot?: () => Promise<string | null>;
    showSnapshots?: () => void;
    exportTo?: (path: string) => Promise<number>;
  };
  const file = join(flint, 'Snap test.md');
  await writeFile(file, '---\nflint: 1\nid: snp1\nmode: tasks\n---\n- [ ] As it was [id:: snp2]\n');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Snap test' }).click();
  await expect(main.locator('.row', { hasText: 'As it was' })).toHaveCount(1);
  expect(
    await app.evaluate(() => (globalThis as { __flintE2E?: Hooks }).__flintE2E?.snapshot?.()),
  ).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  await writeFile(
    file,
    '---\nflint: 1\nid: snp1\nmode: tasks\n---\n- [ ] Changed since [id:: snp2]\n',
  );
  await expect(main.locator('.row', { hasText: 'Changed since' })).toHaveCount(1);

  // From Trash's header (and the tray): the snapshots by day; one opens to its lists and notes.
  await main.locator('.sidebar-foot .nav', { hasText: 'Trash' }).click();
  await main.locator('.subtitle-link', { hasText: 'Snapshots' }).click();
  await expect(main.locator('h1')).toHaveText('Snapshots');
  await main.locator('.snapshot-head').first().click();
  const row = main.locator('.snapshot-file', { hasText: 'Snap test' });
  await expect(row).toHaveClass(/changed/);
  await expect(row.locator('.snapshot-state')).toHaveText('Changed since');
  await row.locator('.trash-action', { hasText: 'Restore' }).click();
  await expect(main.locator('.toast')).toContainText('Restored Snap test');
  await expect.poll(() => readFile(file, 'utf8')).toContain('As it was');
  await main.keyboard.press('Control+z');
  await expect.poll(() => readFile(file, 'utf8')).toContain('Changed since');

  // Restore everything asks first; it is one undo step too.
  await app.evaluate(() => (globalThis as { __flintE2E?: Hooks }).__flintE2E?.showSnapshots?.());
  await expect(main.locator('h1')).toHaveText('Snapshots');
  const all = main.locator('.snapshot-all').first();
  await expect(all).toBeVisible();
  await all.locator('.trash-action', { hasText: 'Restore everything' }).click();
  await expect(all.locator('.trash-confirm')).toContainText('Replace the whole Flint folder');
  await all.locator('.trash-confirm .trash-action', { hasText: 'Restore everything' }).click();
  await expect(main.locator('.toast')).toContainText('Restored the whole Flint folder');
  await expect.poll(() => readFile(file, 'utf8')).toContain('As it was');
  await main.keyboard.press('Control+z');
  await expect.poll(() => readFile(file, 'utf8')).toContain('Changed since');

  // DATA-05: the whole folder as one zip.
  const zip = join(dataDirectory, 'export.zip');
  const count = await app.evaluate(
    (_electron, path) => (globalThis as { __flintE2E?: Hooks }).__flintE2E?.exportTo?.(path),
    zip,
  );
  expect(count).toBeGreaterThan(3);
  expect((await readFile(zip)).subarray(0, 2).toString('ascii')).toBe('PK');
});

test('fixes after 0.4.32: quick notes, renaming in place, the pinned foot, a snapshot compared task by task (NOTE-08, LIST-01, LIST-05, DATA-04, D-99)', async () => {
  const flint = join(dataDirectory, 'Flint');
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');

  // NOTE-08: Ctrl+Shift+J: an untitled note, its editor taking the caret; listed by its first line.
  await main.keyboard.press('Control+Shift+J');
  await expect(main.locator('.quick-title-input')).toHaveAttribute('placeholder', 'Add a title');
  await expect(main.locator('.note-editor .cm-content')).toBeFocused();
  await main.keyboard.type('Ask Alex about the DNS change');
  const quick = main.locator('.quick-notes .nav', { hasText: 'Ask Alex about the DNS change' });
  await expect(quick).toHaveCount(1);
  // An empty one left behind goes.
  await main.locator('.nav.quick-new').click();
  await expect(main.locator('.quick-title-input')).toBeVisible();
  await expect(main.locator('.quick-notes .nav')).toHaveCount(2);
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('h1')).toContainText('Inbox');
  await expect.poll(() => main.locator('.quick-notes .nav').count(), { timeout: 8000 }).toBe(1);
  // D-102: a title (saved when the field is left) keeps it under Quick notes; Keep as a note
  // makes it a normal note in Lists.
  await quick.click();
  await main.locator('.quick-title-input').fill('DNS change');
  await main.locator('.note-editor .cm-content').click();
  // (Its file renamed: read until it is there.)
  await expect
    .poll(() => readFile(join(flint, 'DNS change.md'), 'utf8').catch(() => ''))
    .toMatch(/quick: \d{4}-\d{2}-\d{2}/);
  const titled = main.locator('.quick-notes .nav', { hasText: 'DNS change', hasNotText: 'Ask' });
  await expect(titled).toHaveCount(1);
  await titled.click({ button: 'right' });
  await main.locator('.fl-menu .fl-menu-item', { hasText: 'Keep as a note' }).click();
  await expect(main.locator('.quick-notes')).toHaveCount(0);
  await expect
    .poll(() => readFile(join(flint, 'DNS change.md'), 'utf8').catch(() => 'quick:'))
    .not.toContain('quick:');

  // LIST-01, D-99: a double-click on a list's name edits it in place; Esc cancels, Enter saves.
  const nav = main.locator('.nav:not(.flip-ghost)', { hasText: 'DNS change' });
  await nav.dblclick();
  const field = main.locator('.sidebar .name-field input');
  await expect(field).toBeFocused();
  await main.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await nav.dblclick();
  await main.keyboard.press('Control+a');
  await main.keyboard.type('DNS notes');
  await main.keyboard.press('Enter');
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'DNS notes' })).toHaveCount(1);

  // The pinned foot reaches the window's bottom edge.
  const bottom = await main.evaluate(() => {
    const foot = document.querySelector('.sidebar-foot')?.getBoundingClientRect();
    const side = document.querySelector('.sidebar')?.getBoundingClientRect();
    return foot && side ? Math.round(side.bottom - foot.bottom) : -1;
  });
  expect(bottom).toBe(0);

  // DATA-04, D-99: a snapshot's list compared task by task; one chosen task restored in place.
  type Hooks = { snapshot?: () => Promise<string | null> };
  const file = join(flint, 'Diff test.md');
  await writeFile(
    file,
    '---\nflint: 1\nid: dif1\nmode: tasks\n---\n- [ ] First [id:: dif2]\n- [ ] Second [id:: dif3]\n- [ ] Third [id:: dif4]\n',
  );
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Diff test' }).click();
  await expect(main.locator('.row', { hasText: 'Second' })).toHaveCount(1);
  await app.evaluate(() => (globalThis as { __flintE2E?: Hooks }).__flintE2E?.snapshot?.());
  await writeFile(
    file,
    '---\nflint: 1\nid: dif1\nmode: tasks\n---\n- [ ] First [id:: dif2]\n- [ ] Third [id:: dif4]\n',
  );
  await expect(main.locator('.row', { hasText: 'Second' })).toHaveCount(0);
  await main.locator('.sidebar-foot .nav', { hasText: 'Trash' }).click();
  // Export now sits in Trash's header too (until Settings, M8).
  await expect(main.locator('.subtitle-link', { hasText: 'Export Flint folder' })).toBeVisible();
  await main.locator('.subtitle-link', { hasText: 'Snapshots' }).click();
  await main.locator('.snapshot-head').first().click();
  const changed = main.locator('.snapshot-file', { hasText: 'Diff test' });
  await changed.locator('.trash-title').click();
  const diff = main.locator('.snapshot-diff');
  await expect(diff.locator('.diff-task', { hasText: 'Second' })).toContainText('Deleted since');
  await diff.locator('.diff-task', { hasText: 'Second' }).locator('.diff-check').click();
  await diff.locator('.primary-button', { hasText: 'Restore 1 task' }).click();
  await expect(main.locator('.toast')).toContainText('Restored 1 task in Diff test');
  await expect
    .poll(() => readFile(file, 'utf8'))
    .toMatch(/First \[id:: dif2\]\n- \[ \] Second \[id:: dif3\]\n- \[ \] Third/);
  await main.keyboard.press('Control+z');
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('Second');
});

test('M8 step 1: Settings, one page with its index, every change applied and saved (APP-11, D-100)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const settingsFile = (): Promise<Record<string, unknown>> =>
    readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => ({}));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('main-window'),
    );
    win?.setBounds({ x: -6000, y: 0, width: 1800, height: 900 });
  });
  // The Settings row above Trash opens the page; its index sits in the panel's place.
  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  await expect(main.locator('.settings-header h1')).toHaveText('Settings');
  // D-109: Mini mode is the tenth section; D-128: Clipboard the eleventh; D-151: Claude the twelfth.
  await expect(main.locator('.settings-section')).toHaveCount(13); // D-161: Sync, after Today & lists.
  await expect(main.locator('.settings-index-item')).toHaveCount(13);
  await main.locator('.settings-index-item', { hasText: 'Keyboard shortcuts' }).click();
  await expect(main.locator('#settings-shortcuts')).toBeInViewport();
  await expect(main.locator('#settings-shortcuts')).toContainText('Ctrl+Shift+J');

  // A switch: applied and saved at once.
  const rollover = main.locator('.switch[aria-label="Ask about unfinished pins"]');
  await expect(rollover).toHaveAttribute('aria-checked', 'true');
  await rollover.click();
  await expect(rollover).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await settingsFile())['rolloverPrompt']).toBe(false);
  await rollover.click();
  await expect.poll(async () => (await settingsFile())['rolloverPrompt']).toBe(true);
  // A choice: the reminder sound (the toast goes silent with the chime).
  await main
    .locator('[role=radiogroup][aria-label="Reminder sound"] [role=radio]', {
      hasText: 'Flint chime',
    })
    .click();
  await expect.poll(async () => (await settingsFile())['reminderSound']).toBe(true);
  await main
    .locator('[role=radiogroup][aria-label="Reminder sound"] [role=radio]', {
      hasText: 'Windows sound',
    })
    .click();
  await expect.poll(async () => (await settingsFile())['reminderSound']).toBe(false);
  // The animation speed scales every duration in the window.
  await main
    .locator('[role=radiogroup][aria-label="Animation speed"] [role=radio]', { hasText: 'Quick' })
    .click();
  await expect
    .poll(() =>
      main.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--fl-dur-state').trim(),
      ),
    )
    .toBe('182ms');
  await main
    .locator('[role=radiogroup][aria-label="Animation speed"] [role=radio]', { hasText: 'Normal' })
    .click();
  await expect
    .poll(() =>
      main.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--fl-dur-state').trim(),
      ),
    )
    .toBe('260ms');
  // D-102: a choice sets exactly the value pressed, never one step from the current one.
  const choose = (group: string, option: string): Promise<void> =>
    main
      .locator(`[role=radiogroup][aria-label="${group}"] [role=radio]`, { hasText: option })
      .click();
  const duration = (): Promise<string> =>
    main.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--fl-dur-state').trim(),
    );
  await choose('Animation speed', 'Quick');
  await expect.poll(duration).toBe('182ms');
  await choose('Animation speed', 'Relaxed');
  await expect.poll(duration).toBe('351ms');
  await expect.poll(async () => (await settingsFile())['animationSpeed']).toBe('relaxed');
  await choose('Animation speed', 'Normal');
  await expect.poll(duration).toBe('260ms');
  const zoomFactor = (): Promise<number> =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('main-window'),
      );
      return win?.webContents.getZoomFactor() ?? 0;
    });
  const size = main.locator('[role=radiogroup][aria-label="Interface size"]');
  await expect(size.locator('[aria-checked=true]')).toHaveText('100%');
  await choose('Interface size', '90%');
  await expect.poll(zoomFactor).toBeCloseTo(0.9);
  await choose('Interface size', '125%');
  await expect.poll(zoomFactor).toBeCloseTo(1.25);
  await expect(size.locator('[aria-checked=true]')).toHaveText('125%');
  await choose('Interface size', '100%');
  await expect.poll(zoomFactor).toBeCloseTo(1);
  // D-103, D-105: the foot's two buttons, of one size, show their names whole (no count), and
  // their hover is their own shape (the foot around them keeps the sidebar's ground).
  const foot = await main.evaluate(() =>
    [...document.querySelectorAll('.sidebar-foot .nav')].map((button) => {
      const name = button.querySelector('.nav-name');
      return {
        whole: !!name && name.scrollWidth <= name.clientWidth + 0.5,
        width: Math.round(button.getBoundingClientRect().width),
        count: button.querySelector('.nav-count') !== null,
      };
    }),
  );
  expect(foot.map((button) => [button.whole, button.count])).toEqual([
    [true, false],
    [true, false],
  ]);
  expect(Math.abs((foot[0]?.width ?? 0) - (foot[1]?.width ?? 99))).toBeLessThanOrEqual(1);
  await main.locator('.sidebar-foot .nav', { hasText: 'Trash' }).hover();
  expect(
    await main.evaluate(
      () =>
        getComputedStyle(document.querySelector('.sidebar-foot') as Element).backgroundColor ===
        getComputedStyle(document.querySelector('.sidebar') as Element).backgroundColor,
    ),
  ).toBe(true);
  // Snapshots: how often, kept how long, the space they use.
  await main
    .locator('[role=radiogroup][aria-label="Take a snapshot"] [role=radio]', { hasText: '2 h' })
    .click();
  await expect.poll(async () => (await settingsFile())['snapshotEveryMinutes']).toBe(120);
  await main
    .locator('[role=radiogroup][aria-label="Take a snapshot"] [role=radio]', { hasText: 'Hourly' })
    .click();
  await expect(main.locator('.settings-row', { hasText: 'Space snapshots use' })).toContainText(
    'MB',
  );

  // Ctrl+F finds a setting.
  await main.keyboard.press('Control+f');
  await expect(main.locator('.settings-find')).toBeFocused();
  await main.keyboard.type('chime');
  await expect(main.locator('.settings-section')).toHaveCount(1);
  await expect(main.locator('.settings-section')).toHaveAttribute('aria-label', 'Reminders');
  await main.keyboard.press('Escape');
  await expect(main.locator('.settings-section')).toHaveCount(13);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('main-window'),
    );
    win?.setBounds({ x: -6000, y: 0, width: 1120, height: 780 });
  });
});

test('M8 step 1b: link patterns made from an example; the Flint folder moved, checked (NOTE-07, DATA-07, D-104)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const settingsFile = (): Promise<Record<string, unknown>> =>
    readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => ({}));
  const bounds = (width: number, height: number): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('main-window'),
        );
        win?.setBounds({ x: -6000, y: 0, ...size });
      },
      { width, height },
    );
  await bounds(1800, 900);
  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  // D-104: opening on General, never on About while the page is still loading.
  await expect(main.locator('.settings-index-item.on')).toHaveText('General');

  // NOTE-07, D-104: a pasted Azure DevOps link is recognised; the preview shows both ways.
  await main.locator('#settings-links .trash-action', { hasText: 'Add a link pattern' }).click();
  const editor = main.locator('.link-editor');
  await expect(editor.locator('input[aria-label="Example link"]')).toBeFocused();
  await main.keyboard.type('https://dev.azure.com/acme/web/_workitems/edit/4567');
  await expect(editor.locator('input[aria-label="Short form"]')).toHaveValue('AB#4567');
  await expect(editor).toContainText('Recognised: Azure DevOps work item.');
  await expect(editor.locator('.link-preview')).toContainText(
    'Typing AB#4568 links to https://dev.azure.com/acme/web/_workitems/edit/4568',
  );
  await editor.locator('.primary-button', { hasText: 'Save pattern' }).click();
  await expect(main.locator('.link-editor')).toHaveCount(0);
  await expect(main.locator('.link-patterns .link-pattern')).toHaveCount(1);
  await expect(main.locator('.link-patterns .link-pattern')).toContainText('AB#1234');
  await expect
    .poll(async () => JSON.stringify((await settingsFile())['linkPatterns']))
    .toContain('"short":"AB#{id}"');
  // The same short form twice is refused.
  await main.locator('#settings-links .trash-action', { hasText: 'Add a link pattern' }).click();
  await main.keyboard.type('https://dev.azure.com/acme/web/_workitems/edit/77');
  await expect(main.locator('.link-editor .settings-warning')).toHaveText(
    'You already have a pattern for AB#1234.',
  );
  await expect(main.locator('.link-editor .primary-button')).toBeDisabled();
  await main.locator('.link-editor .trash-action', { hasText: 'Cancel' }).click();
  // Delete, asked inline.
  await main.locator('.link-patterns .link-pattern .trash-action', { hasText: 'Delete' }).click();
  await main
    .locator('.link-patterns .link-pattern .trash-action.danger', { hasText: 'Delete' })
    .click();
  await expect(main.locator('.link-patterns .link-pattern')).toHaveCount(0);
  await expect.poll(async () => (await settingsFile())['linkPatterns']).toEqual([]);

  // DATA-07, D-104: the Flint folder itself is refused; an empty folder gets everything, checked.
  const flint = join(dataDirectory, 'Flint');
  const pick = (path: string): Promise<void> =>
    app.evaluate((_electron, folder) => {
      (globalThis as { __flintE2E?: { pickFolder?: string } }).__flintE2E!.pickFolder = folder;
    }, path);
  await pick(flint);
  await main.locator('#settings-general .trash-action', { hasText: 'Change…' }).click();
  const panel = main.locator('.settings-panel[aria-label="Change the Flint folder"]');
  await expect(panel).toContainText('That is already your Flint folder.');
  await expect(panel.locator('.primary-button')).toHaveCount(0);
  const target = join(dataDirectory, 'Moved Flint');
  await mkdir(target);
  await pick(target);
  await panel.locator('.trash-action', { hasText: 'Choose another…' }).click();
  await expect(panel.locator('[role=radio][aria-checked=true]')).toHaveText('Move my lists here');
  await expect(panel).toContainText('stays as it is, as a backup');
  await panel.locator('.primary-button', { hasText: 'Move and restart' }).click();
  await expect(panel).toContainText('Done. Flint restarts…');
  expect(
    await app.evaluate(
      () => (globalThis as { __flintE2E?: { relaunched?: string } }).__flintE2E?.relaunched,
    ),
  ).toBe(target);
  expect(await readFile(join(target, 'Inbox.md'), 'utf8')).toBe(
    await readFile(join(flint, 'Inbox.md'), 'utf8'),
  );
  expect((await readdir(target)).length).toBeGreaterThan(3);
  expect((await settingsFile())['flintFolder']).toBe(target);
  await pick('');
  await bounds(1120, 780);
  await main.locator('.sidebar > .nav').first().click();
});

test('fixes after 0.8.2: link patterns between fixed text, guarded, edited; built-ins; links everywhere (NOTE-07, TASK-10, D-105)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const flint = join(dataDirectory, 'Flint');
  const settingsFile = (): Promise<Record<string, unknown>> =>
    readFile(join(dataDirectory, 'appdata', 'settings.json'), 'utf8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => ({}));
  await writeFile(
    join(flint, 'Links today.md'),
    '---\nflint: 1\nid: lk05\nmode: tasks\n---\n- [ ] check DEV-123 today [pinned:: true] [id:: lk1]\n    see DEV-117 in the notes\n',
  );
  const bounds = (width: number, height: number): Promise<void> =>
    app.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('main-window'),
        );
        win?.setBounds({ x: -6000, y: 0, ...size });
      },
      { width, height },
    );
  await bounds(1800, 900);
  await main.locator('.sidebar-foot .nav', { hasText: 'Settings' }).click();
  const add = (): Promise<void> =>
    main.locator('#settings-links .trash-action', { hasText: 'Add a link pattern' }).click();
  const editor = main.locator('.link-editor');
  const field = (label: string) => editor.locator(`input[aria-label="${label}"]`);

  // A repository's name between fixed text ("-repo"): two examples, the second typed key by key
  // (its fields stay while it is typed).
  await add();
  await field('Example link').fill('https://dev.azure.com/acme/web/_git/unicorn-api');
  await field('Short form').fill('unicorn-api-repo');
  await expect(field('Second link')).toBeVisible();
  await field('Second link').pressSequentially('https://dev.azure.com/acme/web/_git/platform');
  await field('Second short form').pressSequentially('platform-repo');
  await expect(field('Second short form')).toHaveValue('platform-repo');
  await expect(editor.locator('.link-preview')).toContainText('unicorn-api-repo');
  await expect(editor.locator('.link-preview')).toContainText(
    'Nothing in your lists and notes matches it yet.',
  );
  await editor.locator('.primary-button', { hasText: 'Save pattern' }).click();
  await expect(main.locator('.link-patterns .link-pattern')).toContainText('name-repo');
  // Edit opens the same editor as it was left.
  await main.locator('.link-patterns .trash-action', { hasText: 'Edit' }).click();
  await expect(field('Example link')).toHaveValue(
    'https://dev.azure.com/acme/web/_git/unicorn-api',
  );
  await expect(field('Second short form')).toHaveValue('platform-repo');
  await editor.locator('.trash-action', { hasText: 'Cancel' }).click();

  // No fixed text: refused, with a suggestion that fixes both examples.
  await add();
  await field('Example link').fill('https://drop.example/Qx7Lp-M42sTn');
  await field('Short form').fill('Qx7Lp-M42sTn');
  await field('Second link').fill('https://drop.example/aB3dE-Xy9Zq');
  await field('Second short form').fill('aB3dE-Xy9Zq');
  await expect(editor.locator('.settings-warning')).toContainText('needs fixed text');
  await expect(editor.locator('.primary-button')).toBeDisabled();
  await editor.locator('.settings-warning .trash-action', { hasText: 'Use it' }).click();
  await expect(field('Short form')).toHaveValue('de:Qx7Lp-M42sTn');
  await expect(field('Second short form')).toHaveValue('de:aB3dE-Xy9Zq');
  await expect(editor.locator('.primary-button')).toBeEnabled();
  await editor.locator('.trash-action', { hasText: 'Cancel' }).click();

  // DEV-123 and DEV-200: a number between fixed text; it already matches two places.
  await add();
  await field('Example link').fill('https://tracker.example/t/DEV-123');
  await field('Short form').fill('DEV-123');
  await field('Second link').fill('https://tracker.example/t/DEV-200');
  await field('Second short form').fill('DEV-200');
  await expect(editor.locator('.link-preview')).toContainText(
    'It matches 2 places in your lists and notes now.',
  );
  await editor.locator('.primary-button', { hasText: 'Save pattern' }).click();
  await expect(main.locator('.link-patterns .link-pattern')).toHaveCount(2);

  // The built-ins, each with its switch.
  const builtIn = main.locator('.link-builtins .switch[aria-label="Azure DevOps pull request"]');
  await expect(builtIn).toHaveAttribute('aria-checked', 'true');
  await builtIn.click();
  await expect
    .poll(async () => JSON.stringify((await settingsFile())['builtInLinksOff']))
    .toBe('["ado-pull-request"]');
  await builtIn.click();
  await expect.poll(async () => (await settingsFile())['builtInLinksOff']).toEqual([]);

  // Everywhere text shows: the title, the panel's notes, Today; the composer while typing.
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Links today' }).click();
  await expect(main.locator('.row .title a.auto-link')).toHaveText('DEV-123');
  await main.locator('.row', { hasText: 'check' }).click({ position: { x: 400, y: 10 } });
  await expect(main.locator('.context-panel .cm-fl-auto-link', { hasText: 'DEV-117' })).toHaveCount(
    1,
  );
  await main.locator('.composer-input').click();
  await main.keyboard.type('follow up https://tracker.example/t/DEV-300');
  await expect(main.locator('.composer .link-chip')).toHaveText('DEV-300');
  await main.locator('.composer-input').fill('');
  await main.keyboard.press('Escape');
  await main.locator('.sidebar > .nav').first().click();
  await expect(main.locator('.today-greeting')).toBeVisible();
  await expect(main.locator('a.auto-link', { hasText: 'DEV-123' }).first()).toBeVisible();

  // The note editor: a pasted link shows short at once (the caret just after it).
  await main.keyboard.press('Control+Shift+J');
  await expect(main.locator('.note-editor .cm-content')).toBeFocused();
  await main.keyboard.type('ask about https://tracker.example/t/DEV-301');
  await expect(main.locator('.note-editor .cm-fl-auto-link', { hasText: 'DEV-301' })).toHaveCount(
    1,
  );
  await main.keyboard.press('Control+a');
  await main.keyboard.press('Delete');

  // The capture popup's chips know the patterns too.
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  await popup.locator('#capture').fill('review https://tracker.example/t/DEV-302');
  await expect(popup.locator('.link-chip')).toHaveText('DEV-302');
  await popup.locator('#capture').fill('');
  await popup.keyboard.press('Escape');
  await bounds(1120, 780);
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
});

test('M8 step 2: the Ctrl+K palette and the ? cheat sheet (NAV-01, NAV-02, D-106)', async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const flint = join(dataDirectory, 'Flint');
  const file = join(flint, 'Palette test.md');
  await writeFile(
    file,
    '---\nflint: 1\nid: plt1\nmode: tasks\n---\n- [ ] Renew the palette certificate [id:: pl1]\n- [ ] Throw the palette draft away [id:: pl2]\n',
  );
  await writeFile(join(flint, 'Palette target.md'), '---\nflint: 1\nid: plt2\nmode: tasks\n---\n');
  const palette = main.locator('.palette[aria-label="Search or run a command"]');
  const field = palette.locator('.palette-field');
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();

  // Ctrl+K anywhere; a list by its name.
  await main.keyboard.press('Control+k');
  await expect(field).toBeFocused();
  await main.keyboard.type('palette tes');
  await expect(palette.locator('.palette-item.on')).toContainText('Palette test');
  await main.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(main.locator('h1')).toContainText('Palette test');

  // A task anywhere, by words of its title: opened in its list, selected.
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await main.keyboard.press('Control+k');
  await main.keyboard.type('renew certificate');
  const task = palette.locator('.palette-item', { hasText: 'Renew the palette certificate' });
  await expect(task).toContainText('Palette test');
  await task.click();
  await expect(main.locator('.row.sel')).toContainText('Renew the palette certificate');

  // The selected task's actions; Move to… is a second step (Backspace goes back).
  await main.keyboard.press('Control+k');
  await expect(palette.locator('.palette-label', { hasText: 'This task' })).toBeVisible();
  await palette.locator('.palette-item', { hasText: 'Move to…' }).click();
  await expect(palette.locator('.palette-crumb')).toHaveText('Move to ›');
  await main.keyboard.press('Backspace');
  await expect(palette.locator('.palette-crumb')).toHaveCount(0);
  await palette.locator('.palette-item', { hasText: 'Move to…' }).click();
  await main.keyboard.type('palette target');
  await main.keyboard.press('Enter');
  await expect
    .poll(() => readFile(join(flint, 'Palette target.md'), 'utf8'))
    .toContain('Renew the palette certificate');

  // Trash and the archive only when asked: the last row. (After the move the selection is on
  // the next task already; a click on a selected row would edit it.)
  await expect(main.locator('.row', { hasText: 'Renew the palette certificate' })).toHaveCount(0);
  await main.waitForTimeout(400);
  const draft = main.locator('.row', { hasText: 'Throw the palette draft away' });
  if (!(await draft.evaluate((row) => row.classList.contains('sel'))))
    await draft.click({ position: { x: 400, y: 10 } });
  await expect(draft).toHaveClass(/(^| )sel( |$)/);
  await main.keyboard.press('Delete');
  await expect(main.locator('.row', { hasText: 'Throw the palette draft away' })).toHaveCount(0);
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('Throw the palette draft away');
  await main.keyboard.press('Control+k');
  await main.keyboard.type('palette draft');
  const more = palette.locator('.palette-item', { hasText: 'Search Trash and Archive' });
  await expect(more).toContainText('Nothing else matches.');
  await more.click();
  await expect(palette.locator('.palette-crumb')).toHaveText('Trash and Archive ›');
  const deleted = palette.locator('.palette-item', { hasText: 'Throw the palette draft away' });
  await expect(deleted).toContainText('Deleted · from Palette test');
  await deleted.click();
  // Trash, with the item open (as a page on this narrow window).
  await expect(main.locator('.trash-preview-title')).toHaveText('Throw the palette draft away');
  await expect(main.locator('.sidebar-foot .nav.on')).toHaveText('Trash');
  await main.keyboard.press('Escape');

  // D-107: the sidebar header's search button (the header pill is gone); Esc closes.
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('.palette-pill')).toHaveCount(0);
  const button = main.locator('.brand .palette-button');
  await expect(button).toHaveAttribute('title', 'Search or run a command (Ctrl+K)');
  // In the window's drag strip, where Windows would take the pointer (and its hover) without this.
  expect(
    await button.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('-webkit-app-region'),
    ),
  ).toBe('no-drag');
  await button.click();
  await expect(field).toBeFocused();
  await main.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);

  // NAV-02: `?` shows every shortcut; typing narrows it; Esc closes.
  await main.keyboard.press('Shift+Slash');
  const sheet = main.locator('.cheat-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.cheat-row', { hasText: 'Quick note' })).toHaveCount(1);
  await main.keyboard.type('interface');
  await expect(sheet.locator('.cheat-row')).toHaveCount(1);
  await expect(sheet.locator('.cheat-row')).toContainText('Interface size');
  await main.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // In the note editor, Ctrl+K with text selected makes it a link.
  await main.keyboard.press('Control+Shift+J');
  await expect(main.locator('.note-editor .cm-content')).toBeFocused();
  await main.keyboard.type('see the runbook');
  await main.keyboard.press('Shift+Control+ArrowLeft');
  await main.keyboard.press('Control+k');
  await expect(palette).toHaveCount(0);
  await main.keyboard.press('Control+a');
  await expect
    .poll(() => main.locator('.note-editor .cm-content').innerText())
    .toContain('[runbook]()');
  await main.keyboard.press('Delete');
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
});

test("fixes after 0.8.5: the quick-note tip, renames kept on leaving, the palette's steps, order, footer and note lines (NOTE-08, LIST-01, NAV-01, D-107)", async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const flint = join(dataDirectory, 'Flint');
  const palette = main.locator('.palette[aria-label="Search or run a command"]');
  const field = palette.locator('.palette-field');
  const menu = main.locator('.fl-menu');
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();

  // 1. An empty quick note removed on leaving says why, the first three times only (one is left
  // here).
  await main.evaluate(() => localStorage.setItem('flint.tips', '{"emptyQuickNote":2}'));
  const tip = main.locator('.toast', {
    hasText: 'Empty quick notes are removed when you leave them',
  });
  await main.keyboard.press('Control+Shift+J');
  await expect(main.locator('.note-editor .cm-content')).toBeFocused();
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await expect(tip).toBeVisible({ timeout: 6000 });
  // The fourth time: none (once this one has gone).
  await expect(tip).toHaveCount(0, { timeout: 15_000 });
  await main.keyboard.press('Control+Shift+J');
  await expect(main.locator('.note-editor .cm-content')).toBeFocused();
  const quickBefore = (await readdir(flint)).length;
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await expect
    .poll(async () => (await readdir(flint)).length, { timeout: 6000 })
    .toBe(quickBefore - 1);
  await main.waitForTimeout(800);
  expect(await tip.count()).toBe(0);

  // 2. A list renamed in place keeps the new name when the field is left; only Esc cancels.
  await writeFile(join(flint, 'Leave me.md'), '---\nflint: 1\nid: lvm1\nmode: tasks\n---\n');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Leave me' }).click({ button: 'right' });
  await menu.getByText('Rename').click();
  await main.keyboard.press('Control+a');
  await main.keyboard.type('Left behind');
  // D-107 (after 0.8.6): saved on leaving looks like Enter: the row stays in place, nothing in
  // the sidebar leaves or arrives (it showed the old name, then the row "arriving" again).
  await main.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { sidebarMotion: string[] }).sidebarMotion = seen;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- put back as it was, and called with its element
    const original = Element.prototype.animate;
    (window as unknown as { restoreAnimate: () => void }).restoreAnimate = () => {
      Element.prototype.animate = original;
    };
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if (this.closest('.sidebar') && !this.matches('.nav-glide'))
        seen.push(this.textContent ?? '');
      return original.apply(this, args);
    };
  });
  await main.locator('h1').click();
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'Left behind' })).toBeVisible();
  await expect
    .poll(() => readFile(join(flint, 'Left behind.md'), 'utf8').catch(() => ''))
    .toContain('id: lvm1');
  await main.waitForTimeout(400);
  expect(
    await main.evaluate(() => (window as unknown as { sidebarMotion: string[] }).sidebarMotion),
  ).toEqual([]);
  await main.evaluate(() => (window as unknown as { restoreAnimate: () => void }).restoreAnimate());
  // A click on another list in the sidebar saves it too (the row keeps the focus, so no blur).
  await main
    .locator('.nav:not(.flip-ghost)', { hasText: 'Left behind' })
    .click({ button: 'right' });
  await menu.getByText('Rename').click();
  await main.keyboard.press('Control+a');
  await main.keyboard.type('Left again');
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('h1')).toContainText('Inbox');
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'Left again' })).toBeVisible();
  await expect
    .poll(() => readFile(join(flint, 'Left again.md'), 'utf8').catch(() => ''))
    .toContain('id: lvm1');
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Left again' }).click({ button: 'right' });
  await menu.getByText('Rename').click();
  await main.keyboard.press('Control+a');
  await main.keyboard.type('Not this');
  await main.keyboard.press('Escape');
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'Left again' })).toBeVisible();
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'Not this' })).toHaveCount(0);

  // 3. A step has a back arrow; Esc goes back one step, and closes only from the top. 5. The
  // footer shows the keys and Ctrl+K.
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await main.keyboard.press('Control+k');
  await expect(palette.locator('.palette-foot')).toContainText('Esc close');
  await expect(palette.locator('.palette-foot')).toContainText('Ctrl K opens this anywhere');
  await expect(palette.locator('.palette-back')).toHaveCount(0);
  await main.keyboard.type('interface size');
  await main.keyboard.press('Enter');
  await expect(palette.locator('.palette-crumb')).toHaveText('Interface size ›');
  await expect(palette.locator('.palette-foot')).toContainText('Esc back');
  await main.keyboard.press('Escape');
  await expect(palette).toBeVisible();
  await expect(palette.locator('.palette-crumb')).toHaveCount(0);
  await main.keyboard.type('interface size');
  await main.keyboard.press('Enter');
  await palette.locator('.palette-back').click();
  await expect(palette.locator('.palette-crumb')).toHaveCount(0);
  await expect(field).toBeFocused();
  await main.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);

  // 4. One order: Go to, Commands, Tasks, Lists and notes, lines in notes last.
  const lines = Array.from({ length: 90 }, (_, i) => `Filler line ${i + 1}`);
  lines[75] = 'The quick brown needle is here';
  lines.splice(80, 3, '```bash', 'echo brown haystack', '```');
  await writeFile(
    join(flint, 'Quick reference.md'),
    `---\nflint: 1\nid: qref\nmode: note\n---\n${lines.join('\n')}\n`,
  );
  await writeFile(
    join(flint, 'Quick tasks.md'),
    '---\nflint: 1\nid: qtsk\nmode: tasks\n---\n- [ ] A quick errand [id:: qe1]\n',
  );
  await main.locator('.sidebar > .nav[data-key="@today"]').click();
  await expect(main.locator('.nav:not(.flip-ghost)', { hasText: 'Quick reference' })).toBeVisible();
  await main.keyboard.press('Control+k');
  await main.keyboard.type('quick');
  await expect(palette.locator('.palette-label', { hasText: 'In notes' })).toBeVisible();
  const shown = (await palette.locator('.palette-label').allInnerTexts()).map((label) =>
    label.toUpperCase(),
  );
  const expected = ['GO TO', 'THIS TASK', 'COMMANDS', 'TASKS', 'LISTS AND NOTES', 'IN NOTES'];
  expect(shown).toEqual(expected.filter((label) => shown.includes(label)));
  expect(shown).toContain('COMMANDS');
  expect(shown).toContain('LISTS AND NOTES');

  // 6. A line in a note opens the note there, the line flashed.
  await main.keyboard.press('Control+a');
  await main.keyboard.type('brown needle');
  await palette.locator('.palette-item', { hasText: 'The quick brown needle is here' }).click();
  const needle = main.locator('.note-editor .cm-line', {
    hasText: 'The quick brown needle is here',
  });
  await expect(needle).toBeInViewport();
  // D-143: what was searched for in the line lights up as find's current match (Ctrl+F) does,
  // word by word, then fades and goes.
  const lit = main.locator('.note-editor .fl-match-flash');
  await expect(lit).toHaveText(['brown', 'needle']);
  const looks = await lit.first().evaluate((mark) => {
    const editor = mark.closest('.cm-editor');
    // At the start of the fade (it may have run on a moment), then put back where it was.
    const fade = editor?.getAnimations()[0];
    const at = fade?.currentTime ?? null;
    if (fade) fade.currentTime = 0;
    const flash = getComputedStyle(mark).backgroundColor;
    if (fade && at !== null) fade.currentTime = at;
    const probe = document.createElement('span');
    probe.className = 'cm-searchMatch cm-searchMatch-selected';
    editor?.closest('.md-editor')?.append(probe);
    const find = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { flash, find, fading: fade !== undefined };
  });
  expect(looks.fading).toBe(true);
  expect(looks.flash).toBe(looks.find);
  await expect(lit).toHaveCount(0, { timeout: 4000 });

  // A line in a code card lights the same way.
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await main.keyboard.press('Control+k');
  await main.keyboard.type('brown haystack');
  await palette.locator('.palette-item', { hasText: 'echo brown haystack' }).click();
  await expect(
    main.locator('.note-editor .cm-line.cm-fl-code', { hasText: 'echo brown haystack' }),
  ).toBeInViewport();
  await expect(main.locator('.note-editor .cm-fl-code .fl-match-flash')).toHaveText([
    'brown',
    'haystack',
  ]);
  await expect(lit).toHaveCount(0, { timeout: 4000 });
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
});

test("the composer's toast: Go to the list a ##list task went to, the task selected, in view and flashed (CAP-04, D-147)", async () => {
  const main = app.windows().find((page) => page.url().includes('main-window'));
  if (!main) throw new Error('main window page not found');
  const flint = join(dataDirectory, 'Flint');
  const file = join(flint, 'Faraway.md');
  const tasks = Array.from({ length: 60 }, (_, i) => `- [ ] Faraway task ${i + 1} [id:: fw${i}]`);
  await writeFile(file, `---\nflint: 1\nid: far1\nmode: tasks\n---\n${tasks.join('\n')}\n`);
  // Opened once and left scrolled to its end: Go to has to bring the new task (at the top) back
  // into view.
  await main.locator('.nav:not(.flip-ghost)', { hasText: 'Faraway' }).click();
  await expect(main.locator('.row', { hasText: 'Faraway task 60' })).toHaveCount(1);
  await expect
    .poll(async () => {
      await main.evaluate(() =>
        document.querySelector('.scroller')?.scrollTo({ top: 1200, behavior: 'instant' }),
      );
      return main.evaluate(() => document.querySelector('.scroller')?.scrollTop ?? 0);
    })
    .toBeGreaterThan(300);
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
  await expect(main.locator('h1')).toContainText('Inbox');
  // The flash is recorded as it happens (it lasts 900 ms).
  await main.evaluate(() => {
    const seen: string[] = [];
    (window as { goToFlashes?: string[] }).goToFlashes = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        const row = record.target as HTMLElement;
        if (row.classList.contains('fl-flash')) seen.push(row.textContent ?? '');
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });

  const composer = main.locator('.composer-input');
  await composer.click();
  await main.keyboard.type('Pack the cables ##Farawa');
  await expect(main.locator('.composer-suggestion').first()).toContainText('Faraway');
  await main.keyboard.press('Enter');
  await expect(composer).toHaveValue('Pack the cables ##Faraway');
  await main.keyboard.press('Enter');
  const toast = main.locator('.toast');
  await expect(toast).toContainText('Added to Faraway');
  // D-147: the way to it, then Undo, as Restore's toast (D-98).
  await expect(toast.locator('button')).toHaveText(['Go to Faraway', 'Undo']);
  await expect.poll(() => readFile(file, 'utf8')).toContain('- [ ] Pack the cables [id:: ');
  await toast.locator('button', { hasText: 'Go to Faraway' }).click();
  await expect(main.locator('h1')).toContainText('Faraway');
  const added = main.locator('.row', { hasText: 'Pack the cables' });
  await expect(added).toHaveClass(/\bsel\b/);
  await expect(added).toBeInViewport();
  await expect
    .poll(() => main.evaluate(() => (window as { goToFlashes?: string[] }).goToFlashes))
    .toEqual(expect.arrayContaining([expect.stringContaining('Pack the cables')]));
  await expect(toast).toHaveCount(0);
  await main.locator('.sidebar > .nav', { hasText: 'Inbox' }).click();
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
