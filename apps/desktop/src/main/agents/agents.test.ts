import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_PROTOCOL,
  type AgentRequest,
  type AgentResponse,
  type AgentState,
  type AgentTool,
  type FindResult,
  type ReadResult,
  type WriteResult,
} from '@flint/core/agents';
import type { LinkPattern } from '../../shared/link-patterns.js';
import { Workspace } from '../capture/workspace.js';
import { prepareFlintFolder } from '../storage/flint-folder.js';
import { AgentService, type AgentSettings } from './service.js';

/**
 * AGENT-01 to AGENT-07 (D-185): the agent API end to end in the main process, on a temporary Flint
 * folder (never real data): the switches, the tools, never a guess, limits, Hidden from agents on
 * every path (Q15), and undo.
 */

const now = new Date(2026, 2, 10, 10, 0);
let base: string;
let folder: string;
let workspace: Workspace;
let service: AgentService;
let settings: AgentSettings;
let pausedToasts: string[];

const INBOX = '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] Buy milk [id:: in01]\n';
const BACKEND =
  '---\nflint: 1\nid: backend\nmode: tasks\n---\n## Auth\n- [ ] Fix login loop [priority:: high] [id:: be01]\n    Stack trace in the gateway\n    - [ ] Write a test [id:: be02]\n- [ ] Buy milk [id:: be03]\n- [x] Fix login loop [completion:: 2026-03-09T10:00] [id:: be04]\n';
const PAYROLL =
  '---\nflint: 1\nid: payroll\nmode: tasks\n---\n- [ ] Pay Alex [reminder:: 2026-03-11T09:00] [today:: true] [id:: pa01]\n';
const PLAN = `---\nflint: 1\nid: plan\nmode: note\n---\n# Plan\n\n${Array.from({ length: 300 }, (_, index) => `Line ${index + 1}`).join('\n')}\n## Rollout\nShip on Friday\n`;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-agent-api-'));
  folder = join(base, 'Flint');
  await prepareFlintFolder(folder, {});
  await writeFile(join(folder, 'Inbox.md'), INBOX);
  await writeFile(join(folder, 'Backend.md'), BACKEND);
  await writeFile(join(folder, 'Payroll.md'), PAYROLL);
  await writeFile(join(folder, 'Plan.md'), PLAN);
  workspace = await Workspace.open(folder, join(base, 'ui-state.json'));
  settings = { agentsOn: true, agentsReadOnly: false, agentsLimits: 'medium', linkPatterns: [] };
  pausedToasts = [];
  service = new AgentService({
    userData: join(base, 'appdata'),
    version: '1.8.0',
    workspace: () => workspace,
    settings: () => settings,
    saveSettings: (patch) => {
      settings = { ...settings, ...patch };
      return Promise.resolve();
    },
    now: () => now,
    paused: (agent, limit) => pausedToasts.push(`${agent} ${limit}`),
  });
  await service.start();
});

afterEach(async () => {
  await service.stop();
  await workspace.settled();
  await rm(base, { recursive: true, force: true });
});

let next = 0;
async function call(tool: AgentTool, args: unknown, agent = 'Claude'): Promise<AgentResponse> {
  next += 1;
  return service.handle({
    protocol: AGENT_PROTOCOL,
    id: next,
    token: 'checked by the pipe',
    agent: { name: agent, via: 'mcp' },
    tool,
    args,
  });
}
async function ok<T>(tool: AgentTool, args: unknown, agent?: string): Promise<T> {
  const response = await call(tool, args, agent);
  if (!response.ok) throw new Error(`${tool}: ${response.error.code} ${response.error.message}`);
  return response.result as T;
}
async function refused(tool: AgentTool, args: unknown): Promise<string> {
  const response = await call(tool, args);
  if (response.ok) throw new Error(`${tool} was not refused`);
  return response.error.code;
}
const file = (name: string): Promise<string> => readFile(join(folder, name), 'utf8');

describe('switches and the pipe (AGENT-01)', () => {
  it('answers off when agents are off, and says so in agent-state.json', async () => {
    await service.setOn(false);
    expect(await refused('find', {})).toBe('off');
    const state = JSON.parse(
      await readFile(join(base, 'appdata', 'agent-state.json'), 'utf8'),
    ) as AgentState;
    expect(state).toMatchObject({ on: false, pipe: null, pid: process.pid });
    await expect(readFile(join(base, 'appdata', 'agent-token'), 'utf8')).rejects.toThrow();
  });

  it('takes requests over the pipe only with the token, and renews the token on turn-on', async () => {
    const state = JSON.parse(
      await readFile(join(base, 'appdata', 'agent-state.json'), 'utf8'),
    ) as AgentState;
    expect(state.on).toBe(true);
    const token = (await readFile(join(base, 'appdata', 'agent-token'), 'utf8')).trim();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const send = (request: Partial<AgentRequest>): Promise<AgentResponse> =>
      new Promise((resolve, reject) => {
        const socket = connect(state.pipe ?? '', () =>
          socket.write(`${JSON.stringify(request)}\n`),
        );
        let text = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
          text += chunk;
          if (text.includes('\n')) {
            socket.end();
            resolve(JSON.parse(text) as AgentResponse);
          }
        });
        socket.on('error', reject);
      });
    const request = {
      protocol: AGENT_PROTOCOL,
      id: 7,
      agent: { name: 'Claude', via: 'cli' as const },
      tool: 'status' as const,
      args: {},
    };
    expect(await send({ ...request, token: 'wrong' })).toEqual({
      id: 7,
      ok: false,
      error: { code: 'unauthorized', message: 'Unauthorized.' },
    });
    const answer = await send({ ...request, token });
    expect(answer).toMatchObject({
      id: 7,
      ok: true,
      result: { version: '1.8.0', agent: 'Claude' },
    });
    await service.setOn(false);
    await service.setOn(true);
    expect((await readFile(join(base, 'appdata', 'agent-token'), 'utf8')).trim()).not.toBe(token);
  });

  it('refuses writes when read-only, and carries now in every answer', async () => {
    await service.setReadOnly(true);
    expect(await refused('create', { items: [{ kind: 'task', title: 'x' }] })).toBe('read_only');
    const response = await call('find', {});
    expect(response.ok && response.now).toMatchObject({ local: '2026-03-10T10:00' });
  });
});

describe('find and read (AGENT-01, AGENT-03)', () => {
  it('gives an overview with no query', async () => {
    const result = await ok<FindResult>('find', {});
    if (!('overview' in result)) throw new Error('no overview');
    expect(result.overview.lists.map((list) => list.name)).toEqual([
      'Inbox',
      'Backend',
      'Payroll',
      'Plan',
    ]);
    expect(result.overview.today.map((hit) => hit.id)).toEqual(['pa01']);
    expect(result.overview.reminders[0]).toMatchObject({
      id: 'pa01',
      reminder: { text: 'Wed 11 Mar, 09:00' },
    });
  });

  it('finds titles, and matches inside bodies and notes with a line and snippet', async () => {
    const result = await ok<FindResult>('find', { query: 'gateway' });
    if (!('hits' in result)) throw new Error('no hits');
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: 'be01',
        match: { line: 1, snippet: 'Stack trace in the gateway' },
      }),
    ]);
    const note = await ok<FindResult>('find', { query: 'friday' });
    expect('hits' in note && note.hits[0]).toMatchObject({
      kind: 'note',
      id: 'plan',
      match: { snippet: 'Ship on Friday' },
    });
  });

  it('reads a long note in parts, and its outline', async () => {
    const result = await ok<ReadResult>('read', {
      items: [
        { ref: 'Plan' },
        { ref: 'plan', outline: true },
        { ref: 'Plan', lines: { from: 303, to: 305 } },
      ],
    });
    expect(result.items[0]).toMatchObject({
      kind: 'note',
      from: 1,
      to: 200,
      truncated: true,
      totalLines: 304,
    });
    expect(result.items[1]).toMatchObject({
      outline: [
        { line: 1, level: 1, text: 'Plan' },
        { line: 303, level: 2, text: 'Rollout' },
      ],
    });
    expect(result.items[2]).toMatchObject({ text: '## Rollout\nShip on Friday', truncated: true });
  });

  it('reads a list with its headings, subtasks and paging', async () => {
    const result = await ok<ReadResult>('read', { items: [{ ref: 'Backend' }] });
    expect(result.items[0]).toMatchObject({
      kind: 'list',
      open: 2,
      done: 1,
      total: 2,
      entries: [
        { kind: 'heading' },
        {
          kind: 'task',
          id: 'be01',
          priority: 'high',
          body: 'Stack trace in the gateway',
          subtasks: [{ id: 'be02', parent: 'be01' }],
        },
        { kind: 'task', id: 'be03' },
      ],
    });
  });
});

describe('never a guess (D-185 Q6)', () => {
  it('prefers open tasks, and calls two open ones ambiguous with candidates', async () => {
    const done = await ok<WriteResult>('update', {
      items: [{ ref: 'Fix login loop', done: true }],
    });
    expect(done.changed[0]).toMatchObject({ id: 'be01', what: 'completed' });
    const response = await call('update', { items: [{ ref: 'Buy milk', done: true }] });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error.code).toBe('ambiguous');
    expect(response.error.candidates?.map((each) => each.id).sort()).toEqual(['be03', 'in01']);
  });

  it('changes nothing in a batch with one bad item, and lists every problem', async () => {
    const before = await file('Backend.md');
    const response = await call('update', {
      items: [
        { ref: 'be03', priority: 'low' },
        { ref: 'Nonexistent thing', done: true },
        { ref: 'be01', remind: 'yesterday 9:00' },
      ],
    });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error.problems?.map((each) => [each.index, each.code])).toEqual([
      [1, 'not_found'],
      [2, 'bad_time'],
    ]);
    expect(await file('Backend.md')).toBe(before);
  });
});

describe('writes (AGENT-01)', () => {
  it('adds a task with fields, echoes the time, keeps shorthand as text, and marks who made it', async () => {
    const result = await ok<WriteResult>('create', {
      items: [
        {
          kind: 'task',
          title: 'Email alex@acme.example !h',
          list: 'Backend',
          priority: 'medium',
          remind: 'tomorrow 9:00',
          position: 'bottom',
        },
      ],
    });
    const [added] = result.changed;
    expect(added).toMatchObject({
      what: 'added',
      list: { name: 'Backend' },
      reminder: { at: '2026-03-11T09:00', text: 'Wed 11 Mar, 09:00' },
    });
    expect(result.text[0]).toContain('Reminder Wed 11 Mar, 09:00');
    const text = await file('Backend.md');
    expect(text).toContain('Email alex@acme.example !h');
    expect(text.indexOf('Email alex')).toBeGreaterThan(text.indexOf('Buy milk'));
    expect(workspace.meta.get(added?.id ?? '')).toMatchObject({ createdBy: 'Claude' });
  });

  it('reads shorthand when asked, adds subtasks, moves and reorders', async () => {
    await ok('create', {
      items: [{ kind: 'task', title: 'Ship it !h', parseShorthand: true }],
      parseShorthand: true,
    });
    expect(await file('Inbox.md')).toMatch(/- \[ \] Ship it \[priority:: high\]/);
    await ok('create', { items: [{ kind: 'task', title: 'Check the logs', parent: 'be01' }] });
    expect(await file('Backend.md')).toMatch(/ {4}- \[ \] Check the logs/);
    await ok('update', { items: [{ ref: 'be03', moveTo: 'Inbox', pinned: true }] });
    expect(await file('Inbox.md')).toContain('Buy milk [pinned:: true]');
    await ok('update', { items: [{ ref: 'in01', position: { after: 'be03' }, in: 'Inbox' }] });
  });

  it('edits a note by append and replace, refusing a passage that is not there once', async () => {
    await ok('update', {
      items: [
        {
          kind: 'note',
          ref: 'Plan',
          replace: { find: 'Ship on Friday', with: 'Ship on Monday' },
          append: 'Owner: Alex',
        },
      ],
    });
    const text = await file('Plan.md');
    expect(text).toContain('Ship on Monday\nOwner: Alex');
    expect(
      await refused('update', {
        items: [{ kind: 'note', ref: 'Plan', replace: { find: 'Line 1', with: 'x' } }],
      }),
    ).toBe('ambiguous');
    expect(workspace.meta.get('plan')?.touchedBy).toBe('Claude');
  });

  it('makes lists, notes and groups, and deletes to Trash (never Inbox)', async () => {
    await ok('create', {
      items: [
        { kind: 'group', name: 'Work', lists: ['Backend'] },
        { kind: 'note', name: 'Ideas', text: 'First idea' },
      ],
    });
    expect(workspace.sidebarManual()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'group', name: 'Work', lists: ['backend'] }),
      ]),
    );
    expect(await file('Ideas.md')).toContain('First idea');
    expect(await refused('delete', { items: [{ ref: 'Inbox' }] })).toBe('invalid');
    await ok('delete', { items: [{ ref: 'Ideas' }, { ref: 'be03' }] });
    expect((await workspace.trashView()).deleted.map((item) => item.title).sort()).toEqual([
      'Buy milk',
      'Ideas',
    ]);
  });

  it('keeps to the limits: too large, then the hourly pause with one toast', async () => {
    settings = { ...settings, agentsLimits: 'low' };
    const many = Array.from({ length: 26 }, (_, index) => ({
      kind: 'task',
      title: `Task ${index}`,
    }));
    expect(await refused('create', { items: many })).toBe('too_large');
    for (let round = 0; round < 6; round += 1) await ok('create', { items: many.slice(0, 25) });
    expect(await refused('create', { items: many.slice(0, 1) })).toBe('paused');
    expect(pausedToasts).toEqual(['Claude 150']);
    // Reads go on.
    await ok('find', {});
    await service.resume();
    await ok('create', { items: many.slice(0, 1) });
  }, 60_000); // 150 real task writes to reach the hourly limit: slow under a full parallel run.

  it('adds, changes and deletes link patterns, checked as Settings does', async () => {
    await ok('linkPatterns', {
      action: 'add',
      short: 'AB#{id}',
      url: 'https://dev.example/items/{id}',
    });
    expect(settings.linkPatterns).toEqual([
      { short: 'AB#{id}', url: 'https://dev.example/items/{id}' },
    ]);
    expect(
      await refused('linkPatterns', {
        action: 'add',
        short: '{id}',
        url: 'https://x.example/{id}',
      }),
    ).toBe('invalid');
    await ok('linkPatterns', {
      action: 'edit',
      ref: 'AB#{id}',
      url: 'https://dev.example/work/{id}',
    });
    await ok('linkPatterns', { action: 'delete', ref: 0 });
    expect(settings.linkPatterns).toEqual([]);
    // Undo the delete from Recent agent changes.
    await service.undo();
    expect((settings.linkPatterns as LinkPattern[])[0]?.url).toBe('https://dev.example/work/{id}');
  });
});

describe('Hidden from agents (AGENT-06): hidden items don’t exist for agents', () => {
  beforeEach(async () => {
    await service.hide('payroll', true);
  });

  it('is absent from the overview, Today, Reminders, find and snippets', async () => {
    const overview = await ok<FindResult>('find', {});
    if (!('overview' in overview)) throw new Error('no overview');
    expect(overview.overview.lists.map((list) => list.id)).not.toContain('payroll');
    expect(overview.overview.today).toEqual([]);
    expect(overview.overview.reminders).toEqual([]);
    const found = await ok<FindResult>('find', { query: 'Pay Alex' });
    expect('hits' in found && found.hits).toEqual([]);
    const lists = await ok<FindResult>('find', { query: 'payroll', type: 'list' });
    expect('hits' in lists && lists.hits).toEqual([]);
    const today = await ok<ReadResult>('read', { items: [{ ref: 'Today' }, { ref: 'Reminders' }] });
    expect(today.items.map((item) => ('entries' in item ? item.entries.length : -1))).toEqual([
      0, 0,
    ]);
  });

  it('answers not_found (never "hidden") to every read and write', async () => {
    expect(await refused('read', { items: [{ ref: 'Payroll' }] })).toBe('not_found');
    expect(await refused('read', { items: [{ ref: 'payroll' }] })).toBe('not_found');
    expect(await refused('read', { items: [{ ref: 'pa01' }] })).toBe('not_found');
    expect(await refused('read', { items: [{ ref: 'Payroll', archived: true }] })).toBe(
      'not_found',
    );
    expect(await refused('find', { in: 'Payroll' })).toBe('not_found');
    expect(await refused('update', { items: [{ ref: 'pa01', done: true }] })).toBe('not_found');
    expect(
      await refused('update', { items: [{ kind: 'list', ref: 'Payroll', name: 'Pay' }] }),
    ).toBe('not_found');
    expect(await refused('delete', { items: [{ ref: 'pa01' }] })).toBe('not_found');
    expect(await refused('delete', { items: [{ ref: 'Payroll' }] })).toBe('not_found');
    expect(
      await refused('create', { items: [{ kind: 'task', title: 'x', list: 'Payroll' }] }),
    ).toBe('not_found');
    expect(await refused('create', { items: [{ kind: 'task', title: 'x', parent: 'pa01' }] })).toBe(
      'not_found',
    );
    expect(await refused('update', { items: [{ ref: 'be03', moveTo: 'Payroll' }] })).toBe(
      'not_found',
    );
    expect(await refused('update', { items: [{ ref: 'be03', position: { after: 'pa01' } }] })).toBe(
      'not_found',
    );
    const response = await call('read', { items: [{ ref: 'Payroll' }] });
    expect(JSON.stringify(response)).not.toMatch(/hidden/i);
    expect(await file('Payroll.md')).toBe(PAYROLL);
  });

  it('hides a group’s lists with it, and a hidden group too', async () => {
    await service.hide('payroll', false);
    await ok('create', { items: [{ kind: 'group', name: 'Money', lists: ['Payroll'] }] });
    const group = workspace.sidebarManual().find((item) => item.kind === 'group');
    await service.hide(group?.id ?? '', true);
    expect(await refused('read', { items: [{ ref: 'Payroll' }] })).toBe('not_found');
    expect(await refused('read', { items: [{ ref: 'Money', kind: 'group' }] })).toBe('not_found');
    expect(
      await refused('update', { items: [{ kind: 'group', ref: 'Money', addLists: ['Backend'] }] }),
    ).toBe('not_found');
  });
});

describe('Recent agent changes (AGENT-07)', () => {
  it('records one change per request and undoes it as the user', async () => {
    await ok('create', {
      items: [
        { kind: 'task', title: 'One', list: 'Backend' },
        { kind: 'task', title: 'Two', list: 'Backend' },
      ],
    });
    expect(service.view().changes[0]).toMatchObject({
      agent: 'Claude',
      label: 'Added 2 tasks to Backend',
      undone: false,
    });
    expect(await service.undo()).toEqual({ label: 'Added 2 tasks to Backend', skipped: 0 });
    expect(await file('Backend.md')).toBe(BACKEND);
    expect(service.view().changes[0]?.undone).toBe(true);
  });
});

describe('the security review’s findings (D-185)', () => {
  it('H1: shorthand ##list never reaches a hidden list, nor names it', async () => {
    await service.hide('payroll', true);
    const response = await call('create', {
      items: [{ kind: 'task', title: 'Leak test ##Pay' }],
      parseShorthand: true,
    });
    expect(JSON.stringify(response)).not.toMatch(/payroll/i);
    expect(await file('Payroll.md')).toBe(PAYROLL);
  });

  it('M1, M2: link patterns stay small and simple; kinds only digits or word', async () => {
    const add = (short: string, url: string, kinds?: unknown) =>
      refused('linkPatterns', { action: 'add', short, url, ...(kinds !== undefined && { kinds }) });
    expect(await add('{a}{b}XY', 'https://x.example/{a}/{b}')).toBe('invalid');
    expect(await add('A#{a}-{b}-{c}', 'https://x.example/{a}/{b}/{c}')).toBe('invalid');
    expect(await add('AB#{id}', 'https://x.example/')).toBe('invalid');
    expect(await add('AB#{id}', 'https://x.example/{id}', { id: { deep: 1 } })).toBe('invalid');
    expect(settings.linkPatterns).toEqual([]);
  });

  it('M3, M4: attachments only from this PC’s own drives, no data streams', async () => {
    const attach = (path: string) =>
      refused('update', { items: [{ ref: 'be03', attach: { path } }] });
    expect(await attach('\\\\attacker.example\\share\\a.png')).toBe('invalid');
    expect(await attach('//attacker.example/share/a.png')).toBe('invalid');
    expect(await attach('\\\\?\\UNC\\attacker.example\\share\\a.png')).toBe('invalid');
    expect(await attach('C:\\Temp\\payload.exe::$DATA')).toBe('invalid');
    expect(await attach('C:\\Temp\\notes.txt.')).toBe('invalid');
    // A real file on this PC still attaches (copied into attachments/).
    const picture = join(base, 'shot.png');
    await writeFile(picture, 'not really a png');
    await ok('update', { items: [{ ref: 'be03', attach: { path: picture } }] });
    expect(await file('Backend.md')).toMatch(/!\[shot\.png\]\(attachments\/[^)]+\.png\)/);
  });

  it('L1: a huge reference is refused before any matching', async () => {
    expect(await refused('read', { items: [{ ref: 'x'.repeat(5000) }] })).toBe('invalid');
  });

  it('L2: a name taken by a hidden list is never confirmed', async () => {
    await service.hide('payroll', true);
    const response = await call('create', { items: [{ kind: 'list', name: 'Payroll' }] });
    expect(response.ok).toBe(false);
    expect(JSON.stringify(response)).not.toMatch(/exists|payroll/i);
  });

  it('L4: an unreadable agents.json makes agents wait instead of hiding nothing', async () => {
    await writeFile(join(folder, '.flint', 'agents.json'), '{ not json');
    await service.hidden().load();
    expect(await refused('find', {})).toBe('internal');
    await writeFile(join(folder, '.flint', 'agents.json'), '{"flint":1,"hidden":{},"shown":{}}');
    await service.hidden().load();
    await ok('find', {});
  });
});
