/** AGENT-03 (D-185 Q10): the MCP server's messages, driven in-process. */
import type { AgentIdentity, AgentResponse, AgentTool } from '@flint/core/agents';
import { describe, expect, it } from 'vitest';
import { FlintError, MESSAGES } from './errors.js';
import { INSTRUCTIONS, McpServer, PROTOCOL_VERSIONS, RPC } from './mcp.js';
import { FakeSession, failed, NOW, ok } from './test-helpers.js';
import { TOOLS } from './tools.js';

type Message = Record<string, unknown>;

const STATUS = (readOnly: boolean): AgentResponse =>
  ok({
    version: '1.8.0',
    protocol: 1,
    readOnly,
    paused: false,
    agent: 'Claude',
    limits: {
      preset: 'medium',
      itemsPerRequest: 100,
      taskDeletesPerRequest: 25,
      listDeletesPerRequest: 5,
      changesPerHour: 500,
      usedThisHour: 0,
    },
  });

/** A server with a fake Flint behind it. */
function server(
  answer: (tool: AgentTool, args: unknown) => AgentResponse | Promise<AgentResponse> = (tool) =>
    tool === 'status' ? STATUS(false) : ok({ hits: [], more: false }),
  readOnlyNow: () => boolean | null = () => null,
) {
  const sent: Message[] = [];
  const sessions: FakeSession[] = [];
  const agents: AgentIdentity[] = [];
  const mcp = new McpServer({
    send: (message) => sent.push(message),
    log: () => {},
    version: '1.7.0',
    openSession: (agent) => {
      agents.push(agent);
      const session = new FakeSession(answer);
      sessions.push(session);
      return session;
    },
    readOnlyNow,
  });
  let id = 0;
  /** Sends a request and returns its answer (the last message with its id). */
  const request = async (method: string, params?: unknown): Promise<Message> => {
    id += 1;
    await mcp.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    const answer = sent.filter((message) => message['id'] === id).at(-1);
    if (!answer) throw new Error(`no answer to ${method}`);
    return answer;
  };
  const start = async (
    clientInfo: unknown = { name: 'claude-code', version: '2.1.0' },
  ): Promise<void> => {
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo });
    await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  };
  const listChanged = (): number =>
    sent.filter((message) => message['method'] === 'notifications/tools/list_changed').length;
  const toolNames = async (): Promise<string[]> => {
    const answer = await request('tools/list');
    return ((answer['result'] as { tools: { name: string }[] }).tools ?? []).map(
      (tool) => tool.name,
    );
  };
  return { mcp, sent, sessions, agents, request, start, listChanged, toolNames };
}

const callResult = (answer: Message): Message => answer['result'] as Message;

describe('initialize', () => {
  it('answers with the requested version when supported, else the newest, and never reaches Flint', async () => {
    const s = server();
    const answer = await s.request('initialize', {
      protocolVersion: '2025-03-26',
      clientInfo: { name: 'claude-ai' },
    });
    expect(answer).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'flint', title: 'Flint', version: '1.7.0' },
        instructions: INSTRUCTIONS,
      },
    });
    const newer = await s.request('initialize', { protocolVersion: '2099-01-01' });
    expect((newer['result'] as Message)['protocolVersion']).toBe(PROTOCOL_VERSIONS[0]);
    expect(s.sessions).toEqual([]);
    expect(INSTRUCTIONS).toContain('flint_find first');
  });

  it('answers ping, ignores notifications, and refuses unknown methods (also server/discover)', async () => {
    const s = server();
    expect(await s.request('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    await s.mcp.handle({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1 },
    });
    expect(s.sent).toHaveLength(1);
    expect((await s.request('resources/list'))['error']).toEqual({
      code: RPC.methodNotFound,
      message: 'Method not found: resources/list',
    });
    expect(((await s.request('server/discover'))['error'] as Message)['code']).toBe(
      RPC.methodNotFound,
    );
  });

  it('answers a parse error and an invalid request', async () => {
    const s = server();
    await s.mcp.handleLine('{not json');
    await s.mcp.handleLine('   ');
    await s.mcp.handleLine('{"id": 3, "method": "ping"}');
    expect(s.sent).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: RPC.parse, message: 'Parse error' } },
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: RPC.invalidRequest,
          message: 'Invalid request: expected one JSON-RPC 2.0 message',
        },
      },
    ]);
  });
});

describe('tools/list', () => {
  it('lists all six before Flint is reached, without reaching it', async () => {
    const s = server();
    await s.start();
    expect(await s.toolNames()).toEqual([
      'flint_find',
      'flint_read',
      'flint_create',
      'flint_update',
      'flint_delete',
      'flint_link_patterns',
    ]);
    expect(s.sessions).toEqual([]);
  });

  it('describes each tool with a strict object schema, examples and the right hints', async () => {
    const s = server();
    const answer = await s.request('tools/list');
    const tools = (answer['result'] as { tools: Message[] }).tools;
    for (const tool of tools) {
      expect(Object.keys(tool).sort()).toEqual([
        'annotations',
        'description',
        'inputSchema',
        'name',
        'title',
      ]);
      const schema = tool['inputSchema'] as Message;
      expect(schema['type']).toBe('object');
      expect(schema['additionalProperties']).toBe(false);
      expect(tool['description']).toContain('Examples:');
      expect((tool['annotations'] as Message)['openWorldHint']).toBe(false);
    }
    const hints = Object.fromEntries(
      tools.map((tool): [string, Message] => [
        String(tool['name']),
        tool['annotations'] as Message,
      ]),
    );
    expect(hints['flint_find']).toMatchObject({ readOnlyHint: true });
    expect(hints['flint_read']).toMatchObject({ readOnlyHint: true });
    expect(hints['flint_delete']).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(hints['flint_create']).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it('gives every example in the descriptions as valid JSON naming only known fields', () => {
    for (const tool of TOOLS) {
      const examples = /Examples: (.*)$/m.exec(tool.description)?.[1] ?? '';
      const parsed = examples
        .split(' · ')
        .map((example) => JSON.parse(example.replace(/ \(overview\)$/, '')) as Message);
      expect(parsed.length).toBeGreaterThanOrEqual(2);
      const properties = Object.keys((tool.inputSchema['properties'] as Message | undefined) ?? {});
      for (const example of parsed)
        for (const key of Object.keys(example)) expect(properties).toContain(key);
    }
  });
});

describe('tools/call', () => {
  it("reaches Flint lazily as the client's agent, asks status once, and returns the result with now", async () => {
    const s = server();
    await s.start({ name: 'claude-code', version: '2.1.0' });
    const answer = await s.request('tools/call', {
      name: 'flint_find',
      arguments: { query: 'login' },
    });
    const result = { hits: [], more: false, now: NOW };
    expect(callResult(answer)).toEqual({
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    });
    expect(s.agents).toEqual([{ name: 'Claude Code', via: 'mcp' }]);
    expect(s.sessions[0]?.calls).toEqual([
      { tool: 'status', args: {} },
      { tool: 'find', args: { query: 'login' } },
    ]);
    await s.request('tools/call', { name: 'flint_read', arguments: { items: [{ ref: 'Today' }] } });
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]?.calls.map((call) => call.tool)).toEqual(['status', 'find', 'read']);
  });

  it('maps every tool to its agent API tool, arguments untouched', async () => {
    const s = server((tool) => (tool === 'status' ? STATUS(false) : ok({ changed: [], text: [] })));
    const PAIRS: readonly (readonly [string, AgentTool, Message])[] = [
      ['flint_create', 'create', { items: [{ kind: 'task', title: 'A' }] }],
      ['flint_update', 'update', { items: [{ ref: 'k3f9a2', done: true }] }],
      ['flint_delete', 'delete', { items: [{ ref: 'k3f9a2' }] }],
      ['flint_link_patterns', 'linkPatterns', { action: 'list' }],
    ];
    for (const [name, , args] of PAIRS) await s.request('tools/call', { name, arguments: args });
    expect(s.sessions[0]?.calls.slice(1)).toEqual(PAIRS.map(([, tool, args]) => ({ tool, args })));
  });

  it("returns Flint's errors as tool errors (isError) in the --json shape", async () => {
    const error = {
      code: 'not_found' as const,
      message: 'No list is called "Backnd".',
      suggestions: [{ kind: 'list' as const, id: 'l8c2m4', name: 'Backend' }],
    };
    const s = server((tool) => (tool === 'status' ? STATUS(false) : failed(error)));
    await s.start();
    const answer = await s.request('tools/call', {
      name: 'flint_create',
      arguments: { items: [] },
    });
    expect(callResult(answer)).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ error }) }],
      structuredContent: { error },
      isError: true,
    });
  });

  it('turns not reaching Flint into a tool error, and tries again on the next call', async () => {
    let attempts = 0;
    const s = server((tool) => {
      if (tool === 'status' && (attempts += 1) === 1)
        throw new FlintError({ code: 'off', message: MESSAGES.off });
      return tool === 'status' ? STATUS(false) : ok({ hits: [], more: false });
    });
    await s.start();
    const first = callResult(await s.request('tools/call', { name: 'flint_find', arguments: {} }));
    expect(first['isError']).toBe(true);
    expect(first['structuredContent']).toEqual({ error: { code: 'off', message: MESSAGES.off } });
    expect(s.sessions[0]?.closed).toBe(true);
    const second = callResult(await s.request('tools/call', { name: 'flint_find', arguments: {} }));
    expect(second['isError']).toBeUndefined();
    expect(s.sessions).toHaveLength(2);
  });

  it('refuses an unknown tool and arguments that are not an object (invalid params)', async () => {
    const s = server();
    expect(
      ((await s.request('tools/call', { name: 'flint_nope' }))['error'] as Message)['code'],
    ).toBe(RPC.invalidParams);
    expect(
      ((await s.request('tools/call', { name: 'flint_find', arguments: [1] }))['error'] as Message)[
        'code'
      ],
    ).toBe(RPC.invalidParams);
    expect(s.sessions).toEqual([]);
  });
});

describe('read-only (AGENT-03)', () => {
  it('lists only find and read once status says read-only, and says the list changed', async () => {
    const s = server((tool) => (tool === 'status' ? STATUS(true) : ok({ hits: [], more: false })));
    await s.start();
    await s.request('tools/call', { name: 'flint_find', arguments: {} });
    expect(s.listChanged()).toBe(1);
    expect(await s.toolNames()).toEqual(['flint_find', 'flint_read']);
  });

  it('a write answered read_only hides the writes; switching back shows them again', async () => {
    let readOnlyFile: boolean | null = null;
    const s = server(
      (tool) =>
        tool === 'status'
          ? STATUS(false)
          : failed({ code: 'read_only', message: 'Agents can only read.' }),
      () => readOnlyFile,
    );
    await s.start();
    const answer = callResult(
      await s.request('tools/call', { name: 'flint_create', arguments: { items: [] } }),
    );
    expect(answer['isError']).toBe(true);
    expect(s.listChanged()).toBe(1);
    expect(await s.toolNames()).toEqual(['flint_find', 'flint_read']);
    readOnlyFile = false;
    s.mcp.refreshReadOnly();
    expect(s.listChanged()).toBe(2);
    expect(await s.toolNames()).toHaveLength(6);
    readOnlyFile = true;
    expect(await s.toolNames()).toHaveLength(2);
    expect(s.listChanged()).toBe(3);
  });

  it('sends no list_changed before the client said initialized', async () => {
    const s = server((tool) => (tool === 'status' ? STATUS(true) : ok({ hits: [], more: false })));
    await s.request('initialize', { protocolVersion: '2025-06-18' });
    await s.request('tools/call', { name: 'flint_find', arguments: {} });
    expect(s.listChanged()).toBe(0);
    expect(await s.toolNames()).toHaveLength(2);
  });
});
