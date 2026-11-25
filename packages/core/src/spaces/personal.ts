/**
 * SPACE-09 (D-189 decision 3, D-190 Q10, Q22; docs/04 §9 "Personal fields in shared lists"): a
 * shared list's tasks carry **your** `reminder`, `muted` and `pinned` in your local file, as any
 * list does, but the shared copy never has them. `splitPersonal` takes them out of every task that
 * has an ID (the shared copy) and keeps them by that ID; `applyPersonal` puts them back on a shared
 * copy by ID (a task that is gone loses them; someone else's new task has none).
 *
 * A file-format change in all but name (docs/04 §9):
 * - a task's shared part never changes by being stripped and re-applied: your fields are taken out
 *   of, and put into, the line's own text, so the rest of it stays exactly as its writer wrote it
 *   (pinning someone else's task never rewrites their line); only when that can't be done safely is
 *   the line written canonically;
 * - a line without your fields keeps its text exactly;
 * - only tasks with an ID are split (Q22): a line without one (a checkbox typed into a note, one
 *   nested deeper than a subtask) is text Flint does nothing with, shared as written. A task list
 *   is saved by Flint before it is split (`prepareForSave`: every task gets its ID), so `unkeyed`
 *   counts the tasks that kept fields because they have none, for the caller to check.
 */
import { codeSpanRanges, rangeContaining } from '../format/code-spans.js';
import {
  documentMode,
  isProvisionalKey,
  type Block,
  type FlintDocument,
  type TaskNode,
} from '../format/document.js';
import type { FieldValue, FlintFields, RawField } from '../format/fields.js';
import { formatTaskLine, parseTaskLine, type TaskLine } from '../format/task-line.js';
import { formatLocalDateTime, type ParsedLocalDateTime } from '../time/local-datetime.js';

/** Your fields on a shared task (docs/04 §9): never in the space's copy. */
export const PERSONAL_KEYS = ['reminder', 'muted', 'pinned'] as const;
export type PersonalKey = (typeof PERSONAL_KEYS)[number];

/** Your fields on one task, as the file has them (their exact text kept in `raw`). */
export interface PersonalFields {
  readonly reminder?: FieldValue<ParsedLocalDateTime>;
  readonly muted?: FieldValue<true>;
  readonly pinned?: FieldValue<true>;
}

export interface PersonalSplit {
  /** The shared copy: every task with an ID without your fields; the rest as it was. */
  readonly shared: FlintDocument;
  /** Your fields by task ID (only tasks that have any). */
  readonly mine: ReadonlyMap<string, PersonalFields>;
  /** Tasks that kept your fields in the shared copy because they have no ID (see above). */
  readonly unkeyed: number;
}

function personalOf(fields: FlintFields): PersonalFields | null {
  const { reminder, muted, pinned } = fields;
  if (!reminder && !muted && !pinned) return null;
  return { ...(reminder && { reminder }), ...(muted && { muted }), ...(pinned && { pinned }) };
}

function withoutPersonal(fields: FlintFields): FlintFields {
  const { reminder: _r, muted: _m, pinned: _p, ...rest } = fields;
  void _r;
  void _m;
  void _p;
  return rest;
}

/** Each task, subtasks included, through `visit`; untouched nodes are kept as they were. */
function mapTasks(document: FlintDocument, visit: (node: TaskNode) => TaskNode): FlintDocument {
  const walk = (node: TaskNode): TaskNode => {
    const next = visit(node);
    const children = next.children.map((child) => (child.kind === 'task' ? walk(child) : child));
    return children.some((child, index) => child !== next.children[index])
      ? { ...next, children }
      : next;
  };
  let changed = false;
  const blocks = document.blocks.map((block: Block) => {
    if (block.kind !== 'task') return block;
    const next = walk(block);
    if (next !== block) changed = true;
    return next;
  });
  return changed ? { ...document, blocks } : document;
}

const keyed = (node: TaskNode): boolean => !isProvisionalKey(node.key);

const lineText = (node: TaskNode): string => node.raw ?? formatTaskLine(node.line);

function sameValue(
  a: FieldValue<unknown> | undefined,
  b: FieldValue<unknown> | undefined,
): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a.value) === JSON.stringify(b.value);
}

const FIELD_KEYS = ['reminder', 'muted', 'pinned', 'completion', 'priority', 'id'] as const;

/** The line `text` reads as, when that is exactly this task line (its content, fields and all). */
function readsAs(text: string, expected: TaskLine): TaskLine | null {
  const line = parseTaskLine(text);
  if (!line) return null;
  const same =
    line.indent === expected.indent &&
    line.marker === expected.marker &&
    line.status === expected.status &&
    line.title === expected.title &&
    line.blockId === expected.blockId &&
    JSON.stringify(line.unknown) === JSON.stringify(expected.unknown) &&
    FIELD_KEYS.every((key) => sameValue(line.fields[key], expected.fields[key]));
  return same ? line : null;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text a field has in a line: as written when read, otherwise Flint's form. */
function fieldText(key: PersonalKey, field: FieldValue<unknown>): RawField {
  if (field.raw) return field.raw;
  if (key === 'reminder')
    return { key, value: formatLocalDateTime((field.value as ParsedLocalDateTime).value) };
  return { key, value: 'true' };
}

/** At most this many places are tried per field (a line can't make the search slow, D-146). */
const MAX_PLACES = 4;

/**
 * `text` without one field (`[key:: value]` or `(key::value)`, not escaped, outside code spans,
 * keys and values in any case, `pinned` also as `today`) and the gap by it: one candidate per place
 * the field's text occurs, for the caller to keep the one that reads back right. The gap before it
 * is kept as it was (a tab stays a tab); none is left at the line's end.
 */
function cuts(text: string, key: PersonalKey, field: RawField): string[] {
  const keys = key === 'pinned' ? ['pinned', 'today', field.key] : [field.key];
  const names = [...new Set(keys)].map(escapeRegExp).join('|');
  const pattern = new RegExp(
    `(^|[^\\\\])([ \\t]?)[\\[(][ \\t]*(?:${names})[ \\t]*::[ \\t]*${escapeRegExp(field.value)}[ \\t]*[\\])]([ \\t]?)`,
    'iy',
  );
  const code = codeSpanRanges(text);
  const out: string[] = [];
  for (let from = 0; from < text.length && out.length < MAX_PLACES; from++) {
    pattern.lastIndex = from;
    const match = pattern.exec(text);
    if (!match) continue;
    const [whole, before = '', spaceBefore = '', spaceAfter = ''] = match;
    const start = match.index + before.length + spaceBefore.length;
    if (rangeContaining(start, code)) continue;
    const end = match.index + whole.length;
    const keep = spaceBefore !== '' && spaceAfter !== '' && end < text.length ? spaceBefore : '';
    out.push(text.slice(0, match.index) + before + keep + text.slice(end));
  }
  return out;
}

/** The shared line for a task with your fields: their text cut out, else written canonically. */
function stripLine(node: TaskNode, personal: PersonalFields): TaskNode {
  const expected: TaskLine = { ...node.line, fields: withoutPersonal(node.line.fields) };
  const fields = PERSONAL_KEYS.flatMap((key) => {
    const field = personal[key];
    return field ? [{ key, text: fieldText(key, field) }] : [];
  });
  // Each field cut at one of its places, until the line reads back as exactly the task without them.
  const search = (text: string, index: number): { text: string; line: TaskLine } | null => {
    const field = fields[index];
    if (!field) {
      const line = readsAs(text, expected);
      return line ? { text, line } : null;
    }
    for (const candidate of cuts(text, field.key, field.text)) {
      const found = search(candidate, index + 1);
      if (found) return found;
    }
    return null;
  };
  const found = search(lineText(node), 0);
  return found
    ? { ...node, line: found.line, raw: found.text }
    : { ...node, raw: null, line: expected };
}

/** Your fields put into a shared line's text before Flint's own fields, else canonically. */
function applyLine(node: TaskNode, personal: PersonalFields): TaskNode {
  const expected: TaskLine = { ...node.line, fields: { ...node.line.fields, ...personal } };
  const text = lineText(node);
  const added = PERSONAL_KEYS.flatMap((key) => {
    const field = personal[key];
    if (!field) return [];
    const { key: name, value } = fieldText(key, field);
    return [`[${name}:: ${value}]`];
  }).join(' ');
  // Before one of completion, priority or id as written (the earliest that reads back right: the
  // same text may also sit in the title), else before a block ID, else at the end.
  const code = codeSpanRanges(text);
  const places: number[] = [];
  for (const key of ['completion', 'priority', 'id'] as const) {
    const field = node.line.fields[key];
    if (!field?.raw) continue;
    const opener = new RegExp(
      `(^|[^\\\\])[\\[(][ \\t]*${escapeRegExp(field.raw.key)}[ \\t]*::`,
      'g',
    );
    for (const match of text.matchAll(opener)) {
      const at = match.index + (match[1] ?? '').length;
      if (!rangeContaining(at, code)) places.push(at);
      if (places.length >= MAX_PLACES * 3) break;
    }
  }
  if (node.line.blockId !== null) {
    const block = text.lastIndexOf(`^${node.line.blockId}`);
    if (block >= 0) places.push(block);
  }
  const candidates = [
    ...[...new Set(places)]
      .sort((a, b) => a - b)
      .map((at) => `${text.slice(0, at)}${added} ${text.slice(at)}`),
    `${text.replace(/[ \t]+$/, '')} ${added}`,
  ];
  for (const candidate of candidates) {
    const line = readsAs(candidate, expected);
    if (line) return { ...node, line, raw: candidate };
  }
  return { ...node, raw: null, line: expected };
}

/** The shared copy of a list and your fields in it, by task ID. */
export function splitPersonal(document: FlintDocument): PersonalSplit {
  const mine = new Map<string, PersonalFields>();
  let unkeyed = 0;
  const shared = mapTasks(document, (node) => {
    const personal = personalOf(node.line.fields);
    if (!personal) return node;
    if (!keyed(node)) {
      unkeyed++;
      return node;
    }
    mine.set(node.key, personal);
    return stripLine(node, personal);
  });
  return { shared, mine, unkeyed };
}

/**
 * Your fields put back on a shared copy by task ID. Anything personal the shared copy itself carries
 * (it comes from other people's Flint, D-190 Q11) is taken out first, so only yours are on it: on
 * a task with an ID, and in a task list also on one without (there it is a real task whose pin or
 * reminder would act on your PC; a member's Flint gives every task an ID before it shares a list).
 */
export function applyPersonal(
  shared: FlintDocument,
  mine: ReadonlyMap<string, PersonalFields>,
): FlintDocument {
  const tasksList = documentMode(shared) === 'tasks';
  return mapTasks(splitPersonal(shared).shared, (node) => {
    if (!keyed(node)) {
      const foreign = tasksList ? personalOf(node.line.fields) : null;
      return foreign ? stripLine(node, foreign) : node;
    }
    const personal = mine.get(node.key);
    return personal ? applyLine(node, personal) : node;
  });
}
