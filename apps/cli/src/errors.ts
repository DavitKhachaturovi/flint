/**
 * AGENT-02 (D-185 Q11): errors and the stable exit codes of `flint`. Flint's own error codes come
 * from the protocol; the client adds four of its own for what happens before Flint answers.
 */
import type { AgentError, AgentErrorCode, Candidate, ItemProblem } from '@flint/core/agents';

/** Codes the client gives itself (Flint never sends them). */
export type LocalErrorCode =
  /** Arguments `flint` can't read: exit 1. */
  | 'usage'
  /** `--no-start` (or `FLINT_NO_START=1`) and Flint isn't running. */
  | 'not_running'
  /** `Flint.exe` isn't where it should be. */
  | 'not_installed'
  /** Flint was started or is running, but its pipe didn't answer in time. */
  | 'unreachable';

export type ErrorCode = AgentErrorCode | LocalErrorCode;

/** An error as printed by `--json` (`{"error": …}`) and returned by the MCP tools. */
export interface ErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly candidates?: readonly Candidate[];
  readonly suggestions?: readonly Candidate[];
  readonly problems?: readonly ItemProblem[];
}

/** The stable exit codes (02 AGENT-02). */
export const EXIT = {
  ok: 0,
  usage: 1,
  input: 2,
  unavailable: 3,
  refused: 4,
  internal: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The exit code for an error code. */
export function exitCodeFor(code: ErrorCode): ExitCode {
  switch (code) {
    case 'usage':
      return EXIT.usage;
    case 'not_found':
    case 'ambiguous':
    case 'bad_time':
    case 'invalid':
      return EXIT.input;
    case 'not_running':
    case 'not_installed':
    case 'unreachable':
      return EXIT.unavailable;
    case 'off':
    case 'read_only':
    case 'paused':
    case 'too_large':
    case 'unauthorized':
      return EXIT.refused;
    case 'protocol':
    case 'internal':
      return EXIT.internal;
  }
}

/** A failure carrying the body that is printed or returned to the agent. */
export class FlintError extends Error {
  readonly body: ErrorBody;

  constructor(body: ErrorBody) {
    super(body.message);
    this.name = 'FlintError';
    this.body = body;
  }

  get exitCode(): ExitCode {
    return exitCodeFor(this.body.code);
  }
}

/** A usage error (exit 1). */
export const usageError = (message: string): FlintError =>
  new FlintError({ code: 'usage', message });

/** Flint's error, as the client passes it on. */
export const fromAgentError = (error: AgentError): FlintError => new FlintError(error);

/** The messages AGENT-02 fixes word for word. */
export const MESSAGES = {
  notRunning: "Flint isn't running.",
  notInstalled: (path: string): string => `Flint isn't installed at ${path}.`,
  off: 'AI agents are off in Flint. Turn them on in Flint → Settings → AI agents.',
  devNotRunning:
    "The development Flint isn't running. Start it with npm run dev (or set FLINT_EXE to start it).",
  noAnswer: (seconds: number): string => `Flint didn't answer within ${seconds} s.`,
  notStarted: (seconds: number): string => `Flint didn't start within ${seconds} s.`,
  closed: 'The connection to Flint closed before it answered.',
} as const;
