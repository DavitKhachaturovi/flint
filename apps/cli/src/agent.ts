/**
 * AGENT-01 (D-185 Q4): who is asking. The name is a label the client gives, not proof; Flint shows
 * it in the context panel's footer, a note's header and Recent agent changes.
 */
import type { AgentIdentity } from '@flint/core/agents';
import type { Env } from './locate.js';

/** At most this many characters of a client's own name. */
export const AGENT_NAME_MAX = 32;

/** Control characters (C0, DEL, C1) and the line and paragraph separators. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** A name as Flint will show it: no control characters, trimmed, at most 32 characters. */
export function cleanName(name: string): string {
  return [...name.replace(CONTROL, '').trim()].slice(0, AGENT_NAME_MAX).join('').trim();
}

/** The CLI's agent: `--as`, else `FLINT_AGENT`, else Claude Code inside it, else Command line. */
export function cliAgent(as: string | undefined, env: Env): AgentIdentity {
  const named = cleanName(as ?? env['FLINT_AGENT'] ?? '');
  const name = named || (env['CLAUDECODE'] === '1' ? 'Claude Code' : 'Command line');
  return { name, via: 'cli' };
}

/** What `initialize` says about the MCP client. */
export interface ClientInfo {
  readonly name?: unknown;
  readonly title?: unknown;
  readonly version?: unknown;
}

/** The MCP client's agent, from `initialize`'s `clientInfo`. */
export function mcpAgent(info: ClientInfo | undefined): AgentIdentity {
  const name = typeof info?.name === 'string' ? info.name : '';
  const title = typeof info?.title === 'string' ? info.title : '';
  const lower = name.toLowerCase();
  let shown: string;
  if (lower === 'claude-ai') shown = 'Claude';
  else if (lower === 'claude-code') shown = 'Claude Code';
  else if (lower.includes('cursor')) shown = 'Cursor';
  else if (lower === 'visual studio code' || lower.includes('vscode')) shown = 'VS Code';
  else shown = cleanName(title) || cleanName(name) || 'MCP client';
  return { name: shown, via: 'mcp' };
}
