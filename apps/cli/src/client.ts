/**
 * AGENT-01 (D-185 Q3): the pipe client. Newline-delimited JSON over Flint's named pipe: one request
 * per line, one answer per line, matched by `id`. A connection carries many requests (the MCP
 * server keeps one open); each waits at most 30 s.
 */
import { connect as netConnect, type Socket } from 'node:net';
import type { AgentRequest, AgentResponse } from '@flint/core/agents';
import { FlintError, MESSAGES } from './errors.js';

/** Flint's own per-request limit (02 AGENT-01). */
export const REQUEST_TIMEOUT_MS = 30_000;

/** One open connection to Flint's agent API. */
export interface Connection {
  /** Sends a request (its `id` is the caller's) and waits for the answer with that `id`. */
  send(request: AgentRequest): Promise<AgentResponse>;
  close(): void;
  readonly closed: boolean;
}

interface Pending {
  readonly resolve: (response: AgentResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A connection over a socket that is already open (tests use it with any duplex socket). */
export class PipeConnection implements Connection {
  private readonly pending = new Map<number, Pending>();
  private buffer = '';
  private isClosed = false;
  private readonly socket: Socket;
  private readonly timeoutMs: number;

  constructor(socket: Socket, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.receive(chunk));
    socket.on('close', () =>
      this.fail(new FlintError({ code: 'unreachable', message: MESSAGES.closed })),
    );
    socket.on('error', () => {
      // `close` follows and rejects what is pending.
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  send(request: AgentRequest): Promise<AgentResponse> {
    if (this.isClosed)
      return Promise.reject(new FlintError({ code: 'unreachable', message: MESSAGES.closed }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(
          new FlintError({
            code: 'unreachable',
            message: MESSAGES.noAnswer(Math.ceil(this.timeoutMs / 1000)),
          }),
        );
      }, this.timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify(request)}\n`);
    });
  }

  close(): void {
    this.isClosed = true;
    this.socket.end();
    this.socket.destroy();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line !== '') this.answer(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private answer(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.fail(new FlintError({ code: 'protocol', message: "Flint's answer wasn't JSON." }));
      this.close();
      return;
    }
    if (
      !isRecord(parsed) ||
      typeof parsed['id'] !== 'number' ||
      typeof parsed['ok'] !== 'boolean'
    ) {
      // An answer without an id (Flint refusing a malformed or unauthorized request) goes to the
      // oldest request: answers come in order.
      const first = this.pending.keys().next();
      if (first.done || !isRecord(parsed) || !isRecord(parsed['error'])) {
        this.fail(
          new FlintError({ code: 'protocol', message: "Flint's answer wasn't understood." }),
        );
        this.close();
        return;
      }
      this.settle(first.value, { ...parsed, id: first.value, ok: false } as AgentResponse);
      return;
    }
    this.settle(parsed['id'], parsed as unknown as AgentResponse);
  }

  private settle(id: number, response: AgentResponse): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }

  private fail(error: Error): void {
    this.isClosed = true;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

/** Opens Flint's pipe; rejects when nothing listens on it. */
export function connectPipe(pipe: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(pipe);
    const onError = (error: Error): void => {
      socket.destroy();
      reject(error);
    };
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(new PipeConnection(socket, timeoutMs));
    });
  });
}
