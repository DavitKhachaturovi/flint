/**
 * AGENT-02, AGENT-03: the real wiring of the CLI and the MCP server to this process (stdio, the
 * environment, Flint's app-data folder). No side effects until called; main.ts calls it.
 */
import { watch, type FSWatcher } from 'node:fs';
import { createInterface } from 'node:readline';
import { isSea } from 'node:sea';
import { once } from 'node:events';
import { AGENT_STATE_FILE, type AgentIdentity } from '@flint/core/agents';
import pkg from '../package.json' with { type: 'json' };
import type { CliDeps, Io, ReachChoice } from './cli.js';
import { appDataDir, flintExePath, isDevelopment, readState, type Env } from './locate.js';
import { McpServer } from './mcp.js';
import { Session } from './session.js';
import { reachFlint } from './start.js';

/** `flint.exe`'s version: Flint's, shipped together. */
export const VERSION: string = pkg.version;

/** Where Flint is for this choice (`--dev`) and how to start it. */
export function placeFor(env: Env, choice: ReachChoice): { dir: string; exe: string | null } {
  const development = isDevelopment(env, choice.dev);
  return {
    dir: appDataDir(env, development, isSea()),
    exe: flintExePath(env, { development, execPath: process.execPath, isSea: isSea() }),
  };
}

/** A session that reaches the real Flint (starting it unless `--no-start`). */
export function openSession(env: Env, agent: AgentIdentity, choice: ReachChoice): Session {
  const { dir, exe } = placeFor(env, choice);
  return new Session(agent, () => reachFlint({ dir, exe, noStart: choice.noStart }));
}

/** `flint mcp` on this process's stdio, until stdin closes. */
export async function runMcpStdio(env: Env, choice: ReachChoice): Promise<number> {
  const { dir } = placeFor(env, choice);
  const server = new McpServer({
    send: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
    log: (text) => process.stderr.write(`${text}\n`),
    version: VERSION,
    openSession: (agent) => openSession(env, agent, choice),
    readOnlyNow: () => readState(dir)?.readOnly ?? null,
  });
  // Read-only switched in Flint while connected: tools/list_changed (AGENT-03).
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, { persistent: false }, (_event, file) => {
      if (file === AGENT_STATE_FILE) server.refreshReadOnly();
    });
    watcher.on('error', () => watcher?.close());
  } catch {
    // No app-data folder yet: tools/list and each call still re-read the state.
  }
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Messages are handled as they come (a ping isn't held up by a tool call); the ones still
  // running when stdin closes get their answers before the server stops.
  const running = new Set<Promise<void>>();
  lines.on('line', (line) => {
    const handled = server.handleLine(line).finally(() => running.delete(handled));
    running.add(handled);
  });
  await once(lines, 'close');
  await Promise.allSettled([...running]);
  watcher?.close();
  server.close();
  return 0;
}

/** The process's own stdio for the CLI. */
export function processIo(): Io {
  return {
    env: process.env,
    cwd: process.cwd(),
    stdoutIsTTY: process.stdout.isTTY === true,
    stderrIsTTY: process.stderr.isTTY === true,
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

export function processDeps(env: Env): CliDeps {
  return {
    openSession: (agent, choice) => openSession(env, agent, choice),
    runMcp: (choice) => runMcpStdio(env, choice),
  };
}
