/**
 * AGENT-03 (D-185 Q10): `flint mcp`, Flint's MCP server over stdio. JSON-RPC 2.0, one message per
 * line; nothing but protocol messages on stdout (logs go to stderr). Flint's own small
 * implementation (docs/05 §5, no SDK): initialize, ping, tools/list, tools/call and
 * `notifications/tools/list_changed`. It speaks the initialize-based revisions (up to 2025-11-25);
 * a client of the stateless 2026-07-28 revision probes with `server/discover`, gets "method not
 * found" and falls back to `initialize`, as that revision's stdio binding says.
 *
 * Flint is reached lazily, on the first tool call, never at `initialize` (D-185 Q2): clients start
 * their servers when they launch.
 */
import type { AgentIdentity, AgentResponse } from '@flint/core/agents';
import { mcpAgent } from './agent.js';
import { withNow } from './cli.js';
import { FlintError, type ErrorBody } from './errors.js';
import type { AgentSession } from './session.js';
import { describeTool, listedTools, toolByName } from './tools.js';

/** Newest first; an unknown requested version gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

export const INSTRUCTIONS =
  "Flint is the user's quick-capture notes and tasks app on this PC: task lists, notes, groups, Today's pinned tasks and reminders. " +
  'Call flint_find first (no query: the overview with every list and "now"), then act by the IDs it returns. ' +
  'Read long notes by line range or outline; edit notes with append or replace instead of resending them. ' +
  "Changes go through Flint (the user can undo them in Settings → AI agents); never edit Flint's files directly.";

/** JSON-RPC error codes. */
export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export interface McpDeps {
  /** Writes one message to stdout. */
  readonly send: (message: Readonly<Record<string, unknown>>) => void;
  /** stderr. */
  readonly log: (text: string) => void;
  readonly version: string;
  /** The session for the client's agent (main.ts: reaches Flint, starting it). */
  readonly openSession: (agent: AgentIdentity) => AgentSession;
  /** Read-only from `agent-state.json`, re-read once Flint has been reached; null if unknown. */
  readonly readOnlyNow?: () => boolean | null;
}

type Id = string | number;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class McpServer {
  private agent: AgentIdentity = mcpAgent(undefined);
  private initialized = false;
  private session: AgentSession | null = null;
  private contact: Promise<AgentSession> | null = null;
  /** null until Flint has been reached: then every tool is listed. */
  private readOnly: boolean | null = null;

  private readonly deps: McpDeps;

  constructor(deps: McpDeps) {
    this.deps = deps;
  }

  /** One line from stdin. */
  async handleLine(line: string): Promise<void> {
    if (line.trim() === '') return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.error(null, RPC.parse, 'Parse error');
      return;
    }
    await this.handle(message);
  }

  async handle(message: unknown): Promise<void> {
    if (!isRecord(message) || message['jsonrpc'] !== '2.0') {
      this.error(null, RPC.invalidRequest, 'Invalid request: expected one JSON-RPC 2.0 message');
      return;
    }
    const method = message['method'];
    const rawId = message['id'];
    const id: Id | undefined =
      typeof rawId === 'string' || typeof rawId === 'number' ? rawId : undefined;
    if (typeof method !== 'string') return; // A response to us (we send no requests): ignored.
    const params = isRecord(message['params']) ? message['params'] : {};
    if (id === undefined) {
      if (method === 'notifications/initialized') this.initialized = true;
      return; // Notifications (initialized, cancelled…) get no answer.
    }
    try {
      switch (method) {
        case 'initialize':
          this.reply(id, this.initialize(params));
          return;
        case 'ping':
          this.reply(id, {});
          return;
        case 'tools/list':
          this.refreshReadOnly();
          this.reply(id, { tools: listedTools(this.readOnly === true).map(describeTool) });
          return;
        case 'tools/call':
          await this.call(id, params);
          return;
        default:
          this.error(id, RPC.methodNotFound, `Method not found: ${method}`);
      }
    } catch (error) {
      this.deps.log(
        `flint mcp: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      this.error(id, RPC.internal, 'Internal error');
    }
  }

  /** Re-reads read-only (the state file changed); tells the client when its tool list changes. */
  refreshReadOnly(): void {
    if (this.session === null) return;
    const now = this.deps.readOnlyNow?.();
    if (now !== undefined && now !== null) this.setReadOnly(now);
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }

  private initialize(params: Record<string, unknown>): Record<string, unknown> {
    const requested = params['protocolVersion'];
    const protocolVersion = (PROTOCOL_VERSIONS as readonly unknown[]).includes(requested)
      ? (requested as string)
      : PROTOCOL_VERSIONS[0];
    const info = params['clientInfo'];
    this.agent = mcpAgent(isRecord(info) ? info : undefined);
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'flint', title: 'Flint', version: this.deps.version },
      instructions: INSTRUCTIONS,
    };
  }

  private async call(id: Id, params: Record<string, unknown>): Promise<void> {
    const name = params['name'];
    const tool = typeof name === 'string' ? toolByName(name) : undefined;
    if (!tool) {
      this.error(
        id,
        RPC.invalidParams,
        `Unknown tool: ${typeof name === 'string' ? name : '(none)'}`,
      );
      return;
    }
    const args = params['arguments'] ?? {};
    if (!isRecord(args)) {
      this.error(id, RPC.invalidParams, 'Tool arguments must be an object');
      return;
    }
    let response: AgentResponse;
    try {
      const session = await this.reach();
      response = await session.call(tool.tool, args);
    } catch (error) {
      const body: ErrorBody =
        error instanceof FlintError
          ? error.body
          : { code: 'internal', message: error instanceof Error ? error.message : String(error) };
      this.reply(id, toolError(body));
      return;
    }
    if (response.ok) {
      if (!tool.readOnly) this.setReadOnly(false);
      else this.refreshReadOnly();
      const result = withNow(response.result, response.now);
      this.reply(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        ...(isRecord(result) ? { structuredContent: result } : {}),
      });
      return;
    }
    if (response.error.code === 'read_only') this.setReadOnly(true);
    this.reply(id, toolError(response.error));
  }

  /** The session, reaching Flint on the first call; then asks `status` whether it is read-only. */
  private reach(): Promise<AgentSession> {
    if (this.session) return Promise.resolve(this.session);
    this.contact ??= this.makeContact().finally(() => {
      this.contact = null;
    });
    return this.contact;
  }

  private async makeContact(): Promise<AgentSession> {
    const session = this.deps.openSession(this.agent);
    let status: AgentResponse;
    try {
      status = await session.call('status', {});
    } catch (error) {
      session.close();
      throw error;
    }
    this.session = session;
    if (status.ok && isRecord(status.result) && typeof status.result['readOnly'] === 'boolean')
      this.setReadOnly(status.result['readOnly']);
    return session;
  }

  private setReadOnly(readOnly: boolean): void {
    const before = this.readOnly === true;
    this.readOnly = readOnly;
    if (before !== readOnly && this.initialized)
      this.deps.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
  }

  private reply(id: Id, result: Record<string, unknown>): void {
    this.deps.send({ jsonrpc: '2.0', id, result });
  }

  private error(id: Id | null, code: number, message: string): void {
    this.deps.send({ jsonrpc: '2.0', id, error: { code, message } });
  }
}

/** A tool error the agent can read (`isError`), in the same shape as `flint --json`. */
function toolError(body: ErrorBody): Record<string, unknown> {
  const error = { error: body };
  return {
    content: [{ type: 'text', text: JSON.stringify(error) }],
    structuredContent: error,
    isError: true,
  };
}
