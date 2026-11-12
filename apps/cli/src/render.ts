/**
 * AGENT-02 (D-185 Q11): what `flint` prints by default. Writes print Flint's own sentences
 * (`WriteResult.text`); find, read and status get a compact rendering made for reading in a
 * terminal, with every ID shown so the next command can act by it. `--json` prints the objects
 * as they are (cli.ts); nothing here decides anything.
 */
import type {
  AgentTool,
  ArchivedOut,
  Candidate,
  FindHit,
  FindResult,
  GroupOut,
  ListEntry,
  ListOut,
  NoteOut,
  NowInfo,
  Overview,
  ReadOut,
  ReadResult,
  ReminderInfo,
  StatusResult,
  TaskOut,
} from '@flint/core/agents';
import type { ErrorBody } from './errors.js';

/** Colours, or none (not a terminal, `--json`, `NO_COLOR`). */
export interface Style {
  readonly dim: (text: string) => string;
  readonly bold: (text: string) => string;
  readonly red: (text: string) => string;
  readonly green: (text: string) => string;
  readonly yellow: (text: string) => string;
}

const same = (text: string): string => text;
export const PLAIN: Style = { dim: same, bold: same, red: same, green: same, yellow: same };

const ansi =
  (open: number, close: number) =>
  (text: string): string =>
    `\u001b[${open}m${text}\u001b[${close}m`;
export const COLOURS: Style = {
  dim: ansi(2, 22),
  bold: ansi(1, 22),
  red: ansi(31, 39),
  green: ansi(32, 39),
  yellow: ansi(33, 39),
};

const SEP = ' · ';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textLines = (value: unknown): string[] | null =>
  isRecord(value) &&
  Array.isArray(value['text']) &&
  value['text'].every((line) => typeof line === 'string')
    ? value['text']
    : null;

function reminder(info: ReminderInfo | undefined, style: Style): string[] {
  if (!info) return [];
  const text = `${info.text}${info.muted ? ' (muted)' : ''}`;
  return [info.overdue ? style.red(`${text} (overdue)`) : text];
}

/** `[ ] title · id · list · !high · pinned · Sat 14 Nov, 09:00`. */
function taskLine(
  task: {
    readonly name: string;
    readonly id: string;
    readonly done?: boolean | undefined;
    readonly list?: string | undefined;
    readonly priority?: string | undefined;
    readonly pinned?: boolean | undefined;
    readonly focus?: boolean | undefined;
    readonly reminder?: ReminderInfo | undefined;
  },
  style: Style,
): string {
  const parts = [
    `${task.done ? style.green('[x]') : '[ ]'} ${task.name}`,
    style.dim(task.id),
    ...(task.list ? [task.list] : []),
    ...(task.priority ? [task.priority === 'high' ? style.red('!high') : `!${task.priority}`] : []),
    ...(task.pinned ? ['pinned'] : []),
    ...(task.focus ? ['Focus'] : []),
    ...reminder(task.reminder, style),
  ];
  return parts.join(SEP);
}

const KIND_LABEL: Record<string, string> = {
  list: 'List',
  note: 'Note',
  group: 'Group',
  task: 'Task',
};

function hitLine(hit: FindHit, style: Style): string[] {
  const head =
    hit.kind === 'task'
      ? taskLine({ ...hit, list: hit.list?.name }, style)
      : [
          `${style.bold(KIND_LABEL[hit.kind] ?? hit.kind)} ${hit.name}`,
          style.dim(hit.id),
          ...(hit.group ? [hit.group.name] : []),
          ...(hit.list && hit.kind !== 'list' ? [hit.list.name] : []),
          ...(hit.open !== undefined ? [`${hit.open} open`] : []),
        ].join(SEP);
  return hit.match ? [head, style.dim(`    ${hit.match.line}: ${hit.match.snippet}`)] : [head];
}

const nowLine = (now: NowInfo | undefined, style: Style): string[] =>
  now ? [style.dim(`Now: ${now.text} (${now.timeZone}, ${now.offset})`)] : [];

function renderOverview(overview: Overview, now: NowInfo | undefined, style: Style): string[] {
  const lines = [...nowLine(now, style)];
  const section = (title: string, body: string[], empty: string): void => {
    if (lines.length > 0) lines.push('');
    lines.push(style.bold(title), ...(body.length > 0 ? body : [style.dim(`  ${empty}`)]));
  };
  section(
    'Lists and notes',
    overview.lists.map((list) =>
      [
        `  ${list.name}`,
        style.dim(list.id),
        ...(list.kind === 'note' ? [list.quick ? 'quick note' : 'note'] : []),
        ...(list.group ? [list.group] : []),
        ...(list.open !== undefined ? [`${list.open} open`] : []),
      ].join(SEP),
    ),
    'None.',
  );
  section(
    'Groups',
    overview.groups.map((group) =>
      [
        `  ${group.name}`,
        style.dim(group.id),
        `${group.lists.length} ${group.lists.length === 1 ? 'list' : 'lists'}`,
      ].join(SEP),
    ),
    'None.',
  );
  section(
    'Today',
    overview.today.flatMap((hit) => hitLine(hit, style).map((line) => `  ${line}`)),
    'Nothing pinned.',
  );
  section(
    'Reminders',
    overview.reminders.flatMap((hit) => hitLine(hit, style).map((line) => `  ${line}`)),
    'None to come.',
  );
  return lines;
}

function renderFind(result: FindResult, now: NowInfo | undefined, style: Style): string[] {
  if ('overview' in result) return renderOverview(result.overview, now, style);
  if (result.hits.length === 0) return ['Nothing found.'];
  const lines = result.hits.flatMap((hit) => hitLine(hit, style));
  if (result.more)
    lines.push(style.dim('More results: narrow the search or raise --limit (at most 100).'));
  return lines;
}

function renderTask(task: TaskOut, style: Style, indent = ''): string[] {
  const lines = [
    indent +
      taskLine({ ...task, name: task.title, list: indent ? undefined : task.list.name }, style),
  ];
  if (task.body !== undefined && task.body !== '') {
    for (const line of task.body.split('\n')) lines.push(`${indent}    ${line}`);
    if (task.bodyTruncated)
      lines.push(
        style.dim(
          `${indent}    … ${task.bodyLines ?? '?'} lines in all: read on with --lines from:to`,
        ),
      );
  }
  for (const subtask of task.subtasks ?? [])
    lines.push(...renderTask(subtask, style, `${indent}  `));
  return lines;
}

function bookkeeping(
  item: { readonly createdBy?: string; readonly touchedBy?: string; readonly created?: string },
  style: Style,
): string[] {
  const parts = [
    ...(item.created ? [`created ${item.created}`] : []),
    ...(item.createdBy ? [`by ${item.createdBy}`] : []),
    ...(item.touchedBy ? [`changed by ${item.touchedBy}`] : []),
  ];
  return parts.length > 0 ? [style.dim(`  ${parts.join(', ')}`)] : [];
}

function renderEntry(entry: ListEntry, style: Style): string[] {
  if (entry.kind === 'heading') return [style.bold(entry.text)];
  if (entry.kind === 'text') return [entry.text];
  return renderTask(entry, style);
}

function renderList(list: ListOut, style: Style): string[] {
  const head = [
    `${style.bold('List')} ${list.name}`,
    style.dim(list.id),
    ...(list.group ? [list.group.name] : []),
    `${list.open} open, ${list.done} done`,
  ].join(SEP);
  const lines = [head, ...list.entries.flatMap((entry) => renderEntry(entry, style))];
  if (list.entries.length === 0) lines.push(style.dim('  No tasks.'));
  if (list.more)
    lines.push(
      style.dim(
        `More tasks (${list.total} in all): read on with --offset ${list.offset + list.entries.filter((entry) => entry.kind === 'task').length}`,
      ),
    );
  return lines;
}

function renderNote(note: NoteOut, style: Style): string[] {
  const range =
    note.from !== undefined && note.to !== undefined
      ? `lines ${note.from}–${note.to} of ${note.totalLines}`
      : `${note.totalLines} lines`;
  const head = [
    `${style.bold(note.quick ? 'Quick note' : 'Note')} ${note.name}`,
    style.dim(note.id),
    ...(note.group ? [note.group.name] : []),
    range,
  ].join(SEP);
  const lines = [head];
  if (note.outline) {
    for (const heading of note.outline)
      lines.push(
        `${style.dim(String(heading.line).padStart(6))}  ${'#'.repeat(heading.level)} ${heading.text}`,
      );
  }
  if (note.text !== undefined) lines.push(...note.text.split('\n'));
  if (note.truncated)
    lines.push(style.dim(note.hint ?? 'Truncated: read on with --lines from:to.'));
  lines.push(...bookkeeping(note, style));
  return lines;
}

function renderGroup(group: GroupOut, style: Style): string[] {
  return [
    [`${style.bold('Group')} ${group.name}`, style.dim(group.id)].join(SEP),
    ...group.lists.map((list) =>
      [`  ${list.name}`, style.dim(list.id), ...(list.kind === 'note' ? ['note'] : [])].join(SEP),
    ),
  ];
}

function renderArchived(archived: ArchivedOut, style: Style): string[] {
  return [
    [`${style.bold('Archived')} ${archived.list.name}`, style.dim(archived.list.id)].join(SEP),
    ...archived.tasks.map((task) =>
      [`${style.green('[x]')} ${task.title}`, style.dim(task.id), task.completed].join(SEP),
    ),
    ...(archived.tasks.length === 0 ? [style.dim('  Nothing archived.')] : []),
  ];
}

function renderReadOut(item: ReadOut, style: Style): string[] {
  switch (item.kind) {
    case 'task':
      return [...renderTask(item, style), ...bookkeeping(item, style)];
    case 'list':
      return renderList(item, style);
    case 'note':
      return renderNote(item, style);
    case 'group':
      return renderGroup(item, style);
    case 'archived':
      return renderArchived(item, style);
  }
}

function renderRead(result: ReadResult, style: Style): string[] {
  return result.items.flatMap((item, index) => [
    ...(index > 0 ? [''] : []),
    ...renderReadOut(item, style),
  ]);
}

function renderStatus(status: StatusResult, now: NowInfo | undefined, style: Style): string[] {
  const writes = status.readOnly
    ? style.yellow('read-only')
    : status.paused
      ? style.red('paused')
      : 'allowed';
  const limits = status.limits;
  return [
    `Flint ${status.version} (protocol ${status.protocol})${SEP}agent: ${status.agent}`,
    `Writes: ${writes}`,
    `Limits (${limits.preset}): ${limits.itemsPerRequest} items per request, ${limits.taskDeletesPerRequest} task deletes, ` +
      `${limits.listDeletesPerRequest} list deletes, ${limits.changesPerHour} changes an hour (${limits.usedThisHour} used)`,
    ...nowLine(now, style),
  ];
}

/** The default output of a successful request. */
export function renderResult(
  tool: AgentTool,
  result: unknown,
  now: NowInfo | undefined,
  style: Style,
): string[] {
  const lines = textLines(result);
  if (lines) return lines;
  if (!isRecord(result)) return [JSON.stringify(result)];
  switch (tool) {
    case 'find':
      return renderFind(result as unknown as FindResult, now, style);
    case 'read':
      return renderRead(result as unknown as ReadResult, style);
    case 'status':
      return renderStatus(result as unknown as StatusResult, now, style);
    default:
      return [JSON.stringify(result)];
  }
}

function candidateLine(candidate: Candidate, style: Style): string {
  return [
    `  ${style.dim(candidate.id)}  ${candidate.name}`,
    ...(candidate.kind !== 'task' ? [candidate.kind] : []),
    ...(candidate.list ? [candidate.list] : []),
    ...(candidate.group ? [candidate.group] : []),
    ...(candidate.done ? ['done'] : []),
  ].join(SEP);
}

function choices(
  body: { readonly candidates?: readonly Candidate[]; readonly suggestions?: readonly Candidate[] },
  style: Style,
  indent: string,
): string[] {
  const lines: string[] = [];
  if (body.candidates?.length)
    lines.push(
      `${indent}Matches (use an ID):`,
      ...body.candidates.map((c) => indent + candidateLine(c, style)),
    );
  if (body.suggestions?.length)
    lines.push(
      `${indent}Did you mean:`,
      ...body.suggestions.map((c) => indent + candidateLine(c, style)),
    );
  return lines;
}

/** An error for stderr: the message, then candidates, suggestions and a batch's problems. */
export function renderError(body: ErrorBody, style: Style): string[] {
  const lines = [`${style.red('flint:')} ${body.message}`, ...choices(body, style, '')];
  for (const problem of body.problems ?? []) {
    lines.push(
      `  Item ${problem.index + 1}: ${problem.message}`,
      ...choices(problem, style, '    '),
    );
  }
  return lines;
}
