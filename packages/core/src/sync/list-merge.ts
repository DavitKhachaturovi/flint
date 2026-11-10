/**
 * Three-way merge of task lists, per task by ID (SYNC-01, D-161 Q2 and Q4, docs/04 §7).
 *
 * Several lists are merged together, because a task can move between lists: each task's place is
 * decided once, across all of them (moved on one PC and edited on the other: it moves, with the
 * edit). Per task: done wins when both PCs changed it; priority, reminder, muted and pinned by the
 * later `lastTouched`; a title changed on both keeps the other as the body's first line; the body
 * merges as text; edited beats deleted; the later move wins. Lines nobody changed stay byte for byte.
 */
import {
  documentLines,
  parseDocument,
  serializeDocument,
  type Block,
  type FlintDocument,
  type OtherBlock,
  type TaskNode,
  type TextChunk,
} from '../format/document.js';
import { flintField, type FlintFields } from '../format/fields.js';
import { generateId } from '../format/ids.js';
import type { Line } from '../format/lines.js';
import { formatTaskLine, isCompletedStatus, type TaskLine } from '../format/task-line.js';
import { childIndent, shiftTask } from '../model/tree.js';
import type { ConflictLabels } from './conflict.js';
import { mergeLines } from './text-merge.js';

/** One list as each side has it; null where that side doesn't have the list. */
export interface ListVersions {
  readonly listId: string;
  readonly base: string | null;
  readonly mine: string | null;
  readonly theirs: string | null;
}

export interface ListsMergeContext {
  /** This PC's name (conflict callouts, "Other version (…)"). */
  readonly mineDevice: string;
  /** The PC that wrote the other side's version of a list. */
  readonly theirsDevice: (listId: string) => string;
  /** When the other side's version was written, as shown in callouts (`10 Nov 14:02`). */
  readonly when: (listId: string) => string;
  /** A task's `lastTouched` on a side (already clamped, D-161 Q4), in ms; null when unknown. */
  readonly touched: (side: 'mine' | 'theirs', key: string) => number | null;
  /** Whether a task ID is taken anywhere in the Flint folder (for re-IDing a collision). */
  readonly isTaken: (id: string) => boolean;
  readonly random?: () => number;
}

export interface TrashedTask {
  /** The list this PC had the task in. */
  readonly listId: string;
  readonly node: TaskNode;
}

export interface ListsMergeResult {
  /** The merged text per list (every list passed in that still has a side). */
  readonly texts: ReadonlyMap<string, string>;
  /** Conflict callouts added, per list. */
  readonly conflicts: ReadonlyMap<string, number>;
  /** Tasks this PC had that the other side deleted (to this PC's Trash). */
  readonly trashed: readonly TrashedTask[];
  /** Incoming tasks whose IDs collided with a different task here, re-IDed: old → new. */
  readonly reIded: ReadonlyMap<string, string>;
}

interface Found {
  readonly list: string;
  /** Parent task's key, null at the top level. */
  readonly parent: string | null;
  readonly node: TaskNode;
}

interface Target {
  readonly list: string;
  readonly parent: string | null;
  /** Whose sequence places it: kept where this PC has it, or inserted where the other side has it. */
  readonly place: 'mine' | 'theirs';
}

const OTHER = 'o:';

/** Keys for the top-level blocks of a document: task keys, and content keys for other blocks. */
function blockKeys(blocks: readonly Block[]): string[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    if (block.kind === 'task') return block.key;
    if (block.completedHeading) return `${OTHER}completed`;
    const content = block.lines.map((line) => line.text).join('\n');
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    return `${OTHER}${content}#${occurrence}`;
  });
}

function subtaskKeys(node: TaskNode): string[] {
  return node.children.flatMap((child) => (child.kind === 'task' ? [child.key] : []));
}

function lineText(node: TaskNode): string {
  return node.raw ?? formatTaskLine(node.line);
}

function bodyLines(node: TaskNode): Line[] {
  return node.children.flatMap((child) => (child.kind === 'text' ? child.lines : []));
}

/** The task without its subtasks or place: what "changed" means for its content. */
function contentOf(node: TaskNode): string {
  return [lineText(node).trim(), ...bodyLines(node).map((line) => line.text)].join('\n');
}

/** A task with its subtasks, for "the same task" (an ID collision or not). */
function wholeOf(node: TaskNode): string {
  return [
    contentOf(node),
    ...node.children.flatMap((child) => (child.kind === 'task' ? [wholeOf(child)] : [])),
  ].join('\n');
}

class Index {
  readonly tasks = new Map<string, Found>();
  readonly docs = new Map<string, FlintDocument>();

  /**
   * Adds a list. A task ID another list on the same side already has (an Explorer copy, D-23) is
   * kept apart under its own key, so a duplicate is never merged away; its text is unchanged.
   */
  add(list: string, input: FlintDocument): void {
    const own = (node: TaskNode): TaskNode => {
      const known = this.tasks.get(node.key);
      const key = known && known.list !== list ? `${node.key}\u0000${list}` : node.key;
      const children = node.children.map((child) => (child.kind === 'task' ? own(child) : child));
      return key === node.key && children.every((child, at) => child === node.children[at])
        ? node
        : { ...node, key, children };
    };
    const document: FlintDocument = {
      ...input,
      blocks: input.blocks.map((block) => (block.kind === 'task' ? own(block) : block)),
    };
    this.docs.set(list, document);
    for (const block of document.blocks) {
      if (block.kind !== 'task') continue;
      this.tasks.set(block.key, { list, parent: null, node: block });
      for (const child of block.children) {
        if (child.kind === 'task')
          this.tasks.set(child.key, { list, parent: block.key, node: child });
      }
    }
  }

  /** The keys of the siblings around a task (top-level blocks, or a parent's subtasks). */
  siblings(list: string, parent: string | null): string[] {
    const document = this.docs.get(list);
    if (!document) return [];
    if (parent === null) return blockKeys(document.blocks);
    const found = this.tasks.get(parent);
    return found && found.list === list ? subtaskKeys(found.node) : [];
  }
}

/**
 * The nearest sibling before `key` that both sequences have: a task "moved" only when this changes,
 * so tasks added or deleted around it don't count as moves.
 */
function stablePredecessor(
  sequence: readonly string[],
  key: string,
  shared: ReadonlySet<string>,
): string | null {
  const index = sequence.indexOf(key);
  for (let at = index - 1; at >= 0; at--) {
    const candidate = sequence[at] as string;
    if (shared.has(candidate)) return candidate;
  }
  return null;
}

function moved(index: Index, base: Index, key: string): boolean {
  const now = index.tasks.get(key);
  const was = base.tasks.get(key);
  if (!now || !was) return false;
  if (now.list !== was.list || now.parent !== was.parent) return true;
  const here = index.siblings(now.list, now.parent);
  const there = base.siblings(was.list, was.parent);
  const inHere = new Set(here);
  const shared = new Set(there.filter((candidate) => inHere.has(candidate)));
  return stablePredecessor(here, key, shared) !== stablePredecessor(there, key, shared);
}

/** Picks between two sides by the base: the side that changed, or `conflict` when both did. */
function pick<T>(
  base: T | undefined,
  mine: T,
  theirs: T,
  same: (a: T, b: T) => boolean,
): 'mine' | 'theirs' | 'conflict' {
  if (same(mine, theirs)) return 'mine';
  if (base !== undefined && same(base, mine)) return 'theirs';
  if (base !== undefined && same(base, theirs)) return 'mine';
  return 'conflict';
}

function fieldText(fields: FlintFields, key: keyof FlintFields): string {
  const field = fields[key];
  if (!field) return '';
  return field.raw ? field.raw.value : JSON.stringify(field.value);
}

interface MergedContent {
  readonly line: TaskLine;
  readonly raw: string | null;
  /** Body lines (indented as children); null keeps the template's own text children. */
  readonly body: Line[] | null;
  readonly conflicts: number;
}

/** Merges a task's line and body (not its subtasks or place). */
function mergeContent(
  base: TaskNode | undefined,
  mine: TaskNode,
  theirs: TaskNode,
  document: FlintDocument,
  labels: ConflictLabels,
  later: 'mine' | 'theirs',
): MergedContent {
  const choose = (choice: 'mine' | 'theirs' | 'conflict'): 'mine' | 'theirs' =>
    choice === 'conflict' ? later : choice;
  const same = (a: string, b: string): boolean => a === b;
  let fromTheirs = false;
  let fromMine = false;
  const note = (side: 'mine' | 'theirs'): void => {
    if (side === 'theirs') fromTheirs = true;
    else fromMine = true;
  };

  // Completion: by the base; when both PCs changed the task and disagree, done wins (Q4).
  const doneOf = (node: TaskNode): string =>
    isCompletedStatus(node.line.status) ? 'done' : 'open';
  const bothChanged =
    base !== undefined &&
    contentOf(mine) !== contentOf(base) &&
    contentOf(theirs) !== contentOf(base);
  let statusSide: 'mine' | 'theirs';
  const statusChoice = pick(base && doneOf(base), doneOf(mine), doneOf(theirs), same);
  if (bothChanged && doneOf(mine) !== doneOf(theirs)) {
    statusSide = doneOf(mine) === 'done' ? 'mine' : 'theirs';
  } else {
    statusSide = choose(statusChoice);
  }
  if (doneOf(mine) !== doneOf(theirs)) note(statusSide);
  const statusNode = statusSide === 'mine' ? mine : theirs;

  const fields: { -readonly [K in keyof FlintFields]?: FlintFields[K] | undefined } = {
    ...mine.line.fields,
  };
  for (const key of ['priority', 'reminder', 'muted', 'pinned'] as const) {
    const side = choose(
      pick(
        base && fieldText(base.line.fields, key),
        fieldText(mine.line.fields, key),
        fieldText(theirs.line.fields, key),
        same,
      ),
    );
    if (fieldText(mine.line.fields, key) !== fieldText(theirs.line.fields, key)) note(side);
    const chosen = (side === 'mine' ? mine : theirs).line.fields;
    if (key === 'priority') fields.priority = chosen.priority;
    else if (key === 'reminder') fields.reminder = chosen.reminder;
    else if (key === 'muted') fields.muted = chosen.muted;
    else fields.pinned = chosen.pinned;
  }
  fields.completion = statusNode.line.fields.completion;
  if (fieldText(mine.line.fields, 'completion') !== fieldText(statusNode.line.fields, 'completion'))
    fromTheirs = true;
  for (const key of Object.keys(fields) as (keyof FlintFields)[])
    if (fields[key] === undefined) delete fields[key];

  const extrasOf = (node: TaskNode): string =>
    JSON.stringify([node.line.unknown, node.line.blockId]);
  const extrasSide = choose(pick(base && extrasOf(base), extrasOf(mine), extrasOf(theirs), same));
  if (extrasOf(mine) !== extrasOf(theirs)) note(extrasSide);
  const extras = extrasSide === 'mine' ? mine.line : theirs.line;

  const titleChoice = pick(base?.line.title, mine.line.title, theirs.line.title, same);
  const titleSide = choose(titleChoice);
  if (mine.line.title !== theirs.line.title) note(titleSide);
  const title = (titleSide === 'mine' ? mine : theirs).line.title;
  const otherTitle =
    titleChoice === 'conflict'
      ? {
          device: titleSide === 'mine' ? labels.theirs : labels.mine,
          title: (titleSide === 'mine' ? theirs : mine).line.title,
        }
      : null;

  const line: TaskLine = {
    ...mine.line,
    status: statusNode.line.status,
    title,
    fields: fields as FlintFields,
    unknown: extras.unknown,
    blockId: extras.blockId,
  };
  const raw = !fromTheirs
    ? mine.raw
    : !fromMine && theirs.line.indent === mine.line.indent
      ? theirs.raw
      : null;

  // The body: as text, with this PC's indentation for the lines it writes.
  const indent = childIndent(document, mine);
  const strip = (lines: readonly Line[]): string[] =>
    lines.map((entry) =>
      entry.text.startsWith(indent) ? entry.text.slice(indent.length) : entry.text,
    );
  const mineBody = bodyLines(mine);
  const theirBody = bodyLines(theirs);
  const sameBody =
    mineBody.length === theirBody.length &&
    mineBody.every((entry, at) => entry.text === theirBody[at]?.text);
  let body: Line[] | null = null;
  let conflicts = 0;
  if (!sameBody || otherTitle) {
    const merged = sameBody
      ? { lines: strip(mineBody), conflicts: 0 }
      : mergeLines(base ? strip(bodyLines(base)) : null, strip(mineBody), strip(theirBody), labels);
    conflicts = merged.conflicts;
    const texts = otherTitle
      ? [`Other version (${otherTitle.device}): ${otherTitle.title}`, ...merged.lines]
      : merged.lines;
    // Untouched trailing blank lines stay where they were.
    body = texts.map((text) => ({ text: text === '' ? '' : indent + text, eol: document.eol }));
    if (!otherTitle && merged.conflicts === 0 && sameLinesAs(body, theirBody)) body = theirBody;
    if (!otherTitle && merged.conflicts === 0 && sameLinesAs(body, mineBody)) body = null;
  }
  return { line, raw, body, conflicts };
}

function sameLinesAs(a: readonly Line[], b: readonly Line[]): boolean {
  return a.length === b.length && a.every((entry, at) => entry.text === b[at]?.text);
}

/** Sets a new ID on a task (an incoming collision). */
function withId(node: TaskNode, id: string): TaskNode {
  return {
    ...node,
    key: id,
    raw: null,
    line: { ...node.line, fields: { ...node.line.fields, id: flintField(id) } },
  };
}

function parse(text: string, listId: string): FlintDocument {
  return parseDocument(text, { keySeed: listId });
}

/**
 * Merges task lists. Every list passed in comes back merged (its text unchanged where nothing
 * changed); a task's content and place are decided across all of them.
 */
export function mergeTaskLists(
  versions: readonly ListVersions[],
  context: ListsMergeContext,
): ListsMergeResult {
  const base = new Index();
  const mine = new Index();
  const theirs = new Index();
  for (const version of versions) {
    if (version.base !== null) base.add(version.listId, parse(version.base, version.listId));
    if (version.mine !== null) mine.add(version.listId, parse(version.mine, version.listId));
  }

  // Incoming tasks whose ID this PC uses for a different task (never in the base): new IDs.
  const reIded = new Map<string, string>();
  const created = new Set<string>();
  const taken = (id: string): boolean =>
    created.has(id) || mine.tasks.has(id) || base.tasks.has(id) || context.isTaken(id);
  const incoming = new Index();
  for (const version of versions) {
    if (version.theirs !== null)
      incoming.add(version.listId, parse(version.theirs, version.listId));
  }
  for (const [listId, input] of incoming.docs) {
    const rename = (node: TaskNode): TaskNode => {
      let next = node;
      const here = mine.tasks.get(node.key);
      if (
        !base.tasks.has(node.key) &&
        here &&
        wholeOf(here.node) !== wholeOf(node) &&
        !node.key.startsWith('~')
      ) {
        const id = generateId(taken, context.random);
        created.add(id);
        reIded.set(node.key.split('\u0000')[0] as string, id);
        next = withId(node, id);
      }
      const children = next.children.map((child) =>
        child.kind === 'task' ? rename(child) : child,
      );
      return children.some((child, at) => child !== next.children[at])
        ? { ...next, children }
        : next;
    };
    theirs.add(listId, {
      ...input,
      blocks: input.blocks.map((block) => (block.kind === 'task' ? rename(block) : block)),
    });
  }

  // Where each task ends up (Q4): the side that moved it; both: the later; deleted unless edited.
  const targets = new Map<string, Target>();
  const trashed: TrashedTask[] = [];
  const keys = new Set([...base.tasks.keys(), ...mine.tasks.keys(), ...theirs.tasks.keys()]);
  const later = (key: string): 'mine' | 'theirs' =>
    (context.touched('theirs', key) ?? 0) > (context.touched('mine', key) ?? 0) ? 'theirs' : 'mine';
  for (const key of keys) {
    const b = base.tasks.get(key);
    const m = mine.tasks.get(key);
    const t = theirs.tasks.get(key);
    const at = (found: Found, place: 'mine' | 'theirs'): Target => ({
      list: found.list,
      parent: found.parent,
      place,
    });
    if (!b) {
      if (m) targets.set(key, at(m, 'mine'));
      else if (t) targets.set(key, at(t, 'theirs'));
      continue;
    }
    const mineChanged =
      m !== undefined && (contentOf(m.node) !== contentOf(b.node) || moved(mine, base, key));
    const theirChanged =
      t !== undefined && (contentOf(t.node) !== contentOf(b.node) || moved(theirs, base, key));
    if (!m && !t) continue;
    if (!m) {
      // Deleted here; the other side's edit brings it back (edited beats deleted).
      if (t && theirChanged) targets.set(key, at(t, 'theirs'));
      continue;
    }
    if (!t) {
      if (mineChanged) targets.set(key, at(m, 'mine'));
      else trashed.push({ listId: m.list, node: m.node });
      continue;
    }
    const mineMoved = moved(mine, base, key);
    const theirMoved = moved(theirs, base, key);
    if (theirMoved && (!mineMoved || later(key) === 'theirs')) targets.set(key, at(t, 'theirs'));
    else targets.set(key, at(m, 'mine'));
  }
  // A subtask whose parent goes elsewhere or away goes to the top level of its target list.
  for (const [key, target] of targets) {
    if (target.parent === null) continue;
    const parent = targets.get(target.parent);
    if (!parent || parent.list !== target.list || parent.parent !== null) {
      targets.set(key, { ...target, parent: null });
    }
  }

  const texts = new Map<string, string>();
  const conflicts = new Map<string, number>();
  for (const version of versions) {
    const list = version.listId;
    const mineDoc = mine.docs.get(list);
    const theirDoc = theirs.docs.get(list);
    const baseDoc = base.docs.get(list);
    const skeleton = mineDoc ?? theirDoc;
    if (!skeleton) continue;
    const labels: ConflictLabels = {
      mine: context.mineDevice,
      theirs: context.theirsDevice(list),
      when: context.when(list),
    };
    let count = 0;

    /** The merged node for a key, subtasks as given. */
    const content = (key: string, children: (TextChunk | TaskNode)[], indent: string): TaskNode => {
      const target = targets.get(key) as Target;
      const m = mine.tasks.get(key)?.node;
      const t = theirs.tasks.get(key)?.node;
      const b = base.tasks.get(key)?.node;
      const template = (target.place === 'mine' ? m : t) ?? m ?? t;
      if (!template) throw new Error(`no version of task ${key}`);
      let node: TaskNode;
      if (m && t && contentOf(m) !== contentOf(t)) {
        const document = mine.docs.get(mine.tasks.get(key)?.list ?? list) ?? skeleton;
        const merged = mergeContent(b, m, t, document, labels, later(key));
        count += merged.conflicts;
        const text: TextChunk[] =
          merged.body === null
            ? m.children.filter((child): child is TextChunk => child.kind === 'text')
            : merged.body.length > 0
              ? [{ kind: 'text', lines: merged.body }]
              : [];
        node = {
          ...m,
          line: merged.line,
          raw: merged.raw,
          children: [...text, ...children.filter((child) => child.kind === 'task')],
        };
      } else {
        const own = template.children.filter((child): child is TextChunk => child.kind === 'text');
        node = {
          ...template,
          children: [...own, ...children.filter((child) => child.kind === 'task')],
        };
      }
      return node.line.indent === indent ? node : shiftTask(node, node.line.indent, indent);
    };

    /** The merged order of one sequence: this PC's, minus what left, plus what came. */
    const order = (
      mineSeq: readonly string[],
      theirSeq: readonly string[],
      baseSeq: readonly string[],
      parent: string | null,
    ): string[] => {
      const belongs = (key: string, place: 'mine' | 'theirs'): boolean => {
        if (key.startsWith(OTHER)) return false;
        const target = targets.get(key);
        return (
          target !== undefined &&
          target.list === list &&
          target.parent === parent &&
          target.place === place
        );
      };
      const theirSet = new Set(theirSeq);
      const baseSet = new Set(baseSeq);
      const mineSet = new Set(mineSeq);
      const result = mineSeq.filter((key) =>
        key.startsWith(OTHER)
          ? // Other text the other side removed goes; the rest stays.
            !(baseSet.has(key) && !theirSet.has(key))
          : belongs(key, 'mine'),
      );
      for (let at = 0; at < theirSeq.length; at++) {
        const key = theirSeq[at] as string;
        const incoming = key.startsWith(OTHER)
          ? !baseSet.has(key) && !mineSet.has(key)
          : belongs(key, 'theirs') && !result.includes(key);
        if (!incoming) continue;
        let anchor = -1;
        for (let back = at - 1; back >= 0; back--) {
          const found = result.indexOf(theirSeq[back] as string);
          if (found >= 0) {
            anchor = found;
            break;
          }
        }
        result.splice(anchor + 1, 0, key);
      }
      // Tasks that belong here but neither sequence has (a subtask whose parent left): at the end.
      for (const [key, target] of targets) {
        if (target.list === list && target.parent === parent && !result.includes(key))
          result.push(key);
      }
      return result;
    };

    const otherBlocks = new Map<string, OtherBlock>();
    const collect = (document: FlintDocument | undefined): void => {
      if (!document) return;
      const keysOf = blockKeys(document.blocks);
      document.blocks.forEach((block, at) => {
        const key = keysOf[at] as string;
        if (block.kind === 'other' && !otherBlocks.has(key)) otherBlocks.set(key, block);
      });
    };
    collect(mineDoc);
    collect(theirDoc);

    const top = order(
      mineDoc ? blockKeys(mineDoc.blocks) : [],
      theirDoc ? blockKeys(theirDoc.blocks) : [],
      baseDoc ? blockKeys(baseDoc.blocks) : [],
      null,
    );
    const subtaskSeq = (index: Index, key: string): string[] => {
      const found = index.tasks.get(key);
      return found && found.list === list ? subtaskKeys(found.node) : [];
    };
    const blocks: Block[] = top.map((key) => {
      if (key.startsWith(OTHER)) return otherBlocks.get(key) as OtherBlock;
      const subtasks = order(
        subtaskSeq(mine, key),
        subtaskSeq(theirs, key),
        subtaskSeq(base, key),
        key,
      );
      const head = content(key, [], '');
      const indent = childIndent(skeleton, head);
      const children = subtasks.map((sub) => content(sub, [], indent));
      return { ...head, children: [...head.children, ...children] };
    });
    const merged: FlintDocument = { ...skeleton, blocks };
    const text = serializeDocument(merged);
    // Nothing changed for this PC: its own text, byte for byte.
    texts.set(
      list,
      mineDoc && version.mine !== null && sameText(merged, mineDoc) ? version.mine : text,
    );
    conflicts.set(list, count);
  }
  return { texts, conflicts, trashed, reIded };
}

function sameText(a: FlintDocument, b: FlintDocument): boolean {
  const left = documentLines(a);
  const right = documentLines(b);
  return left.length === right.length && left.every((line, at) => line.text === right[at]?.text);
}
