/** AGENT-02 (D-185 Q11): output, exit codes, help and the reach choices of `flint`. */
import type { AgentErrorCode } from '@flint/core/agents';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands.js';
import { EXIT, exitCodeFor, FlintError, MESSAGES } from './errors.js';
import { failed, NOW, ok, run } from './test-helpers.js';

const WRITE = {
  changed: [{ kind: 'task', id: 'k3f9a2', name: 'Fix login loop', what: 'added' }],
  text: ['Added "Fix login loop" to Backend · id k3f9a2 · Reminder Sat 14 Nov, 09:00'],
};

describe('output', () => {
  it("prints a write's sentences", async () => {
    const result = await run(['add', 'Fix login loop'], { answer: () => ok(WRITE) });
    expect(result.out).toBe(`${WRITE.text[0]}\n`);
    expect(result.code).toBe(0);
  });

  it('prints the exact result with now as one JSON document with --json', async () => {
    const result = await run(['add', 'Fix login loop', '--json'], { answer: () => ok(WRITE) });
    expect(JSON.parse(result.out)).toEqual({ ...WRITE, now: NOW });
    expect(result.out.trim().split('\n')).toHaveLength(1);
  });

  it('prints an error as {"error": …} on stdout with --json, with its exit code', async () => {
    const error = {
      code: 'ambiguous' as const,
      message: 'Two tasks are called "Fix login loop".',
      candidates: [
        { kind: 'task' as const, id: 'k3f9a2', name: 'Fix login loop', list: 'Backend' },
        { kind: 'task' as const, id: 'p7d1x0', name: 'Fix login loop', list: 'Inbox', done: true },
      ],
    };
    const result = await run(['task', 'done', 'Fix login loop', '--json'], {
      answer: () => failed(error),
    });
    expect(result.code).toBe(2);
    expect(JSON.parse(result.out)).toEqual({ error });
    expect(result.err).toBe('');
  });

  it('prints an error to stderr with its candidates, suggestions and problems', async () => {
    const result = await run(['task', 'done', 'Fix'], {
      answer: () =>
        failed({
          code: 'not_found',
          message: 'No task is called "Fix".',
          suggestions: [{ kind: 'task', id: 'k3f9a2', name: 'Fix login loop', list: 'Backend' }],
          problems: [
            {
              index: 1,
              code: 'ambiguous',
              message: 'Two lists are called "Work".',
              candidates: [{ kind: 'list', id: 'l1', name: 'Work', group: 'Acme' }],
            },
          ],
        }),
    });
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(result.err).toBe(
      [
        'flint: No task is called "Fix".',
        'Did you mean:',
        '  k3f9a2  Fix login loop · Backend',
        '  Item 2: Two lists are called "Work".',
        '    Matches (use an ID):',
        '      l1  Work · list · Acme',
        '',
      ].join('\n'),
    );
  });

  it('colours only a terminal, never with --json or NO_COLOR', async () => {
    const answer = (): ReturnType<typeof ok> =>
      ok({ hits: [{ kind: 'task', id: 'k3f9a2', name: 'A', priority: 'high' }], more: false });
    expect((await run(['find', 'a'], { answer, tty: true })).out).toContain('\u001b[');
    expect((await run(['find', 'a'], { answer, tty: false })).out).not.toContain('\u001b[');
    expect(
      (await run(['find', 'a'], { answer, tty: true, env: { NO_COLOR: '1' } })).out,
    ).not.toContain('\u001b[');
    expect((await run(['find', 'a', '--json'], { answer, tty: true })).out).not.toContain(
      '\u001b[',
    );
  });

  it('reports a failure before Flint answers (not running) with exit 3', async () => {
    const result = await run(['status'], {
      answer: () => {
        throw new FlintError({ code: 'not_running', message: MESSAGES.notRunning });
      },
    });
    expect(result.code).toBe(3);
    expect(result.err).toBe("flint: Flint isn't running.\n");
  });

  it('reports an unexpected failure as internal (exit 5)', async () => {
    const result = await run(['status', '--json'], {
      answer: () => {
        throw new Error('boom');
      },
    });
    expect(result.code).toBe(5);
    expect(JSON.parse(result.out)).toEqual({ error: { code: 'internal', message: 'boom' } });
  });
});

describe('exit codes (stable, AGENT-02)', () => {
  const CODES: readonly (readonly [AgentErrorCode, number])[] = [
    ['not_found', 2],
    ['ambiguous', 2],
    ['bad_time', 2],
    ['invalid', 2],
    ['off', 4],
    ['read_only', 4],
    ['paused', 4],
    ['too_large', 4],
    ['unauthorized', 4],
    ['internal', 5],
    ['protocol', 5],
  ];
  it.each(CODES)('%s → %i', async (code, exit) => {
    expect(exitCodeFor(code)).toBe(exit);
    const result = await run(['status'], { answer: () => failed({ code, message: 'x' }) });
    expect(result.code).toBe(exit);
  });
  it('maps the client’s own codes', () => {
    expect(exitCodeFor('usage')).toBe(EXIT.usage);
    expect(exitCodeFor('not_running')).toBe(3);
    expect(exitCodeFor('not_installed')).toBe(3);
    expect(exitCodeFor('unreachable')).toBe(3);
  });
});

describe('who and how', () => {
  it('names the agent and passes --no-start and --dev on', async () => {
    const result = await run(['status', '--as', 'Nightly job', '--no-start', '--dev'], {
      env: { CLAUDECODE: '1' },
    });
    expect(result.agents).toEqual([{ name: 'Nightly job', via: 'cli' }]);
    expect(result.choices).toEqual([{ dev: true, noStart: true }]);
  });
  it('takes FLINT_NO_START=1 and Claude Code from the environment', async () => {
    const result = await run(['status'], { env: { FLINT_NO_START: '1', CLAUDECODE: '1' } });
    expect(result.agents).toEqual([{ name: 'Claude Code', via: 'cli' }]);
    expect(result.choices).toEqual([{ dev: false, noStart: true }]);
  });
});

describe('help at every level', () => {
  it('flint --help lists the commands, exit codes and examples', async () => {
    for (const argv of [['--help'], ['-h'], ['help']]) {
      const result = await run(argv);
      expect(result.code).toBe(0);
      expect(result.out).toMatch(/^flint: /);
      expect(result.out).toContain('Exit codes: 0 done; 1 usage;');
      expect(result.out).toContain('Examples:');
      expect(result.out).toContain('See also:');
      expect(result.calls).toEqual([]);
    }
  });
  it.each(['task', 'list', 'note', 'group', 'links'])(
    'flint %s --help lists its verbs',
    async (noun) => {
      for (const argv of [[noun, '--help'], [noun], ['help', noun]]) {
        const result = await run(argv);
        expect(result.code).toBe(0);
        expect(result.out).toContain(`Usage: flint ${noun} <verb>`);
        expect(result.out).toContain('Examples:');
      }
    },
  );
  it.each(COMMANDS.map((command) => [command.words.join(' ')]))(
    'flint %s --help',
    async (words) => {
      const result = await run([...words.split(' '), '--help']);
      expect(result.code).toBe(0);
      expect(result.out).toContain('Usage: flint ');
      expect(result.out.match(/^ {2}flint /gm)?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(result.out).toContain('See also:');
      expect(result.calls).toEqual([]);
    },
  );
  it('every command has 1–3 examples, most 2–3', () => {
    for (const command of COMMANDS) expect(command.examples.length).toBeGreaterThanOrEqual(1);
    const fewer = COMMANDS.filter((command) => command.examples.length < 2).length;
    expect(fewer).toBeLessThan(COMMANDS.length / 2);
  });
  it('flint help agents is a short guide', async () => {
    const result = await run(['help', 'agents']);
    const lines = result.out.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(15);
    expect(lines.length).toBeLessThanOrEqual(25);
    expect(result.out).toContain('--literal');
    expect(result.out).toContain('--json');
    expect(result.out).toContain('Exit codes');
  });
  it('flint mcp --help, and flint mcp runs the server', async () => {
    expect((await run(['mcp', '--help'])).out).toContain('Usage: flint mcp');
    expect((await run(['mcp'])).code).toBe(0);
    expect((await run(['mcp', 'extra'])).code).toBe(1);
  });
});
