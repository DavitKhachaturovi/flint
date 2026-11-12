import type { Candidate, ItemKind } from './protocol.js';

/**
 * AGENT-01 (D-185 Q6): from an agent's reference to one item. IDs first, then exact names (lists,
 * notes and groups ignoring case and surrounding spaces; tasks by exact title ignoring case, open
 * ones before done ones). Never a guess: more than one match is ambiguous, none is not found with
 * a few close matches to suggest (never acted on).
 */
export interface Resolvable extends Candidate {
  /** Tasks only: their list's ID, to narrow by `in`. */
  readonly listId?: string;
}

export type Resolved<T extends Resolvable> =
  | { readonly ok: true; readonly item: T }
  | { readonly ok: false; readonly code: 'ambiguous'; readonly candidates: readonly T[] }
  | { readonly ok: false; readonly code: 'not_found'; readonly suggestions: readonly T[] };

const MAX_CANDIDATES = 10;
const MAX_SUGGESTIONS = 5;

/** Names compared: case and surrounding (and repeated) spaces don't matter. */
export function sameName(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Resolves `ref` among `items` (already filtered by kind, `in`, and Hidden from agents).
 * `preferOpen`: a title matching open tasks never counts the done ones.
 */
export function resolveRef<T extends Resolvable>(
  ref: string,
  items: readonly T[],
  options: { readonly preferOpen?: boolean } = {},
): Resolved<T> {
  const trimmed = ref.trim();
  const byId = items.filter((item) => item.id === trimmed);
  if (byId.length === 1) return { ok: true, item: byId[0] as T };
  let matches = items.filter((item) => sameName(item.name, trimmed));
  if (options.preferOpen && matches.some((item) => item.done !== true)) {
    matches = matches.filter((item) => item.done !== true);
  }
  if (matches.length === 1) return { ok: true, item: matches[0] as T };
  if (matches.length > 1)
    return { ok: false, code: 'ambiguous', candidates: matches.slice(0, MAX_CANDIDATES) };
  return { ok: false, code: 'not_found', suggestions: suggest(trimmed, items) };
}

/** Close matches by a simple score: shared words, then a contained name, then edit distance. */
export function suggest<T extends Resolvable>(ref: string, items: readonly T[]): T[] {
  const query = normalise(ref);
  if (query === '') return [];
  const words = query.split(' ');
  const scored = items
    .map((item) => {
      const name = normalise(item.name);
      const shared = words.filter((word) => word.length > 1 && name.includes(word)).length;
      const contains = name.includes(query) || query.includes(name) ? 2 : 0;
      const distance = name.length < 80 ? editDistance(query, name) : 99;
      const close = distance <= Math.max(2, Math.floor(query.length / 4)) ? 3 : 0;
      return { item, score: shared + contains + close };
    })
    .filter((each) => each.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_SUGGESTIONS).map((each) => each.item);
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      previous[j] = Math.min(
        above + 1,
        (previous[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

/** As the protocol carries it (no internal fields). */
export function asCandidate(item: Resolvable): Candidate {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    ...(item.list !== undefined && { list: item.list }),
    ...(item.group !== undefined && { group: item.group }),
    ...(item.done !== undefined && { done: item.done }),
  };
}

/** The kind's word for messages. */
export function kindWord(kind: ItemKind | undefined): string {
  return kind ?? 'item';
}
