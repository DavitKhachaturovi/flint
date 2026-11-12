import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { FIXED_LIMITS, type AgentRequest, type AgentResponse } from '@flint/core/agents';

/**
 * AGENT-01 (D-185 Q3): the agents' named pipe. Node gives a pipe Windows' default permissions
 * (anyone may open it to read; remote clients aren't refused), so every request must carry the
 * token from `agent-token`; a wrong one is answered with `unauthorized` and nothing else. One
 * request per line, one answer per line, in order; at most 8 connections, 30 s per request.
 */

/** `\\.\pipe\flint-agents-<hash>`: per app-data folder, so per build identity and user. */
export function pipeName(userData: string): string {
  const hash = createHash('sha256').update(userData.toLowerCase()).digest('hex').slice(0, 20);
  return `\\\\.\\pipe\\flint-agents-${hash}`;
}

/** Constant-time comparison (Davit, D-185 Q3). */
export function sameToken(given: unknown, token: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(token, 'utf8');
  // Compared at the same length either way, so the time says nothing about the token.
  const padded = Buffer.alloc(b.length);
  a.copy(padded, 0, 0, Math.min(a.length, b.length));
  return timingSafeEqual(padded, b) && a.length === b.length;
}

export interface PipeHandlers {
  /** A request whose token matched. */
  readonly handle: (request: AgentRequest, connection: number) => Promise<AgentResponse>;
  readonly token: () => string;
  /** A connection closed (its agent is no longer connected). */
  readonly closed?: (connection: number) => void;
}

export class AgentPipe {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private next = 0;
  readonly name: string;
  private readonly handlers: PipeHandlers;

  constructor(name: string, handlers: PipeHandlers) {
    this.name = name;
    this.handlers = handlers;
  }

  /** Resolves once listening; rejects `taken` when another program holds the name. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.connect(socket));
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(error.code === 'EADDRINUSE' ? new Error('taken') : error);
      });
      server.listen(this.name, () => {
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private connect(socket: Socket): void {
    if (this.sockets.size >= FIXED_LIMITS.connections) {
      socket.destroy();
      return;
    }
    const connection = (this.next += 1);
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    let queue = Promise.resolve();
    const send = (response: AgentResponse): void => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
    };
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > FIXED_LIMITS.requestBytes + 1024 && !buffer.includes('\n')) {
        send({
          id: 0,
          ok: false,
          error: { code: 'too_large', message: 'The request is larger than 2 MB.' },
        });
        socket.destroy();
        return;
      }
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\n');
        if (line === '') continue;
        queue = queue.then(() => this.answer(line, connection).then(send));
      }
    });
    const close = (): void => {
      this.sockets.delete(socket);
      this.handlers.closed?.(connection);
    };
    socket.on('close', close);
    socket.on('error', () => socket.destroy());
  }

  private async answer(line: string, connection: number): Promise<AgentResponse> {
    let request: AgentRequest;
    try {
      request = JSON.parse(line) as AgentRequest;
    } catch {
      return { id: 0, ok: false, error: { code: 'invalid', message: 'Not JSON.' } };
    }
    const id = typeof request?.id === 'number' ? request.id : 0;
    if (!sameToken(request?.token, this.handlers.token()))
      return { id, ok: false, error: { code: 'unauthorized', message: 'Unauthorized.' } };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<AgentResponse>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            id,
            ok: false,
            error: {
              code: 'internal',
              message: 'Flint took longer than 30 seconds; the change may still finish.',
            },
          }),
        FIXED_LIMITS.requestMs,
      );
    });
    try {
      return await Promise.race([this.handlers.handle(request, connection), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
