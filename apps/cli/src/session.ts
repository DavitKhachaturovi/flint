/**
 * AGENT-01 (D-185 Q3, Q4): one agent's conversation with Flint. It reaches Flint lazily, sends each
 * request with the protocol version, the token and the agent's name, and keeps the connection for
 * the next one (the MCP server's whole life; one request for the CLI).
 */
import {
  AGENT_PROTOCOL,
  type AgentIdentity,
  type AgentResponse,
  type AgentState,
  type AgentTool,
} from '@flint/core/agents';
import { FlintError } from './errors.js';
import type { Reached } from './start.js';

/** Tools that change nothing, so a dropped one can be sent again. */
const READS: ReadonlySet<AgentTool> = new Set(['status', 'find', 'read']);

/** What the CLI and the MCP server need from a session (tests fake it). */
export interface AgentSession {
  call(tool: AgentTool, args: unknown): Promise<AgentResponse>;
  /** Flint's state when it was last reached, null before. */
  readonly state: AgentState | null;
  close(): void;
}

export class Session implements AgentSession {
  private reached: Reached | null = null;
  private reaching: Promise<Reached> | null = null;
  private nextId = 1;

  private readonly agent: AgentIdentity;
  private readonly reach: () => Promise<Reached>;

  constructor(agent: AgentIdentity, reach: () => Promise<Reached>) {
    this.agent = agent;
    this.reach = reach;
  }

  get state(): AgentState | null {
    return this.reached?.state ?? null;
  }

  /**
   * Sends one request. Reaches Flint again, once, when the connection had closed (Flint restarted)
   * before the request went out, or under a read (reading twice changes nothing); and when the token
   * was refused (renewed when agents were turned on again), which changed nothing either. A write
   * whose connection dropped is never sent twice: it may have been applied.
   */
  async call(tool: AgentTool, args: unknown): Promise<AgentResponse> {
    let reached = await this.connection();
    if (reached.connection.closed) {
      this.drop();
      reached = await this.connection();
    }
    let response: AgentResponse;
    try {
      response = await this.send(reached, tool, args);
    } catch (error) {
      if (!(error instanceof FlintError) || !reached.connection.closed || !READS.has(tool))
        throw error;
      this.drop();
      return this.send(await this.connection(), tool, args);
    }
    if (response.ok || response.error.code !== 'unauthorized') return response;
    this.drop();
    return this.send(await this.connection(), tool, args);
  }

  close(): void {
    this.drop();
  }

  private send(reached: Reached, tool: AgentTool, args: unknown): Promise<AgentResponse> {
    return reached.connection.send({
      protocol: AGENT_PROTOCOL,
      id: this.nextId++,
      token: reached.token,
      agent: this.agent,
      tool,
      args,
    });
  }

  private async connection(): Promise<Reached> {
    if (this.reached) return this.reached;
    this.reaching ??= this.reach();
    try {
      this.reached = await this.reaching;
      return this.reached;
    } finally {
      this.reaching = null;
    }
  }

  private drop(): void {
    this.reached?.connection.close();
    this.reached = null;
  }
}
