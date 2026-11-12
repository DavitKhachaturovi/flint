/**
 * AGENT-02, AGENT-03 end to end inside one process: the real CLI and MCP server, the real pipe
 * client and the real locating, against a fake Flint (a named pipe on `\\.\pipe\flint-test-…` and a
 * temporary app-data folder with `agent-state.json` and `agent-token`).
 */
import { writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import type { AgentRequest } from '@flint/core/agents';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, type Io } from './cli.js';
import { connectPipe } from './client.js';
import { FlintError } from './errors.js';
import { flintExePath, readState, type Env } from './locate.js';
import { McpServer } from './mcp.js';
import { Session } from './session.js';
import { reachFlint } from './start.js';
import { NOW, startFakeFlint, tempDir } from './test-helpers.js';
import { openSession } from './wiring.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fakeFlint(
  answer?: (request: AgentRequest) => unknown,
  options?: { writeFiles?: boolean },
) {
  const dir = tempDir();
  cleanups.push(dir.dispose);
  const flint = await startFakeFlint(dir.path, answer, options);
  cleanups.push(() => flint.close());
  return { dir: dir.path, flint };
}

/** Runs the real CLI (real session, pipe and locating) with this environment. */
async function flint(
  argv: readonly string[],
  env: Env,
): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = {
    env,
    cwd: 'C:\\Work',
    stdoutIsTTY: false,
    stderrIsTTY: false,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    readStdin: () => Promise.resolve(''),
  };
  const code = await runCli(argv, io, {
    openSession: (agent, choice) => openSession(env, agent, choice),
    runMcp: () => Promise.resolve(0),
  });
  return { code, out, err };
}

const WRITE = { changed: [], text: ['Added "Fix login loop" to Inbox · id k3f9a2'] };

describe('the CLI over a real pipe', () => {
  it('sends the token, the protocol, the agent and the request, and prints the answer', async () => {
    const { dir, flint: fake } = await fakeFlint(() => WRITE);
    const result = await flint(['add', 'Fix login loop', '--list', 'Inbox', '--as', 'Nightly'], {
      FLINT_APP_DATA: dir,
    });
    expect(result).toEqual({ code: 0, out: `${WRITE.text[0]}\n`, err: '' });
    expect(fake.requests).toEqual([
      {
        protocol: 1,
        id: 1,
        token: fake.token,
        agent: { name: 'Nightly', via: 'cli' },
        tool: 'create',
        args: {
          items: [{ kind: 'task', title: 'Fix login loop', list: 'Inbox' }],
          parseShorthand: true,
        },
      },
    ]);
  });

  it('prints --json as one document with now', async () => {
    const { dir } = await fakeFlint(() => WRITE);
    const result = await flint(['add', 'x', '--json'], { FLINT_APP_DATA: dir });
    expect(JSON.parse(result.out)).toEqual({ ...WRITE, now: NOW });
  });

  it("passes Flint's errors on with their exit code", async () => {
    const { dir } = await fakeFlint(() => ({
      error: { code: 'paused', message: 'Flint paused agent changes.' },
    }));
    const result = await flint(['task', 'done', 'k3f9a2'], { FLINT_APP_DATA: dir });
    expect(result).toEqual({ code: 4, out: '', err: 'flint: Flint paused agent changes.\n' });
  });

  it('a refused token: tries once more with the token read again, then exit 4', async () => {
    const { dir, flint: fake } = await fakeFlint();
    writeFileSync(join(dir, 'agent-token'), 'stale');
    const result = await flint(['status', '--json'], { FLINT_APP_DATA: dir });
    expect(result.code).toBe(4);
    expect(JSON.parse(result.out)).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized.' },
    });
    expect(fake.requests.map((request) => request.token)).toEqual(['stale', 'stale']);
  });

  it('agents off: exit 4 with the message, nothing sent', async () => {
    const { dir, flint: fake } = await fakeFlint();
    fake.writeState({ on: false, pipe: null });
    const result = await flint(['status'], { FLINT_APP_DATA: dir });
    expect(result).toEqual({
      code: 4,
      out: '',
      err: 'flint: AI agents are off in Flint. Turn them on in Flint → Settings → AI agents.\n',
    });
    expect(fake.requests).toEqual([]);
  });

  it('not running with --no-start (or FLINT_NO_START=1): exit 3', async () => {
    const dir = tempDir();
    cleanups.push(dir.dispose);
    expect(await flint(['status', '--no-start'], { FLINT_APP_DATA: dir.path })).toEqual({
      code: 3,
      out: '',
      err: "flint: Flint isn't running.\n",
    });
    expect((await flint(['status'], { FLINT_APP_DATA: dir.path, FLINT_NO_START: '1' })).code).toBe(
      3,
    );
  });

  it("a missing FLINT_EXE: exit 3, isn't installed", async () => {
    const dir = tempDir();
    cleanups.push(dir.dispose);
    const exe = join(dir.path, 'missing', 'Flint.exe');
    const result = await flint(['status'], { FLINT_APP_DATA: dir.path, FLINT_EXE: exe });
    expect(result).toEqual({ code: 3, out: '', err: `flint: Flint isn't installed at ${exe}.\n` });
  });
});

describe('starting Flint (FLINT_EXE)', () => {
  it('starts the exe once and connects when the started Flint has written its state', async () => {
    const { dir, flint: fake } = await fakeFlint(() => ({ hits: [], more: false }), {
      writeFiles: false,
    });
    const exe = join(dir, 'Flint.exe');
    writeFileSync(exe, '');
    const started: string[] = [];
    const reached = await reachFlint({
      dir,
      noStart: false,
      exe: flintExePath(
        { FLINT_EXE: exe },
        { development: false, execPath: process.execPath, isSea: false },
      ),
      deps: {
        start: (path) => {
          started.push(path);
          // What Flint does at its start: the token, then the state with its pipe.
          writeFileSync(join(dir, 'agent-token'), fake.token);
          fake.writeState({});
        },
      },
    });
    cleanups.push(() => reached.connection.close());
    expect(started).toEqual([exe]);
    expect(reached.state).toEqual(readState(dir));
    expect(reached.token).toBe(fake.token);
  });
});

describe('the MCP server over a real pipe', () => {
  it('reaches Flint on the first tool call, keeps one connection, and names the client', async () => {
    const { dir, flint: fake } = await fakeFlint((request) =>
      request.tool === 'status' ? { readOnly: false } : { hits: [], more: false },
    );
    const sent: Record<string, unknown>[] = [];
    const env = { FLINT_APP_DATA: dir };
    const server = new McpServer({
      send: (message) => sent.push(message),
      log: () => {},
      version: '1.7.0',
      openSession: (agent) => openSession(env, agent, { dev: false, noStart: true }),
      readOnlyNow: () => readState(dir)?.readOnly ?? null,
    });
    cleanups.push(() => server.close());
    await server.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-ai' } },
      }),
    );
    expect(fake.requests).toEqual([]);
    await server.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'flint_find', arguments: { query: 'a' } },
      }),
    );
    await server.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'flint_find', arguments: {} },
      }),
    );
    expect(
      fake.requests.map((request) => [
        request.id,
        request.tool,
        request.agent.name,
        request.agent.via,
      ]),
    ).toEqual([
      [1, 'status', 'Claude', 'mcp'],
      [2, 'find', 'Claude', 'mcp'],
      [3, 'find', 'Claude', 'mcp'],
    ]);
    expect((sent[1]?.['result'] as Record<string, unknown>)['structuredContent']).toEqual({
      hits: [],
      more: false,
      now: NOW,
    });
  });

  it('reconnects after Flint restarted (the connection had closed)', async () => {
    const { dir, flint: fake } = await fakeFlint(() => ({ ok: true }));
    const session = new Session({ name: 'Command line', via: 'cli' }, () =>
      reachFlint({ dir, noStart: true, exe: null }),
    );
    cleanups.push(() => session.close());
    expect((await session.call('status', {})).ok).toBe(true);
    await fake.close();
    const again = await startFakeFlint(dir, () => ({ ok: 'again' }));
    cleanups.push(() => again.close());
    const response = await session.call('status', {});
    expect(response.ok && response.result).toEqual({ ok: 'again' });
  });
});

describe('the pipe client', () => {
  it('rejects pending requests when the connection closes, and refuses to send after', async () => {
    const pipe = `\\\\.\\pipe\\flint-test-close-${process.pid}-${Date.now()}`;
    const server = createServer((socket) => socket.once('data', () => socket.destroy()));
    await new Promise<void>((resolve) => server.listen(pipe, resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const connection = await connectPipe(pipe);
    const request = {
      protocol: 1,
      id: 1,
      token: 't',
      agent: { name: 'x', via: 'cli' as const },
      tool: 'status' as const,
      args: {},
    };
    await expect(connection.send(request)).rejects.toMatchObject({ body: { code: 'unreachable' } });
    expect(connection.closed).toBe(true);
    await expect(connection.send({ ...request, id: 2 })).rejects.toBeInstanceOf(FlintError);
  });

  it("answers a request that gets no answer with Flint didn't answer", async () => {
    const pipe = `\\\\.\\pipe\\flint-test-silent-${process.pid}-${Date.now()}`;
    const sockets: Socket[] = [];
    const server = createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(pipe, resolve));
    const connection = await connectPipe(pipe, 50);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        }),
    );
    cleanups.push(() => connection.close());
    const request = {
      protocol: 1,
      id: 1,
      token: 't',
      agent: { name: 'x', via: 'cli' as const },
      tool: 'status' as const,
      args: {},
    };
    await expect(connection.send(request)).rejects.toMatchObject({
      body: { code: 'unreachable', message: "Flint didn't answer within 1 s." },
    });
    expect(connection.closed).toBe(false);
  });

  it('rejects a pipe nobody listens on', async () => {
    await expect(connectPipe(`\\\\.\\pipe\\flint-test-nobody-${process.pid}`)).rejects.toThrow();
  });
});
