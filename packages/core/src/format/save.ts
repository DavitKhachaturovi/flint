import type { LocalDateTime } from '../time/local-datetime.js';
import type { Block, FlintDocument, Frontmatter, TaskNode } from './document.js';
import { flintField, localDateTimeField } from './fields.js';
import { generateId } from './ids.js';
import type { Line } from './lines.js';
import { isCompletedStatus } from './task-line.js';

export interface SaveContext {
  /** Local time of the save, stamped as `completion` on tasks checked outside Flint. */
  readonly now: LocalDateTime;
  /** Whether an ID is already used anywhere in the Flint folder (lists, notes, archive, Trash). */
  readonly isTaken: (id: string) => boolean;
  /** IDs this file must replace because an older file has them too (D-23). */
  readonly replaceIds?: ReadonlySet<string>;
  readonly random?: () => number;
}

export interface SaveResult {
  readonly document: FlintDocument;
  /** Task keys that changed: provisional key or replaced ID → new ID. */
  readonly renamed: ReadonlyMap<string, string>;
}

/**
 * Fills in what a task list is missing, as part of a save caused by an edit (docs/04 §3, D-28):
 * an ID for every task that has none or a duplicate one, and a `completion` time for tasks that
 * were checked outside Flint. Only the lines that needed it change. Notes are never passed here:
 * their checkboxes are not tasks.
 */
export function prepareForSave(document: FlintDocument, context: SaveContext): SaveResult {
  const renamed = new Map<string, string>();
  const created = new Set<string>();
  const isTaken = (id: string): boolean => created.has(id) || context.isTaken(id);

  const visit = (node: TaskNode): TaskNode => {
    let next = node;
    const needsId = node.key.startsWith('~') || (context.replaceIds?.has(node.key) ?? false);
    if (needsId) {
      const id = generateId(isTaken, context.random);
      created.add(id);
      renamed.set(node.key, id);
      next = {
        ...next,
        key: id,
        raw: null,
        line: { ...next.line, fields: { ...next.line.fields, id: flintField(id) } },
      };
    }
    if (isCompletedStatus(next.line.status) && !next.line.fields.completion) {
      next = {
        ...next,
        raw: null,
        line: {
          ...next.line,
          fields: { ...next.line.fields, completion: localDateTimeField(context.now) },
        },
      };
    }
    const children = next.children.map((child) => (child.kind === 'task' ? visit(child) : child));
    return children.some((child, index) => child !== next.children[index])
      ? { ...next, children }
      : next;
  };

  const blocks = document.blocks.map((block: Block) =>
    block.kind === 'task' ? visit(block) : block,
  );
  return { document: { ...document, blocks }, renamed };
}

const FRONTMATTER_KEYS = ['flint', 'id', 'mode'] as const;
type FrontmatterKey = (typeof FRONTMATTER_KEYS)[number];

/**
 * Sets Flint's frontmatter keys, changing only their own lines: an existing `key:` line is
 * replaced, a missing key is added before the closing `---`, and a file without frontmatter gets
 * a new block at the top. Other keys (Obsidian `tags`, `aliases`, …) are untouched (D-23).
 */
export function setFrontmatterValues(
  document: FlintDocument,
  values: Partial<Record<FrontmatterKey, string>>,
): FlintDocument {
  const eol = document.eol;
  const lines: Line[] = document.frontmatter
    ? [...document.frontmatter.lines]
    : [
        { text: '---', eol },
        { text: '---', eol },
      ];
  for (const key of FRONTMATTER_KEYS) {
    const value = values[key];
    if (value === undefined) continue;
    const pattern = new RegExp(`^${key}[ \\t]*:`);
    const index = lines.findIndex(
      (line, position) => position > 0 && position < lines.length - 1 && pattern.test(line.text),
    );
    if (index > 0) {
      lines[index] = { text: `${key}: ${value}`, eol: lines[index]?.eol || eol };
    } else {
      lines.splice(lines.length - 1, 0, { text: `${key}: ${value}`, eol });
    }
  }
  const frontmatter: Frontmatter = {
    lines,
    flint: values.flint ?? document.frontmatter?.flint ?? null,
    id: values.id ?? document.frontmatter?.id ?? null,
    mode: values.mode ?? document.frontmatter?.mode ?? null,
  };
  return { ...document, frontmatter };
}

/**
 * Adds Flint's header to a file that doesn't have it yet, on the first save caused by an edit in
 * Flint (D-23). Keys already present keep their values; a missing `mode` means note.
 */
export function ensureFlintHeader(document: FlintDocument, listId: string): FlintDocument {
  const current = document.frontmatter;
  const values: Partial<Record<FrontmatterKey, string>> = {};
  if (!current?.flint) values.flint = '1';
  if (!current?.id) values.id = listId;
  if (!current?.mode) values.mode = 'note';
  return Object.keys(values).length === 0 ? document : setFrontmatterValues(document, values);
}
