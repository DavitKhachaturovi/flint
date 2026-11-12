import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
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
 * AGENT-01 to AGENT-03 (D-185): AI agents end to end: the development Flint on a temporary Flint
 * folder (never real data), driven by the real `flint` command (the CLI bundle) and its MCP server
 * over stdio. On the test clock (D-107), waiting for what it checks (D-156).
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

const UNICORN = [
  '---',
  'flint: 1',
  'id: unicorn',
  'mode: tasks',
  '---',
  '- [ ] Review the PR [id:: t1]',
  '',
].join('\n');

interface Hooks {
  blockedRequests: string[];
}
const hooks = (): Promise<Hooks> =>
  app.evaluate(() => (globalThis as unknown as { __flintE2E: Hooks }).__flintE2E);

/** The real command, against this test's Flint (never starting another). */
function flintCommand(
  args: readonly string[],
  env: Record<string, string> = {},
): { code: number; out: string; err: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, FLINT_APP_DATA: appData, FLINT_NO_START: '1', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}
function json<T>(args: readonly string[]): T {
  const result = flintCommand([...args, '--json']);
  expect(result.code, result.err || result.out).toBe(0);
  return JSON.parse(result.out) as T;
}
const file = (name: string): Promise<string> => readFile(join(flint, name), 'utf8');
const row = (title: string): ReturnType<Page['locator']> =>
  main.locator('.row', { hasText: title }).first();

test.beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), 'flint-e2e-agents-'));
  flint = join(dataDirectory, 'Flint');
  appData = join(dataDirectory, 'appdata');
  await mkdir(join(flint, '.flint'), { recursive: true });
  await mkdir(appData, { recursive: true });
  await writeFile(join(flint, 'Inbox.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
  await writeFile(join(flint, 'Unicorn.md'), UNICORN);
  await writeFile(
    join(flint, 'Payroll.md'),
    '---\nflint: 1\nid: payroll\nmode: tasks\n---\n- [ ] Pay Alex [id:: p1]\n',
  );
  await writeFile(
    join(flint, '.flint', 'agents.json'),
    JSON.stringify({ flint: 1, hidden: { payroll: '2026-03-10T08:00:00.000Z' }, shown: {} }),
  );
  // AGENT-05: agents on (Settings' switch is the user's; the test starts with it on).
  await writeFile(join(appData, 'settings.json'), JSON.stringify({ agentsOn: true }));
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
    window.setBounds({ x: -6000, y: 0, width: 1400, height: 900 });
    window.showInactive();
  });
  await main.locator('.nav', { hasText: 'Unicorn' }).first().click();
  await expect(row('Review the PR')).toBeVisible();
  // Agents are on once agent-state.json says so (the pipe is listening).
  await expect
    .poll(async () => {
      const state = JSON.parse(
        await readFile(join(appData, 'agent-state.json'), 'utf8').catch(() => '{}'),
      ) as { on?: boolean };
      return state.on === true;
    })
    .toBe(true);
});

test.afterAll(async () => {
  await app?.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('the flint command reads, adds and completes through Flint (AGENT-02)', async () => {
  const overview = json<{ overview: { lists: { name: string }[] }; now: { local: string } }>([]);
  expect(overview.overview.lists.map((list) => list.name)).toEqual(['Inbox', 'Unicorn']);
  expect(overview.now.local).toBe('2026-03-10T10:00');

  const added = json<{ changed: { id: string; reminder?: { text: string } }[] }>([
    'add',
    'Email alex@acme.example',
    '--list',
    'Unicorn',
    '--priority',
    'high',
    '--remind',
    'tomorrow 9:00',
    '--literal',
  ]);
  const id = added.changed[0]?.id ?? '';
  expect(added.changed[0]?.reminder?.text).toBe('Wed 11 Mar, 09:00');
  const line = (await file('Unicorn.md')).split('\n').find((each) => each.includes(`[id:: ${id}]`));
  expect(line).toMatch(/^- \[ \] Email alex@acme\.example /);
  expect(line).toContain('[priority:: high]');
  expect(line).toContain('[reminder:: 2026-03-11T09:00]');
  // The open window shows it at once (DATA-06's path: the workspace told it).
  await expect(row('Email alex@acme.example')).toBeVisible();

  const done = flintCommand(['task', 'done', id]);
  expect(done.code, done.err).toBe(0);
  await expect.poll(() => file('Unicorn.md')).toContain('- [x] Email alex@acme.example');
});

test('never a guess, and hidden lists don’t exist (D-185 Q6, AGENT-06)', () => {
  const missing = flintCommand(['read', 'Payroll']);
  expect(missing.code).toBe(2);
  expect(missing.err + missing.out).not.toMatch(/hidden/i);
  expect(flintCommand(['task', 'done', 'Pay Alex']).code).toBe(2);
});

test('a wrong token gets nothing (D-185 Q3)', async () => {
  const token = await readFile(join(appData, 'agent-token'), 'utf8');
  expect(token.trim()).toMatch(/^[0-9a-f]{64}$/);
  await writeFile(join(appData, 'agent-token'), 'f'.repeat(64));
  try {
    const refused = flintCommand(['--json']);
    expect(refused.code).toBe(4);
    expect(refused.out).toContain('unauthorized');
  } finally {
    await writeFile(join(appData, 'agent-token'), token);
  }
});

test('the MCP server answers over stdio and names its client (AGENT-03, Q4)', async () => {
  const server: ChildProcessWithoutNullStreams = spawn(process.execPath, [cli, 'mcp'], {
    env: { ...process.env, FLINT_APP_DATA: appData, FLINT_NO_START: '1' },
  });
  const answers = new Map<number, unknown>();
  let buffer = '';
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\n');
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf('\n');
      if (line === '') continue;
      const message = JSON.parse(line) as { id?: number };
      if (typeof message.id === 'number') answers.set(message.id, message);
    }
  });
  const send = (message: object): void => {
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const answer = async <T>(id: number): Promise<T> => {
    await expect.poll(() => answers.has(id), { timeout: 15_000 }).toBe(true);
    return answers.get(id) as T;
  };
  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'claude-ai', version: '1.0' },
      },
    });
    expect(await answer<{ result: { serverInfo: { name: string } } }>(1)).toMatchObject({
      result: { serverInfo: { name: 'flint' } },
    });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    const tools = await answer<{ result: { tools: { name: string }[] } }>(2);
    expect(tools.result.tools.map((tool) => tool.name).sort()).toEqual([
      'flint_create',
      'flint_delete',
      'flint_find',
      'flint_link_patterns',
      'flint_read',
      'flint_update',
    ]);
    send({
      id: 3,
      method: 'tools/call',
      params: {
        name: 'flint_create',
        arguments: { items: [{ kind: 'task', title: 'From Claude', list: 'Unicorn' }] },
      },
    });
    const created = await answer<{
      result: { isError?: boolean; structuredContent: { changed: { id: string }[] } };
    }>(3);
    expect(created.result.isError).toBeFalsy();
    const id = created.result.structuredContent.changed[0]?.id ?? '';
    await expect(row('From Claude')).toBeVisible();
    // Q4: Claude Desktop's clientInfo name is shown as "Claude".
    await expect
      .poll(async () => {
        const meta = JSON.parse(await file('.flint/meta.json').catch(() => '{}')) as {
          tasks?: Record<string, { createdBy?: string }>;
        };
        return meta.tasks?.[id]?.createdBy;
      })
      .toBe('Claude');
  } finally {
    server.kill();
  }
});

test('nothing goes to the network, and a quit leaves no token behind (APP-09, D-185 Q3)', async () => {
  expect((await hooks()).blockedRequests).toEqual([]);
  await app.close();
  await expect(stat(join(appData, 'agent-token'))).rejects.toThrow();
  const state = JSON.parse(await readFile(join(appData, 'agent-state.json'), 'utf8')) as {
    on: boolean;
  };
  expect(state.on).toBe(false);
});
