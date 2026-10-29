import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
