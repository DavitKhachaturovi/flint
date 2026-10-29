import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

const port = (address: string): string => address.slice(address.lastIndexOf(':') + 1);
const isLoopback = (address: string): boolean => /^(127\.|\[::1\])/.test(address);

let dataDirectory: string;
let proxy: Server;
const proxied: string[] = [];
let app: ElectronApplication;
const violations = new Set<string>();
let poller: NodeJS.Timeout | undefined;

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-'));
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

test('a capture typed in the popup reaches the main process on Enter (D-27)', async () => {
  await app.evaluate(() =>
    (globalThis as { __flintE2E?: { showPopup?: () => void } }).__flintE2E?.showPopup?.(),
  );
  const popup = app.windows().find((page) => page.url().includes('capture-popup'));
  if (!popup) throw new Error('capture popup page not found');
  await popup.locator('#capture').fill('check the e2e capture');
  await popup.locator('#capture').press('Enter');
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as { __flintE2E?: { captured: string[] } }).__flintE2E?.captured ?? [],
      ),
    )
    .toEqual(['check the e2e capture']);
  await expect(popup.locator('#capture')).toHaveValue('');
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
