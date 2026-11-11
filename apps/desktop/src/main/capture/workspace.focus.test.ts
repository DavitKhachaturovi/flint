import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareFlintFolder } from '../storage/flint-folder.js';
import { Workspace } from './workspace.js';
import { FOCUS_ID } from '../../shared/focus.js';

/** FOCUS-02, FOCUS-03 (D-170): Focus's sprint through the workspace. */

let base: string;
let folder: string;
const now = new Date(2026, 2, 10, 10, 0);
const opened: Workspace[] = [];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-focus-'));
  folder = join(base, 'Flint');
  await prepareFlintFolder(folder, {});
  await writeFile(
    join(folder, 'Inbox.md'),
    '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] Review the PR [id:: aaaa]\n- [ ] Write docs [id:: bbbb]\n',
  );
  await writeFile(
    join(folder, 'Backend.md'),
    '---\nflint: 1\nid: backend\nmode: tasks\n---\n- [ ] Fix the login loop [priority:: high] [id:: cccc]\n- [x] Old one [completion:: 2026-03-09T10:00] [id:: dddd]\n',
  );
});
afterEach(async () => {
  await Promise.all(opened.splice(0).map((workspace) => workspace.settled()));
  await rm(base, { recursive: true, force: true });
});

const open = async (): Promise<Workspace> => {
  const workspace = await Workspace.open(folder, join(base, 'ui-state.json'));
  opened.push(workspace);
  return workspace;
};
const keys = (workspace: Workspace): string[] =>
  (workspace.view(FOCUS_ID, now)?.items ?? []).flatMap((item) =>
    item.kind === 'task' ? [item.task.key] : [],
  );
const sprintFile = async (workspace: Workspace): Promise<unknown> => {
  await workspace.settled();
  return JSON.parse(await readFile(join(folder, '.flint', 'focus.json'), 'utf8'));
};

describe('Send to Focus (FOCUS-02)', () => {
  it('sends from any list to the end of the sprint, never touching the task line', async () => {
    const workspace = await open();
    const before = await readFile(join(folder, 'Backend.md'), 'utf8');
    expect(
      await workspace.change('backend', { kind: 'focus', key: 'cccc', focus: true }, now),
    ).toMatchObject({ label: 'Sent to Focus', key: 'cccc' });
    await workspace.change('inbox', { kind: 'focus', key: 'aaaa', focus: true }, now);
    expect(keys(workspace)).toEqual(['cccc', 'aaaa']);
    expect(await readFile(join(folder, 'Backend.md'), 'utf8')).toBe(before);
    expect(await sprintFile(workspace)).toEqual({
      flint: 1,
      tasks: [
        { id: 'cccc', estimate: 1, count: 0 },
        { id: 'aaaa', estimate: 1, count: 0 },
      ],
    });
    // Sending again changes nothing; Remove from Focus takes it out; undo puts it back.
    expect(
      await workspace.change('inbox', { kind: 'focus', key: 'aaaa', focus: true }, now),
    ).toBeNull();
    await workspace.change(FOCUS_ID, { kind: 'focus', key: 'cccc', focus: false }, now);
    expect(keys(workspace)).toEqual(['aaaa']);
    expect(await workspace.undoLast(now)).toBe('Removed from Focus');
    expect(keys(workspace)).toEqual(['cccc', 'aaaa']);
  });

  it('shows rows with their home list, the active task and the numbers', async () => {
    const workspace = await open();
    for (const key of ['aaaa', 'cccc'])
      await workspace.change('inbox', { kind: 'focus', key, focus: true }, now);
    await workspace.change(FOCUS_ID, { kind: 'estimate', key: 'cccc', estimate: 3 }, now);
    const view = workspace.view(FOCUS_ID, now);
    expect(view).toMatchObject({ id: FOCUS_ID, name: 'Focus', open: 2 });
    const rows = (view?.items ?? []).flatMap((item) => (item.kind === 'task' ? [item.task] : []));
    expect(rows.map((row) => row.home?.listName)).toEqual(['Inbox', 'Backend']);
    expect(view?.focus).toEqual({
      entries: { aaaa: { estimate: 1, count: 0 }, cccc: { estimate: 3, count: 0 } },
      active: 'aaaa',
    });
  });

  it('done tasks sink below the open ones, unless Check to bottom is off', async () => {
    const workspace = await open();
    for (const key of ['dddd', 'aaaa'])
      await workspace.change('inbox', { kind: 'focus', key, focus: true }, now);
    expect(keys(workspace)).toEqual(['aaaa', 'dddd']);
    workspace.focusCheckToBottom = false;
    expect(keys(workspace)).toEqual(['dddd', 'aaaa']);
    expect(workspace.view(FOCUS_ID, now)?.focus?.active).toBe('aaaa');
  });

  it('completing in Focus completes in the home list', async () => {
    const workspace = await open();
    await workspace.change('backend', { kind: 'focus', key: 'cccc', focus: true }, now);
    expect(await workspace.toggleDone(FOCUS_ID, 'cccc', now)).toBe('Completed');
    expect(await readFile(join(folder, 'Backend.md'), 'utf8')).toContain(
      '- [x] Fix the login loop',
    );
  });
});

describe('the sprint order and the active task (FOCUS-02)', () => {
  it('Alt+↓, Focus on this and drag reorder the open tasks; one undo step each', async () => {
    const workspace = await open();
    for (const key of ['aaaa', 'bbbb', 'cccc'])
      await workspace.change('inbox', { kind: 'focus', key, focus: true }, now);
    await workspace.change(FOCUS_ID, { kind: 'move', key: 'aaaa', direction: 'down' }, now);
    expect(keys(workspace)).toEqual(['bbbb', 'aaaa', 'cccc']);
    await workspace.change(FOCUS_ID, { kind: 'focusTop', key: 'cccc' }, now);
    expect(keys(workspace)).toEqual(['cccc', 'bbbb', 'aaaa']);
    expect(workspace.focusActive()).toBe('cccc');
    await workspace.change(
      FOCUS_ID,
      { kind: 'place', key: 'aaaa', where: { at: 'before', key: 'cccc' } },
      now,
    );
    expect(keys(workspace)).toEqual(['aaaa', 'cccc', 'bbbb']);
    await workspace.undoLast(now);
    expect(keys(workspace)).toEqual(['cccc', 'bbbb', 'aaaa']);
    // Indenting is the home list's business: nothing here.
    expect(await workspace.change(FOCUS_ID, { kind: 'indent', key: 'bbbb' }, now)).toBeNull();
  });

  it('the composer adds to Inbox and to the end of the sprint, one undo step', async () => {
    const workspace = await open();
    await workspace.change('backend', { kind: 'focus', key: 'cccc', focus: true }, now);
    const added = await workspace.change(
      FOCUS_ID,
      { kind: 'add', text: 'Plan the release', where: 'top' },
      now,
    );
    expect(added).toMatchObject({ listId: FOCUS_ID, listName: 'Focus' });
    expect(keys(workspace)).toEqual(['cccc', added?.key]);
    expect(await readFile(join(folder, 'Inbox.md'), 'utf8')).toContain('- [ ] Plan the release');
    await workspace.undoLast(now);
    expect(keys(workspace)).toEqual(['cccc']);
    expect(await readFile(join(folder, 'Inbox.md'), 'utf8')).not.toContain('Plan the release');
  });

  it('a deleted task leaves Focus; undoing the delete brings it back', async () => {
    const workspace = await open();
    for (const key of ['aaaa', 'bbbb'])
      await workspace.change('inbox', { kind: 'focus', key, focus: true }, now);
    await workspace.change(FOCUS_ID, { kind: 'delete', key: 'aaaa' }, now);
    expect(keys(workspace)).toEqual(['bbbb']);
    await workspace.undoLast(now);
    expect(keys(workspace)).toEqual(['aaaa', 'bbbb']);
  });
});

describe('sessions, counts and the ⋯ menu (FOCUS-03, FOCUS-04)', () => {
  it('a finished session counts for the active task; Auto check completes it at its estimate', async () => {
    const workspace = await open();
    for (const key of ['aaaa', 'bbbb'])
      await workspace.change('inbox', { kind: 'focus', key, focus: true }, now);
    await workspace.change(FOCUS_ID, { kind: 'estimate', key: 'aaaa', estimate: 2 }, now);
    expect(await workspace.focusCounted(true, now)).toBe('aaaa');
    expect(workspace.view(FOCUS_ID, now)?.focus?.entries.aaaa).toEqual({ estimate: 2, count: 1 });
    expect(await workspace.focusCounted(true, now)).toBe('aaaa');
    expect(await readFile(join(folder, 'Inbox.md'), 'utf8')).toContain('- [x] Review the PR');
    expect(workspace.focusActive()).toBe('bbbb');
    expect(await workspace.focusCounted(false, now)).toBe('bbbb');
    expect(await readFile(join(folder, 'Inbox.md'), 'utf8')).toContain('- [ ] Write docs');
  });

  it('Clear finished, Reset counts and Remove all only change the sprint', async () => {
    const workspace = await open();
    for (const key of ['aaaa', 'dddd', 'cccc'])
      await workspace.change('inbox', { kind: 'focus', key, focus: true }, now);
    await workspace.focusCounted(false, now);
    expect(await workspace.focusAction('resetCounts')).toBe('Counts reset');
    expect(workspace.view(FOCUS_ID, now)?.focus?.entries.aaaa?.count).toBe(0);
    expect(await workspace.focusAction('clearFinished')).toBe('Cleared finished tasks');
    expect(keys(workspace)).toEqual(['aaaa', 'cccc']);
    expect(await workspace.focusAction('removeAll')).toBe('Removed all from Focus');
    expect(keys(workspace)).toEqual([]);
    expect(await readFile(join(folder, 'Backend.md'), 'utf8')).toContain('Fix the login loop');
    await workspace.undoLast(now);
    expect(keys(workspace)).toEqual(['aaaa', 'cccc']);
    expect(await workspace.focusAction('resetCounts')).toBeNull();
  });

  it('the sprint is read again on the next start', async () => {
    const first = await open();
    await first.change('inbox', { kind: 'focus', key: 'bbbb', focus: true }, now);
    await first.settled();
    const second = await open();
    expect(keys(second)).toEqual(['bbbb']);
  });
});
