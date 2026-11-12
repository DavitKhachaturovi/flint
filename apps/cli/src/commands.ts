/**
 * AGENT-02 (D-185 Q11): the `flint` commands, noun-verb, one-to-one with the MCP tools. Each maps
 * its arguments to exactly one request (one tool call; several refs make one batch). No checks
 * beyond the arguments' shape: names, IDs, times and limits are Flint's (AGENT-01).
 */
import { isAbsolute, resolve } from 'node:path';
import type {
  AgentTool,
  CreateArgs,
  CreateItem,
  DeleteArgs,
  FindArgs,
  ItemKind,
  LineRange,
  LinkPatternsArgs,
  Priority,
  ReadArgs,
  ReadItem,
  SidebarPosition,
  UpdateArgs,
  UpdateItem,
} from '@flint/core/agents';
import type { OptionSpec, OptionValue } from './args.js';
import { usageError } from './errors.js';

/** What a command's builder reads. Standard input (`-`) is already read in. */
export interface CommandInput {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, OptionValue>;
  /** For attachments: relative paths are made absolute from here. */
  readonly cwd: string;
}

export interface Command {
  /** `['task', 'add']`, `['find']`. */
  readonly words: readonly string[];
  /** After `flint `: `task add <title> [options]`. */
  readonly usage: string;
  readonly summary: string;
  /** More about it, for its own help. */
  readonly details?: readonly string[];
  readonly options: readonly OptionSpec[];
  readonly examples: readonly string[];
  readonly seeAlso: readonly string[];
  readonly tool: AgentTool;
  readonly build: (input: CommandInput) => unknown;
}

// ─── reading the options ─────────────────────────────────────────────────────────────────────────

const str = (input: CommandInput, name: string): string | undefined => {
  const value = input.options.get(name);
  return typeof value === 'string' ? value : undefined;
};
const has = (input: CommandInput, name: string): boolean => input.options.get(name) === true;
const many = (input: CommandInput, name: string): readonly string[] => {
  const value = input.options.get(name);
  return Array.isArray(value) ? (value as readonly string[]) : [];
};

/** Exactly `count` positionals, named for the usage error. */
function exactly(input: CommandInput, names: readonly string[]): string[] {
  if (names.length === 0 && input.positionals.length > 0)
    throw usageError(`Unexpected argument "${input.positionals[0]}".`);
  if (input.positionals.length !== names.length)
    throw usageError(
      `Expected ${names.map((name) => `<${name}>`).join(' ')}${input.positionals.length > names.length ? ' only (quote names with spaces)' : ''}.`,
    );
  return [...input.positionals];
}

/** One or more refs (each its own argument: quote titles with spaces). */
function refs(input: CommandInput, what: string): readonly string[] {
  if (input.positionals.length === 0)
    throw usageError(`Give at least one ${what}: its ID or exact name.`);
  return input.positionals;
}

/** The positionals joined into one text (`flint add buy milk !h`). */
function joined(input: CommandInput, what: string): string {
  const text = input.positionals.join(' ').trim();
  if (text === '') throw usageError(`Give the ${what}.`);
  return text;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw usageError(`--${name} must be ${allowed.join(', ')} (not "${value}").`);
}

function count(input: CommandInput, name: string): number | undefined {
  const value = str(input, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw usageError(`--${name} must be a whole number (not "${value}").`);
  return Number(value);
}

const PRIORITIES = ['high', 'medium', 'low', 'none'] as const;

/** `--priority`: `none` clears it (null), on add it's simply left out. */
function priority(input: CommandInput): Priority | null | undefined {
  const value = str(input, 'priority');
  if (value === undefined) return undefined;
  const chosen = oneOf(value.toLowerCase(), PRIORITIES, 'priority');
  return chosen === 'none' ? null : chosen;
}

/** `--lines 40:120` (or one line, `--lines 40`). */
export function lineRange(value: string): LineRange {
  const match = /^(\d+)(?::(\d+))?$/.exec(value.trim());
  if (!match) throw usageError(`--lines takes from:to, like --lines 40:120 (not "${value}").`);
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (from < 1 || to < from) throw usageError(`--lines needs 1 ≤ from ≤ to (not "${value}").`);
  return { from, to };
}

/** `--top`, `--bottom`, `--after <ref>`, `--before <ref>`: at most one. */
function position(input: CommandInput): SidebarPosition | undefined {
  const given: SidebarPosition[] = [];
  if (has(input, 'top')) given.push('top');
  if (has(input, 'bottom')) given.push('bottom');
  const after = str(input, 'after');
  if (after !== undefined) given.push({ after });
  const before = str(input, 'before');
  if (before !== undefined) given.push({ before });
  if (given.length > 1) throw usageError('Give one of --top, --bottom, --after, --before.');
  return given[0];
}

/** `T` with its possibly-undefined fields made optional (and never undefined). */
type Defined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Keeps the defined values only (exactOptionalPropertyTypes: no `undefined` fields). */
function defined<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Defined<T>;
}

const shorthand = (input: CommandInput): boolean => !has(input, 'literal');

// ─── option specs ────────────────────────────────────────────────────────────────────────────────

const O = {
  literal: {
    name: 'literal',
    help: 'Take the title as typed: no capture shorthand (!h, ##list, @fri 9)',
  },
  list: { name: 'list', value: '<list>', help: 'The list: its ID or exact name (default Inbox)' },
  in: { name: 'in', value: '<list>', help: 'Narrow a task title to this list' },
  parent: { name: 'parent', value: '<task>', help: 'Make it a subtask of this task (one level)' },
  priority: { name: 'priority', value: '<p>', help: 'high, medium, low or none' },
  remind: {
    name: 'remind',
    value: '<time>',
    help: '"tomorrow 9:00", "fri 14", "in 2h", ISO 2026-11-14T09:00, or none',
  },
  pin: { name: 'pin', help: 'Pin it to Today' },
  focus: { name: 'focus', help: "Add it to Focus's sprint" },
  mute: { name: 'mute', help: 'Remind without sound' },
  body: { name: 'body', value: '<text>', help: 'Its body (markdown); - reads stdin' },
  text: { name: 'text', value: '<text>', help: 'The text (markdown); - reads stdin' },
  top: { name: 'top', help: 'Put it first' },
  bottom: { name: 'bottom', help: 'Put it last' },
  after: { name: 'after', value: '<ref>', help: 'Put it right after this one' },
  before: { name: 'before', value: '<ref>', help: 'Put it right before this one' },
  group: { name: 'group', value: '<group>', help: 'The group: its ID or exact name' },
  jsonInput: {
    name: 'json-input',
    value: '-',
    help: "Read the whole request from stdin, in the MCP tool's JSON shape",
  },
} as const satisfies Record<string, OptionSpec>;

const POSITION = [O.top, O.bottom, O.after, O.before];

// ─── builders shared by several commands ─────────────────────────────────────────────────────────

const updates = (items: readonly UpdateItem[], parseShorthand?: boolean): UpdateArgs =>
  parseShorthand === undefined ? { items } : { items, parseShorthand };

const deletes = (input: CommandInput, kind: ItemKind, what: string): DeleteArgs => ({
  items: refs(input, what).map((ref) =>
    defined({ ref, kind, in: kind === 'task' ? str(input, 'in') : undefined }),
  ),
});

/** A task change applied to each ref (`done`, `pin`…). */
const eachTask =
  (fields: Partial<Record<'done' | 'pinned', boolean>>) =>
  (input: CommandInput): UpdateArgs =>
    updates(refs(input, 'task').map((ref) => defined({ ref, in: str(input, 'in'), ...fields })));

/** A list or note change applied to each ref. */
const eachList =
  (kind: 'list' | 'note', fields: { duplicate?: true; archiveDone?: true }) =>
  (input: CommandInput): UpdateArgs =>
    updates(refs(input, kind).map((ref) => ({ kind, ref, ...fields })));

function taskAdd(input: CommandInput): CreateArgs {
  const title = joined(input, 'task title');
  const level = priority(input);
  const item: CreateItem = defined({
    kind: 'task' as const,
    title,
    list: str(input, 'list'),
    parent: str(input, 'parent'),
    body: str(input, 'body'),
    priority: level ?? undefined,
    remind: str(input, 'remind'),
    pinned: has(input, 'pin') || undefined,
    focus: has(input, 'focus') || undefined,
    muted: has(input, 'mute') || undefined,
    position: position(input),
  });
  return { items: [item], parseShorthand: shorthand(input) };
}

function taskEdit(input: CommandInput): UpdateArgs {
  const [ref = ''] = exactly(input, ['task']);
  if (has(input, 'pin') && has(input, 'unpin'))
    throw usageError('Give --pin or --unpin, not both.');
  if (has(input, 'mute') && has(input, 'unmute'))
    throw usageError('Give --mute or --unmute, not both.');
  if (has(input, 'focus') && has(input, 'no-focus'))
    throw usageError('Give --focus or --no-focus, not both.');
  if (str(input, 'parent') !== undefined && has(input, 'outdent'))
    throw usageError('Give --parent or --outdent, not both.');
  const toggle = (on: string, off: string): boolean | undefined =>
    has(input, on) ? true : has(input, off) ? false : undefined;
  const fields = defined({
    title: str(input, 'title'),
    body: str(input, 'body'),
    priority: priority(input),
    remind: str(input, 'remind'),
    pinned: toggle('pin', 'unpin'),
    muted: toggle('mute', 'unmute'),
    focus: toggle('focus', 'no-focus'),
    parent: has(input, 'outdent') ? null : str(input, 'parent'),
    position: position(input),
  });
  if (Object.keys(fields).length === 0) throw usageError('Nothing to change: give an option.');
  return updates([defined({ ref, in: str(input, 'in'), ...fields })], shorthand(input));
}

function taskMove(input: CommandInput): UpdateArgs {
  if (str(input, 'parent') !== undefined && has(input, 'outdent'))
    throw usageError('Give --parent or --outdent, not both.');
  const fields = defined({
    moveTo: str(input, 'to'),
    parent: has(input, 'outdent') ? null : str(input, 'parent'),
    position: position(input),
  });
  if (Object.keys(fields).length === 0)
    throw usageError(
      'Say where: --to <list>, a position (--top, --after <task>…), --parent or --outdent.',
    );
  return updates(
    refs(input, 'task').map((ref) => defined({ ref, in: str(input, 'in'), ...fields })),
  );
}

function noteAdd(input: CommandInput): CreateArgs {
  if (has(input, 'quick')) {
    if (str(input, 'group') !== undefined) throw usageError('A quick note has no group.');
    const text = str(input, 'text') ?? (input.positionals.join(' ') || undefined);
    if (str(input, 'text') !== undefined && input.positionals.length > 0)
      throw usageError('Give the text once: as an argument or with --text.');
    return { items: [defined({ kind: 'quickNote' as const, text })] };
  }
  const name = joined(input, 'note name');
  return {
    items: [
      defined({
        kind: 'note' as const,
        name,
        group: str(input, 'group'),
        text: str(input, 'text'),
      }),
    ],
  };
}

function noteAppend(input: CommandInput): UpdateArgs {
  const option = str(input, 'text');
  const [ref, text] = input.positionals;
  if (ref === undefined || input.positionals.length > 2)
    throw usageError('Expected <note> [<text>] (quote names and text with spaces).');
  if ((text === undefined) === (option === undefined))
    throw usageError('Give the text to add once: as an argument or with --text (- reads stdin).');
  return updates([{ kind: 'note', ref, append: (text ?? option) as string }]);
}

function noteReplace(input: CommandInput): UpdateArgs {
  const [ref = ''] = exactly(input, ['note']);
  const find = str(input, 'find');
  const replacement = str(input, 'with');
  const text = str(input, 'text');
  if (text !== undefined) {
    if (find !== undefined || replacement !== undefined)
      throw usageError('Give --text (the whole note) or --find with --with, not both.');
    return updates([{ kind: 'note', ref, text }]);
  }
  if (find === undefined || replacement === undefined)
    throw usageError('Give --find <passage> and --with <text>, or --text for the whole note.');
  return updates([{ kind: 'note', ref, replace: { find, with: replacement } }]);
}

function sidebarMove(kind: 'list' | 'note' | 'group') {
  return (input: CommandInput): UpdateArgs => {
    const [ref = ''] = exactly(input, [kind]);
    const where = position(input);
    if (kind === 'group') {
      if (!where) throw usageError('Say where: --top, --bottom, --after <ref> or --before <ref>.');
      return updates([{ kind, ref, position: where }]);
    }
    if (str(input, 'group') !== undefined && has(input, 'no-group'))
      throw usageError('Give --group or --no-group, not both.');
    const group = has(input, 'no-group') ? null : str(input, 'group');
    if (!where && group === undefined)
      throw usageError(
        'Say where: --group <group>, --no-group, or a position (--top, --after <ref>…).',
      );
    return updates([defined({ kind, ref, group, position: where })]);
  };
}

/** `--kind name=digits` (repeatable) for link patterns. */
function kinds(input: CommandInput): Record<string, 'digits' | 'word'> | undefined {
  const given = many(input, 'kind');
  if (given.length === 0) return undefined;
  const out: Record<string, 'digits' | 'word'> = {};
  for (const entry of given) {
    const match = /^([^=]+)=(digits|word)$/.exec(entry.trim());
    if (!match) throw usageError(`--kind takes name=digits or name=word (not "${entry}").`);
    out[match[1] as string] = match[2] as 'digits' | 'word';
  }
  return out;
}

/** A link pattern by its index (a number) or its short form. */
const patternRef = (ref: string): string | number => (/^\d+$/.test(ref) ? Number(ref) : ref);

function find(input: CommandInput): FindArgs {
  const query = input.positionals.join(' ').trim();
  const type = str(input, 'type');
  const status = str(input, 'status');
  const level = str(input, 'priority');
  if (str(input, 'in') !== undefined && str(input, 'list') !== undefined)
    throw usageError('Give --in or --list, not both.');
  return defined({
    query: query || undefined,
    type:
      type === undefined
        ? undefined
        : oneOf(type, ['task', 'list', 'note', 'group', 'any'], 'type'),
    in: str(input, 'in') ?? str(input, 'list'),
    status: status === undefined ? undefined : oneOf(status, ['open', 'done', 'all'], 'status'),
    priority: level === undefined ? undefined : oneOf(level, ['high', 'medium', 'low'], 'priority'),
    pinned: has(input, 'pinned') || undefined,
    remindBefore: str(input, 'remind-before'),
    remindAfter: str(input, 'remind-after'),
    limit: count(input, 'limit'),
  });
}

function read(input: CommandInput): ReadArgs {
  const kind = str(input, 'kind');
  const status = str(input, 'status');
  const lines = str(input, 'lines');
  const shared: Omit<ReadItem, 'ref'> = defined({
    kind: kind === undefined ? undefined : oneOf(kind, ['task', 'list', 'note', 'group'], 'kind'),
    in: str(input, 'in'),
    lines: lines === undefined ? undefined : lineRange(lines),
    outline: has(input, 'outline') || undefined,
    status: status === undefined ? undefined : oneOf(status, ['open', 'done', 'all'], 'status'),
    limit: count(input, 'limit'),
    offset: count(input, 'offset'),
    archived: has(input, 'archived') || undefined,
  });
  return { items: refs(input, 'item').map((ref) => ({ ref, ...shared })) };
}

// ─── the commands ────────────────────────────────────────────────────────────────────────────────

const taskAddCommand = {
  usage: 'task add <title> [options]',
  summary: 'Add a task (to Inbox unless --list)',
  details: [
    'The words are joined into the title. Capture shorthand in it is read (!h, ##Backend, @fri 9)',
    'unless --literal; the explicit options are clearer for scripts and agents.',
  ],
  options: [
    O.list,
    O.parent,
    O.priority,
    O.remind,
    O.pin,
    O.focus,
    O.mute,
    O.body,
    ...POSITION,
    O.literal,
  ],
  examples: [
    'flint task add "Fix login loop" --list Backend --priority high --remind "tomorrow 9:00"',
    'flint add "Call Alex !h @fri 9"',
    'flint task add "Write tests" --parent k3f9a2 --bottom --literal',
  ],
  seeAlso: ['flint task edit --help', 'flint find --help'],
  tool: 'create',
  build: taskAdd,
} as const satisfies Omit<Command, 'words'>;

export const COMMANDS: readonly Command[] = [
  {
    words: ['find'],
    usage: 'find [<query>] [options]',
    summary: 'Search tasks, lists, notes and groups; no query: the overview',
    details: [
      'Fuzzy. Matches inside notes and bodies come with a line number and a snippet: read that',
      'range with flint read <note> --lines from:to. `flint` alone is `flint find`.',
    ],
    options: [
      { name: 'type', value: '<kind>', help: 'task, list, note, group or any' },
      { name: 'in', value: '<list>', help: 'Only in this list or note' },
      { name: 'list', value: '<list>', help: 'The same as --in' },
      { name: 'status', value: '<s>', help: 'open, done or all' },
      { name: 'priority', value: '<p>', help: 'high, medium or low' },
      { name: 'pinned', help: 'Only tasks pinned to Today' },
      { name: 'remind-before', value: '<time>', help: 'Tasks reminding before this time' },
      { name: 'remind-after', value: '<time>', help: 'Tasks reminding after this time' },
      { name: 'limit', value: '<n>', help: 'At most this many results (default 30, at most 100)' },
    ],
    examples: [
      'flint',
      'flint find "login" --type task --status open',
      'flint find --remind-before "fri 18:00" --json',
    ],
    seeAlso: ['flint read --help', 'flint help agents'],
    tool: 'find',
    build: find,
  },
  {
    words: ['read'],
    usage: 'read <ref>... [options]',
    summary:
      'Read lists, notes, tasks or groups by ID or exact name (also Today, Inbox, Reminders)',
    details: [
      'A long note comes back in parts (about 200 lines): read on with --lines, or get its headings',
      'with --outline. A list shows its open tasks, paged with --limit and --offset.',
    ],
    options: [
      { name: 'kind', value: '<kind>', help: 'task, list, note or group, when a name is shared' },
      O.in,
      { name: 'lines', value: '<from:to>', help: "A note's (or a body's) lines, like 40:120" },
      { name: 'outline', help: "A note's headings with their line numbers" },
      { name: 'status', value: '<s>', help: "A list's tasks: open (default), done or all" },
      { name: 'limit', value: '<n>', help: 'At most this many tasks' },
      { name: 'offset', value: '<n>', help: 'Skip this many tasks' },
      { name: 'archived', help: "A list's Archived tab" },
    ],
    examples: [
      'flint read Backend',
      'flint read "Meeting notes" --lines 40:120',
      'flint read Today Inbox --json',
    ],
    seeAlso: ['flint find --help', 'flint note append --help'],
    tool: 'read',
    build: read,
  },
  {
    words: ['add'],
    ...taskAddCommand,
    usage: 'add <title> [options]',
    summary: 'The same as flint task add',
  },
  { words: ['task', 'add'], ...taskAddCommand },
  {
    words: ['task', 'edit'],
    usage: 'task edit <task> [options]',
    summary: "Change a task's title, body, priority, reminder, pin, Focus or place",
    options: [
      O.in,
      { name: 'title', value: '<title>', help: 'A new title' },
      O.body,
      O.priority,
      O.remind,
      O.pin,
      { name: 'unpin', help: 'Unpin it from Today' },
      O.mute,
      { name: 'unmute', help: 'Remind with sound again' },
      O.focus,
      { name: 'no-focus', help: "Take it out of Focus's sprint" },
      O.parent,
      { name: 'outdent', help: 'Make a subtask a task again' },
      ...POSITION,
      O.literal,
    ],
    examples: [
      'flint task edit k3f9a2 --priority none --remind "mon 10:00"',
      'flint task edit "Fix login loop" --in Backend --title "Fix the login loop" --literal',
      'flint task edit k3f9a2 --body - < notes.md',
    ],
    seeAlso: ['flint task done --help', 'flint task move --help'],
    tool: 'update',
    build: taskEdit,
  },
  {
    words: ['task', 'done'],
    usage: 'task done <task>... [--in <list>]',
    summary: 'Complete tasks',
    options: [O.in],
    examples: [
      'flint task done k3f9a2',
      'flint task done "Call Alex" --in Inbox',
      'flint task done k3f9a2 p7d1x0',
    ],
    seeAlso: ['flint task undone --help'],
    tool: 'update',
    build: eachTask({ done: true }),
  },
  {
    words: ['task', 'undone'],
    usage: 'task undone <task>... [--in <list>]',
    summary: 'Open completed tasks again',
    options: [O.in],
    examples: ['flint task undone k3f9a2', 'flint task undone "Call Alex" --in Inbox'],
    seeAlso: ['flint task done --help'],
    tool: 'update',
    build: eachTask({ done: false }),
  },
  {
    words: ['task', 'pin'],
    usage: 'task pin <task>... [--in <list>]',
    summary: 'Pin tasks to Today',
    options: [O.in],
    examples: ['flint task pin k3f9a2', 'flint task pin "Review PR" --in Backend'],
    seeAlso: ['flint task unpin --help', 'flint read Today'],
    tool: 'update',
    build: eachTask({ pinned: true }),
  },
  {
    words: ['task', 'unpin'],
    usage: 'task unpin <task>... [--in <list>]',
    summary: 'Unpin tasks from Today',
    options: [O.in],
    examples: ['flint task unpin k3f9a2', 'flint task unpin k3f9a2 p7d1x0'],
    seeAlso: ['flint task pin --help'],
    tool: 'update',
    build: eachTask({ pinned: false }),
  },
  {
    words: ['task', 'move'],
    usage: 'task move <task>... [--to <list>] [position]',
    summary: 'Move tasks to another list, reorder them, or make them subtasks',
    options: [
      O.in,
      { name: 'to', value: '<list>', help: 'To the top of this list' },
      O.parent,
      { name: 'outdent', help: 'Make a subtask a task again' },
      ...POSITION,
    ],
    examples: [
      'flint task move k3f9a2 --to Backend',
      'flint task move k3f9a2 --after p7d1x0',
      'flint task move k3f9a2 --parent p7d1x0',
    ],
    seeAlso: ['flint task edit --help'],
    tool: 'update',
    build: taskMove,
  },
  {
    words: ['task', 'snooze'],
    usage: 'task snooze <task> <time> [--in <list>]',
    summary: "Move a task's reminder to a new time",
    options: [O.in],
    examples: [
      'flint task snooze k3f9a2 "tomorrow 9:00"',
      'flint task snooze k3f9a2 "in 2h"',
      'flint task snooze k3f9a2 2026-11-16T10:00',
    ],
    seeAlso: ['flint task edit --help'],
    tool: 'update',
    build: (input) => {
      const [ref = '', remind = ''] = exactly(input, ['task', 'time']);
      return updates([defined({ ref, in: str(input, 'in'), remind })]);
    },
  },
  {
    words: ['task', 'delete'],
    usage: 'task delete <task>... [--in <list>]',
    summary: 'Move tasks to Trash',
    options: [O.in],
    examples: ['flint task delete k3f9a2', 'flint task delete "Old idea" --in Inbox'],
    seeAlso: ['flint task done --help'],
    tool: 'delete',
    build: (input) => deletes(input, 'task', 'task'),
  },
  {
    words: ['list', 'add'],
    usage: 'list add <name> [--group <group>]',
    summary: 'Create a task list',
    options: [O.group],
    examples: ['flint list add Backend', 'flint list add "Sprint 12" --group Work'],
    seeAlso: ['flint note add --help', 'flint group add --help'],
    tool: 'create',
    build: (input) => ({
      items: [
        defined({
          kind: 'list' as const,
          name: joined(input, 'list name'),
          group: str(input, 'group'),
        }),
      ],
    }),
  },
  {
    words: ['list', 'rename'],
    usage: 'list rename <list> <new name>',
    summary: 'Rename a list',
    options: [],
    examples: ['flint list rename Backend "Backend API"', 'flint list rename l8c2m4 "Sprint 13"'],
    seeAlso: ['flint list move --help'],
    tool: 'update',
    build: (input) => {
      const [ref = '', name = ''] = exactly(input, ['list', 'new name']);
      return updates([{ kind: 'list', ref, name }]);
    },
  },
  {
    words: ['list', 'move'],
    usage: 'list move <list> [--group <group> | --no-group] [position]',
    summary: 'Move a list into or out of a group, or within the sidebar',
    options: [O.group, { name: 'no-group', help: 'Out of its group' }, ...POSITION],
    examples: [
      'flint list move Backend --group Work',
      'flint list move Backend --top',
      'flint list move Backend --no-group',
    ],
    seeAlso: ['flint group add-list --help'],
    tool: 'update',
    build: sidebarMove('list'),
  },
  {
    words: ['list', 'duplicate'],
    usage: 'list duplicate <list>...',
    summary: 'Copy lists ("<name> copy", right below)',
    options: [],
    examples: ['flint list duplicate "Packing list"'],
    seeAlso: ['flint list add --help'],
    tool: 'update',
    build: eachList('list', { duplicate: true }),
  },
  {
    words: ['list', 'convert'],
    usage: 'list convert <list> --to tasks|note',
    summary: 'Turn a task list into a note, or a note into a task list',
    options: [{ name: 'to', value: '<mode>', help: 'tasks or note' }],
    examples: [
      'flint list convert Ideas --to note',
      'flint list convert "Meeting notes" --to tasks',
    ],
    seeAlso: ['flint list add --help'],
    tool: 'update',
    build: (input) => {
      const [ref = ''] = exactly(input, ['list']);
      const to = str(input, 'to');
      if (to === undefined) throw usageError('Say what it becomes: --to tasks or --to note.');
      return updates([{ kind: 'list', ref, mode: oneOf(to, ['tasks', 'note'], 'to') }]);
    },
  },
  {
    words: ['list', 'archive-done'],
    usage: 'list archive-done <list>...',
    summary: "Move lists' done tasks to their Archived tab",
    options: [],
    examples: ['flint list archive-done Backend', 'flint read Backend --archived'],
    seeAlso: ['flint read --help'],
    tool: 'update',
    build: eachList('list', { archiveDone: true }),
  },
  {
    words: ['list', 'delete'],
    usage: 'list delete <list>...',
    summary: 'Move lists to Trash',
    options: [],
    examples: ['flint list delete "Old project"'],
    seeAlso: ['flint note delete --help'],
    tool: 'delete',
    build: (input) => deletes(input, 'list', 'list'),
  },
  {
    words: ['note', 'add'],
    usage: 'note add <name> [--group <group>] [--text <text>]  |  note add --quick [<text>]',
    summary: 'Create a note, or an untitled quick note',
    options: [
      O.group,
      O.text,
      { name: 'quick', help: 'A quick note: no name, the words are its text' },
    ],
    examples: [
      'flint note add "Meeting notes" --group Work --text - < notes.md',
      'flint note add --quick "Ask Alex about the release"',
    ],
    seeAlso: ['flint note append --help', 'flint note keep --help'],
    tool: 'create',
    build: noteAdd,
  },
  {
    words: ['note', 'append'],
    usage: 'note append <note> [<text>] [--text <text>]',
    summary: 'Add text at the end of a note (better than resending it)',
    options: [O.text],
    examples: [
      'flint note append "Meeting notes" "- Decided: ship on Monday"',
      'git log -5 --oneline | flint note append Changelog --text -',
    ],
    seeAlso: ['flint note replace --help', 'flint read --help'],
    tool: 'update',
    build: noteAppend,
  },
  {
    words: ['note', 'replace'],
    usage:
      'note replace <note> --find <passage> --with <text>  |  note replace <note> --text <text>',
    summary: 'Replace an exact passage (it must occur once), or the whole text',
    options: [
      { name: 'find', value: '<passage>', help: 'The exact passage now in the note' },
      { name: 'with', value: '<text>', help: 'What replaces it' },
      { ...O.text, help: 'The whole new text; - reads stdin' },
    ],
    examples: [
      'flint note replace "Meeting notes" --find "Monday" --with "Tuesday"',
      'flint note replace Changelog --text - < changelog.md',
    ],
    seeAlso: ['flint note append --help'],
    tool: 'update',
    build: noteReplace,
  },
  {
    words: ['note', 'keep'],
    usage: 'note keep <quick note> <name>',
    summary: 'Keep a quick note as a note with this name',
    options: [],
    examples: ['flint note keep q4h8s1 "Release plan"'],
    seeAlso: ['flint note add --help'],
    tool: 'update',
    build: (input) => {
      const [ref = '', name = ''] = exactly(input, ['quick note', 'name']);
      return updates([{ kind: 'note', ref, keep: { name } }]);
    },
  },
  {
    words: ['note', 'delete'],
    usage: 'note delete <note>...',
    summary: 'Move notes to Trash',
    options: [],
    examples: ['flint note delete "Old draft"'],
    seeAlso: ['flint list delete --help'],
    tool: 'delete',
    build: (input) => deletes(input, 'note', 'note'),
  },
  {
    words: ['group', 'add'],
    usage: 'group add <name> [--list <list>]...',
    summary: 'Create a group, optionally with lists in it',
    options: [{ ...O.list, repeat: true, help: 'A list or note to put in it (repeat for more)' }],
    examples: [
      'flint group add Work',
      'flint group add Work --list Backend --list "Meeting notes"',
    ],
    seeAlso: ['flint group add-list --help'],
    tool: 'create',
    build: (input) => {
      const lists = many(input, 'list');
      return {
        items: [
          defined({
            kind: 'group' as const,
            name: joined(input, 'group name'),
            lists: lists.length > 0 ? lists : undefined,
          }),
        ],
      };
    },
  },
  {
    words: ['group', 'rename'],
    usage: 'group rename <group> <new name>',
    summary: 'Rename a group',
    options: [],
    examples: ['flint group rename Work "Day job"'],
    seeAlso: ['flint group move --help'],
    tool: 'update',
    build: (input) => {
      const [ref = '', name = ''] = exactly(input, ['group', 'new name']);
      return updates([{ kind: 'group', ref, name }]);
    },
  },
  {
    words: ['group', 'add-list'],
    usage: 'group add-list <group> <list>...',
    summary: 'Put lists or notes into a group',
    options: [],
    examples: ['flint group add-list Work Backend "Meeting notes"'],
    seeAlso: ['flint group remove-list --help', 'flint list move --help'],
    tool: 'update',
    build: (input) => {
      const [ref, ...lists] = input.positionals;
      if (ref === undefined || lists.length === 0) throw usageError('Expected <group> <list>...');
      return updates([{ kind: 'group', ref, addLists: lists }]);
    },
  },
  {
    words: ['group', 'remove-list'],
    usage: 'group remove-list <group> <list>...',
    summary: 'Take lists or notes out of a group',
    options: [],
    examples: ['flint group remove-list Work Backend'],
    seeAlso: ['flint group add-list --help'],
    tool: 'update',
    build: (input) => {
      const [ref, ...lists] = input.positionals;
      if (ref === undefined || lists.length === 0) throw usageError('Expected <group> <list>...');
      return updates([{ kind: 'group', ref, removeLists: lists }]);
    },
  },
  {
    words: ['group', 'move'],
    usage: 'group move <group> --top|--bottom|--after <ref>|--before <ref>',
    summary: 'Move a group in the sidebar',
    options: [...POSITION],
    examples: ['flint group move Work --top', 'flint group move Work --after Personal'],
    seeAlso: ['flint list move --help'],
    tool: 'update',
    build: sidebarMove('group'),
  },
  {
    words: ['group', 'delete'],
    usage: 'group delete <group>...',
    summary: 'Move groups to Trash (their lists stay)',
    options: [],
    examples: ['flint group delete Archive'],
    seeAlso: ['flint list delete --help'],
    tool: 'delete',
    build: (input) => deletes(input, 'group', 'group'),
  },
  {
    words: ['attach'],
    usage: 'attach <file> --to <task|note> [--note] [--in <list>]',
    summary: "Attach a file to a task's body (or a note with --note)",
    details: [
      'Up to 25 MB is copied into the Flint folder, a bigger file is linked; programs and scripts',
      'are refused.',
    ],
    options: [
      { name: 'to', value: '<ref>', help: 'The task (or note) to attach it to' },
      { name: 'note', help: '--to is a note' },
      O.in,
    ],
    examples: [
      'flint attach screenshot.png --to k3f9a2',
      'flint attach C:\\Specs\\api.pdf --to "Meeting notes" --note',
    ],
    seeAlso: ['flint task edit --help'],
    tool: 'update',
    build: (input) => {
      const [file = ''] = exactly(input, ['file']);
      const ref = str(input, 'to');
      if (ref === undefined) throw usageError('Say where: --to <task> (or --to <note> --note).');
      const path = isAbsolute(file) ? file : resolve(input.cwd, file);
      if (has(input, 'note')) {
        if (str(input, 'in') !== undefined)
          throw usageError('--in narrows a task title; a note has none.');
        return updates([{ kind: 'note', ref, attach: { path } }]);
      }
      return updates([defined({ ref, in: str(input, 'in'), attach: { path } })]);
    },
  },
  {
    words: ['links', 'list'],
    usage: 'links list',
    summary: 'Show the link patterns (Settings → Links)',
    options: [],
    examples: ['flint links list', 'flint links list --json'],
    seeAlso: ['flint links add --help'],
    tool: 'linkPatterns',
    build: (input): LinkPatternsArgs => {
      exactly(input, []);
      return { action: 'list' };
    },
  },
  {
    words: ['links', 'add'],
    usage: 'links add <short> <url> [--kind <name>=digits|word]...',
    summary: 'Add a link pattern',
    options: [
      {
        name: 'kind',
        value: '<name=digits|word>',
        repeat: true,
        help: 'What a placeholder matches',
      },
    ],
    examples: [
      'flint links add "ACME-{id}" "https://tracker.example/browse/ACME-{id}"',
      'flint links add "PR {n}" "https://git.example/acme/pull/{n}" --kind n=digits',
    ],
    seeAlso: ['flint links edit --help'],
    tool: 'linkPatterns',
    build: (input): LinkPatternsArgs => {
      const [short = '', url = ''] = exactly(input, ['short', 'url']);
      return defined({ action: 'add' as const, short, url, kinds: kinds(input) });
    },
  },
  {
    words: ['links', 'edit'],
    usage:
      'links edit <index|short> [--short <short>] [--url <url>] [--kind <name>=digits|word]...',
    summary: 'Change a link pattern',
    options: [
      { name: 'short', value: '<short>', help: 'A new short form' },
      { name: 'url', value: '<url>', help: 'A new URL' },
      {
        name: 'kind',
        value: '<name=digits|word>',
        repeat: true,
        help: 'What a placeholder matches',
      },
    ],
    examples: [
      'flint links edit 0 --url "https://tracker.example/b/ACME-{id}"',
      'flint links edit "ACME-{id}" --short "AC-{id}"',
    ],
    seeAlso: ['flint links list'],
    tool: 'linkPatterns',
    build: (input): LinkPatternsArgs => {
      const [ref = ''] = exactly(input, ['index or short']);
      const fields = defined({
        short: str(input, 'short'),
        url: str(input, 'url'),
        kinds: kinds(input),
      });
      if (Object.keys(fields).length === 0)
        throw usageError('Nothing to change: give --short, --url or --kind.');
      return { action: 'edit', ref: patternRef(ref), ...fields };
    },
  },
  {
    words: ['links', 'delete'],
    usage: 'links delete <index|short>',
    summary: 'Delete a link pattern',
    options: [],
    examples: ['flint links delete 2', 'flint links delete "ACME-{id}"'],
    seeAlso: ['flint links list'],
    tool: 'linkPatterns',
    build: (input): LinkPatternsArgs => {
      const [ref = ''] = exactly(input, ['index or short']);
      return { action: 'delete', ref: patternRef(ref) };
    },
  },
  {
    words: ['status'],
    usage: 'status',
    summary: "Flint's version, read-only and paused, the limits and what's used this hour",
    options: [],
    examples: ['flint status', 'flint status --json'],
    seeAlso: ['flint help agents'],
    tool: 'status',
    build: (input) => {
      exactly(input, []);
      return {};
    },
  },
];

/** The command for these words, or undefined. */
export const findCommand = (words: readonly string[]): Command | undefined =>
  COMMANDS.find(
    (command) =>
      command.words.length === words.length &&
      command.words.every((word, index) => word === words[index]),
  );

/** The verbs of a noun (`task` → add, edit…). */
export const verbsOf = (noun: string): readonly Command[] =>
  COMMANDS.filter((command) => command.words.length === 2 && command.words[0] === noun);

/**
 * A command's options: every command but `status` also takes `--json-input -`, and every create and
 * update takes `--literal` (it turns the default shorthand off for `--json-input` too).
 */
export function optionsOf(command: Command): readonly OptionSpec[] {
  if (command.tool === 'status') return command.options;
  const literal =
    (command.tool === 'create' || command.tool === 'update') &&
    !command.options.some((option) => option.name === 'literal');
  return [...command.options, ...(literal ? [O.literal] : []), O.jsonInput];
}

/**
 * `--json-input -`: the tool's own JSON shape. A bare array is a batch's `items`. The CLI reads
 * shorthand by default, so a create or update without `parseShorthand` gets it unless --literal.
 */
export function fromJsonInput(command: Command, value: unknown, literal: boolean): unknown {
  const args = Array.isArray(value) ? { items: value } : value;
  if (typeof args !== 'object' || args === null)
    throw usageError('--json-input takes a JSON object (or an array of items).');
  if ((command.tool === 'create' || command.tool === 'update') && !('parseShorthand' in args))
    return { ...args, parseShorthand: !literal };
  return args;
}

/** Options that may read standard input with `-`. */
export const STDIN_OPTIONS: readonly string[] = ['body', 'text'];
