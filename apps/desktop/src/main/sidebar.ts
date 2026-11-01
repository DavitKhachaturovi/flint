/**
 * The sidebar's groups and manual order (LIST-05, LIST-06, D-73, D-74; docs/04 §2): kept in the
 * Flint folder's `.flint/sidebar.json`, so they travel with the lists. Groups are not folders: the
 * list files stay flat. Pure functions: reading, arranging for the sidebar, and the changes the user
 * makes; the workspace reads and writes the file.
 */

/** A group with its lists in their order. */
export interface SidebarGroupEntry {
  readonly group: string;
  readonly name: string;
  readonly lists: readonly string[];
}

/** One manual order of groups and ungrouped lists together (D-74). */
export type SidebarEntry = SidebarGroupEntry | { readonly list: string };

export interface SidebarFile {
  readonly items: readonly SidebarEntry[];
  /** Keys this version doesn't know, kept as they are (tolerant reader). */
  readonly extra: Readonly<Record<string, unknown>>;
}

import type { SidebarItem, SidebarSort } from '../shared/ipc.js';

export type { SidebarItem, SidebarSort };

/** What the sidebar needs of a list to place and sort it. */
export interface SidebarList {
  readonly id: string;
  /** File times (ms): Recently edited and Created, newest first (D-74). */
  readonly edited: number;
  readonly created: number;
}

export const EMPTY_SIDEBAR: SidebarFile = { items: [], extra: {} };

const isGroup = (entry: SidebarEntry): entry is SidebarGroupEntry => 'group' in entry;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** A tolerant reader: anything it can't use is skipped; unknown top-level keys are kept. */
export function readSidebar(text: string | null): SidebarFile {
  if (text === null) return EMPTY_SIDEBAR;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_SIDEBAR;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY_SIDEBAR;
  const { items, flint: _version, ...extra } = parsed as Record<string, unknown>;
  void _version;
  const seen = new Set<string>();
  const entries: SidebarEntry[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.group === 'string' && typeof record.name === 'string') {
      if (seen.has(`group:${record.group}`)) continue;
      seen.add(`group:${record.group}`);
      const lists = strings(record.lists).filter((id) => !seen.has(id));
      lists.forEach((id) => seen.add(id));
      entries.push({ group: record.group, name: record.name, lists });
    } else if (typeof record.list === 'string' && !seen.has(record.list)) {
      seen.add(record.list);
      entries.push({ list: record.list });
    }
  }
  return { items: entries, extra };
}

export function writeSidebar(file: SidebarFile): string {
  return `${JSON.stringify({ ...file.extra, flint: 1, items: file.items }, null, 2)}\n`;
}

/**
 * The sidebar for these lists (D-73, D-74): the manual order from the file, then any list it
 * doesn't mention, ungrouped at the end; IDs of lists that are gone are skipped. Under a sort,
 * groups keep their places and the lists are sorted within each group and among the ungrouped ones,
 * newest first.
 */
export function arrange(
  file: SidebarFile,
  lists: readonly SidebarList[],
  sort: SidebarSort,
): SidebarItem[] {
  const known = new Map(lists.map((list) => [list.id, list]));
  const placed = new Set<string>();
  const items: SidebarItem[] = [];
  for (const entry of file.items) {
    if (isGroup(entry)) {
      const members = entry.lists.filter((id) => known.has(id) && !placed.has(id));
      members.forEach((id) => placed.add(id));
      items.push({ kind: 'group', id: entry.group, name: entry.name, lists: members });
    } else if (known.has(entry.list) && !placed.has(entry.list)) {
      placed.add(entry.list);
      items.push({ kind: 'list', id: entry.list });
    }
  }
  for (const list of lists) if (!placed.has(list.id)) items.push({ kind: 'list', id: list.id });
  if (sort === 'manual') return items;
  const key = (id: string): number => {
    const list = known.get(id);
    return list ? (sort === 'edited' ? list.edited : list.created) : 0;
  };
  const newest = (ids: readonly string[]): string[] => [...ids].sort((a, b) => key(b) - key(a));
  // Groups keep their places; the ungrouped lists fill the other places in sorted order.
  const loose = newest(items.flatMap((item) => (item.kind === 'list' ? [item.id] : [])));
  return items.map((item) =>
    item.kind === 'group'
      ? { ...item, lists: newest(item.lists) }
      : { kind: 'list', id: loose.shift() ?? item.id },
  );
}

/** The file holding every list in `items` order: what is shown becomes the manual order. */
export function fromItems(items: readonly SidebarItem[], extra: SidebarFile['extra']): SidebarFile {
  return {
    items: items.map((item) =>
      item.kind === 'group'
        ? { group: item.id, name: item.name, lists: [...item.lists] }
        : { list: item.id },
    ),
    extra,
  };
}

/** A new group (D-73), at the top of Lists (D-80). */
export function addGroup(items: readonly SidebarItem[], id: string, name: string): SidebarItem[] {
  return [{ kind: 'group', id, name, lists: [] }, ...items];
}

export function renameGroup(
  items: readonly SidebarItem[],
  id: string,
  name: string,
): SidebarItem[] {
  return items.map((item) => (item.kind === 'group' && item.id === id ? { ...item, name } : item));
}

/** Deleting a group keeps its lists: they move out, in its place, in their order (D-73). */
export function deleteGroup(items: readonly SidebarItem[], id: string): SidebarItem[] {
  return items.flatMap((item) =>
    item.kind === 'group' && item.id === id
      ? item.lists.map((list): SidebarItem => ({ kind: 'list', id: list }))
      : [item],
  );
}

/** Where a list or group goes: into a group (or out, `group: null`), before position `index`. */
export interface Destination {
  readonly group: string | null;
  readonly index: number;
}

/**
 * Moves a list into a group, out of one, or within its place (the right-click menu, drag); a group
 * moves among the top-level items (groups never nest).
 */
export function moveTo(items: readonly SidebarItem[], id: string, to: Destination): SidebarItem[] {
  const group = items.find((item) => item.kind === 'group' && item.id === id);
  if (group) {
    const rest = items.filter((item) => item !== group);
    const at = Math.max(0, Math.min(rest.length, to.index));
    return [...rest.slice(0, at), group, ...rest.slice(at)];
  }
  // Out of wherever it is.
  const without = items
    .filter((item) => !(item.kind === 'list' && item.id === id))
    .map((item) =>
      item.kind === 'group' && item.lists.includes(id)
        ? { ...item, lists: item.lists.filter((list) => list !== id) }
        : item,
    );
  if (to.group === null) {
    const at = Math.max(0, Math.min(without.length, to.index));
    return [...without.slice(0, at), { kind: 'list', id }, ...without.slice(at)];
  }
  return without.map((item) => {
    if (item.kind !== 'group' || item.id !== to.group) return item;
    const at = Math.max(0, Math.min(item.lists.length, to.index));
    return { ...item, lists: [...item.lists.slice(0, at), id, ...item.lists.slice(at)] };
  });
}

/**
 * Alt+↑/↓ (LIST-06): a list one place up or down within its group (or among the top-level items),
 * a group among the top-level items. Null at the edge.
 */
export function moveStep(
  items: readonly SidebarItem[],
  id: string,
  direction: -1 | 1,
): SidebarItem[] | null {
  const top = items.findIndex((item) => item.id === id);
  if (top >= 0) {
    const next = top + direction;
    if (next < 0 || next >= items.length) return null;
    return moveTo(items, id, { group: null, index: next });
  }
  const group = items.find(
    (item): item is Extract<SidebarItem, { kind: 'group' }> =>
      item.kind === 'group' && item.lists.includes(id),
  );
  if (!group) return null;
  const next = group.lists.indexOf(id) + direction;
  if (next < 0 || next >= group.lists.length) return null;
  return moveTo(items, id, { group: group.id, index: next });
}
