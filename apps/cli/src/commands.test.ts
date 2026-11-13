/** AGENT-02 (D-185 Q11): every command maps to exactly one request of the right shape. */
import { describe, expect, it } from 'vitest';
import { COMMANDS, lineRange } from './commands.js';
import { ok, run } from './test-helpers.js';

/** argv → the one request it sends. */
const CASES: readonly (readonly [string, readonly string[], string, unknown])[] = [
  ['overview', [], 'find', {}],
  [
    'find with a query and filters',
    [
      'find',
      'login',
      'loop',
      '--type',
      'task',
      '--status',
      'open',
      '--priority',
      'high',
      '--pinned',
      '--limit',
      '50',
    ],
    'find',
    {
      query: 'login loop',
      type: 'task',
      status: 'open',
      priority: 'high',
      pinned: true,
      limit: 50,
    },
  ],
  [
    'find --list is --in',
    ['find', '--list', 'Backend', '--remind-before', 'fri 18:00', '--remind-after', 'now'],
    'find',
    { in: 'Backend', remindBefore: 'fri 18:00', remindAfter: 'now' },
  ],
  [
    'read several, with a range',
    ['read', 'Meeting notes', 'Today', '--lines', '40:120'],
    'read',
    {
      items: [
        { ref: 'Meeting notes', lines: { from: 40, to: 120 } },
        { ref: 'Today', lines: { from: 40, to: 120 } },
      ],
    },
  ],
  [
    'read a list paged',
    ['read', 'Backend', '--status', 'all', '--limit', '20', '--offset', '40', '--kind', 'list'],
    'read',
    { items: [{ ref: 'Backend', kind: 'list', status: 'all', limit: 20, offset: 40 }] },
  ],
  [
    'read outline and archived',
    ['read', 'Notes', '--outline', '--archived', '--in', 'Work'],
    'read',
    { items: [{ ref: 'Notes', in: 'Work', outline: true, archived: true }] },
  ],
  [
    'task add with every field',
    [
      'task',
      'add',
      'Fix',
      'login loop',
      '--list',
      'Backend',
      '--priority',
      'high',
      '--remind',
      'tomorrow 9:00',
      '--pin',
      '--focus',
      '--mute',
      '--body',
      'Steps',
      '--bottom',
    ],
    'create',
    {
      items: [
        {
          kind: 'task',
          title: 'Fix login loop',
          list: 'Backend',
          body: 'Steps',
          priority: 'high',
          remind: 'tomorrow 9:00',
          pinned: true,
          focus: true,
          muted: true,
          position: 'bottom',
        },
      ],
      parseShorthand: true,
    },
  ],
  [
    'add is task add',
    ['add', 'Call Alex !h @fri 9'],
    'create',
    { items: [{ kind: 'task', title: 'Call Alex !h @fri 9' }], parseShorthand: true },
  ],
  [
    'task add --literal, a subtask after another',
    ['task', 'add', 'Write tests', '--parent', 'k3f9a2', '--after', 'p7d1x0', '--literal'],
    'create',
    {
      items: [
        { kind: 'task', title: 'Write tests', parent: 'k3f9a2', position: { after: 'p7d1x0' } },
      ],
      parseShorthand: false,
    },
  ],
  [
    'task add --priority none leaves it out',
    ['task', 'add', 'x', '--priority', 'none'],
    'create',
    { items: [{ kind: 'task', title: 'x' }], parseShorthand: true },
  ],
  [
    'task edit',
    [
      'task',
      'edit',
      'k3f9a2',
      '--title',
      'New',
      '--priority',
      'none',
      '--remind',
      'none',
      '--unpin',
      '--unmute',
      '--no-focus',
      '--before',
      'p7d1x0',
    ],
    'update',
    {
      items: [
        {
          ref: 'k3f9a2',
          title: 'New',
          priority: null,
          remind: 'none',
          pinned: false,
          muted: false,
          focus: false,
          position: { before: 'p7d1x0' },
        },
      ],
      parseShorthand: true,
    },
  ],
  [
    'task edit outdent, in a list',
    ['task', 'edit', 'Fix login loop', '--in', 'Backend', '--outdent', '--top', '--literal'],
    'update',
    {
      items: [{ ref: 'Fix login loop', in: 'Backend', parent: null, position: 'top' }],
      parseShorthand: false,
    },
  ],
  [
    'task done, a batch',
    ['task', 'done', 'k3f9a2', 'p7d1x0'],
    'update',
    {
      items: [
        { ref: 'k3f9a2', done: true },
        { ref: 'p7d1x0', done: true },
      ],
    },
  ],
  [
    'task undone',
    ['task', 'undone', 'Call Alex', '--in', 'Inbox'],
    'update',
    { items: [{ ref: 'Call Alex', in: 'Inbox', done: false }] },
  ],
  ['task pin', ['task', 'pin', 'k3f9a2'], 'update', { items: [{ ref: 'k3f9a2', pinned: true }] }],
  [
    'task unpin',
    ['task', 'unpin', 'k3f9a2'],
    'update',
    { items: [{ ref: 'k3f9a2', pinned: false }] },
  ],
  [
    'task move to a list',
    ['task', 'move', 'k3f9a2', '--to', 'Backend'],
    'update',
    { items: [{ ref: 'k3f9a2', moveTo: 'Backend' }] },
  ],
  [
    'task move under a parent',
    ['task', 'move', 'k3f9a2', '--parent', 'p7d1x0'],
    'update',
    { items: [{ ref: 'k3f9a2', parent: 'p7d1x0' }] },
  ],
  [
    'task snooze',
    ['task', 'snooze', 'k3f9a2', 'in 2h'],
    'update',
    { items: [{ ref: 'k3f9a2', remind: 'in 2h' }] },
  ],
  [
    'task snooze with --remind (preview 3: as the skill showed it)',
    ['task', 'snooze', 'k3f9a2', '--remind', '2026-11-20T15:30'],
    'update',
    { items: [{ ref: 'k3f9a2', remind: '2026-11-20T15:30' }] },
  ],
  [
    'task delete',
    ['task', 'delete', 'k3f9a2', 'Old idea', '--in', 'Inbox'],
    'delete',
    {
      items: [
        { ref: 'k3f9a2', kind: 'task', in: 'Inbox' },
        { ref: 'Old idea', kind: 'task', in: 'Inbox' },
      ],
    },
  ],
  [
    'list add',
    ['list', 'add', 'Sprint', '12', '--group', 'Work'],
    'create',
    { items: [{ kind: 'list', name: 'Sprint 12', group: 'Work' }] },
  ],
  [
    'list rename',
    ['list', 'rename', 'Backend', 'Backend API'],
    'update',
    { items: [{ kind: 'list', ref: 'Backend', name: 'Backend API' }] },
  ],
  [
    'list move into a group',
    ['list', 'move', 'Backend', '--group', 'Work', '--top'],
    'update',
    { items: [{ kind: 'list', ref: 'Backend', group: 'Work', position: 'top' }] },
  ],
  [
    'list move out of its group',
    ['list', 'move', 'Backend', '--no-group'],
    'update',
    { items: [{ kind: 'list', ref: 'Backend', group: null }] },
  ],
  [
    'list duplicate',
    ['list', 'duplicate', 'Packing'],
    'update',
    { items: [{ kind: 'list', ref: 'Packing', duplicate: true }] },
  ],
  [
    'list convert',
    ['list', 'convert', 'Ideas', '--to', 'note'],
    'update',
    { items: [{ kind: 'list', ref: 'Ideas', mode: 'note' }] },
  ],
  [
    'list archive-done',
    ['list', 'archive-done', 'Backend'],
    'update',
    { items: [{ kind: 'list', ref: 'Backend', archiveDone: true }] },
  ],
  ['list delete', ['list', 'delete', 'Old'], 'delete', { items: [{ ref: 'Old', kind: 'list' }] }],
  [
    'note add',
    ['note', 'add', 'Meeting notes', '--group', 'Work', '--text', '# Agenda'],
    'create',
    { items: [{ kind: 'note', name: 'Meeting notes', group: 'Work', text: '# Agenda' }] },
  ],
  [
    'note add --quick',
    ['note', 'add', '--quick', 'Ask', 'Alex'],
    'create',
    { items: [{ kind: 'quickNote', text: 'Ask Alex' }] },
  ],
  [
    'note add --quick, empty',
    ['note', 'add', '--quick'],
    'create',
    { items: [{ kind: 'quickNote' }] },
  ],
  [
    'note append',
    ['note', 'append', 'Meeting notes', '- Decided'],
    'update',
    { items: [{ kind: 'note', ref: 'Meeting notes', append: '- Decided' }] },
  ],
  [
    'note replace a passage',
    ['note', 'replace', 'Notes', '--find', 'Monday', '--with', 'Tuesday'],
    'update',
    { items: [{ kind: 'note', ref: 'Notes', replace: { find: 'Monday', with: 'Tuesday' } }] },
  ],
  [
    'note replace the whole text',
    ['note', 'replace', 'Notes', '--text', 'All new'],
    'update',
    { items: [{ kind: 'note', ref: 'Notes', text: 'All new' }] },
  ],
  [
    'note keep',
    ['note', 'keep', 'q4h8s1', 'Release plan'],
    'update',
    { items: [{ kind: 'note', ref: 'q4h8s1', keep: { name: 'Release plan' } }] },
  ],
  [
    'note delete',
    ['note', 'delete', 'Draft'],
    'delete',
    { items: [{ ref: 'Draft', kind: 'note' }] },
  ],
  [
    'group add with lists',
    ['group', 'add', 'Work', '--list', 'Backend', '--list', 'Notes'],
    'create',
    { items: [{ kind: 'group', name: 'Work', lists: ['Backend', 'Notes'] }] },
  ],
  [
    'group rename',
    ['group', 'rename', 'Work', 'Day job'],
    'update',
    { items: [{ kind: 'group', ref: 'Work', name: 'Day job' }] },
  ],
  [
    'group add-list',
    ['group', 'add-list', 'Work', 'Backend', 'Notes'],
    'update',
    { items: [{ kind: 'group', ref: 'Work', addLists: ['Backend', 'Notes'] }] },
  ],
  [
    'group remove-list',
    ['group', 'remove-list', 'Work', 'Backend'],
    'update',
    { items: [{ kind: 'group', ref: 'Work', removeLists: ['Backend'] }] },
  ],
  [
    'group move',
    ['group', 'move', 'Work', '--after', 'Personal'],
    'update',
    { items: [{ kind: 'group', ref: 'Work', position: { after: 'Personal' } }] },
  ],
  [
    'group delete',
    ['group', 'delete', 'Archive'],
    'delete',
    { items: [{ ref: 'Archive', kind: 'group' }] },
  ],
  [
    'attach to a task, made absolute',
    ['attach', 'shots\\a.png', '--to', 'k3f9a2'],
    'update',
    { items: [{ ref: 'k3f9a2', attach: { path: 'C:\\Work\\shots\\a.png' } }] },
  ],
  [
    'attach to a note',
    ['attach', 'D:\\Specs\\api.pdf', '--to', 'Notes', '--note'],
    'update',
    { items: [{ kind: 'note', ref: 'Notes', attach: { path: 'D:\\Specs\\api.pdf' } }] },
  ],
  ['links list', ['links', 'list'], 'linkPatterns', { action: 'list' }],
  [
    'links add',
    ['links', 'add', 'ACME-{id}', 'https://tracker.example/ACME-{id}', '--kind', 'id=digits'],
    'linkPatterns',
    {
      action: 'add',
      short: 'ACME-{id}',
      url: 'https://tracker.example/ACME-{id}',
      kinds: { id: 'digits' },
    },
  ],
  [
    'links edit by index',
    ['links', 'edit', '0', '--url', 'https://x.example/{id}'],
    'linkPatterns',
    { action: 'edit', ref: 0, url: 'https://x.example/{id}' },
  ],
  [
    'links delete by short form',
    ['links', 'delete', 'ACME-{id}'],
    'linkPatterns',
    { action: 'delete', ref: 'ACME-{id}' },
  ],
  ['status', ['status'], 'status', {}],
];

describe('commands → one request (AGENT-02)', () => {
  it.each(CASES)('%s', async (_name, argv, tool, args) => {
    const result = await run(argv, { answer: () => ok({ text: [] }) });
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([{ tool, args }]);
  });

  it('covers every command in the table', () => {
    const covered = new Set(
      CASES.map(([, argv]) =>
        argv[0] && ['task', 'list', 'note', 'group', 'links'].includes(argv[0])
          ? `${argv[0]} ${argv[1]}`
          : (argv[0] ?? 'find'),
      ),
    );
    for (const command of COMMANDS)
      expect(covered, command.words.join(' ')).toContain(command.words.join(' '));
  });

  it('reads --body - and --text - from standard input', async () => {
    const body = await run(['task', 'edit', 'k3f9a2', '--body', '-'], {
      stdin: 'Line 1\r\nLine 2\r\n',
    });
    expect(body.calls[0]?.args).toEqual({
      items: [{ ref: 'k3f9a2', body: 'Line 1\nLine 2' }],
      parseShorthand: true,
    });
    const text = await run(['note', 'append', 'Changelog', '--text', '-'], { stdin: 'abc\n' });
    expect(text.calls[0]?.args).toEqual({
      items: [{ kind: 'note', ref: 'Changelog', append: 'abc' }],
    });
  });

  it('takes a whole batch with --json-input -', async () => {
    const batch = {
      items: [
        { kind: 'task', title: 'A' },
        { kind: 'task', title: 'B', list: 'Backend' },
      ],
    };
    const create = await run(['task', 'add', '--json-input', '-'], {
      stdin: JSON.stringify(batch),
    });
    expect(create.calls).toEqual([{ tool: 'create', args: { ...batch, parseShorthand: true } }]);
    const literal = await run(['task', 'add', '--json-input', '-', '--literal'], {
      stdin: JSON.stringify(batch.items),
    });
    expect(literal.calls[0]?.args).toEqual({ ...batch, parseShorthand: false });
    const kept = await run(['task', 'edit', '--json-input', '-'], {
      stdin: '{"items":[{"ref":"a","done":true}],"parseShorthand":false}',
    });
    expect(kept.calls[0]?.args).toEqual({
      items: [{ ref: 'a', done: true }],
      parseShorthand: false,
    });
    const read = await run(['read', '--json-input', '-'], { stdin: '{"items":[{"ref":"Today"}]}' });
    expect(read.calls[0]).toEqual({ tool: 'read', args: { items: [{ ref: 'Today' }] } });
  });

  it('takes --name=value and -- before a title that starts with a dash', async () => {
    const result = await run(['task', 'add', '--list=Backend', '--', '-x is a title']);
    expect(result.calls[0]?.args).toEqual({
      items: [{ kind: 'task', title: '-x is a title', list: 'Backend' }],
      parseShorthand: true,
    });
  });
});

describe('usage errors (exit 1, nothing sent)', () => {
  const USAGE: readonly (readonly [string, readonly string[]])[] = [
    ['an unknown option', ['task', 'add', 'x', '--bogus']],
    ['an unknown command', ['frobnicate']],
    ['an unknown verb', ['task', 'frobnicate']],
    ['a missing title', ['task', 'add']],
    ['a missing value', ['task', 'add', 'x', '--list']],
    ['a bad priority', ['task', 'add', 'x', '--priority', 'urgent']],
    ['two positions', ['task', 'add', 'x', '--top', '--bottom']],
    ['an edit with nothing to change', ['task', 'edit', 'k3f9a2']],
    ['a switch given a value', ['task', 'add', 'x', '--pin=yes']],
    ['a value given twice', ['task', 'add', 'x', '--list', 'A', '--list', 'B']],
    ['snooze without a time', ['task', 'snooze', 'k3f9a2']],
    ['a bad line range', ['read', 'Notes', '--lines', '10-20']],
    ['a bad count', ['find', '--limit', 'ten']],
    ['convert without --to', ['list', 'convert', 'Ideas']],
    ['replace without --with', ['note', 'replace', 'Notes', '--find', 'a']],
    ['append twice', ['note', 'append', 'Notes', 'a', '--text', 'b']],
    ['attach without --to', ['attach', 'a.png']],
    ['two stdin options', ['note', 'add', 'N', '--text', '-', '--json-input', '-']],
    ['json-input with arguments', ['task', 'add', 'x', '--json-input', '-']],
    ['json-input that is not JSON', ['task', 'add', '--json-input', '-']],
    ['links add with a bad kind', ['links', 'add', 'a', 'b', '--kind', 'id']],
    ['status with an argument', ['status', 'now']],
    ['--literal where it means nothing', ['find', '--literal']],
  ];
  it.each(USAGE)('%s', async (_name, argv) => {
    const result = await run(argv, { stdin: 'not json' });
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.out).toBe('');
    expect(result.err).toMatch(/^flint: .+\nUsage: flint /);
  });

  it('prints a usage error as JSON on stdout with --json', async () => {
    const result = await run(['task', 'add', '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out)).toEqual({
      error: { code: 'usage', message: 'Give the task title.' },
    });
    expect(result.err).toBe('');
  });
});

describe('lineRange', () => {
  it('reads from:to and a single line', () => {
    expect(lineRange('40:120')).toEqual({ from: 40, to: 120 });
    expect(lineRange('7')).toEqual({ from: 7, to: 7 });
    expect(() => lineRange('0:3')).toThrow();
    expect(() => lineRange('9:3')).toThrow();
  });
});
