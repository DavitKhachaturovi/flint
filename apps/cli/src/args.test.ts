/** AGENT-02: the argument parser and the agent's name. */
import { describe, expect, it } from 'vitest';
import { cleanName, cliAgent, mcpAgent } from './agent.js';
import { commandWords, isOption, parseArgs } from './args.js';

describe('commandWords', () => {
  it('finds a noun and its verb, skipping global options before them', () => {
    expect(commandWords(['--json', '--as', 'Bot', 'task', 'add', 'x'])).toEqual({
      words: ['task', 'add'],
      rest: ['--json', '--as', 'Bot', 'x'],
    });
  });
  it('takes one word for a command without a verb', () => {
    expect(commandWords(['find', 'login', 'loop'])).toEqual({
      words: ['find'],
      rest: ['login', 'loop'],
    });
  });
  it("stops at a command's own option", () => {
    expect(commandWords(['find', '--type', 'task'])).toEqual({
      words: ['find'],
      rest: ['--type', 'task'],
    });
  });
  it('gives no words for the overview', () => {
    expect(commandWords(['--json'])).toEqual({ words: [], rest: ['--json'] });
  });
});

describe('parseArgs', () => {
  const specs = [
    { name: 'list', value: '<list>', help: '' },
    { name: 'pin', help: '' },
    { name: 'kind', value: '<k>', repeat: true, help: '' },
  ];
  it('reads values, switches, repeats and positionals in any order', () => {
    const parsed = parseArgs(
      ['a', '--list', 'B', '--pin', 'c', '--kind=x', '--kind', 'y', '-h'],
      specs,
      'flint t',
    );
    expect(parsed.positionals).toEqual(['a', 'c']);
    expect(Object.fromEntries(parsed.options)).toEqual({
      list: 'B',
      pin: true,
      kind: ['x', 'y'],
      help: true,
    });
  });
  it('keeps dashes that are text, and everything after --', () => {
    expect(parseArgs(['- item', '-', '-5', '--', '--pin'], specs, 'flint t').positionals).toEqual([
      '- item',
      '-',
      '-5',
      '--pin',
    ]);
    expect(isOption('--x')).toBe(true);
    expect(isOption('-h')).toBe(true);
    expect(isOption('- x')).toBe(false);
  });
  it('lets a value start with a dash when it is not an option', () => {
    expect(parseArgs(['--list', '-'], specs, 'flint t').options.get('list')).toBe('-');
  });
  it('refuses unknown options and missing values', () => {
    expect(() => parseArgs(['--nope'], specs, 'flint t')).toThrow(
      'Unknown option --nope for `flint t`.',
    );
    expect(() => parseArgs(['-x'], specs, 'flint t')).toThrow('Unknown option -x');
    expect(() => parseArgs(['--list'], specs, 'flint t')).toThrow('--list needs a value');
    expect(() => parseArgs(['--list', '--pin'], specs, 'flint t')).toThrow('--list needs a value');
  });
});

describe("the agent's name (AGENT-01, D-185 Q4)", () => {
  it('CLI: --as, then FLINT_AGENT, then Claude Code, then Command line', () => {
    expect(cliAgent('Build bot', { FLINT_AGENT: 'x' })).toEqual({ name: 'Build bot', via: 'cli' });
    expect(cliAgent(undefined, { FLINT_AGENT: 'Nightly', CLAUDECODE: '1' }).name).toBe('Nightly');
    expect(cliAgent(undefined, { CLAUDECODE: '1' }).name).toBe('Claude Code');
    expect(cliAgent(undefined, {}).name).toBe('Command line');
    expect(cliAgent('  ', {}).name).toBe('Command line');
  });
  it('MCP: the known clients by clientInfo, others by their title or name', () => {
    expect(mcpAgent({ name: 'claude-ai', version: '1' })).toEqual({ name: 'Claude', via: 'mcp' });
    expect(mcpAgent({ name: 'claude-code' }).name).toBe('Claude Code');
    expect(mcpAgent({ name: 'cursor-vscode' }).name).toBe('Cursor');
    expect(mcpAgent({ name: 'Visual Studio Code' }).name).toBe('VS Code');
    expect(mcpAgent({ name: 'vscode-insiders' }).name).toBe('VS Code');
    expect(mcpAgent({ name: 'acme-agent', title: 'Acme Agent' }).name).toBe('Acme Agent');
    expect(mcpAgent({ name: 'acme-agent' }).name).toBe('acme-agent');
    expect(mcpAgent(undefined).name).toBe('MCP client');
  });
  it('removes control characters, trims and keeps at most 32 characters', () => {
    expect(cleanName(' Uni\u0007corn\n ')).toBe('Unicorn');
    expect(cleanName('x'.repeat(40))).toHaveLength(32);
    expect(mcpAgent({ name: 'a b'.padEnd(50, 'c') }).name).toHaveLength(32);
  });
});
