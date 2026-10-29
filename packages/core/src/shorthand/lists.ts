/** A list as the shorthand sees it (CAP-05). */
export interface ListInfo {
  readonly id: string;
  readonly name: string;
  readonly mode: 'tasks' | 'note';
  /** Most-recently-used rank (0 = last capture or move target); absent if never used (D-25). */
  readonly recentRank?: number;
}

/** Where a `##name` token sends the capture (D-25). */
export type ListResolution =
  | { readonly kind: 'existing'; readonly list: ListInfo }
  /** Card: `<list> · Enter · New list "<name>" · Tab`. */
  | { readonly kind: 'close-match'; readonly list: ListInfo; readonly name: string }
  /** Card: `New list "<name>" · Enter`. */
  | { readonly kind: 'new'; readonly name: string }
  /** Stays as text, task goes to Inbox: `<name> is a note → Inbox`. */
  | { readonly kind: 'note'; readonly list: ListInfo }
  /** Stays as text, task goes to Inbox; Windows can't use this as a file name. */
  | { readonly kind: 'invalid-name'; readonly name: string };

/** Case, spaces, hyphens and underscores don't matter: `##meeting-notes` finds "Meeting notes". */
export function normalizeListName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** The form autocomplete inserts after `##`: spaces become hyphens. */
export function listToken(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}

const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;

/** Whether Windows accepts this as a file name (without `.md`). */
export function isValidListName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !/[<>:"/\\|?*]/.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 0x20) &&
    !/[. ]$/.test(name) &&
    !RESERVED.test(name)
  );
}

/** Optimal string alignment distance: insertions, deletions, substitutions and swaps cost 1. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const table: number[] = new Array<number>(rows * columns).fill(0);
  const cell = (row: number, column: number): number => table[row * columns + column] ?? 0;
  for (let row = 0; row < rows; row++) table[row * columns] = row;
  for (let column = 0; column < columns; column++) table[column] = column;
  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      let value = Math.min(
        cell(row - 1, column) + 1,
        cell(row, column - 1) + 1,
        cell(row - 1, column - 1) + cost,
      );
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        value = Math.min(value, cell(row - 2, column - 2) + 1);
      }
      table[row * columns + column] = value;
    }
  }
  return cell(rows - 1, columns - 1);
}

function byRecentThenSidebar(lists: readonly ListInfo[]): (a: ListInfo, b: ListInfo) => number {
  return (a, b) =>
    (a.recentRank ?? Infinity) - (b.recentRank ?? Infinity) || lists.indexOf(a) - lists.indexOf(b);
}

/**
 * Resolves the name after `##` (D-25):
 * 1. a task list with the same normalized name (an exact spelling wins, then sidebar order);
 *    a note with that name → `note`;
 * 2. close matches among task lists: prefixes (2+ characters) first, then names within edit
 *    distance 2 (1 for names of 4 characters or fewer); most recently used first, then sidebar
 *    order (edit-distance matches by distance first);
 * 3. otherwise a new list named exactly as typed, if Windows accepts the name.
 */
export function resolveList(name: string, lists: readonly ListInfo[]): ListResolution {
  const normalized = normalizeListName(name);
  const same = lists.filter((list) => normalizeListName(list.name) === normalized);
  const sameTasks = same.filter((list) => list.mode === 'tasks');
  if (sameTasks.length > 0) {
    const exact = sameTasks.find((list) => list.name === name) ?? sameTasks[0];
    if (exact) return { kind: 'existing', list: exact };
  }
  const note = same[0];
  if (note) return { kind: 'note', list: note };

  const taskLists = lists.filter((list) => list.mode === 'tasks');
  const order = byRecentThenSidebar(lists);
  if (normalized.length >= 2) {
    const prefixed = taskLists
      .filter((list) => normalizeListName(list.name).startsWith(normalized))
      .sort(order);
    const first = prefixed[0];
    if (first) return { kind: 'close-match', list: first, name };
  }
  const typos = taskLists
    .map((list) => {
      const candidate = normalizeListName(list.name);
      return {
        list,
        distance: editDistance(normalized, candidate),
        limit: candidate.length <= 4 ? 1 : 2,
      };
    })
    .filter(({ distance, limit }) => distance <= limit)
    .sort((a, b) => a.distance - b.distance || order(a.list, b.list));
  const typo = typos[0];
  if (typo) return { kind: 'close-match', list: typo.list, name };

  return isValidListName(name) ? { kind: 'new', name } : { kind: 'invalid-name', name };
}

/**
 * Autocomplete while typing after `##` (CAP-05): task lists whose name starts with, contains, or
 * has the letters of the typed text in order; most recently used first, then sidebar order.
 */
export function suggestLists(typed: string, lists: readonly ListInfo[]): ListInfo[] {
  const query = normalizeListName(typed);
  const order = byRecentThenSidebar(lists);
  const score = (list: ListInfo): number => {
    const name = normalizeListName(list.name);
    if (name.startsWith(query)) return 0;
    if (name.includes(query)) return 1;
    let position = 0;
    for (const char of name) if (char === query[position]) position++;
    return position === query.length ? 2 : 3;
  };
  return lists
    .filter((list) => list.mode === 'tasks')
    .map((list) => ({ list, score: score(list) }))
    .filter(({ score: value }) => value < 3)
    .sort((a, b) => a.score - b.score || order(a.list, b.list))
    .map(({ list }) => list);
}
