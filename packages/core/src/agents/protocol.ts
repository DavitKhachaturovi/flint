/**
 * AGENT-01 (D-185): the agent protocol, shared by Flint's main process (the agent API) and
 * `flint.exe` (the CLI and the MCP server, AGENT-02, AGENT-03). Plain JSON shapes only.
 *
 * Transport: a named pipe (its name in `agent-state.json`, below), newline-delimited JSON: one
 * request per line, one response per line, in order. A connection may send many requests (MCP keeps
 * one open). Every request carries the token from `agent-token`; a wrong one is answered with
 * `unauthorized` and nothing else.
 */

/** Bumped only when an older `flint.exe` couldn't understand a newer Flint (or the reverse). */
export const AGENT_PROTOCOL = 1;

/** Files in Flint's app-data folder (`%APPDATA%\Flint`, docs/04 §2). */
export const AGENT_TOKEN_FILE = 'agent-token';
export const AGENT_STATE_FILE = 'agent-state.json';

/**
 * `agent-state.json`: written by Flint at every start and on every change of the switches, so the
 * client can tell "agents are off" from "Flint isn't running" without waiting. No secret in it.
 */
export interface AgentState {
  readonly protocol: number;
  /** Flint's process ID; a dead one means Flint isn't running. */
  readonly pid: number;
  readonly on: boolean;
  readonly readOnly: boolean;
  /** Writes paused by the hourly budget or by hand (AGENT-01). */
  readonly paused: boolean;
  /** `\\.\pipe\flint-agents-<hash of the app-data folder>`; null while off. */
  readonly pipe: string | null;
  /** Flint's version, for `flint status`. */
  readonly version: string;
}

/** Who sends a request (AGENT-01, D-185 Q4). */
export interface AgentIdentity {
  /** As shown: `Claude`, `Claude Code`, `Cursor`, `VS Code`, `Command line`, or the client's own. */
  readonly name: string;
  readonly via: 'mcp' | 'cli';
}

export type AgentTool = 'status' | 'find' | 'read' | 'create' | 'update' | 'delete' | 'linkPatterns';

export interface AgentRequest {
  readonly protocol: number;
  /** Echoed in the response. */
  readonly id: number;
  readonly token: string;
  readonly agent: AgentIdentity;
  readonly tool: AgentTool;
  readonly args: unknown;
}

export type AgentResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly result: unknown;
      readonly now: NowInfo;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: AgentError;
      readonly now?: NowInfo;
    };

/** In every answer (D-185 Q7): agents often don't know today's date. */
export interface NowInfo {
  /** Local `YYYY-MM-DDTHH:MM`. */
  readonly local: string;
  /** `Fri 13 Nov 2026, 15:04`. */
  readonly text: string;
  /** `+04:00`. */
  readonly offset: string;
  /** IANA name, `Asia/Tbilisi`. */
  readonly timeZone: string;
}

export type AgentErrorCode =
  /** A wrong or missing token: nothing else is said. */
  | 'unauthorized'
  /** AI agents are off in Flint. */
  | 'off'
  | 'read_only'
  | 'paused'
  | 'too_large'
  | 'not_found'
  | 'ambiguous'
  | 'bad_time'
  /** Arguments that don't make sense (a missing title, an unknown field, a subtask of a subtask). */
  | 'invalid'
  /** The newer protocol of one side. */
  | 'protocol'
  | 'internal';

export interface Candidate {
  readonly kind: ItemKind;
  readonly id: string;
  /** A task's title, a list's, note's or group's name. */
  readonly name: string;
  /** A task's list. */
  readonly list?: string;
  /** A list's or note's group. */
  readonly group?: string;
  readonly done?: boolean;
}

export interface AgentError {
  readonly code: AgentErrorCode;
  readonly message: string;
  /** `ambiguous`: up to 10. */
  readonly candidates?: readonly Candidate[];
  /** `not_found`: up to 5 close matches (never acted on). */
  readonly suggestions?: readonly Candidate[];
  /** A batch: every item's problem, by its index in `items` (nothing was changed). */
  readonly problems?: readonly ItemProblem[];
}

export interface ItemProblem {
  readonly index: number;
  readonly code: AgentErrorCode;
  readonly message: string;
  readonly candidates?: readonly Candidate[];
  readonly suggestions?: readonly Candidate[];
}

export type ItemKind = 'task' | 'list' | 'note' | 'group';
export type Priority = 'high' | 'medium' | 'low';

/**
 * Where a task goes in its list: `top` (the default, as capture, CAP-05), `bottom`, or next to
 * another task (its ID or exact title, in the same list and at the same level).
 */
export type TaskPosition = 'top' | 'bottom' | { readonly after: string } | { readonly before: string };

/** Where a list, note or group goes in the sidebar's manual order (LIST-06). */
export type SidebarPosition =
  | 'top'
  | 'bottom'
  | { readonly after: string }
  | { readonly before: string };

/** A line range of a note or a body, 1-based and inclusive. */
export interface LineRange {
  readonly from: number;
  readonly to: number;
}

// ─── status ──────────────────────────────────────────────────────────────────────────────────────

export interface StatusResult {
  readonly version: string;
  readonly protocol: number;
  readonly readOnly: boolean;
  readonly paused: boolean;
  readonly limits: LimitsInfo;
  readonly agent: string;
}

export type LimitsPreset = 'low' | 'medium' | 'high';

export interface LimitsInfo {
  readonly preset: LimitsPreset;
  /** Items created or changed in one request. */
  readonly itemsPerRequest: number;
  readonly taskDeletesPerRequest: number;
  readonly listDeletesPerRequest: number;
  readonly changesPerHour: number;
  /** Used of `changesPerHour` in the last hour. */
  readonly usedThisHour: number;
}

// ─── find ────────────────────────────────────────────────────────────────────────────────────────

export interface FindArgs {
  /** Fuzzy; empty or missing: the overview. */
  readonly query?: string;
  readonly type?: ItemKind | 'any';
  /** Only in this list or note (ID or exact name). */
  readonly in?: string;
  readonly status?: 'open' | 'done' | 'all';
  readonly priority?: Priority;
  readonly pinned?: boolean;
  /** Tasks whose reminder is before / after this time (a phrase or ISO). */
  readonly remindBefore?: string;
  readonly remindAfter?: string;
  /** At most this many results (default 30, at most 100). */
  readonly limit?: number;
}

export interface FindHit {
  readonly kind: ItemKind;
  readonly id: string;
  readonly name: string;
  /** A task's list, a list's group. */
  readonly list?: { readonly id: string; readonly name: string };
  readonly group?: { readonly id: string; readonly name: string };
  readonly done?: boolean;
  readonly priority?: Priority;
  readonly pinned?: boolean;
  readonly reminder?: ReminderInfo;
  /** A match inside a note's text or a task's body. */
  readonly match?: { readonly line: number; readonly snippet: string };
  /** A list's open tasks. */
  readonly open?: number;
}

export interface Overview {
  readonly lists: readonly OverviewList[];
  readonly groups: readonly { readonly id: string; readonly name: string; readonly lists: readonly string[] }[];
  /** Today's pinned tasks. */
  readonly today: readonly FindHit[];
  /** Reminders still to come (and overdue ones), soonest first, at most 20. */
  readonly reminders: readonly FindHit[];
}

export interface OverviewList {
  readonly kind: 'list' | 'note';
  readonly id: string;
  readonly name: string;
  readonly group?: string;
  readonly open?: number;
  readonly quick?: boolean;
  readonly inbox?: boolean;
}

export type FindResult =
  | { readonly overview: Overview }
  | { readonly hits: readonly FindHit[]; readonly more: boolean };

// ─── read ────────────────────────────────────────────────────────────────────────────────────────

export interface ReadItem {
  /** An ID, an exact name or title, or `Today`, `Inbox`, `Reminders`. */
  readonly ref: string;
  readonly kind?: ItemKind;
  /** A task title narrowed to this list. */
  readonly in?: string;
  /** A note's (or a task's body's) lines. */
  readonly lines?: LineRange;
  /** A note's headings with their line numbers only. */
  readonly outline?: boolean;
  /** A task list's tasks: open by default. */
  readonly status?: 'open' | 'done' | 'all';
  readonly limit?: number;
  readonly offset?: number;
  /** A list's Archived tab (TASK-06). */
  readonly archived?: boolean;
}

export interface ReadArgs {
  readonly items: readonly ReadItem[];
}

export interface ReminderInfo {
  /** `YYYY-MM-DDTHH:MM`, local. */
  readonly at: string;
  /** `Sat 14 Nov, 09:00`. */
  readonly text: string;
  readonly muted: boolean;
  readonly overdue: boolean;
}

export interface TaskOut {
  readonly kind: 'task';
  readonly id: string;
  readonly title: string;
  readonly list: { readonly id: string; readonly name: string };
  /** A subtask's parent. */
  readonly parent?: string;
  readonly done: boolean;
  readonly completed?: string;
  readonly priority?: Priority;
  readonly reminder?: ReminderInfo;
  readonly pinned?: boolean;
  readonly focus?: boolean;
  /** Capped like a note's text (`bodyTruncated`, `bodyLines`). */
  readonly body?: string;
  readonly bodyLines?: number;
  readonly bodyTruncated?: boolean;
  readonly subtasks?: readonly TaskOut[];
  readonly created?: string;
  readonly createdBy?: string;
  readonly touchedBy?: string;
}

/** What a task list holds, in order: tasks, and headings and paragraphs that aren't tasks. */
export type ListEntry =
  | TaskOut
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string };

export interface ListOut {
  readonly kind: 'list';
  readonly id: string;
  readonly name: string;
  readonly group?: { readonly id: string; readonly name: string };
  readonly open: number;
  readonly done: number;
  readonly entries: readonly ListEntry[];
  /** Paging over the tasks shown (`status`). */
  readonly total: number;
  readonly offset: number;
  readonly more: boolean;
  readonly inbox?: boolean;
}

export interface NoteOut {
  readonly kind: 'note';
  readonly id: string;
  readonly name: string;
  readonly group?: { readonly id: string; readonly name: string };
  readonly quick?: boolean;
  /** The lines asked for (or the first ~200 lines / 8,000 characters). */
  readonly text?: string;
  readonly from?: number;
  readonly to?: number;
  readonly totalLines: number;
  readonly totalChars: number;
  readonly truncated: boolean;
  /** How to read on, when truncated. */
  readonly hint?: string;
  /** `outline: true`. */
  readonly outline?: readonly { readonly line: number; readonly level: number; readonly text: string }[];
  readonly createdBy?: string;
  readonly touchedBy?: string;
}

export interface GroupOut {
  readonly kind: 'group';
  readonly id: string;
  readonly name: string;
  readonly lists: readonly { readonly id: string; readonly name: string; readonly kind: 'list' | 'note' }[];
}

export interface ArchivedOut {
  readonly kind: 'archived';
  readonly list: { readonly id: string; readonly name: string };
  readonly tasks: readonly { readonly id: string; readonly title: string; readonly completed: string }[];
}

export type ReadOut = TaskOut | ListOut | NoteOut | GroupOut | ArchivedOut;

export interface ReadResult {
  readonly items: readonly ReadOut[];
}

// ─── create ──────────────────────────────────────────────────────────────────────────────────────

export interface TaskFields {
  readonly title?: string;
  readonly body?: string;
  readonly priority?: Priority | null;
  /** A phrase, ISO 8601, or `none`. */
  readonly remind?: string;
  readonly muted?: boolean;
  readonly pinned?: boolean;
  /** In Focus's sprint (FOCUS-02). */
  readonly focus?: boolean;
}

export type CreateItem =
  | (TaskFields & {
      readonly kind: 'task';
      readonly title: string;
      /** The list (default Inbox). */
      readonly list?: string;
      /** A subtask of this task (one level, TASK-04). */
      readonly parent?: string;
      readonly position?: TaskPosition;
    })
  | {
      readonly kind: 'list' | 'note';
      readonly name: string;
      readonly group?: string;
      /** A note's text. */
      readonly text?: string;
    }
  /** NOTE-08: an untitled quick note. */
  | { readonly kind: 'quickNote'; readonly text?: string }
  | { readonly kind: 'group'; readonly name: string; readonly lists?: readonly string[] };

export interface CreateArgs {
  readonly items: readonly CreateItem[];
  /** Read capture shorthand in titles (`!h`, `##list`, `@fri 9`); the CLI's default. */
  readonly parseShorthand?: boolean;
}

// ─── update ──────────────────────────────────────────────────────────────────────────────────────

export type UpdateItem =
  | (TaskFields & {
      readonly kind?: 'task';
      readonly ref: string;
      readonly in?: string;
      readonly done?: boolean;
      /** Move to the top of another list (TASK-11). */
      readonly moveTo?: string;
      /** Make it a subtask of this task, or `null` to outdent it. */
      readonly parent?: string | null;
      readonly position?: TaskPosition;
      /** Attach a file to its body (MEDIA-02/03). */
      readonly attach?: { readonly path: string };
    })
  | {
      readonly kind: 'list' | 'note';
      readonly ref: string;
      readonly name?: string;
      /** Into this group, or `null` out of its group. */
      readonly group?: string | null;
      readonly position?: SidebarPosition;
      /** LIST-04: convert. */
      readonly mode?: 'tasks' | 'note';
      /** LIST-01: a copy (`<name> copy`) right below it. */
      readonly duplicate?: boolean;
      /** TASK-06: done tasks to the Archived tab. */
      readonly archiveDone?: boolean;
      /** NOTE-08: a quick note kept as a note with this name. */
      readonly keep?: { readonly name: string };
      /** A note's text: added at the end. */
      readonly append?: string;
      /** A note's text: an exact passage (it must occur once) replaced. */
      readonly replace?: { readonly find: string; readonly with: string };
      /** A note's whole text. */
      readonly text?: string;
      readonly attach?: { readonly path: string };
    }
  | {
      readonly kind: 'group';
      readonly ref: string;
      readonly name?: string;
      readonly addLists?: readonly string[];
      readonly removeLists?: readonly string[];
      readonly position?: SidebarPosition;
    };

export interface UpdateArgs {
  readonly items: readonly UpdateItem[];
  readonly parseShorthand?: boolean;
}

// ─── delete ──────────────────────────────────────────────────────────────────────────────────────

export interface DeleteItem {
  readonly ref: string;
  readonly kind?: ItemKind;
  readonly in?: string;
}

export interface DeleteArgs {
  readonly items: readonly DeleteItem[];
}

// ─── link patterns (NOTE-07) ─────────────────────────────────────────────────────────────────────

export interface LinkPatternOut {
  /** Its position, for edit and delete (also accepted: its short form). */
  readonly index: number;
  readonly short: string;
  readonly url: string;
  readonly kinds?: Readonly<Record<string, 'digits' | 'word'>>;
}

export type LinkPatternsArgs =
  | { readonly action: 'list' }
  | {
      readonly action: 'add';
      readonly short: string;
      readonly url: string;
      readonly kinds?: Readonly<Record<string, 'digits' | 'word'>>;
    }
  | {
      readonly action: 'edit';
      /** Its index or its short form as it is now. */
      readonly ref: string | number;
      readonly short?: string;
      readonly url?: string;
      readonly kinds?: Readonly<Record<string, 'digits' | 'word'>>;
    }
  | { readonly action: 'delete'; readonly ref: string | number };

// ─── what a write answers ────────────────────────────────────────────────────────────────────────

export interface Changed {
  readonly kind: ItemKind;
  readonly id: string;
  readonly name: string;
  /** What happened: `added`, `edited`, `completed`, `moved`, `deleted`… */
  readonly what: string;
  readonly list?: { readonly id: string; readonly name: string };
  readonly reminder?: ReminderInfo;
}

export interface WriteResult {
  readonly changed: readonly Changed[];
  /** One plain sentence per item, for the CLI's default output. */
  readonly text: readonly string[];
  /** The change's entry in Recent agent changes (AGENT-07). */
  readonly change?: string;
}

/** For `linkPatterns`. */
export interface LinkPatternsResult {
  readonly patterns: readonly LinkPatternOut[];
  readonly text: readonly string[];
}
