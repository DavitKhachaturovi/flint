/**
 * Test helpers for flint.exe (AGENT-02, AGENT-03): a fake session, a CLI runner capturing its
 * output, and a fake Flint (a real named pipe and app-data folder). Never bundled.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_STATE_FILE,
  AGENT_TOKEN_FILE,
  type AgentError,
  type AgentIdentity,
  type AgentRequest,
  type AgentResponse,
  type AgentState,
  type AgentTool,
  type NowInfo,
} from '@flint/core/agents';
import { runCli, type Io, type ReachChoice } from './cli.js';
import type { Env } from './locate.js';
import type { AgentSession } from './session.js';

export const NOW: NowInfo = {
  local: '2026-03-10T10:00',
  text: 'Tue 10 Mar 2026, 10:00',
  offset: '+04:00',
  timeZone: 'Asia/Tbilisi',
};

export const ok = (result: unknown): AgentResponse => ({ id: 1, ok: true, result, now: NOW });
export const failed = (error: AgentError): AgentResponse => ({ id: 1, ok: false, error, now: NOW });

export interface Call {
  readonly tool: AgentTool;
  readonly args: unknown;
}

/** A session that answers from a function and records what it was asked. */
export class FakeSession implements AgentSession {
  readonly calls: Call[] = [];
  closed = false;
  state: AgentState | null = null;
  private readonly answer: (
    tool: AgentTool,
    args: unknown,
  ) => AgentResponse | Promise<AgentResponse>;

  constructor(answer: (tool: AgentTool, args: unknown) => AgentResponse | Promise<AgentResponse>) {
    this.answer = answer;
  }

  async call(tool: AgentTool, args: unknown): Promise<AgentResponse> {
    this.calls.push({ tool, args });
    return this.answer(tool, args);
  }

  close(): void {
    this.closed = true;
  }
}

export interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly calls: readonly Call[];
  readonly agents: readonly AgentIdentity[];
  readonly choices: readonly ReachChoice[];
}

export interface RunOptions {
  readonly answer?: (tool: AgentTool, args: unknown) => AgentResponse | Promise<AgentResponse>;
  readonly stdin?: string;
  readonly env?: Env;
  readonly tty?: boolean;
  readonly cwd?: string;
}

/** Runs the CLI in-process with a fake session. */
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  let out = '';
  let err = '';
  const sessions: FakeSession[] = [];
  const agents: AgentIdentity[] = [];
  const choices: ReachChoice[] = [];
  const io: Io = {
    env: options.env ?? {},
    cwd: options.cwd ?? 'C:\\Work',
    stdoutIsTTY: options.tty ?? false,
    stderrIsTTY: options.tty ?? false,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    readStdin: () => Promise.resolve(options.stdin ?? ''),
  };
  const code = await runCli(argv, io, {
    openSession: (agent, choice) => {
      agents.push(agent);
      choices.push(choice);
      const session = new FakeSession(
        options.answer ?? (() => ok({ changed: [], text: ['Done.'] })),
      );
      sessions.push(session);
      return session;
    },
    runMcp: () => Promise.resolve(0),
  });
  return { code, out, err, calls: sessions.flatMap((session) => session.calls), agents, choices };
}

/** A temporary folder, removed by `dispose`. */
export function tempDir(): { path: string; dispose: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'flint-cli-test-'));
  return { path, dispose: () => rmSync(path, { recursive: true, force: true }) };
}

export interface FakeFlint {
  readonly pipe: string;
  readonly token: string;
  readonly requests: AgentRequest[];
  /** Rewrites agent-state.json (the switches in Settings). */
  writeState(change: Partial<AgentState>): void;
  close(): Promise<void>;
}

/**
 * A fake Flint: a pipe server on `\\.\pipe\flint-test-<random>` answering newline-delimited JSON,
 * with `agent-state.json` and `agent-token` written into `dir`.
 */
export async function startFakeFlint(
  dir: string,
  answer: (request: AgentRequest) => unknown = () => ({ changed: [], text: ['Done.'] }),
  options: { readonly writeFiles?: boolean } = {},
): Promise<FakeFlint> {
  const pipe = `\\\\.\\pipe\\flint-test-${randomBytes(8).toString('hex')}`;
  const token = randomBytes(32).toString('hex');
  const requests: AgentRequest[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const request = JSON.parse(buffer.slice(0, newline)) as AgentRequest;
        buffer = buffer.slice(newline + 1);
        requests.push(request);
        let response: AgentResponse;
        if (request.token !== token)
          response = {
            id: request.id,
            ok: false,
            error: { code: 'unauthorized', message: 'Unauthorized.' },
          };
        else {
          const result = answer(request);
          response =
            typeof result === 'object' && result !== null && 'error' in result
              ? {
                  id: request.id,
                  ok: false,
                  error: (result as { error: AgentError }).error,
                  now: NOW,
                }
              : { id: request.id, ok: true, result, now: NOW };
        }
        socket.write(`${JSON.stringify(response)}\n`);
        newline = buffer.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(pipe, resolve));
  let state: AgentState = {
    protocol: 1,
    pid: process.pid,
    on: true,
    readOnly: false,
    paused: false,
    pipe,
    version: '1.8.0',
  };
  const writeState = (change: Partial<AgentState>): void => {
    state = { ...state, ...change };
    writeFileSync(join(dir, AGENT_STATE_FILE), JSON.stringify(state));
  };
  if (options.writeFiles !== false) {
    writeState({});
    writeFileSync(join(dir, AGENT_TOKEN_FILE), `${token}\r\n`);
  }
  return {
    pipe,
    token,
    requests,
    writeState,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
