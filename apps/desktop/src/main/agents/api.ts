import {
  appendText,
  asCandidate,
  FIXED_LIMITS,
  findInText,
  outline,
  parseAgentTime,
  replaceOnce,
  resolveRef,
  sameName,
  sliceText,
  suggest,
  textLines,
  timeText,
  timeValue,
  type AgentError,
  type AgentErrorCode,
  type ArchivedOut,
  type Candidate,
  type Changed,
  type CreateItem,
  type DeleteArgs,
  type FindArgs,
  type FindHit,
  type FindResult,
  type GroupOut,
  type ItemKind,
  type ItemProblem,
  type LimitsInfo,
  type LineRange,
  type LinkPatternOut,
  type LinkPatternsArgs,
  type LinkPatternsResult,
  type ListEntry,
  type ListOut,
  type NoteOut,
  type Overview,
  type Priority,
  type ReadItem,
  type ReadOut,
  type ReadResult,
  type ReminderInfo,
  type Resolvable,
  type SidebarPosition,
  type TaskOut,
  type TaskPosition,
  type UpdateItem,
  type WriteResult,
} from '@flint/core/agents';
import { escapeInert, parseCapture } from '@flint/core/shorthand';
import {
  compareLocalDateTime,
  parseLocalDateTime,
  parseTime,
  type LocalDateTime,
} from '@flint/core/time';
import type { ListChange, TaskRow } from '../../shared/ipc.js';
import {
  compileLinkPatterns,
  fixedPartProblem,
  type LinkPattern,
} from '../../shared/link-patterns.js';
import { attachFile, fileKind } from '../attachments.js';
import type { AgentStep, Workspace } from '../capture/workspace.js';
import { INBOX_ID } from '../storage/flint-folder.js';
import type { HiddenFile } from './hidden.js';
import type { Limits } from '@flint/core/agents';

/**
 * AGENT-01 (D-185): the agent API's tools over the workspace. Everything goes through the
 * workspace's own operations; Hidden from agents (AGENT-06) is applied once, in `visible()`, so a
 * hidden list, note or group (and its tasks) doesn't exist for any tool. A write checks every item
 * first and changes nothing when one has a problem (Q6); then it runs as one agent run.
 */

export class AgentFailure extends Error {
  readonly error: AgentError;
  constructor(error: AgentError) {
    super(error.message);
    this.error = error;
  }
}

const fail = (
  code: AgentErrorCode,
  message: string,
  extra: Omit<AgentError, 'code' | 'message'> = {},
): AgentFailure => new AgentFailure({ code, message, ...extra });

export interface LinkPatternStore {
  get(): readonly LinkPattern[];
  save(next: readonly LinkPattern[]): Promise<void>;
}

export interface AgentApiDeps {
  readonly workspace: () => Workspace;
  readonly hidden: () => HiddenFile;
  readonly now: () => Date;
  readonly limits: () => Limits;
  readonly linkPatterns: LinkPatternStore;
}

/** What a write did, for the change log (AGENT-07) and the windows' flash. */
export interface WriteOutcome {
  readonly result: WriteResult;
  readonly label: string;
  readonly steps: readonly AgentStep[];
  readonly keys: readonly string[];
  readonly lists: readonly string[];
  /** Items changed, for the hourly budget (a deleted list counts its tasks). */
  readonly count: number;
  /** Archiving done tasks isn't undone from Recent agent changes (Proposed, D-185). */
  readonly undoable: boolean;
  readonly linkPatterns?: {
    readonly before: readonly LinkPattern[];
    readonly after: readonly LinkPattern[];
  };
  /** A failure part-way (after the checks): what was done is still recorded. */
  readonly error?: unknown;
}

// ─── the visible workspace ───────────────────────────────────────────────────────────────────────

interface VList extends Resolvable {
  readonly kind: 'list' | 'note';
  readonly groupRef?: { readonly id: string; readonly name: string };
  readonly quick: boolean;
  readonly inbox: boolean;
  readonly open: number;
}

interface VGroup extends Resolvable {
  readonly kind: 'group';
  readonly lists: readonly VList[];
}

interface VTask extends Resolvable {
  readonly kind: 'task';
  readonly listId: string;
  readonly listName: string;
  readonly row: TaskRow;
  readonly parent?: string;
  /** Top-level tasks of its list in order (for positions). */
  readonly topLevel: boolean;
}

type VItem = VList | VGroup | VTask;

class Visible {
  readonly lists: VList[];
  readonly groups: VGroup[];
  private taskCache = new Map<string, VTask[]>();
  private readonly workspace: Workspace;
  private readonly now: Date;

  constructor(workspace: Workspace, hidden: HiddenFile, now: Date) {
    this.workspace = workspace;
    this.now = now;
    const manual = workspace.sidebarManual();
    const groupOf = new Map<string, { id: string; name: string }>();
    for (const item of manual)
      if (item.kind === 'group')
        for (const list of item.lists) groupOf.set(list, { id: item.id, name: item.name });
    const isHidden = (id: string): boolean => {
      const group = groupOf.get(id);
      return hidden.isHidden(id) || (group !== undefined && hidden.isHidden(group.id));
    };
    const summaries = new Map(workspace.summaries(now).map((summary) => [summary.id, summary]));
    const make = (id: string): VList | null => {
      const summary = summaries.get(id);
      if (!summary || isHidden(id)) return null;
      const group = groupOf.get(id);
      return {
        kind: summary.mode === 'note' ? 'note' : 'list',
        id,
        name: summary.inbox ? 'Inbox' : summary.name,
        ...(group && { group: group.name, groupRef: group }),
        quick: summary.quick !== undefined,
        inbox: summary.inbox,
        open: summary.open,
      };
    };
    const ordered: string[] = [INBOX_ID];
    for (const item of manual) {
      if (item.kind === 'group') ordered.push(...item.lists);
      else ordered.push(item.id);
    }
    for (const id of summaries.keys()) if (!ordered.includes(id)) ordered.push(id);
    this.lists = ordered.flatMap((id) => {
      const list = make(id);
      return list ? [list] : [];
    });
    this.groups = manual.flatMap((item): VGroup[] =>
      item.kind === 'group' && !hidden.isHidden(item.id)
        ? [
            {
              kind: 'group',
              id: item.id,
              name: item.name,
              lists: this.lists.filter((list) => list.groupRef?.id === item.id),
            },
          ]
        : [],
    );
  }

  list(id: string): VList | undefined {
    return this.lists.find((list) => list.id === id);
  }

  /** A task list's tasks (open, then done), subtasks after their parent. */
  tasksOf(list: VList): VTask[] {
    if (list.kind !== 'list') return [];
    const cached = this.taskCache.get(list.id);
    if (cached) return cached;
    const view = this.workspace.view(list.id, this.now);
    const tasks: VTask[] = [];
    const add = (row: TaskRow, parent?: string): void => {
      tasks.push({
        kind: 'task',
        id: row.key,
        name: row.title.trim() === '' ? row.label : row.title,
        list: list.name,
        listId: list.id,
        listName: list.name,
        done: row.done,
        row,
        topLevel: parent === undefined,
        ...(parent !== undefined && { parent }),
      });
      for (const sub of row.subtasks) add(sub, row.key);
    };
    for (const item of view?.items ?? []) if (item.kind === 'task') add(item.task);
    for (const row of view?.completed ?? []) add(row);
    this.taskCache.set(list.id, tasks);
    return tasks;
  }

  allTasks(): VTask[] {
    return this.lists.flatMap((list) => this.tasksOf(list));
  }

  task(id: string): VTask | undefined {
    const located = this.workspace.locate(id);
    const list = located ? this.list(located.listId) : undefined;
    return list ? this.tasksOf(list).find((task) => task.id === id) : undefined;
  }
}

// ─── shared helpers ──────────────────────────────────────────────────────────────────────────────

const RESERVED = { today: '@today', reminders: '@reminders' } as const;

function reminderOf(row: TaskRow, now: Date): ReminderInfo | undefined {
  if (!row.reminderAt) return undefined;
  const parsed = parseLocalDateTime(row.reminderAt);
  if (!parsed) return undefined;
  return {
    at: timeValue(parsed.value),
    text: timeText(parsed.value, now),
    muted: row.reminderState === 'muted',
    overdue: row.reminderState === 'overdue',
  };
}

function hitOf(task: VTask, now: Date, match?: FindHit['match']): FindHit {
  const reminder = reminderOf(task.row, now);
  return {
    kind: 'task',
    id: task.id,
    name: task.name,
    list: { id: task.listId, name: task.listName },
    done: task.row.done,
    ...(task.row.priority && { priority: task.row.priority }),
    ...(task.row.pinned && { pinned: true }),
    ...(reminder && { reminder }),
    ...(match && { match }),
  };
}

/** Plain text for a title: shorthand markers escaped, so `@` and `!` stay text (D-45). */
function literal(title: string): string {
  return escapeInert(title, [{ start: 0, end: title.length }]).text;
}

function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function nameMatches(name: string, query: string): boolean {
  const lower = name.toLowerCase();
  return words(query).every((word) => lower.includes(word));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw fail('invalid', `"${field}" must be text.`);
  return value;
}

function checkText(value: string | undefined, field: string, title = false): void {
  if (value === undefined) return;
  if (title && value.length > FIXED_LIMITS.titleChars)
    throw fail('too_large', `"${field}" is longer than ${FIXED_LIMITS.titleChars} characters.`);
  if (Buffer.byteLength(value, 'utf8') > FIXED_LIMITS.textBytes)
    throw fail('too_large', `"${field}" is larger than 1 MB.`);
}

function itemsOf(args: unknown): unknown[] {
  if (!isObject(args) || !Array.isArray(args['items']) || args['items'].length === 0)
    throw fail('invalid', 'Give "items": a list of one or more items.');
  return args['items'];
}

function asPriority(value: unknown): Priority | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === 'none') return null;
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  throw fail('invalid', '"priority" is high, medium, low or none.');
}

/** A filter's time: ISO (past allowed) or a phrase. */
function filterTime(text: string, now: Date): LocalDateTime {
  const iso = parseLocalDateTime(text.trim());
  if (iso) return iso.value;
  const phrase = parseTime(text, { now });
  if (phrase) return phrase;
  throw fail(
    'bad_time',
    `Flint can’t read the time "${text}". Try "2026-11-14T09:00" or "tomorrow 9:00".`,
  );
}

// ─── the API ─────────────────────────────────────────────────────────────────────────────────────

export class AgentApi {
  private readonly deps: AgentApiDeps;
  constructor(deps: AgentApiDeps) {
    this.deps = deps;
  }

  private visible(): Visible {
    const hidden = this.deps.hidden();
    // Security review L4: never guess what's hidden; agents wait until the file reads.
    if (hidden.broken)
      throw fail(
        'internal',
        'Flint can’t read which lists are hidden from agents (.flint/agents.json) yet, so agents wait. Try again in a moment.',
      );
    return new Visible(this.deps.workspace(), hidden, this.deps.now());
  }

  /** Resolves `ref` among the visible items of `kind` (any kind when unset). */
  private resolve(view: Visible, ref: unknown, kind?: ItemKind, inList?: string): VItem {
    if (typeof ref !== 'string' || ref.trim() === '')
      throw fail('invalid', 'Each item needs a "ref": an ID or an exact name.');
    // Security review L1: a huge reference would make suggestions take minutes.
    if (ref.length > FIXED_LIMITS.titleChars)
      throw fail('invalid', `A "ref" is at most ${FIXED_LIMITS.titleChars} characters.`);
    let scope: VList | undefined;
    if (inList !== undefined) {
      const list = this.resolve(view, inList, undefined, undefined);
      if (list.kind !== 'list' && list.kind !== 'note')
        throw fail('invalid', `"in" must be a list or a note, not ${list.kind} "${list.name}".`);
      scope = list;
    }
    const pool: VItem[] = [];
    if (!kind || kind === 'list' || kind === 'note')
      // A list and a note are both "lists" to an agent: `flint list rename` works on a note too.
      pool.push(...view.lists);
    if (!kind || kind === 'group') pool.push(...view.groups);
    if (!kind || kind === 'task') {
      if (scope) pool.push(...view.tasksOf(scope));
      else {
        // A task's ID is found directly; a title needs every task.
        const byId = view.task(ref.trim());
        if (byId) pool.push(byId);
        else if (kind === 'task' || !pool.some((item) => sameName(item.name, ref)))
          pool.push(...view.allTasks());
      }
    }
    const resolved = resolveRef(ref, pool, { preferOpen: true });
    if (resolved.ok) return resolved.item;
    const what = kind ?? 'item';
    if (resolved.code === 'ambiguous')
      throw fail('ambiguous', `More than one ${what} is called "${ref}". Use its ID.`, {
        candidates: resolved.candidates.map(asCandidate),
      });
    throw fail('not_found', `No ${what} "${ref}"${scope ? ` in ${scope.name}` : ''}.`, {
      suggestions: resolved.suggestions.map(asCandidate),
    });
  }

  // ─── status ────────────────────────────────────────────────────────────────────────────────────

  limitsInfo(preset: LimitsInfo['preset'], used: number): LimitsInfo {
    return { preset, ...this.deps.limits(), usedThisHour: used };
  }

  // ─── find ──────────────────────────────────────────────────────────────────────────────────────

  find(raw: unknown): FindResult {
    const args = (isObject(raw) ? raw : {}) as FindArgs;
    const now = this.deps.now();
    const view = this.visible();
    const query = optionalString(args.query, 'query')?.trim() ?? '';
    const filtered =
      args.status !== undefined ||
      args.priority !== undefined ||
      args.pinned !== undefined ||
      args.remindBefore !== undefined ||
      args.remindAfter !== undefined ||
      args.in !== undefined ||
      (args.type !== undefined && args.type !== 'any');
    if (query === '' && !filtered) return { overview: this.overview(view, now) };
    const limit = Math.min(100, Math.max(1, Math.floor(Number(args.limit ?? 30)) || 30));
    const type = args.type ?? 'any';
    const scope =
      args.in !== undefined ? (this.resolve(view, args.in, undefined) as VList) : undefined;
    if (scope && scope.kind !== 'list' && scope.kind !== 'note')
      throw fail('invalid', '"in" must be a list or a note.');
    const taskFilters =
      args.status !== undefined ||
      args.priority !== undefined ||
      args.pinned !== undefined ||
      args.remindBefore !== undefined ||
      args.remindAfter !== undefined;
    const before = args.remindBefore !== undefined ? filterTime(args.remindBefore, now) : null;
    const after = args.remindAfter !== undefined ? filterTime(args.remindAfter, now) : null;
    const status = args.status ?? 'open';
    const named: FindHit[] = [];
    const inside: FindHit[] = [];
    if (!scope && !taskFilters) {
      if (type === 'any' || type === 'list' || type === 'note')
        for (const list of view.lists) {
          if (type !== 'any' && list.kind !== type) continue;
          if (query !== '' && nameMatches(list.name, query))
            named.push({
              kind: list.kind,
              id: list.id,
              name: list.name,
              ...(list.groupRef && { group: list.groupRef }),
              ...(list.kind === 'list' && { open: list.open }),
            });
          else if (query !== '' && list.kind === 'note') {
            const text = this.deps.workspace().view(list.id, now)?.noteText ?? '';
            const match = findInText(text, query);
            if (match) inside.push({ kind: 'note', id: list.id, name: list.name, match });
          }
        }
      if (type === 'any' || type === 'group')
        for (const group of view.groups)
          if (query !== '' && nameMatches(group.name, query))
            named.push({ kind: 'group', id: group.id, name: group.name });
    }
    if (type === 'any' || type === 'task') {
      const tasks = scope ? view.tasksOf(scope) : view.allTasks();
      for (const task of tasks) {
        const row = task.row;
        if (status === 'open' && row.done) continue;
        if (status === 'done' && !row.done) continue;
        if (args.priority !== undefined && row.priority !== args.priority) continue;
        if (args.pinned !== undefined && Boolean(row.pinned) !== args.pinned) continue;
        if (before || after) {
          const at = row.reminderAt ? parseLocalDateTime(row.reminderAt)?.value : undefined;
          if (!at) continue;
          if (before && compareLocalDateTime(at, before) >= 0) continue;
          if (after && compareLocalDateTime(at, after) <= 0) continue;
        }
        if (query === '' || nameMatches(task.name, query)) named.push(hitOf(task, now));
        else {
          const match = findInText(row.body, query);
          if (match) inside.push(hitOf(task, now, match));
        }
      }
    }
    const hits = [...named, ...inside];
    return { hits: hits.slice(0, limit), more: hits.length > limit };
  }

  private overview(view: Visible, now: Date): Overview {
    const tasks = view.allTasks();
    const reminders = tasks
      .filter((task) => !task.row.done && task.row.reminderAt && task.row.reminderState !== 'muted')
      .sort((a, b) => (a.row.reminderAt ?? '').localeCompare(b.row.reminderAt ?? ''))
      .slice(0, 20);
    return {
      lists: view.lists.map((list) => ({
        kind: list.kind,
        id: list.id,
        name: list.name,
        ...(list.groupRef && { group: list.groupRef.name }),
        ...(list.kind === 'list' && { open: list.open }),
        ...(list.quick && { quick: true }),
        ...(list.inbox && { inbox: true }),
      })),
      groups: view.groups.map((group) => ({
        id: group.id,
        name: group.name,
        lists: group.lists.map((list) => list.id),
      })),
      today: tasks
        .filter((task) => task.row.pinned && !task.row.done)
        .map((task) => hitOf(task, now)),
      reminders: reminders.map((task) => hitOf(task, now)),
    };
  }

  // ─── read ──────────────────────────────────────────────────────────────────────────────────────

  async read(raw: unknown): Promise<ReadResult> {
    const items = itemsOf(raw) as ReadItem[];
    if (items.length > FIXED_LIMITS.readItems)
      throw fail('too_large', `Read at most ${FIXED_LIMITS.readItems} items at once.`);
    const view = this.visible();
    const now = this.deps.now();
    const out: ReadOut[] = [];
    for (const item of items) {
      if (!isObject(item)) throw fail('invalid', 'Each item is an object with a "ref".');
      out.push(await this.readOne(view, item, now));
    }
    return { items: out };
  }

  private async readOne(view: Visible, item: ReadItem, now: Date): Promise<ReadOut> {
    const special = typeof item.ref === 'string' ? item.ref.trim().toLowerCase() : '';
    if (!item.kind || item.kind === 'list') {
      if (special === 'today' || special === RESERVED.today) {
        const tasks = view.allTasks().filter((task) => task.row.pinned && !task.row.done);
        return this.page(RESERVED.today, 'Today', tasks, item, now);
      }
      if (special === 'reminders' || special === RESERVED.reminders) {
        const tasks = view
          .allTasks()
          .filter((task) => !task.row.done && task.row.reminderAt)
          .sort((a, b) => (a.row.reminderAt ?? '').localeCompare(b.row.reminderAt ?? ''));
        return this.page(RESERVED.reminders, 'Reminders', tasks, { ...item, status: 'all' }, now);
      }
    }
    const found = this.resolve(view, item.ref, item.kind, item.in);
    if (item.archived) {
      if (found.kind !== 'list') throw fail('invalid', 'Only a task list has an Archived tab.');
      const trash = await this.deps.workspace().trashView();
      const archived = trash.archived.find((each) => each.listId === found.id);
      const result: ArchivedOut = {
        kind: 'archived',
        list: { id: found.id, name: found.name },
        tasks: (archived?.tasks ?? []).map((task) => ({
          id: task.key,
          title: task.title,
          completed: task.completed,
        })),
      };
      return result;
    }
    switch (found.kind) {
      case 'task':
        return this.taskOut(view, found, now, { full: true, lines: item.lines });
      case 'group':
        return {
          kind: 'group',
          id: found.id,
          name: found.name,
          lists: found.lists.map((list) => ({ id: list.id, name: list.name, kind: list.kind })),
        } satisfies GroupOut;
      case 'note':
        return this.noteOut(found, item, now);
      case 'list':
        return this.listOut(view, found, item, now);
    }
  }

  private noteOut(note: VList, item: ReadItem, now: Date): NoteOut {
    const workspace = this.deps.workspace();
    const text = workspace.view(note.id, now)?.noteText ?? '';
    const meta = workspace.meta.get(note.id);
    const base = {
      kind: 'note' as const,
      id: note.id,
      name: note.name,
      ...(note.groupRef && { group: note.groupRef }),
      ...(note.quick && { quick: true }),
      ...(meta?.createdBy !== undefined && { createdBy: meta.createdBy }),
      ...(meta?.touchedBy !== undefined && { touchedBy: meta.touchedBy }),
    };
    if (item.outline)
      return {
        ...base,
        outline: outline(text),
        totalLines: textLines(text).length,
        totalChars: text.length,
        truncated: false,
      };
    const slice = sliceText(text, item.lines);
    return {
      ...base,
      text: slice.text,
      from: slice.from,
      to: slice.to,
      totalLines: slice.totalLines,
      totalChars: slice.totalChars,
      truncated: slice.truncated,
      ...(slice.hint !== undefined && { hint: slice.hint }),
    };
  }

  private listOut(view: Visible, list: VList, item: ReadItem, now: Date): ListOut {
    const all = view.tasksOf(list).filter((task) => task.topLevel);
    const shown = this.statusFilter(all, item.status);
    const { offset, limit } = this.paging(item);
    const page = shown.slice(offset, offset + limit);
    const keys = new Set(page.map((task) => task.id));
    // Headings and paragraphs keep their place between the tasks on the page.
    const entries: ListEntry[] = [];
    const listView = this.deps.workspace().view(list.id, now);
    let pending: ListEntry[] = [];
    let started = false;
    for (const entry of listView?.items ?? []) {
      if (entry.kind === 'task') {
        if (keys.has(entry.task.key)) {
          entries.push(...pending);
          const task = all.find((each) => each.id === entry.task.key);
          if (task) entries.push(this.taskOut(view, task, now, { full: false }));
          started = true;
        }
        pending = [];
      } else if (offset === 0 || started) pending.push(entry);
    }
    if (keys.size > 0 && offset + limit >= shown.length) entries.push(...pending);
    for (const task of page)
      if (task.row.done) entries.push(this.taskOut(view, task, now, { full: false }));
    const done = all.filter((task) => task.row.done).length;
    return {
      kind: 'list',
      id: list.id,
      name: list.name,
      ...(list.groupRef && { group: list.groupRef }),
      open: all.length - done,
      done,
      entries,
      total: shown.length,
      offset,
      more: offset + limit < shown.length,
      ...(list.inbox && { inbox: true }),
    };
  }

  /** Today and Reminders, read as a list of tasks. */
  private page(id: string, name: string, tasks: VTask[], item: ReadItem, now: Date): ListOut {
    const view = this.visible();
    const shown = this.statusFilter(tasks, item.status ?? 'all');
    const { offset, limit } = this.paging(item);
    return {
      kind: 'list',
      id,
      name,
      open: tasks.filter((task) => !task.row.done).length,
      done: tasks.filter((task) => task.row.done).length,
      entries: shown
        .slice(offset, offset + limit)
        .map((task) => this.taskOut(view, task, now, { full: false })),
      total: shown.length,
      offset,
      more: offset + limit < shown.length,
    };
  }

  private statusFilter(tasks: VTask[], status: ReadItem['status']): VTask[] {
    if (status === 'all') return tasks;
    if (status === 'done') return tasks.filter((task) => task.row.done);
    return tasks.filter((task) => !task.row.done);
  }

  private paging(item: ReadItem): { offset: number; limit: number } {
    const offset = Math.max(0, Math.floor(Number(item.offset ?? 0)) || 0);
    const limit = Math.min(200, Math.max(1, Math.floor(Number(item.limit ?? 50)) || 50));
    return { offset, limit };
  }

  private taskOut(
    view: Visible,
    task: VTask,
    now: Date,
    options: { readonly full: boolean; readonly lines?: LineRange | undefined },
  ): TaskOut {
    const row = task.row;
    const meta = this.deps.workspace().meta.get(task.id);
    const reminder = reminderOf(row, now);
    const body = row.body.trim() === '' ? null : sliceText(row.body, options.lines, 'body');
    const capped = body && !options.full ? sliceText(row.body, { from: 1, to: 20 }, 'body') : body;
    const subtasks = view
      .tasksOf(view.list(task.listId) ?? (task as unknown as VList))
      .filter((each) => each.parent === task.id);
    return {
      kind: 'task',
      id: task.id,
      title: task.name,
      list: { id: task.listId, name: task.listName },
      ...(task.parent !== undefined && { parent: task.parent }),
      done: row.done,
      ...(row.completed && { completed: row.completed }),
      ...(row.priority && { priority: row.priority }),
      ...(reminder && { reminder }),
      ...(row.pinned && { pinned: true }),
      ...(capped && {
        body: capped.text,
        bodyLines: capped.totalLines,
        ...(capped.truncated && { bodyTruncated: true }),
      }),
      ...(subtasks.length > 0 && {
        subtasks: subtasks.map((sub) => this.taskOut(view, sub, now, { full: false })),
      }),
      ...(meta?.created !== undefined && { created: meta.created }),
      ...(meta?.createdBy !== undefined && { createdBy: meta.createdBy }),
      ...(meta?.touchedBy !== undefined && { touchedBy: meta.touchedBy }),
    };
  }

  // ─── writes ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Checks every item (Q6: all or nothing), then runs the planned changes as one agent run. A
   * planned change returns what it changed.
   */
  private async write(
    agent: string,
    items: readonly unknown[],
    plan: (view: Visible, item: unknown, index: number) => Planned,
    counts: { readonly taskDeletes?: number; readonly listDeletes?: number } = {},
  ): Promise<WriteOutcome> {
    const limits = this.deps.limits();
    if (items.length > limits.itemsPerRequest)
      throw fail(
        'too_large',
        `At most ${limits.itemsPerRequest} items in one request (this has ${items.length}). Split the work.`,
      );
    if ((counts.taskDeletes ?? 0) > limits.taskDeletesPerRequest)
      throw fail(
        'too_large',
        `At most ${limits.taskDeletesPerRequest} tasks deleted in one request.`,
      );
    if ((counts.listDeletes ?? 0) > limits.listDeletesPerRequest)
      throw fail(
        'too_large',
        `At most ${limits.listDeletesPerRequest} lists, notes or groups deleted in one request.`,
      );
    const view = this.visible();
    const planned: Planned[] = [];
    const problems: ItemProblem[] = [];
    items.forEach((item, index) => {
      try {
        planned.push(plan(view, item, index));
      } catch (caught) {
        if (!(caught instanceof AgentFailure)) throw caught;
        const { code, message, candidates, suggestions } = caught.error;
        problems.push({
          index,
          code,
          message,
          ...(candidates && { candidates }),
          ...(suggestions && { suggestions }),
        });
      }
    });
    if (problems.length > 0) {
      const [first] = problems;
      throw fail(
        first?.code ?? 'invalid',
        problems.length === 1
          ? `Nothing was changed: ${first?.message ?? ''}`
          : `Nothing was changed: ${problems.length} items have problems.`,
        {
          problems,
          ...(problems.length === 1 && first?.candidates && { candidates: first.candidates }),
          ...(problems.length === 1 && first?.suggestions && { suggestions: first.suggestions }),
        },
      );
    }
    const changed: Changed[] = [];
    const text: string[] = [];
    let count = 0;
    const run = await this.deps.workspace().agentRun(
      agent,
      async () => {
        for (const each of planned) {
          const done = await each.run();
          changed.push(...done.changed);
          text.push(...done.text);
          count += done.count ?? done.changed.length;
        }
      },
      // Security review H1: shorthand's ##list never reaches a list hidden from agents.
      (listId) => !this.hiddenNow(listId),
    );
    const label = summarise(changed, text);
    const result: WriteResult = { changed, text };
    return {
      result,
      label,
      steps: run.steps,
      keys: run.keys,
      lists: run.lists,
      count,
      undoable: !planned.some((each) => each.notUndoable),
      ...(run.error !== undefined && { error: run.error }),
    };
  }

  create(agent: string, raw: unknown): Promise<WriteOutcome> {
    const items = itemsOf(raw);
    const shorthand = isObject(raw) && raw['parseShorthand'] === true;
    return this.write(agent, items, (view, item) =>
      this.planCreate(view, item as CreateItem, shorthand),
    );
  }

  update(agent: string, raw: unknown): Promise<WriteOutcome> {
    const items = itemsOf(raw);
    const shorthand = isObject(raw) && raw['parseShorthand'] === true;
    return this.write(agent, items, (view, item) =>
      this.planUpdate(view, item as UpdateItem, shorthand, agent),
    );
  }

  /** AGENT-06: a list or note hidden from agents now, itself or through its group. */
  private hiddenNow(listId: string): boolean {
    const hidden = this.deps.hidden();
    if (hidden.isHidden(listId)) return true;
    return this.deps
      .workspace()
      .sidebarManual()
      .some(
        (item) => item.kind === 'group' && item.lists.includes(listId) && hidden.isHidden(item.id),
      );
  }

  delete(agent: string, raw: unknown): Promise<WriteOutcome> {
    const items = itemsOf(raw) as DeleteArgs['items'][number][];
    // Security review L1: the count comes first, before any item is resolved.
    if (items.length > this.deps.limits().itemsPerRequest)
      throw fail(
        'too_large',
        `At most ${this.deps.limits().itemsPerRequest} items in one request (this has ${items.length}). Split the work.`,
      );
    // Counted before resolving, by kind when given (a resolved list is recounted below).
    const view = this.visible();
    let taskDeletes = 0;
    let listDeletes = 0;
    for (const item of items) {
      if (!isObject(item)) continue;
      let kind = item.kind;
      if (!kind) {
        try {
          kind = this.resolve(view, item.ref, undefined, item.in).kind;
        } catch {
          kind = 'task';
        }
      }
      if (kind === 'task') taskDeletes += 1;
      else listDeletes += 1;
    }
    return this.write(agent, items, (planView, item) => this.planDelete(planView, item), {
      taskDeletes,
      listDeletes,
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────────────────────────

  private planCreate(view: Visible, item: CreateItem, shorthand: boolean): Planned {
    if (typeof item !== 'object' || item === null)
      throw fail('invalid', 'Each item is an object with a "kind".');
    const workspace = this.deps.workspace();
    const now = this.deps.now();
    switch (item.kind) {
      case 'task': {
        const title = optionalString(item.title, 'title') ?? '';
        if (title.trim() === '') throw fail('invalid', 'A task needs a "title".');
        checkText(title, 'title', true);
        checkText(item.body, 'body');
        const parent =
          item.parent !== undefined
            ? (this.resolve(view, item.parent, 'task') as VTask)
            : undefined;
        if (parent && !parent.topLevel)
          throw fail(
            'invalid',
            `"${parent.name}" is a subtask; subtasks have no subtasks (TASK-04).`,
          );
        let list =
          item.list !== undefined
            ? this.resolve(view, item.list, undefined)
            : (view.list(INBOX_ID) ?? view.lists[0]);
        if (parent) list = view.list(parent.listId) ?? list;
        if (!list || list.kind !== 'list')
          throw fail(
            'invalid',
            `Tasks go into a task list${list ? `, not ${list.kind} "${list.name}"` : ''}.`,
          );
        const target = list;
        // The 1.8.0 preview (D-185 Q6): an agent's ##list never makes a list or picks a near one;
        // an unknown or near name is not_found, with the close lists to choose from.
        if (shorthand) {
          const lists = view.lists.map((each) => ({
            id: each.id,
            name: each.name,
            mode: each.kind === 'note' ? ('note' as const) : ('tasks' as const),
          }));
          const parsed = parseCapture(title, { now, lists });
          if (parsed.target.kind === 'new' || parsed.target.kind === 'close-match') {
            const name = parsed.target.name;
            const close =
              parsed.target.kind === 'close-match'
                ? [asCandidate(view.list(parsed.target.list.id) ?? list)]
                : suggest(name, view.lists).map(asCandidate);
            throw fail(
              'not_found',
              `No list called "${name}". Agents never make one from ##: make it first (flint list add), give the list with --list, or keep ## as text with --literal.`,
              { suggestions: close },
            );
          }
        }
        const position = this.taskPosition(view, target, item.position);
        const fields = this.taskFields(item, now);
        return {
          run: async () => {
            const id = workspace.reserveId();
            const added = await workspace.change(
              target.id,
              {
                kind: 'add',
                text: shorthand ? title : literal(title),
                where: position.after ? { after: position.after } : 'top',
                id,
              },
              this.deps.now(),
            );
            if (!added) throw fail('invalid', `"${title}" couldn't be added.`);
            const key = added.key ?? id;
            const at = added.listId;
            if (position.before)
              await this.change(at, {
                kind: 'place',
                key,
                where: { at: 'before', key: position.before },
              });
            if (position.bottom) {
              const last = this.lastTopLevel(at, key);
              if (last)
                await this.change(at, { kind: 'place', key, where: { at: 'after', key: last } });
            }
            if (parent) {
              await this.change(at, { kind: 'place', key, where: { at: 'after', key: parent.id } });
              await this.change(at, { kind: 'indent', key });
            }
            await this.applyFields(key, fields);
            const reminder = fields.remind?.kind === 'at' ? fields.remind.at : undefined;
            const changed: Changed = {
              kind: 'task',
              id: key,
              name: title,
              what: 'added',
              list: { id: at, name: added.listName },
              ...(reminder && {
                reminder: {
                  at: timeValue(reminder),
                  text: timeText(reminder, this.deps.now()),
                  muted: false,
                  overdue: false,
                },
              }),
            };
            return {
              changed: [changed],
              text: [
                `Added "${title}" to ${added.listName} · id ${key}${reminder ? ` · Reminder ${timeText(reminder, this.deps.now())}` : ''}`,
              ],
            };
          },
        };
      }
      case 'list':
      case 'note': {
        const name = optionalString(item.name, 'name')?.trim() ?? '';
        if (name === '') throw fail('invalid', `A ${item.kind} needs a "name".`);
        if (
          view.lists.some((list) => sameName(list.name, name)) ||
          workspace.listInfos().some((info) => sameName(info.name, name))
        )
          throw fail('invalid', 'That name isn’t available; choose another.');
        const text = item.kind === 'note' ? optionalString(item.text, 'text') : undefined;
        checkText(text, 'text');
        const group =
          item.group !== undefined
            ? (this.resolve(view, item.group, 'group') as VGroup)
            : undefined;
        const mode = item.kind === 'note' ? 'note' : 'tasks';
        return {
          run: async () => {
            const now2 = this.deps.now();
            const outcome = group
              ? await workspace.newListInGroup(name, mode, group.id, now2)
              : await workspace.newList(name, mode, now2);
            if (!outcome.ok) throw fail('invalid', neutral(outcome.problem));
            if (text !== undefined && text !== '')
              await workspace.saveNote(outcome.listId, text, now2);
            this.touchNote(outcome.listId);
            return {
              changed: [{ kind: item.kind, id: outcome.listId, name, what: 'created' }],
              text: [
                `Created ${item.kind} "${name}"${group ? ` in ${group.name}` : ''} · id ${outcome.listId}`,
              ],
            };
          },
        };
      }
      case 'quickNote': {
        const text = optionalString(item.text, 'text');
        checkText(text, 'text');
        return {
          run: async () => {
            const id = await workspace.newQuickNote(this.deps.now());
            if (!id) throw fail('internal', 'The quick note couldn’t be made.');
            if (text !== undefined && text !== '')
              await workspace.saveNote(id, text, this.deps.now());
            this.touchNote(id);
            return {
              changed: [{ kind: 'note', id, name: 'Quick note', what: 'created' }],
              text: [`Created a quick note · id ${id}`],
            };
          },
        };
      }
      case 'group': {
        const name = optionalString(item.name, 'name')?.trim() ?? '';
        if (name === '') throw fail('invalid', 'A group needs a "name".');
        const lists = (Array.isArray(item.lists) ? item.lists : []).map((ref) => {
          const list = this.resolve(view, ref, undefined);
          if (list.kind !== 'list' && list.kind !== 'note')
            throw fail(
              'invalid',
              `Only lists and notes go into a group, not ${list.kind} "${list.name}".`,
            );
          return list;
        });
        return {
          run: async () => {
            const made = await workspace.sidebarAction(
              { kind: 'newGroup', name },
              this.deps.now(),
              true,
            );
            if (!made.ok || made.id === undefined)
              throw fail('invalid', made.ok ? 'The group couldn’t be made.' : made.problem);
            for (const [index, list] of lists.entries())
              await workspace.sidebarAction(
                { kind: 'move', id: list.id, to: { group: made.id, index } },
                this.deps.now(),
                true,
              );
            return {
              changed: [{ kind: 'group', id: made.id, name, what: 'created' }],
              text: [
                `Created group "${name}"${lists.length ? ` with ${lists.length} ${lists.length === 1 ? 'list' : 'lists'}` : ''} · id ${made.id}`,
              ],
            };
          },
        };
      }
      default:
        throw fail('invalid', '"kind" is task, list, note, quickNote or group.');
    }
  }

  // ─── update ────────────────────────────────────────────────────────────────────────────────────

  private planUpdate(view: Visible, item: UpdateItem, shorthand: boolean, agent: string): Planned {
    if (typeof item !== 'object' || item === null)
      throw fail('invalid', 'Each item is an object with a "ref".');
    const kind = item.kind ?? 'task';
    if (kind === 'task') return this.planTaskUpdate(view, item as TaskUpdate, shorthand);
    const found = this.resolve(view, item.ref, kind === 'group' ? 'group' : undefined, undefined);
    if (found.kind === 'task')
      return this.planTaskUpdate(
        view,
        { ...(item as object), kind: 'task', ref: found.id },
        shorthand,
      );
    if (found.kind === 'group') return this.planGroupUpdate(view, found, item as GroupUpdate);
    return this.planListUpdate(view, found, item as ListUpdate, agent);
  }

  private planTaskUpdate(view: Visible, item: TaskUpdate, shorthand: boolean): Planned {
    const task = this.resolve(view, item.ref, 'task', item.in) as VTask;
    const title = optionalString(item.title, 'title');
    if (title !== undefined && title.trim() === '')
      throw fail('invalid', 'A title can’t be empty.');
    checkText(title, 'title', true);
    checkText(item.body, 'body');
    const now = this.deps.now();
    const fields = this.taskFields(item, now);
    const moveTo =
      item.moveTo !== undefined ? this.resolve(view, item.moveTo, undefined) : undefined;
    if (moveTo && moveTo.kind !== 'list')
      throw fail('invalid', `Tasks move into a task list, not ${moveTo.kind} "${moveTo.name}".`);
    const home = moveTo ?? view.list(task.listId);
    let parent: VTask | null | undefined;
    if (item.parent === null) parent = null;
    else if (item.parent !== undefined) {
      parent = this.resolve(view, item.parent, 'task') as VTask;
      if (!parent.topLevel)
        throw fail('invalid', `"${parent.name}" is a subtask; subtasks have no subtasks.`);
      if (parent.id === task.id) throw fail('invalid', 'A task can’t be its own subtask.');
      if (home && parent.listId !== home.id)
        throw fail(
          'invalid',
          `"${parent.name}" is in ${parent.listName}; move the task there first.`,
        );
      if (view.tasksOf(view.list(task.listId) as VList).some((each) => each.parent === task.id))
        throw fail(
          'invalid',
          `"${task.name}" has subtasks of its own, so it can’t become a subtask.`,
        );
    }
    const position =
      item.position !== undefined && home
        ? this.taskPosition(view, home, item.position, task.id)
        : undefined;
    const attach = item.attach !== undefined ? this.checkAttach(item.attach) : undefined;
    return {
      run: async () => {
        const workspace = this.deps.workspace();
        const key = task.id;
        const what: string[] = [];
        if (title !== undefined && title !== task.name) {
          await this.changeTask(key, {
            kind: 'edit',
            key,
            text: shorthand ? title : literal(title),
          });
          what.push('renamed');
        }
        if (moveTo && moveTo.id !== task.listId) {
          await this.changeTask(key, { kind: 'moveTo', key, to: { list: moveTo.id } });
          what.push(`moved to ${moveTo.name}`);
        }
        if (parent === null && !task.topLevel) {
          await this.changeTask(key, { kind: 'outdent', key });
          what.push('outdented');
        } else if (parent) {
          await this.changeTask(key, {
            kind: 'place',
            key,
            where: { at: 'after', key: parent.id },
          });
          await this.changeTask(key, { kind: 'indent', key });
          what.push(`made a subtask of "${parent.name}"`);
        }
        if (position) {
          const at = workspace.locate(key)?.listId ?? task.listId;
          if (position.before)
            await this.change(at, {
              kind: 'place',
              key,
              where: { at: 'before', key: position.before },
            });
          else if (position.after)
            await this.change(at, {
              kind: 'place',
              key,
              where: { at: 'after', key: position.after },
            });
          else if (position.top) {
            const first = this.firstTopLevel(at, key);
            if (first)
              await this.change(at, { kind: 'place', key, where: { at: 'before', key: first } });
          } else if (position.bottom) {
            const last = this.lastTopLevel(at, key);
            if (last)
              await this.change(at, { kind: 'place', key, where: { at: 'after', key: last } });
          }
          what.push('moved');
        }
        what.push(...(await this.applyFields(key, fields)));
        if (item.done !== undefined && item.done !== task.row.done) {
          await this.changeTask(key, { kind: 'complete', key, done: item.done });
          what.push(item.done ? 'completed' : 'reopened');
        }
        if (attach) {
          const link = await this.attach(attach);
          const body = workspace.view(
            workspace.locate(key)?.listId ?? task.listId,
            this.deps.now(),
          );
          const row = body ? findRow(body.items, body.completed, key) : undefined;
          await this.changeTask(key, {
            kind: 'body',
            key,
            body: appendText(row?.body ?? '', link),
          });
          what.push('attachment added');
        }
        const listId = workspace.locate(key)?.listId ?? task.listId;
        const listName = view.list(listId)?.name ?? moveTo?.name ?? task.listName;
        const reminder = fields.remind?.kind === 'at' ? fields.remind.at : undefined;
        const name = title ?? task.name;
        return {
          changed: [
            {
              kind: 'task',
              id: key,
              name,
              what: what.join(', ') || 'unchanged',
              list: { id: listId, name: listName },
              ...(reminder && {
                reminder: {
                  at: timeValue(reminder),
                  text: timeText(reminder, this.deps.now()),
                  muted: false,
                  overdue: false,
                },
              }),
            },
          ],
          text: [`${capitalise(what.join(', ') || 'unchanged')}: "${name}" · id ${key}`],
          count: what.length > 0 ? 1 : 0,
        };
      },
    };
  }

  private planListUpdate(view: Visible, list: VList, item: ListUpdate, agent: string): Planned {
    const workspace = this.deps.workspace();
    const name = optionalString(item.name, 'name')?.trim();
    if (name !== undefined) {
      if (name === '') throw fail('invalid', 'A name can’t be empty.');
      if (list.inbox) throw fail('invalid', 'Inbox keeps its name.');
      if (
        !sameName(name, list.name) &&
        workspace.listInfos().some((info) => sameName(info.name, name))
      )
        throw fail('invalid', 'That name isn’t available; choose another.');
    }
    const group =
      item.group === null
        ? null
        : item.group !== undefined
          ? (this.resolve(view, item.group, 'group') as VGroup)
          : undefined;
    const position =
      item.position !== undefined ? this.sidebarPosition(view, list, item.position) : undefined;
    if (item.mode !== undefined && item.mode !== 'tasks' && item.mode !== 'note')
      throw fail('invalid', '"mode" is tasks or note.');
    if (item.archiveDone && list.kind !== 'list')
      throw fail('invalid', 'Only a task list has done tasks to archive.');
    if (item.keep !== undefined && !list.quick)
      throw fail('invalid', `"${list.name}" isn't a quick note.`);
    const keepName =
      item.keep !== undefined ? optionalString(item.keep.name, 'keep.name')?.trim() : undefined;
    if (item.keep !== undefined && !keepName)
      throw fail('invalid', 'Keep needs a name: keep: { name }.');
    // A note's new text, worked out now so a missing passage changes nothing.
    let text: string | undefined;
    if (item.append !== undefined || item.replace !== undefined || item.text !== undefined) {
      if (list.kind !== 'note')
        throw fail('invalid', `"${list.name}" is a task list; its text is its tasks.`);
      let current = workspace.view(list.id, this.deps.now())?.noteText ?? '';
      if (item.text !== undefined) {
        checkText(item.text, 'text');
        current = item.text;
      }
      if (item.replace !== undefined) {
        if (
          !isObject(item.replace) ||
          typeof item.replace.find !== 'string' ||
          typeof item.replace.with !== 'string'
        )
          throw fail(
            'invalid',
            'replace is { find, with }: the exact passage and what replaces it.',
          );
        checkText(item.replace.with, 'replace.with');
        const replaced = replaceOnce(current, item.replace.find, item.replace.with);
        if (!replaced.ok)
          throw fail(
            replaced.count === 0 ? 'not_found' : 'ambiguous',
            replaced.count === 0
              ? `The passage to replace isn't in "${list.name}" (it must match exactly).`
              : `The passage occurs ${replaced.count} times in "${list.name}"; include more of it so it occurs once.`,
          );
        current = replaced.text;
      }
      if (item.append !== undefined) {
        checkText(item.append, 'append');
        current = appendText(current, item.append);
      }
      checkText(current, 'text');
      text = current;
    }
    const attach = item.attach !== undefined ? this.checkAttach(item.attach) : undefined;
    if (attach && list.kind !== 'note') throw fail('invalid', 'Attach to a note or a task.');
    return {
      ...(item.archiveDone && { notUndoable: true }),
      run: async () => {
        const now = (): Date => this.deps.now();
        const what: string[] = [];
        let id = list.id;
        let shownName = list.name;
        let count = 1;
        if (text !== undefined) {
          await workspace.saveNote(id, text, now());
          what.push('edited');
        }
        if (attach) {
          const link = await this.attach(attach);
          await workspace.saveNote(
            id,
            appendText(workspace.view(id, now())?.noteText ?? '', link),
            now(),
          );
          what.push('attachment added');
        }
        if (keepName !== undefined) {
          const kept = await workspace.keepQuickNote(id, keepName, now());
          if (!kept.ok) throw fail('invalid', neutral(kept.problem));
          id = kept.listId;
          shownName = keepName;
          what.push(`kept as "${keepName}"`);
        } else if (name !== undefined && name !== list.name) {
          const renamed = await workspace.renameList(id, name, now());
          if (!renamed.ok) throw fail('invalid', neutral(renamed.problem));
          shownName = name;
          what.push(`renamed to "${name}"`);
        }
        if (item.mode !== undefined && item.mode !== (list.kind === 'note' ? 'note' : 'tasks')) {
          const converted = await workspace.convertList(id, item.mode, now());
          if (!converted.ok) throw fail('invalid', converted.problem);
          what.push(item.mode === 'note' ? 'converted to a note' : 'converted to a task list');
        }
        if (group !== undefined) {
          const target = group?.id ?? null;
          const index =
            target === null ? workspace.sidebarManual().length : (group?.lists.length ?? 0);
          await workspace.sidebarAction(
            { kind: 'move', id, to: { group: target, index } },
            now(),
            true,
          );
          what.push(group ? `moved into ${group.name}` : 'moved out of its group');
        }
        if (position) {
          await workspace.sidebarAction({ kind: 'move', id, to: position }, now(), true);
          what.push('moved');
        }
        if (item.duplicate) {
          const copy = await workspace.duplicateList(id, now());
          if (!copy.ok) throw fail('invalid', neutral(copy.problem));
          what.push(`duplicated (id ${copy.listId})`);
        }
        if (item.archiveDone) {
          count = await workspace.archiveDone(now(), 0, id);
          what.push(`archived ${count} done ${count === 1 ? 'task' : 'tasks'}`);
        }
        this.touchNote(id, agent);
        return {
          changed: [{ kind: list.kind, id, name: shownName, what: what.join(', ') || 'unchanged' }],
          text: [`${capitalise(what.join(', ') || 'unchanged')}: "${shownName}" · id ${id}`],
          count: what.length > 0 ? Math.max(1, count) : 0,
        };
      },
    };
  }

  private planGroupUpdate(view: Visible, group: VGroup, item: GroupUpdate): Planned {
    const workspace = this.deps.workspace();
    const name = optionalString(item.name, 'name')?.trim();
    if (name !== undefined && name === '') throw fail('invalid', 'A name can’t be empty.');
    const resolveLists = (refs: unknown): VList[] =>
      (Array.isArray(refs) ? refs : []).map((ref) => {
        const list = this.resolve(view, ref, undefined);
        if (list.kind !== 'list' && list.kind !== 'note')
          throw fail(
            'invalid',
            `Only lists and notes go into a group, not ${list.kind} "${list.name}".`,
          );
        return list;
      });
    const adding = resolveLists(item.addLists);
    const removing = resolveLists(item.removeLists);
    const position =
      item.position !== undefined ? this.sidebarPosition(view, group, item.position) : undefined;
    return {
      run: async () => {
        const now = (): Date => this.deps.now();
        const what: string[] = [];
        if (name !== undefined && name !== group.name) {
          const renamed = await workspace.sidebarAction(
            { kind: 'renameGroup', id: group.id, name },
            now(),
            true,
          );
          if (!renamed.ok) throw fail('invalid', renamed.problem);
          what.push(`renamed to "${name}"`);
        }
        for (const list of adding) {
          const current = workspace
            .sidebarManual()
            .find((each) => each.kind === 'group' && each.id === group.id);
          const index = current?.kind === 'group' ? current.lists.length : 0;
          await workspace.sidebarAction(
            { kind: 'move', id: list.id, to: { group: group.id, index } },
            now(),
            true,
          );
        }
        if (adding.length) what.push(`added ${adding.map((list) => `"${list.name}"`).join(', ')}`);
        for (const list of removing)
          await workspace.sidebarAction(
            {
              kind: 'move',
              id: list.id,
              to: { group: null, index: workspace.sidebarManual().length },
            },
            now(),
            true,
          );
        if (removing.length)
          what.push(`took out ${removing.map((list) => `"${list.name}"`).join(', ')}`);
        if (position) {
          await workspace.sidebarAction({ kind: 'move', id: group.id, to: position }, now(), true);
          what.push('moved');
        }
        const shown = name ?? group.name;
        return {
          changed: [
            { kind: 'group', id: group.id, name: shown, what: what.join(', ') || 'unchanged' },
          ],
          text: [
            `${capitalise(what.join(', ') || 'unchanged')}: group "${shown}" · id ${group.id}`,
          ],
          count: what.length > 0 ? 1 : 0,
        };
      },
    };
  }

  // ─── delete ────────────────────────────────────────────────────────────────────────────────────

  private planDelete(view: Visible, raw: unknown): Planned {
    if (!isObject(raw)) throw fail('invalid', 'Each item is an object with a "ref".');
    const item = raw as unknown as DeleteArgs['items'][number];
    const found = this.resolve(view, item.ref, item.kind, item.in);
    const workspace = this.deps.workspace();
    switch (found.kind) {
      case 'task':
        return {
          run: async () => {
            await this.changeTask(found.id, { kind: 'delete', key: found.id });
            return {
              changed: [
                {
                  kind: 'task',
                  id: found.id,
                  name: found.name,
                  what: 'deleted',
                  list: { id: found.listId, name: found.listName },
                },
              ],
              text: [`Deleted "${found.name}" from ${found.listName} (in Trash) · id ${found.id}`],
            };
          },
        };
      case 'list':
      case 'note': {
        if (found.inbox) throw fail('invalid', 'Inbox can’t be deleted.');
        const tasks = view.tasksOf(found).length;
        return {
          run: async () => {
            const outcome = await workspace.deleteList(found.id, this.deps.now());
            if (!outcome.ok) throw fail('invalid', outcome.problem);
            return {
              changed: [{ kind: found.kind, id: found.id, name: found.name, what: 'deleted' }],
              text: [`Deleted ${found.kind} "${found.name}" (in Trash) · id ${found.id}`],
              count: Math.max(1, tasks),
            };
          },
        };
      }
      case 'group':
        return {
          run: async () => {
            const outcome = await workspace.sidebarAction(
              { kind: 'deleteGroup', id: found.id },
              this.deps.now(),
              true,
            );
            if (!outcome.ok) throw fail('invalid', outcome.problem);
            return {
              changed: [{ kind: 'group', id: found.id, name: found.name, what: 'deleted' }],
              text: [`Deleted group "${found.name}"; its lists stay · id ${found.id}`],
            };
          },
        };
    }
  }

  // ─── link patterns ─────────────────────────────────────────────────────────────────────────────

  linkPatternsList(): LinkPatternsResult {
    const patterns = this.deps.linkPatterns.get().map(patternOut);
    return {
      patterns,
      text:
        patterns.length === 0
          ? ['No link patterns.']
          : patterns.map((each) => `${each.index}: ${each.short} → ${each.url}`),
    };
  }

  async linkPatterns(raw: unknown): Promise<{
    result: LinkPatternsResult;
    before?: readonly LinkPattern[];
    after?: readonly LinkPattern[];
    label?: string;
  }> {
    if (!isObject(raw)) throw fail('invalid', 'Give an "action": list, add, edit or delete.');
    const args = raw as unknown as LinkPatternsArgs;
    if (args.action === 'list') return { result: this.linkPatternsList() };
    const before = this.deps.linkPatterns.get();
    const find = (ref: unknown): number => {
      const index =
        typeof ref === 'number'
          ? ref
          : before.findIndex((pattern) => typeof ref === 'string' && pattern.short === ref.trim());
      if (!Number.isInteger(index) || index < 0 || index >= before.length)
        throw fail('not_found', `No link pattern ${JSON.stringify(ref)}.`, {
          suggestions: before.slice(0, 5).map((pattern, at): Candidate => ({
            kind: 'list',
            id: String(at),
            name: pattern.short,
          })),
        });
      return index;
    };
    let after: LinkPattern[];
    let label: string;
    switch (args.action) {
      case 'add': {
        const pattern = checkPattern(
          { short: args.short, url: args.url, ...(args.kinds && { kinds: args.kinds }) },
          before,
        );
        after = [...before, pattern];
        label = `Added link pattern ${pattern.short}`;
        break;
      }
      case 'edit': {
        const index = find(args.ref);
        const old = before[index] as LinkPattern;
        const pattern = checkPattern(
          {
            short: args.short ?? old.short,
            url: args.url ?? old.url,
            ...((args.kinds ?? old.kinds) && { kinds: args.kinds ?? old.kinds }),
          },
          before.filter((_, at) => at !== index),
        );
        after = before.map((each, at) => (at === index ? pattern : each));
        label = `Changed link pattern ${pattern.short}`;
        break;
      }
      case 'delete': {
        const index = find(args.ref);
        label = `Deleted link pattern ${before[index]?.short ?? ''}`;
        after = before.filter((_, at) => at !== index);
        break;
      }
      default:
        throw fail('invalid', '"action" is list, add, edit or delete.');
    }
    await this.deps.linkPatterns.save(after);
    const listed = this.linkPatternsList();
    return { result: { patterns: listed.patterns, text: [label] }, before, after, label };
  }

  // ─── helpers for writes ────────────────────────────────────────────────────────────────────────

  private taskFields(
    item: {
      readonly body?: unknown;
      readonly priority?: unknown;
      readonly remind?: unknown;
      readonly muted?: unknown;
      readonly pinned?: unknown;
      readonly focus?: unknown;
    },
    now: Date,
  ): PlannedFields {
    const priority = asPriority(item.priority);
    const remindText = optionalString(item.remind, 'remind');
    const remind = remindText !== undefined ? parseAgentTime(remindText, now) : undefined;
    if (remind?.kind === 'bad') throw fail('bad_time', remind.message);
    const flag = (value: unknown, field: string): boolean | undefined => {
      if (value === undefined) return undefined;
      if (typeof value !== 'boolean') throw fail('invalid', `"${field}" is true or false.`);
      return value;
    };
    return {
      ...(item.body !== undefined && { body: optionalString(item.body, 'body') ?? '' }),
      ...(priority !== undefined && { priority }),
      ...(remind !== undefined && { remind }),
      ...(flag(item.muted, 'muted') !== undefined && { muted: flag(item.muted, 'muted') }),
      ...(flag(item.pinned, 'pinned') !== undefined && { pinned: flag(item.pinned, 'pinned') }),
      ...(flag(item.focus, 'focus') !== undefined && { focus: flag(item.focus, 'focus') }),
    };
  }

  /** The fields' changes on a task, in order; what changed, in words. */
  private async applyFields(key: string, fields: PlannedFields): Promise<string[]> {
    const what: string[] = [];
    if (fields.body !== undefined) {
      await this.changeTask(key, { kind: 'body', key, body: fields.body });
      what.push('notes changed');
    }
    if (fields.priority !== undefined) {
      await this.changeTask(key, { kind: 'priority', key, priority: fields.priority });
      what.push(fields.priority ? `priority ${fields.priority}` : 'priority removed');
    }
    if (fields.remind !== undefined && fields.remind.kind !== 'bad') {
      const at = fields.remind.kind === 'at' ? fields.remind.at : null;
      await this.changeTask(key, { kind: 'reminder', key, at });
      what.push(at ? `reminder ${timeText(at, this.deps.now())}` : 'reminder removed');
    }
    if (fields.muted !== undefined) {
      await this.changeTask(key, { kind: 'mute', key, muted: fields.muted });
      what.push(fields.muted ? 'reminder off' : 'reminder on');
    }
    if (fields.pinned !== undefined) {
      await this.changeTask(key, { kind: 'pin', key, pinned: fields.pinned });
      what.push(fields.pinned ? 'pinned' : 'unpinned');
    }
    if (fields.focus !== undefined) {
      await this.changeTask(key, { kind: 'focus', key, focus: fields.focus });
      what.push(fields.focus ? 'sent to Focus' : 'taken out of Focus');
    }
    return what;
  }

  private async change(listId: string, change: ListChange): Promise<void> {
    await this.deps.workspace().change(listId, change, this.deps.now());
  }

  private async changeTask(key: string, change: ListChange): Promise<void> {
    const at = this.deps.workspace().locate(key)?.listId;
    if (!at) throw fail('not_found', `The task ${key} is gone.`);
    await this.change(at, change);
  }

  private taskPosition(
    view: Visible,
    list: VList,
    position: TaskPosition | undefined,
    self?: string,
  ): { top?: true; bottom?: true; after?: string; before?: string } {
    if (position === undefined || position === 'top') return { top: true };
    if (position === 'bottom') return { bottom: true };
    if (isObject(position)) {
      const ref =
        'after' in position ? position.after : 'before' in position ? position.before : undefined;
      const neighbour = this.resolve(view, ref, 'task', list.id) as VTask;
      if (neighbour.id === self) throw fail('invalid', 'A task can’t be placed next to itself.');
      return 'after' in position ? { after: neighbour.id } : { before: neighbour.id };
    }
    throw fail('invalid', '"position" is top, bottom, { after } or { before }.');
  }

  private sidebarPosition(
    view: Visible,
    self: VList | VGroup,
    position: SidebarPosition,
  ): { readonly group: string | null; readonly index: number } {
    const manual = this.deps.workspace().sidebarManual();
    const groupOf = (id: string): string | null => {
      const group = manual.find((item) => item.kind === 'group' && item.lists.includes(id));
      return group?.id ?? null;
    };
    const container = (group: string | null): string[] => {
      if (group === null) return manual.map((item) => item.id);
      const found = manual.find((item) => item.kind === 'group' && item.id === group);
      return found?.kind === 'group' ? [...found.lists] : [];
    };
    const own = self.kind === 'group' ? null : groupOf(self.id);
    if (position === 'top' || position === 'bottom') {
      const ids = container(own).filter((id) => id !== self.id);
      return { group: own, index: position === 'top' ? 0 : ids.length };
    }
    if (!isObject(position))
      throw fail('invalid', '"position" is top, bottom, { after } or { before }.');
    const ref = 'after' in position ? position.after : position.before;
    const neighbour = this.resolve(view, ref, undefined);
    if (neighbour.kind === 'task') throw fail('invalid', 'Place it next to a list, note or group.');
    if (neighbour.id === self.id) throw fail('invalid', 'Place it next to another item.');
    const group =
      self.kind === 'group' || neighbour.kind === 'group' ? null : groupOf(neighbour.id);
    if (self.kind === 'group' && neighbour.kind !== 'group' && groupOf(neighbour.id) !== null)
      throw fail(
        'invalid',
        'Groups sit at the top level; place it next to a group or an ungrouped list.',
      );
    const ids = container(group).filter((id) => id !== self.id);
    const at = ids.indexOf(neighbour.id);
    return { group, index: 'after' in position ? at + 1 : Math.max(0, at) };
  }

  private firstTopLevel(listId: string, self: string): string | undefined {
    const view = this.deps.workspace().view(listId, this.deps.now());
    return (view?.items ?? []).flatMap((item) =>
      item.kind === 'task' && item.task.key !== self ? [item.task.key] : [],
    )[0];
  }

  private lastTopLevel(listId: string, self: string): string | undefined {
    const view = this.deps.workspace().view(listId, this.deps.now());
    return (view?.items ?? [])
      .flatMap((item) => (item.kind === 'task' && item.task.key !== self ? [item.task.key] : []))
      .at(-1);
  }

  private checkAttach(attach: unknown): string {
    if (!isObject(attach) || typeof attach['path'] !== 'string')
      throw fail('invalid', 'attach is { path }: an absolute path to an existing file.');
    const path = attach['path'];
    // Security review M3, M4: a local drive path only (no network share or device path, which
    // would make Flint reach another computer), no alternate data stream (`x.exe::$DATA`), no
    // trailing dot or space (Windows drops them, changing the extension).
    if (!/^[a-z]:\\/i.test(path) || path.includes(':', 2) || /[. ]$/.test(path))
      throw fail('invalid', 'The attachment path must be a file on this PC (C:\\…).');
    if (fileKind(path) === 'blocked')
      throw fail('invalid', 'Flint never attaches programs or scripts.');
    return path;
  }

  /** A file into `attachments/` (or linked when large, MEDIA-03); its markdown link. */
  private async attach(path: string): Promise<string> {
    const outcome = await attachFile(path, this.deps.workspace().folder, this.deps.now());
    if (!outcome.ok) throw fail('invalid', outcome.problem);
    const target = outcome.link.includes(' ') ? `<${outcome.link}>` : outcome.link;
    return outcome.kind === 'image'
      ? `![${outcome.name}](${target})`
      : `[${outcome.name}](${target})`;
  }

  /** A note an agent made or changed (its `meta.json` entry is keyed by its ID). */
  private touchNote(id: string, agent?: string): void {
    const workspace = this.deps.workspace();
    const info = workspace.listInfos().find((each) => each.id === id);
    if (info?.mode !== 'note' || agent === undefined) return;
    workspace.meta.touch([id], this.deps.now(), agent);
  }
}

type TaskUpdate = Exclude<UpdateItem, { readonly kind: 'list' | 'note' | 'group' }>;
type ListUpdate = Extract<UpdateItem, { readonly kind: 'list' | 'note' }>;
type GroupUpdate = Extract<UpdateItem, { readonly kind: 'group' }>;

interface PlannedFields {
  readonly body?: string;
  readonly priority?: Priority | null;
  readonly remind?: ReturnType<typeof parseAgentTime>;
  readonly muted?: boolean | undefined;
  readonly pinned?: boolean | undefined;
  readonly focus?: boolean | undefined;
}

interface PlannedRun {
  readonly changed: readonly Changed[];
  readonly text: readonly string[];
  /** Items changed for the budget; `changed.length` when unset. */
  readonly count?: number;
}

interface Planned {
  readonly run: () => Promise<PlannedRun>;
  readonly notUndoable?: boolean;
}

function findRow(
  items: readonly { readonly kind: string; readonly task?: TaskRow }[],
  completed: readonly TaskRow[],
  key: string,
): TaskRow | undefined {
  const rows = [
    ...items.flatMap((item) => (item.kind === 'task' && item.task ? [item.task] : [])),
    ...completed,
  ];
  for (const row of rows) {
    if (row.key === key) return row;
    const sub = row.subtasks.find((each) => each.key === key);
    if (sub) return sub;
  }
  return undefined;
}

function patternOut(pattern: LinkPattern, index: number): LinkPatternOut {
  return {
    index,
    short: pattern.short,
    url: pattern.url,
    ...(pattern.kinds && { kinds: pattern.kinds }),
  };
}

function checkPattern(pattern: LinkPattern, others: readonly LinkPattern[]): LinkPattern {
  if (
    typeof pattern.short !== 'string' ||
    typeof pattern.url !== 'string' ||
    pattern.short.trim() === ''
  )
    throw fail('invalid', 'A link pattern needs "short" (e.g. "AB#{id}") and "url".');
  if (!/^https?:\/\//i.test(pattern.url))
    throw fail('invalid', 'The URL starts with https:// (or http://).');
  if (!/\{[a-z][a-z0-9]*\}/i.test(pattern.short))
    throw fail('invalid', 'The short form needs a part that changes, like {id}.');
  // Security review M1, M2: a short, simple pattern only (one with many changing parts side by
  // side can take seconds to match a long word on every keystroke); kinds only digits or word.
  if (pattern.short.length > 100 || pattern.url.length > 2000)
    throw fail('invalid', 'The short form is at most 100 characters, the URL 2,000.');
  const parts = [...pattern.short.matchAll(/\{([a-z][a-z0-9]*)\}/gi)].map((match) => match[1]);
  if (parts.length > 2) throw fail('invalid', 'A short form has at most two parts that change.');
  if (/\}\{/.test(pattern.short))
    throw fail('invalid', 'Put fixed text between the parts that change, like {project}#{id}.');
  if (parts.some((part) => !pattern.url.includes(`{${part}}`)))
    throw fail('invalid', 'Every part that changes in the short form must be in the URL.');
  if (pattern.kinds !== undefined) {
    if (typeof pattern.kinds !== 'object' || pattern.kinds === null || Array.isArray(pattern.kinds))
      throw fail('invalid', '"kinds" maps each changing part to "digits" or "word".');
    for (const [name, kind] of Object.entries(pattern.kinds))
      if (!parts.includes(name) || (kind !== 'digits' && kind !== 'word'))
        throw fail('invalid', '"kinds" maps each changing part to "digits" or "word".');
  }
  const fixed = fixedPartProblem(pattern);
  if (fixed) throw fail('invalid', fixed);
  if (compileLinkPatterns([pattern]).length !== 1)
    throw fail('invalid', 'That pattern can’t be read.');
  if (others.some((each) => each.short === pattern.short))
    throw fail('invalid', `A link pattern ${pattern.short} already exists.`);
  return {
    short: pattern.short.trim(),
    url: pattern.url.trim(),
    ...(pattern.kinds && { kinds: pattern.kinds }),
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The change's line in Recent agent changes: "Added 5 tasks to Backend", "Completed "Fix…"". */
export function summarise(changed: readonly Changed[], text: readonly string[]): string {
  if (changed.length === 1) return (text[0] ?? '').replace(/ · id .*$/, '');
  const added = changed.filter((each) => each.what === 'added' && each.kind === 'task');
  if (added.length === changed.length) {
    const lists = new Set(added.map((each) => each.list?.name));
    return lists.size === 1
      ? `Added ${added.length} tasks to ${[...lists][0] ?? 'Inbox'}`
      : `Added ${added.length} tasks`;
  }
  const deleted = changed.filter((each) => each.what === 'deleted');
  if (deleted.length === changed.length) return `Deleted ${deleted.length} items`;
  return `Changed ${changed.length} items`;
}

/**
 * Security review L2: a name taken by a list hidden from agents mustn't be confirmed to them; every
 * "that name exists" says the same neutral thing.
 */
function neutral(problem: string): string {
  return /exists|taken/i.test(problem) ? 'That name isn’t available; choose another.' : problem;
}
