import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_PROTOCOL,
  AGENT_STATE_FILE,
  AGENT_TOKEN_FILE,
  ChangeBudget,
  LIMIT_PRESETS,
  nowInfo,
  type AgentRequest,
  type AgentResponse,
  type AgentState,
  type LimitsPreset,
  type StatusResult,
  type WriteResult,
} from '@flint/core/agents';
import type { LinkPattern } from '../../shared/link-patterns.js';
import type { Workspace } from '../capture/workspace.js';
import { AgentApi, AgentFailure, type WriteOutcome } from './api.js';
import { AgentChangeLog, type AgentChange } from './changes.js';
import { HiddenFile } from './hidden.js';
import { AgentPipe, pipeName } from './pipe.js';

/**
 * AGENT-01, AGENT-05, AGENT-07 (D-185): AI agents' side of Flint. Owns the switches (on, read-only,
 * limits, paused), the pipe and its token, `agent-state.json` for `flint.exe`, the hourly budget,
 * Recent agent changes and their undo, and Hidden from agents for the current Flint folder.
 */

export interface AgentSettings {
  readonly agentsOn: boolean;
  readonly agentsReadOnly: boolean;
  readonly agentsLimits: LimitsPreset;
  readonly linkPatterns: readonly LinkPattern[];
}

export interface AgentServiceDeps {
  readonly userData: string;
  readonly version: string;
  readonly workspace: () => Workspace;
  readonly settings: () => AgentSettings;
  readonly saveSettings: (patch: Partial<AgentSettings>) => Promise<void>;
  readonly now: () => Date;
  /** Windows' flash and refresh (AGENT-07, Q12). */
  readonly changed?: (keys: readonly string[], lists: readonly string[]) => void;
  /** The pause toast, once (Q8). */
  readonly paused?: (agent: string, limit: number) => void;
  /** Settings → AI agents shows the new state. */
  readonly stateChanged?: () => void;
  readonly log?: (line: string) => void;
}

/** What Settings → AI agents shows (AGENT-05). */
export interface AgentsView {
  readonly on: boolean;
  readonly readOnly: boolean;
  readonly paused: boolean;
  readonly limits: LimitsPreset;
  readonly usedThisHour: number;
  /** Agents with an open connection now. */
  readonly connected: readonly string[];
  /** Why agents can't start (another program holds the pipe's name), or null. */
  readonly problem: string | null;
  readonly changes: readonly {
    readonly id: string;
    readonly agent: string;
    readonly label: string;
    readonly at: number;
    readonly undoable: boolean;
    readonly undone: boolean;
  }[];
  readonly hidden: readonly string[];
}

export class AgentService {
  private readonly deps: AgentServiceDeps;
  private readonly api: AgentApi;
  private readonly changes: AgentChangeLog;
  private readonly budget = new ChangeBudget();
  private pipe: AgentPipe | null = null;
  private token = '';
  private isPaused = false;
  private problem: string | null = null;
  private hiddenFile: HiddenFile | null = null;
  private readonly connections = new Map<number, string>();
  /** One toggle at a time (on, off). */
  private switching: Promise<void> = Promise.resolve();

  constructor(deps: AgentServiceDeps) {
    this.deps = deps;
    this.changes = new AgentChangeLog(deps.userData);
    this.changes.onChange(() => this.deps.stateChanged?.());
    this.api = new AgentApi({
      workspace: deps.workspace,
      hidden: () => this.hidden(),
      now: deps.now,
      limits: () => LIMIT_PRESETS[deps.settings().agentsLimits],
      linkPatterns: {
        get: () => deps.settings().linkPatterns,
        save: (next) => deps.saveSettings({ linkPatterns: next }),
      },
    });
  }

  /** The current Flint folder's Hidden from agents (a folder change reads the new one's). */
  hidden(): HiddenFile {
    const folder = this.deps.workspace().folder;
    if (this.hiddenFile?.path !== join(folder, '.flint', 'agents.json')) {
      this.hiddenFile = new HiddenFile(folder);
      this.hiddenFile.onChange(() => this.deps.stateChanged?.());
      void this.hiddenFile.load().then(() => this.deps.stateChanged?.());
    }
    return this.hiddenFile;
  }

  async start(): Promise<void> {
    await this.changes.load();
    await this.hidden().load();
    if (this.deps.settings().agentsOn) await this.enable();
    else await this.writeState();
  }

  /** D-138: a quit closes the pipe and leaves no token behind. */
  async stop(): Promise<void> {
    await this.disable(false);
    await this.changes.settled();
  }

  // ─── the switches (only from Flint's own window) ───────────────────────────────────────────────

  setOn(on: boolean): Promise<void> {
    // Security review M2: turning off closes the pipe even when the setting couldn't be saved, and
    // one failed switch never blocks the next.
    const next = this.switching.then(async () => {
      try {
        await this.deps.saveSettings({ agentsOn: on });
      } finally {
        if (on) await this.enable();
        else await this.disable(true);
      }
    });
    this.switching = next.catch(() => undefined);
    return next;
  }

  async setReadOnly(readOnly: boolean): Promise<void> {
    await this.deps.saveSettings({ agentsReadOnly: readOnly });
    await this.writeState();
    this.deps.stateChanged?.();
  }

  async setLimits(preset: LimitsPreset): Promise<void> {
    await this.deps.saveSettings({ agentsLimits: preset });
    this.deps.stateChanged?.();
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    await this.writeState();
    this.deps.stateChanged?.();
  }

  async resume(): Promise<void> {
    this.isPaused = false;
    this.budget.reset();
    await this.writeState();
    this.deps.stateChanged?.();
  }

  get paused(): boolean {
    return this.isPaused;
  }

  async hide(id: string, hide: boolean): Promise<void> {
    await this.hidden().set(id, hide, this.deps.now());
  }

  view(): AgentsView {
    const settings = this.deps.settings();
    const now = this.deps.now().getTime();
    return {
      on: settings.agentsOn,
      readOnly: settings.agentsReadOnly,
      paused: this.isPaused,
      limits: settings.agentsLimits,
      usedThisHour: this.budget.used(now),
      connected: [...new Set(this.connections.values())],
      problem: this.problem,
      changes: this.changes
        .list(now)
        .slice(0, 100)
        .map((change) => ({
          id: change.id,
          agent: change.agent,
          label: change.label,
          at: change.at,
          undoable: change.undoable,
          undone: change.undone === true,
        })),
      hidden: this.hidden().ids(),
    };
  }

  /** AGENT-07: the user undoes a change (out of order, never over a later change). */
  async undo(id?: string): Promise<{ readonly label: string; readonly skipped: number } | null> {
    const change = id ? this.changes.get(id) : this.changes.last(this.deps.now().getTime());
    if (!change || change.undone || !change.undoable) return null;
    let skipped = 0;
    if (change.steps.length > 0) {
      const outcome = await this.deps
        .workspace()
        .undoAgentSteps(change.steps, change.label, this.deps.now());
      skipped += outcome.skipped;
    }
    if (change.linkPatterns) {
      const now = this.deps.settings().linkPatterns;
      if (JSON.stringify(now) === JSON.stringify(change.linkPatterns.after))
        await this.deps.saveSettings({ linkPatterns: change.linkPatterns.before });
      else skipped += 1;
    }
    this.changes.markUndone(change.id);
    return { label: change.label, skipped };
  }

  // ─── the pipe ──────────────────────────────────────────────────────────────────────────────────

  private async enable(): Promise<void> {
    await this.disable(false);
    this.token = randomBytes(32).toString('hex');
    await mkdir(this.deps.userData, { recursive: true });
    await writeFile(join(this.deps.userData, AGENT_TOKEN_FILE), this.token, { mode: 0o600 });
    const pipe = new AgentPipe(pipeName(this.deps.userData), {
      token: () => this.token,
      handle: (request, connection) => this.handle(request, connection),
      closed: (connection) => {
        this.connections.delete(connection);
        this.deps.stateChanged?.();
      },
    });
    try {
      await pipe.start();
      this.pipe = pipe;
      this.problem = null;
    } catch (error) {
      this.problem =
        error instanceof Error && error.message === 'taken'
          ? 'Another program is using Flint’s agent channel, so agents can’t start.'
          : 'Agents couldn’t start.';
      this.deps.log?.(`agents: the pipe didn't start: ${String(error)}`);
      await rm(join(this.deps.userData, AGENT_TOKEN_FILE), { force: true });
    }
    await this.writeState();
    this.deps.stateChanged?.();
  }

  private async disable(tell: boolean): Promise<void> {
    const pipe = this.pipe;
    this.pipe = null;
    this.token = '';
    this.connections.clear();
    await pipe?.stop();
    await rm(join(this.deps.userData, AGENT_TOKEN_FILE), { force: true }).catch(() => undefined);
    await this.writeState();
    if (tell) this.deps.stateChanged?.();
  }

  private async writeState(): Promise<void> {
    const settings = this.deps.settings();
    const state: AgentState = {
      protocol: AGENT_PROTOCOL,
      pid: process.pid,
      on: settings.agentsOn && this.pipe !== null,
      readOnly: settings.agentsReadOnly,
      paused: this.isPaused,
      pipe: this.pipe?.name ?? null,
      version: this.deps.version,
    };
    await mkdir(this.deps.userData, { recursive: true });
    await writeFile(
      join(this.deps.userData, AGENT_STATE_FILE),
      `${JSON.stringify(state, null, 2)}\n`,
    ).catch(() => undefined);
  }

  // ─── requests ──────────────────────────────────────────────────────────────────────────────────

  async handle(request: AgentRequest, connection = 0): Promise<AgentResponse> {
    const id = typeof request.id === 'number' ? request.id : 0;
    const now = (): Date => this.deps.now();
    const info = (): ReturnType<typeof nowInfo> =>
      nowInfo(now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    const settings = this.deps.settings();
    if (!settings.agentsOn)
      return {
        id,
        ok: false,
        error: {
          code: 'off',
          message: 'AI agents are off in Flint. Turn them on in Flint → Settings → AI agents.',
        },
      };
    if (request.protocol !== AGENT_PROTOCOL)
      return {
        id,
        ok: false,
        error: {
          code: 'protocol',
          message: `This flint command speaks protocol ${String(request.protocol)}, Flint ${AGENT_PROTOCOL}. Update Flint or the command.`,
        },
      };
    const agent = cleanAgent(request.agent?.name);
    if (!this.connections.has(connection) || this.connections.get(connection) !== agent) {
      this.connections.set(connection, agent);
      this.deps.stateChanged?.();
    }
    try {
      const result = await this.dispatch(request.tool, request.args, agent);
      return { id, ok: true, result, now: info() };
    } catch (error) {
      if (error instanceof AgentFailure) return { id, ok: false, error: error.error, now: info() };
      this.deps.log?.(`agents: ${request.tool} failed: ${String(error)}`);
      return {
        id,
        ok: false,
        error: { code: 'internal', message: 'Something went wrong in Flint; see its log.' },
        now: info(),
      };
    }
  }

  private async dispatch(tool: string, args: unknown, agent: string): Promise<unknown> {
    switch (tool) {
      case 'status':
        return this.status(agent);
      case 'find':
        return this.api.find(args);
      case 'read':
        return this.api.read(args);
      case 'create':
      case 'update':
      case 'delete':
        return this.write(agent, args, tool);
      case 'linkPatterns': {
        const action =
          typeof args === 'object' && args !== null
            ? (args as Record<string, unknown>)['action']
            : undefined;
        if (action === 'list') return this.api.linkPatternsList();
        this.mayWrite(1);
        const done = await this.api.linkPatterns(args);
        if (done.before && done.after && done.label) {
          this.record(agent, done.label, [], true, { before: done.before, after: done.after });
          this.spend(agent, 1);
        }
        return done.result;
      }
      default:
        throw new AgentFailure({ code: 'invalid', message: `Flint has no tool "${tool}".` });
    }
  }

  private status(agent: string): StatusResult {
    const settings = this.deps.settings();
    const limits = LIMIT_PRESETS[settings.agentsLimits];
    return {
      version: this.deps.version,
      protocol: AGENT_PROTOCOL,
      readOnly: settings.agentsReadOnly,
      paused: this.isPaused,
      limits: {
        preset: settings.agentsLimits,
        ...limits,
        usedThisHour: this.budget.used(this.deps.now().getTime()),
      },
      agent,
    };
  }

  /** Read-only, paused, or over the hourly budget: refused before anything changes. */
  private mayWrite(estimate: number): void {
    const settings = this.deps.settings();
    if (settings.agentsReadOnly)
      throw new AgentFailure({
        code: 'read_only',
        message: 'Flint lets agents only find and read (Settings → AI agents → Read-only).',
      });
    const limit = LIMIT_PRESETS[settings.agentsLimits].changesPerHour;
    if (this.isPaused || !this.budget.fits(estimate, limit, this.deps.now().getTime()))
      throw new AgentFailure({
        code: 'paused',
        message: `Flint paused agent changes after ${limit} in an hour. Resume them in Flint → Settings → AI agents.`,
      });
  }

  private async write(
    agent: string,
    args: unknown,
    tool: 'create' | 'update' | 'delete',
  ): Promise<WriteResult> {
    const items =
      typeof args === 'object' &&
      args !== null &&
      Array.isArray((args as { items?: unknown }).items)
        ? (args as { items: unknown[] }).items.length
        : 1;
    this.mayWrite(items);
    const outcome: WriteOutcome =
      tool === 'create'
        ? await this.api.create(agent, args)
        : tool === 'update'
          ? await this.api.update(agent, args)
          : await this.api.delete(agent, args);
    let change: AgentChange | undefined;
    if (outcome.steps.length > 0 || outcome.count > 0)
      change = this.record(agent, outcome.label, outcome.steps, outcome.undoable);
    this.spend(agent, outcome.count);
    if (outcome.keys.length > 0 || outcome.lists.length > 0)
      this.deps.changed?.(outcome.keys, outcome.lists);
    if (outcome.error !== undefined) {
      this.deps.log?.(
        `agents: ${tool} failed part-way: ${outcome.error instanceof Error ? outcome.error.message : 'unknown'}`,
      );
      if (outcome.error instanceof AgentFailure) throw outcome.error;
      throw new AgentFailure({
        code: 'internal',
        message: `Something went wrong part-way; what was done is in Recent agent changes${change ? '' : ' (nothing was)'}.`,
      });
    }
    return { ...outcome.result, ...(change && { change: change.id }) };
  }

  private record(
    agent: string,
    label: string,
    steps: AgentChange['steps'],
    undoable: boolean,
    linkPatterns?: AgentChange['linkPatterns'],
  ): AgentChange {
    const at = this.deps.now().getTime();
    return this.changes.add(
      { agent, label, at, steps, undoable, ...(linkPatterns && { linkPatterns }) },
      at,
    );
  }

  /** Spends the budget; past it, writes pause and the toast says so once (Q8). */
  private spend(agent: string, count: number): void {
    const now = this.deps.now().getTime();
    this.budget.spend(count, now);
    const limit = LIMIT_PRESETS[this.deps.settings().agentsLimits].changesPerHour;
    if (!this.isPaused && this.budget.used(now) >= limit) {
      this.isPaused = true;
      void this.writeState();
      this.deps.paused?.(agent, limit);
      this.deps.stateChanged?.();
    }
  }
}

/** An agent's name as shown: control characters out, at most 32 characters (D-185 Q4). */
export function cleanAgent(name: unknown): string {
  const text =
    typeof name === 'string'
      ? [...name]
          .filter((char) => char >= ' ')
          .join('')
          .trim()
      : '';
  return text === '' ? 'Agent' : text.slice(0, 32);
}
