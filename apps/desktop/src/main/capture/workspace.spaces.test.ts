import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareFlintFolder } from '../storage/flint-folder.js';
import { SnapshotStore } from '../storage/snapshots.js';
import { PERSONAL, Workspace } from './workspace.js';
import { TODAY_ID } from '../../shared/ipc.js';

/**
 * SPACE-01, SPACE-02 (D-190 Q14, Q20): one workspace whose lists know their space. The personal
 * space is the Flint folder; each `Spaces/<name>/` with `.flint/space.json` is another.
 */
let base: string;
let folder: string;
const now = new Date(2026, 9, 29, 14, 30);

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-spaces-ws-'));
  folder = join(base, 'Flint');
  await prepareFlintFolder(folder, {});
});
const opened: Workspace[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((workspace) => workspace.settled()));
  await rm(base, { recursive: true, force: true });
});
const open = async (): Promise<Workspace> => {
  const workspace = await Workspace.open(folder, join(base, 'ui-state.json'));
  opened.push(workspace);
  return workspace;
};

/** A space on disk, with list files (name → text). */
async function seedSpace(name: string, id: string, lists: Record<string, string>): Promise<string> {
  const space = join(folder, 'Spaces', name);
  await mkdir(join(space, '.flint'), { recursive: true });
  await writeFile(join(space, '.flint', 'space.json'), JSON.stringify({ flint: 1, id, name }));
  for (const [list, text] of Object.entries(lists))
    await writeFile(join(space, `${list}.md`), text);
  return space;
}

const header = (id: string, mode = 'tasks'): string =>
  `---\nflint: 1\nid: ${id}\nmode: ${mode}\n---\n`;

describe('spaces in the workspace (SPACE-01, D-190 Q20)', () => {
  it('loads the spaces: Personal first, each list knows its space, the sidebar shows one space', async () => {
    await writeFile(join(folder, 'Errands.md'), `${header('err1')}- [ ] milk [id:: t1a1]\n`);
    await seedSpace('Home', 's-home1', {
      Groceries: `${header('gro1')}- [ ] eggs [id:: t2b2]\n`,
      'Flat repairs': `${header('fla1', 'note')}# Leaks\n`,
    });
    const workspace = await open();
    expect(workspace.spaces().map((space) => [space.id, space.name])).toEqual([
      [PERSONAL, 'Personal'],
      ['s-home1', 'Home'],
    ]);
    expect(workspace.spaceOfList('gro1')).toBe('s-home1');
    expect(workspace.spaceOfList('err1')).toBe(PERSONAL);
    const ids = (items: ReturnType<Workspace['sidebar']>['items']) =>
      items.flatMap((item) => (item.kind === 'group' ? item.lists : [item.id]));
    expect(ids(workspace.sidebar().items)).toEqual(['err1']);
    expect(ids(workspace.sidebar('s-home1').items).sort()).toEqual(['fla1', 'gro1']);
    // Today, search and the rest see every space's lists.
    expect(workspace.listInfos().map((info) => info.id)).toEqual(
      expect.arrayContaining(['inbox', 'err1', 'gro1', 'fla1']),
    );
  });

  it('a space’s file claiming `id: inbox` is not an Inbox (D-190 Q11)', async () => {
    await seedSpace('Home', 's-home1', { Sneaky: `${header('inbox')}- [ ] hi [id:: t3c3]\n` });
    const workspace = await open();
    const sneaky = workspace.listInfos().find((info) => info.name === 'Sneaky');
    expect(sneaky?.id).toBe('file:s-home1/Sneaky');
    expect(workspace.listInfos().filter((info) => info.id === 'inbox')).toHaveLength(1);
    expect(workspace.spaceOfList('inbox')).toBe(PERSONAL);
  });

  it('a list ID claimed twice (a copied file) keeps Personal’s; the space’s falls back', async () => {
    await writeFile(join(folder, 'Errands.md'), `${header('dup1')}- [ ] a [id:: t4d4]\n`);
    await seedSpace('Home', 's-home1', { Errands: `${header('dup1')}- [ ] b [id:: t5e5]\n` });
    const workspace = await open();
    const ids = workspace.listInfos().map((info) => info.id);
    expect(ids).toContain('dup1');
    expect(ids).toContain('file:s-home1/Errands');
    expect(workspace.spaceOfList('dup1')).toBe(PERSONAL);
  });

  it('personal sync never sees a space’s lists (D-190 Q20)', async () => {
    await writeFile(join(folder, 'Errands.md'), header('err1'));
    await seedSpace('Home', 's-home1', { Groceries: header('gro1') });
    const workspace = await open();
    const synced = workspace.syncEntries().map((entry) => entry.id);
    expect(synced).toContain('err1');
    expect(synced).not.toContain('gro1');
  });

  it('new IDs are free across every space: a task ID used in a space is taken', async () => {
    await seedSpace('Home', 's-home1', { Groceries: `${header('gro1')}- [ ] eggs [id:: abcd]\n` });
    const workspace = await open();
    expect(workspace.isTaken('abcd')).toBe(true);
    expect(workspace.isTaken('gro1')).toBe(true);
  });

  it('New space “On this PC”: its folder and space.json, names unique, a list made in it', async () => {
    const workspace = await open();
    const made = await workspace.createSpace('  Trip   crew ');
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.space.folder).toBe(join(folder, 'Spaces', 'Trip crew'));
    expect(
      JSON.parse(await readFile(join(made.space.folder, '.flint', 'space.json'), 'utf8')),
    ).toMatchObject({
      id: made.space.id,
      name: 'Trip crew',
    });
    expect(await workspace.createSpace('trip crew')).toEqual({
      ok: false,
      problem: 'A space with that name exists',
    });
    expect((await workspace.createSpace('Personal')).ok).toBe(false);

    const list = await workspace.newList('Packing', 'tasks', now, made.space.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(workspace.spaceOfList(list.listId)).toBe(made.space.id);
    await readFile(join(made.space.folder, 'Packing.md'), 'utf8');
    // The same name may exist in Personal (each space is its own folder), not twice in one space.
    expect((await workspace.newList('Packing', 'tasks', now)).ok).toBe(true);
    expect(await workspace.newList('packing', 'tasks', now, made.space.id)).toEqual({
      ok: false,
      problem: 'A list with that name exists',
    });
  });

  it('a space’s list renamed stays in its space’s folder', async () => {
    const space = await seedSpace('Home', 's-home1', { Groceries: header('gro1') });
    const workspace = await open();
    const renamed = await workspace.renameList('gro1', 'Shopping', now);
    expect(renamed.ok).toBe(true);
    await readFile(join(space, 'Shopping.md'), 'utf8');
    expect(workspace.spaceOfList('gro1')).toBe('s-home1');
  });

  it('a space’s groups and sort are its own (its sidebar.json, its ui-state key)', async () => {
    const space = await seedSpace('Home', 's-home1', { Groceries: header('gro1') });
    const workspace = await open();
    const grouped = await workspace.sidebarAction(
      { kind: 'newGroup', name: 'Food' },
      now,
      false,
      's-home1',
    );
    expect(grouped.ok).toBe(true);
    expect(await readFile(join(space, '.flint', 'sidebar.json'), 'utf8')).toContain('Food');
    expect(workspace.sidebar().items.some((item) => item.kind === 'group')).toBe(false);
    await workspace.sidebarAction({ kind: 'sort', sort: 'edited' }, now, false, 's-home1');
    expect(workspace.sidebar('s-home1').sort).toBe('edited');
    expect(workspace.sidebar().sort).toBe('manual');
    // Undo restores the space's own sidebar file.
    expect(await workspace.undoLast(now)).toBe('Created group Food');
    expect(workspace.sidebar('s-home1').items.some((item) => item.kind === 'group')).toBe(false);
  });

  it('SPACE-04: a space’s deleted list goes to its own Trash, shows in the one Trash, and comes back to its space', async () => {
    const space = await seedSpace('Home', 's-home1', {
      Groceries: `${header('gro1')}- [ ] eggs [id:: t6f6]\n`,
    });
    const workspace = await open();
    expect((await workspace.deleteList('gro1', now)).ok).toBe(true);
    const [item] = (await workspace.trashView()).deleted;
    expect(item?.id).toMatch(/^s-home1\|/);
    expect(item?.from).toBe('Home');
    expect(item?.title).toBe('Groceries');
    // Its file is in the space's own Trash, never Personal's.
    expect((await readdir(join(space, '.flint', 'trash'))).length).toBe(1);
    expect(await readdir(join(folder, '.flint', 'trash')).catch(() => [])).toEqual([]);
    // Its IDs stay taken while it is in Trash (D-29).
    expect(workspace.isTaken('t6f6')).toBe(true);
    expect((await workspace.trashPreview(item?.id ?? ''))?.tasks.map((task) => task.title)).toEqual(
      ['eggs'],
    );
    expect((await workspace.restoreFromTrash(item?.id ?? '', now))?.listName).toBe('Groceries');
    await readFile(join(space, 'Groceries.md'), 'utf8');
    expect(workspace.spaceOfList('gro1')).toBe('s-home1');
  });

  it('SPACE-04: a space’s deleted task goes to its Trash, named with the space, and comes back to its list', async () => {
    const space = await seedSpace('Home', 's-home1', {
      Groceries: `${header('gro1')}- [ ] eggs [id:: t7g7]\n- [ ] milk [id:: t8h8]\n`,
    });
    const workspace = await open();
    await workspace.change('gro1', { kind: 'delete', key: 't7g7' }, now);
    const [item] = (await workspace.trashView()).deleted;
    expect(item?.from).toBe('Groceries · Home');
    expect((await readdir(join(space, '.flint', 'trash'))).length).toBe(1);
    await workspace.restoreFromTrash(item?.id ?? '', now);
    expect(await readFile(join(space, 'Groceries.md'), 'utf8')).toContain('eggs');
  });

  it('Empty Trash empties every space’s; a forged handle names nothing', async () => {
    await writeFile(join(folder, 'Errands.md'), header('err1'));
    await seedSpace('Home', 's-home1', { Groceries: header('gro1') });
    const workspace = await open();
    await workspace.deleteList('err1', now);
    await workspace.deleteList('gro1', now);
    expect((await workspace.trashView()).deleted).toHaveLength(2);
    expect(await workspace.restoreFromTrash('s-nope1|2026-10-29-143000-x.md', now)).toBeNull();
    expect(await workspace.restoreFromTrash('s-home1|../../Inbox.md', now)).toBeNull();
    expect(await workspace.emptyTrash()).toBe(2);
    expect((await workspace.trashView()).deleted).toHaveLength(0);
  });

  it('Restore everything (a snapshot) never writes or deletes a space’s files (D-190 Q20)', async () => {
    await writeFile(join(folder, 'Work.md'), `${header('wrk1')}- [ ] First [id:: aa11]\n`);
    const store = new SnapshotStore(folder, join(base, 'snapshots'));
    const workspace = await open();
    const old = await store.take(new Date(2026, 9, 29, 9, 0));
    // A space made after the snapshot: Restore everything would have deleted it.
    const space = await seedSpace('Home', 's-home1', { Groceries: header('gro1') });
    await workspace.fileChanged(join(folder, 'Spaces', 'Home'));
    await writeFile(join(folder, 'Work.md'), `${header('wrk1')}- [ ] Second [id:: aa11]\n`);
    expect(await workspace.restoreSnapshot(store, old?.id ?? '', null, now)).toBe(
      'Restored the whole Flint folder',
    );
    expect(await readFile(join(folder, 'Work.md'), 'utf8')).toContain('First');
    await readFile(join(space, 'Groceries.md'), 'utf8');
    await readFile(join(space, '.flint', 'space.json'), 'utf8');
    expect(workspace.spaceOfList('gro1')).toBe('s-home1');
  });

  it('SPACE-03: summaries name a list’s space; Today’s rows carry it for the letter (Personal’s carry none)', async () => {
    await writeFile(
      join(folder, 'Errands.md'),
      `${header('err1')}- [ ] milk [pinned:: true] [id:: p1p1]\n`,
    );
    await seedSpace('Home', 's-home1', {
      Groceries: `${header('gro1')}- [ ] eggs [pinned:: true] [id:: p2p2]\n`,
    });
    const workspace = await open();
    const summaries = workspace.summaries(now);
    expect(summaries.find((list) => list.id === 'gro1')?.space).toBe('s-home1');
    expect(summaries.find((list) => list.id === 'err1')?.space).toBeUndefined();
    const rows = (workspace.view(TODAY_ID, now)?.items ?? []).flatMap((item) =>
      item.kind === 'task' ? [item.task] : [],
    );
    const eggs = rows.find((row) => row.key === 'p2p2');
    const milk = rows.find((row) => row.key === 'p1p1');
    expect(eggs?.home).toEqual({
      listId: 'gro1',
      listName: 'Groceries',
      space: { id: 's-home1', name: 'Home' },
    });
    expect(milk?.home).toEqual({ listId: 'err1', listName: 'Errands' });
  });

  it('the watcher’s paths: a new list in a space and a new space appear', async () => {
    const space = await seedSpace('Home', 's-home1', { Groceries: header('gro1') });
    const workspace = await open();
    await writeFile(join(space, 'Hardware.md'), header('har1'));
    await workspace.fileChanged(join(space, 'Hardware.md'));
    expect(workspace.spaceOfList('har1')).toBe('s-home1');

    await seedSpace('Work', 's-work1', { Standup: header('sta1') });
    await workspace.fileChanged(join(folder, 'Spaces', 'Work'));
    expect(workspace.spaces().map((entry) => entry.id)).toContain('s-work1');
    expect(workspace.spaceOfList('sta1')).toBe('s-work1');

    await rm(join(folder, 'Spaces', 'Work'), { recursive: true, force: true });
    await workspace.fileChanged(join(folder, 'Spaces', 'Work'));
    expect(workspace.spaces().map((entry) => entry.id)).not.toContain('s-work1');
    expect(workspace.listInfos().some((info) => info.id === 'sta1')).toBe(false);
  });
});
