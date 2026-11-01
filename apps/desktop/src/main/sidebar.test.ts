import { describe, expect, it } from 'vitest';
import {
  addGroup,
  arrange,
  deleteGroup,
  fromItems,
  moveStep,
  moveTo,
  readSidebar,
  renameGroup,
  writeSidebar,
  type SidebarList,
} from './sidebar.js';

const lists: SidebarList[] = [
  { id: 'a', edited: 30, created: 1 },
  { id: 'b', edited: 10, created: 3 },
  { id: 'c', edited: 20, created: 2 },
  { id: 'd', edited: 40, created: 4 },
];

const file = readSidebar(
  JSON.stringify({
    flint: 1,
    future: { kept: true },
    items: [
      { list: 'c' },
      { group: 'g1', name: 'Work', lists: ['b', 'gone', 'a'] },
      { list: 'gone' },
      { list: 'c' },
      { nonsense: 1 },
    ],
  }),
);

describe('sidebar groups and order (LIST-05, LIST-06, D-73, D-74)', () => {
  it('reads tolerantly and keeps unknown keys', () => {
    expect(readSidebar('not json').items).toEqual([]);
    expect(readSidebar(null).items).toEqual([]);
    // A list in two places (or twice) is kept at its first.
    expect(file.items).toEqual([
      { list: 'c' },
      { group: 'g1', name: 'Work', lists: ['b', 'gone', 'a'] },
    ]);
    expect(JSON.parse(writeSidebar(file))).toEqual({
      future: { kept: true },
      flint: 1,
      items: file.items,
    });
  });

  it('arranges the manual order; unmentioned lists come last, gone ones are skipped', () => {
    expect(arrange(file, lists, 'manual')).toEqual([
      { kind: 'list', id: 'c' },
      { kind: 'group', id: 'g1', name: 'Work', lists: ['b', 'a'] },
      { kind: 'list', id: 'd' },
    ]);
  });

  it('sorts within groups and among the ungrouped lists; groups keep their places', () => {
    expect(arrange(file, lists, 'edited')).toEqual([
      { kind: 'list', id: 'd' },
      { kind: 'group', id: 'g1', name: 'Work', lists: ['a', 'b'] },
      { kind: 'list', id: 'c' },
    ]);
    expect(arrange(file, lists, 'created')).toEqual([
      { kind: 'list', id: 'd' },
      { kind: 'group', id: 'g1', name: 'Work', lists: ['b', 'a'] },
      { kind: 'list', id: 'c' },
    ]);
  });

  it('adds, renames and deletes groups; deleting keeps the lists in its place', () => {
    const items = arrange(file, lists, 'manual');
    const added = addGroup(items, 'g2', 'Home');
    // D-80: a new group goes to the top of Lists.
    expect(added[0]).toEqual({ kind: 'group', id: 'g2', name: 'Home', lists: [] });
    expect(renameGroup(added, 'g2', 'House')[0]).toMatchObject({ name: 'House' });
    expect(deleteGroup(items, 'g1')).toEqual([
      { kind: 'list', id: 'c' },
      { kind: 'list', id: 'b' },
      { kind: 'list', id: 'a' },
      { kind: 'list', id: 'd' },
    ]);
    expect(fromItems(items, {}).items).toEqual([
      { list: 'c' },
      { group: 'g1', name: 'Work', lists: ['b', 'a'] },
      { list: 'd' },
    ]);
  });

  it('moves lists into, within and out of groups, and groups among the top level', () => {
    const items = arrange(file, lists, 'manual');
    expect(moveTo(items, 'd', { group: 'g1', index: 1 })).toEqual([
      { kind: 'list', id: 'c' },
      { kind: 'group', id: 'g1', name: 'Work', lists: ['b', 'd', 'a'] },
    ]);
    expect(moveTo(items, 'a', { group: null, index: 0 })).toEqual([
      { kind: 'list', id: 'a' },
      { kind: 'list', id: 'c' },
      { kind: 'group', id: 'g1', name: 'Work', lists: ['b'] },
      { kind: 'list', id: 'd' },
    ]);
    expect(moveTo(items, 'g1', { group: null, index: 0 })[0]).toMatchObject({ id: 'g1' });
  });

  it('steps a list within its group and a group among the top level (Alt+↑/↓)', () => {
    const items = arrange(file, lists, 'manual');
    expect(moveStep(items, 'a', -1)?.[1]).toEqual({
      kind: 'group',
      id: 'g1',
      name: 'Work',
      lists: ['a', 'b'],
    });
    expect(moveStep(items, 'b', -1)).toBeNull();
    expect(moveStep(items, 'g1', 1)?.map((item) => item.id)).toEqual(['c', 'd', 'g1']);
    expect(moveStep(items, 'c', -1)).toBeNull();
  });
});
