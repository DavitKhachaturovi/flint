/**
 * AGENT-03 (D-185 Q10): the six MCP tools. Their input schemas follow protocol.ts (FindArgs,
 * ReadArgs, CreateArgs, UpdateArgs, DeleteArgs, LinkPatternsArgs) exactly; their descriptions
 * carry examples and the rules agents trip on. Flint checks everything again (AGENT-01).
 */
import type { AgentTool } from '@flint/core/agents';

type Schema = Readonly<Record<string, unknown>>;

export interface McpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly annotations: {
    readonly title: string;
    readonly readOnlyHint: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint: false;
  };
  /** The agent API's tool it calls. */
  readonly tool: AgentTool;
  /** Listed while Flint is read-only. */
  readonly readOnly: boolean;
}

// ─── shared pieces ───────────────────────────────────────────────────────────────────────────────

const ref = (what: string): Schema => ({
  type: 'string',
  minLength: 1,
  description: `${what}: its ID (from flint_find or flint_read) or its exact name. Prefer the ID.`,
});
const ITEM_KIND = { type: 'string', enum: ['task', 'list', 'note', 'group'] } as const;
const PRIORITY = { type: 'string', enum: ['high', 'medium', 'low'] } as const;
const PRIORITY_OR_NULL = {
  type: ['string', 'null'],
  enum: ['high', 'medium', 'low', null],
  description: 'high, medium or low; null clears it.',
} as const;
const REMIND = {
  type: 'string',
  minLength: 1,
  description:
    'A phrase ("tomorrow 9:00", "fri 14", "in 2h", "14 nov 9:30"; a day alone is 10:00) or ISO 8601 ' +
    '("2026-11-14T09:00" is local time; with an offset or Z it is converted), or "none" to clear. ' +
    'English only; a past or unreadable time is bad_time and nothing changes.',
} as const;
const TITLE = { type: 'string', minLength: 1, maxLength: 1000 } as const;
const MARKDOWN = (what: string): Schema => ({
  type: 'string',
  description: `${what} (markdown, up to 1 MB).`,
});
const STATUS = { type: 'string', enum: ['open', 'done', 'all'] } as const;
const COUNT = { type: 'integer', minimum: 0 } as const;

const position = (what: string): Schema => ({
  description: `Where it goes: "top", "bottom", or {"after": ref} / {"before": ref} (${what}).`,
  anyOf: [
    { type: 'string', enum: ['top', 'bottom'] },
    {
      type: 'object',
      properties: { after: { type: 'string', minLength: 1 } },
      required: ['after'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { before: { type: 'string', minLength: 1 } },
      required: ['before'],
      additionalProperties: false,
    },
  ],
});
const TASK_POSITION = position(
  'a task in the same list and at the same level; default "top", as capture',
);
const SIDEBAR_POSITION = position("the sidebar's order");

const LINE_RANGE = {
  type: 'object',
  description: 'Lines from–to, 1-based and inclusive.',
  properties: { from: { type: 'integer', minimum: 1 }, to: { type: 'integer', minimum: 1 } },
  required: ['from', 'to'],
  additionalProperties: false,
} as const;

const ATTACH = {
  type: 'object',
  description:
    'Attach a file by its absolute path: up to 25 MB is copied into the Flint folder, bigger files are linked; programs and scripts are refused.',
  properties: { path: { type: 'string', minLength: 1 } },
  required: ['path'],
  additionalProperties: false,
} as const;

const KINDS = {
  type: 'object',
  description: 'What each {placeholder} matches: "digits" or "word".',
  additionalProperties: { type: 'string', enum: ['digits', 'word'] },
} as const;

const PARSE_SHORTHAND = {
  type: 'boolean',
  description:
    'Read capture shorthand in titles (!h, ##List, @fri 9). Off by default: use the explicit fields instead.',
} as const;

const batch = (item: Schema, max?: number): Schema => ({
  type: 'array',
  minItems: 1,
  ...(max === undefined ? {} : { maxItems: max }),
  items: item,
  description:
    'A batch: all or nothing. Any problem changes nothing and every problem is listed by index.',
});

const object = (properties: Record<string, unknown>, required: readonly string[] = []): Schema => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

// ─── the rules every description repeats where it matters ───────────────────────────────────────

const ACT_BY_ID =
  'Act by ID after a flint_find or flint_read. Names must be exact: more than one match is "ambiguous" (with candidates), none is "not_found" (with suggestions); Flint never guesses, so pick an ID and call again.';
const LIMITS =
  'Limits apply per request and per hour; "too_large" names the limit: split the work. "paused" and "read_only" are the user\'s to lift in Flint.';

const json = (value: unknown): string => JSON.stringify(value);

// ─── the six tools ───────────────────────────────────────────────────────────────────────────────

export const TOOLS: readonly McpTool[] = [
  {
    name: 'flint_find',
    title: 'Find in Flint',
    tool: 'find',
    readOnly: true,
    description: [
      "Search the user's Flint (a quick-capture notes and tasks app on this PC): tasks, task lists, notes and groups. Call it first.",
      'With no query it returns the overview: every list, note and group with open counts, Today\'s pinned tasks, upcoming and overdue reminders, and "now" (the local date and time).',
      'Fuzzy. Matches inside notes and task bodies come with a line number and a snippet: then flint_read that note with "lines".',
      'Every result carries IDs to act on. At most "limit" results (default 30, at most 100); "more" says there are more.',
      `Examples: ${json({})} (overview) · ${json({ query: 'login', type: 'task', status: 'open' })} · ${json({ remindBefore: 'fri 18:00', pinned: true })}`,
    ].join('\n'),
    inputSchema: object({
      query: { type: 'string', description: 'Words to look for. Empty or missing: the overview.' },
      type: { type: 'string', enum: ['task', 'list', 'note', 'group', 'any'] },
      in: ref('Only in this list or note'),
      status: { ...STATUS, description: 'Tasks: open, done or all.' },
      priority: PRIORITY,
      pinned: { type: 'boolean', description: 'Only tasks pinned to Today.' },
      remindBefore: {
        ...REMIND,
        description: 'Tasks whose reminder is before this time (a phrase or ISO).',
      },
      remindAfter: {
        ...REMIND,
        description: 'Tasks whose reminder is after this time (a phrase or ISO).',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }),
    annotations: {
      title: 'Find in Flint',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'flint_read',
    title: 'Read from Flint',
    tool: 'read',
    readOnly: true,
    description: [
      'Read 1–20 items by ID or exact name: a task list as its tasks in order with headings and paragraphs (open tasks by default, paged with limit/offset), a note as markdown, a task with its body, subtasks and who changed it, a group with its lists; also "Today", "Inbox" and "Reminders"; a list\'s Archived tab with "archived": true.',
      'Long notes: without "lines" you get about the first 200 lines or 8,000 characters with "truncated": true, "totalLines" and a hint. Read on by range ("lines": {"from": 200, "to": 400}), or get the headings with line numbers ("outline": true) and read only the section you need.',
      `Examples: ${json({ items: [{ ref: 'Today' }, { ref: 'k3f9a2' }] })} · ${json({ items: [{ ref: 'Meeting notes', outline: true }] })} · ${json({ items: [{ ref: 'Backend', status: 'all', limit: 50, offset: 50 }] })}`,
    ].join('\n'),
    inputSchema: object(
      {
        items: batch(
          object(
            {
              ref: ref('The item ("Today", "Inbox" and "Reminders" too)'),
              kind: { ...ITEM_KIND, description: 'Say which kind when a name is shared.' },
              in: ref('A task title narrowed to this list'),
              lines: LINE_RANGE,
              outline: {
                type: 'boolean',
                description: "A note's headings with their line numbers only.",
              },
              status: { ...STATUS, description: "A list's tasks: open (default), done or all." },
              limit: COUNT,
              offset: COUNT,
              archived: { type: 'boolean', description: "A list's Archived tab." },
            },
            ['ref'],
          ),
          20,
        ),
      },
      ['items'],
    ),
    annotations: {
      title: 'Read from Flint',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'flint_create',
    title: 'Create in Flint',
    tool: 'create',
    readOnly: false,
    description: [
      'Create tasks, subtasks, task lists, notes, quick notes and groups, as a batch.',
      'A task goes to Inbox unless "list" is given, at the top unless "position" says otherwise; "parent" makes it a subtask (one level only). Set priority, reminder ("remind"), "pinned" (Today) and "focus" (Focus\'s sprint) with their own fields: shorthand in titles is off unless "parseShorthand": true.',
      `${ACT_BY_ID} ${LIMITS}`,
      `Examples: ${json({ items: [{ kind: 'task', title: 'Fix login loop', list: 'Backend', priority: 'high', remind: 'tomorrow 9:00' }] })} · ${json({ items: [{ kind: 'task', title: 'Write tests', parent: 'k3f9a2', position: 'bottom' }] })} · ${json({ items: [{ kind: 'note', name: 'Meeting notes', group: 'Work', text: '# Agenda\n- Release' }] })}`,
    ].join('\n'),
    inputSchema: object(
      {
        items: batch({
          anyOf: [
            object(
              {
                kind: { const: 'task' },
                title: TITLE,
                list: ref('The list (default Inbox)'),
                parent: ref('Make it a subtask of this task'),
                position: TASK_POSITION,
                body: MARKDOWN("The task's body"),
                priority: PRIORITY_OR_NULL,
                remind: REMIND,
                muted: { type: 'boolean', description: 'Remind without sound.' },
                pinned: { type: 'boolean', description: 'Pinned to Today.' },
                focus: { type: 'boolean', description: "In Focus's sprint." },
              },
              ['kind', 'title'],
            ),
            object(
              {
                kind: { type: 'string', enum: ['list', 'note'] },
                name: TITLE,
                group: ref('Its group'),
                text: MARKDOWN("A note's text"),
              },
              ['kind', 'name'],
            ),
            object({ kind: { const: 'quickNote' }, text: MARKDOWN('Its text') }, ['kind']),
            object(
              {
                kind: { const: 'group' },
                name: TITLE,
                lists: {
                  type: 'array',
                  items: { type: 'string', minLength: 1 },
                  description: 'Lists and notes to put in it.',
                },
              },
              ['kind', 'name'],
            ),
          ],
        }),
        parseShorthand: PARSE_SHORTHAND,
      },
      ['items'],
    ),
    annotations: {
      title: 'Create in Flint',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'flint_update',
    title: 'Change in Flint',
    tool: 'update',
    readOnly: false,
    description: [
      'Change tasks, lists, notes and groups, as a batch.',
      'Tasks (no "kind" needed): title, body, priority (null clears), "remind" (also to snooze; "none" clears), muted, pinned, focus, "done", "moveTo" another list, "parent" (null outdents), "position" to reorder, "attach" a file.',
      'Lists and notes ("kind": "list" or "note"): name, group (null: out of its group), sidebar "position", "mode" to convert, "duplicate", "archiveDone", a quick note\'s "keep" with its name, "attach". A note\'s text: prefer "append" (added at the end) or "replace" (an exact passage that must occur once) to resending the whole "text"; read long notes by range first.',
      'Groups ("kind": "group"): name, addLists, removeLists, position.',
      `${ACT_BY_ID} ${LIMITS}`,
      `Examples: ${json({
        items: [
          { ref: 'k3f9a2', done: true },
          { ref: 'p7d1x0', remind: 'mon 10:00' },
        ],
      })} · ${json({ items: [{ kind: 'note', ref: 'Meeting notes', append: '\n- Decided: ship on Monday' }] })} · ${json({ items: [{ kind: 'list', ref: 'Backend', group: 'Work', position: 'top' }] })}`,
    ].join('\n'),
    inputSchema: object(
      {
        items: batch({
          anyOf: [
            object(
              {
                kind: { const: 'task' },
                ref: ref('The task'),
                in: ref('A task title narrowed to this list'),
                title: TITLE,
                body: MARKDOWN("The task's body"),
                priority: PRIORITY_OR_NULL,
                remind: REMIND,
                muted: { type: 'boolean' },
                pinned: { type: 'boolean', description: 'Pinned to Today.' },
                focus: { type: 'boolean', description: "In Focus's sprint." },
                done: { type: 'boolean' },
                moveTo: ref('Move it to the top of this list'),
                parent: {
                  type: ['string', 'null'],
                  minLength: 1,
                  description:
                    'Make it a subtask of this task (ID or exact title), or null to outdent it.',
                },
                position: TASK_POSITION,
                attach: ATTACH,
              },
              ['ref'],
            ),
            object(
              {
                kind: { type: 'string', enum: ['list', 'note'] },
                ref: ref('The list or note'),
                name: TITLE,
                group: {
                  type: ['string', 'null'],
                  minLength: 1,
                  description: 'Into this group, or null out of its group.',
                },
                position: SIDEBAR_POSITION,
                mode: { type: 'string', enum: ['tasks', 'note'], description: 'Convert it.' },
                duplicate: {
                  type: 'boolean',
                  description: 'A copy ("<name> copy") right below it.',
                },
                archiveDone: {
                  type: 'boolean',
                  description: 'Move its done tasks to the Archived tab.',
                },
                keep: object({ name: TITLE }, ['name']),
                append: { type: 'string', description: "Text added at the end of a note's text." },
                replace: object(
                  {
                    find: {
                      type: 'string',
                      minLength: 1,
                      description: 'An exact passage; it must occur once.',
                    },
                    with: { type: 'string' },
                  },
                  ['find', 'with'],
                ),
                text: MARKDOWN("A note's whole new text"),
                attach: ATTACH,
              },
              ['kind', 'ref'],
            ),
            object(
              {
                kind: { const: 'group' },
                ref: ref('The group'),
                name: TITLE,
                addLists: { type: 'array', items: { type: 'string', minLength: 1 } },
                removeLists: { type: 'array', items: { type: 'string', minLength: 1 } },
                position: SIDEBAR_POSITION,
              },
              ['kind', 'ref'],
            ),
          ],
        }),
        parseShorthand: PARSE_SHORTHAND,
      },
      ['items'],
    ),
    annotations: {
      title: 'Change in Flint',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'flint_delete',
    title: 'Delete in Flint',
    tool: 'delete',
    readOnly: false,
    description: [
      "Move tasks, lists, notes or groups to Flint's Trash, as a batch (a group's lists stay). The user can restore them; agents can't.",
      `${ACT_BY_ID} ${LIMITS}`,
      `Examples: ${json({ items: [{ ref: 'k3f9a2' }] })} · ${json({ items: [{ ref: 'Old idea', kind: 'task', in: 'Inbox' }] })} · ${json({ items: [{ ref: 'l8c2m4', kind: 'list' }] })}`,
    ].join('\n'),
    inputSchema: object(
      {
        items: batch(
          object(
            {
              ref: ref('The item'),
              kind: ITEM_KIND,
              in: ref('A task title narrowed to this list'),
            },
            ['ref'],
          ),
        ),
      },
      ['items'],
    ),
    annotations: {
      title: 'Delete in Flint',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'flint_link_patterns',
    title: 'Link patterns in Flint',
    tool: 'linkPatterns',
    readOnly: false,
    description: [
      'List, add, change or delete link patterns (Settings → Links): a short form such as ACME-{id} that Flint turns into a link.',
      '"action": "list" | "add" (short, url, optional kinds) | "edit" (ref, then any of short, url, kinds) | "delete" (ref). "ref" is the pattern\'s index from "list" or its short form as it is now. Checked as Settings → Links does.',
      `Examples: ${json({ action: 'list' })} · ${json({ action: 'add', short: 'ACME-{id}', url: 'https://tracker.example/browse/ACME-{id}', kinds: { id: 'digits' } })} · ${json({ action: 'delete', ref: 2 })}`,
    ].join('\n'),
    inputSchema: object(
      {
        action: { type: 'string', enum: ['list', 'add', 'edit', 'delete'] },
        ref: {
          type: ['string', 'integer'],
          description: 'edit and delete: its index (from list) or its short form as it is now.',
        },
        short: {
          type: 'string',
          minLength: 1,
          description: 'add, edit: the short form, with {placeholders}.',
        },
        url: {
          type: 'string',
          minLength: 1,
          description: 'add, edit: the URL, with the same {placeholders}.',
        },
        kinds: KINDS,
      },
      ['action'],
    ),
    annotations: {
      title: 'Link patterns in Flint',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

export const toolByName = (name: string): McpTool | undefined =>
  TOOLS.find((tool) => tool.name === name);

/** What `tools/list` shows: only find and read while Flint is read-only (AGENT-03). */
export const listedTools = (readOnly: boolean): readonly McpTool[] =>
  readOnly ? TOOLS.filter((tool) => tool.readOnly) : TOOLS;

/** A tool as `tools/list` returns it (without the client-side fields). */
export const describeTool = (tool: McpTool): Record<string, unknown> => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: tool.annotations,
});
