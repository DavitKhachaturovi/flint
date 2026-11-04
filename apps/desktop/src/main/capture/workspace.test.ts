import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareFlintFolder } from '../storage/flint-folder.js';
import { DraftFile } from './drafts.js';
import { Workspace } from './workspace.js';
import { SnapshotStore } from '../storage/snapshots.js';
import { TODAY_ID } from '../../shared/ipc.js';

let base: string;
let folder: string;
const now = new Date(2026, 9, 29, 14, 30);
const id = /\[id:: ([a-z0-9]{4,6})\]/;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-capture-'));
  folder = join(base, 'Flint');
  await prepareFlintFolder(folder, {});
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const open = (): Promise<Workspace> => Workspace.open(folder, join(base, 'ui-state.json'));
const inbox = (): Promise<string> => readFile(join(folder, 'Inbox.md'), 'utf8');

describe('capture to Inbox (CAP-01, CAP-02, D-27)', () => {
  it('saves a plain capture at the top of Inbox, with a new ID', async () => {
    await writeFile(
      join(folder, 'Inbox.md'),
      '---\nflint: 1\nid: inbox\nmode: tasks\n---\nSome intro text.\n\n- [ ] older [id:: aaaa]\n',
    );
    const workspace = await open();
    const outcome = await workspace.capture(
      { text: 'fix token refresh', chooseNewList: false },
      now,
    );
    expect(outcome).toMatchObject({ kind: 'saved', listName: 'Inbox', createdList: null });
    const text = await inbox();
    // Top of Inbox means just before the first task, not above the intro (D-22).
    expect(text).toMatch(
      /Some intro text\.\n\n- \[ \] fix token refresh \[id:: [a-z0-9]{4,6}\]\n- \[ \] older/,
    );
    expect(id.exec(text)?.[1]).not.toBe('aaaa');
  });

  it('applies the shorthand: priority, reminder, body lines', async () => {
    const workspace = await open();
    await workspace.capture(
      { text: 'deploy hotfix !h @tomorrow 10\nstack line one\n  at foo()', chooseNewList: false },
      now,
    );
    const text = await inbox();
    expect(text).toContain(
      '- [ ] deploy hotfix [reminder:: 2026-10-30T10:00] [priority:: high] [id:: ',
    );
    expect(text).toContain('\n    stack line one\n      at foo()\n');
  });

  it('ignores an empty capture', async () => {
    const workspace = await open();
    expect(await workspace.capture({ text: '   ', chooseNewList: false }, now)).toEqual({
      kind: 'empty',
    });
  });
});

describe('##lists from capture (CAP-05, D-25)', () => {
  beforeEach(async () => {
    await writeFile(join(folder, 'Unicorn.md'), '---\nflint: 1\nid: uni1\nmode: tasks\n---\n');
    await writeFile(join(folder, 'Meeting notes.md'), '# Notes\n');
  });

  it('saves into an existing list and remembers it as recently used', async () => {
    const workspace = await open();
    const outcome = await workspace.capture(
      { text: 'review PR ##unicorn', chooseNewList: false },
      now,
    );
    expect(outcome).toMatchObject({ kind: 'saved', listName: 'Unicorn', createdList: null });
    expect(await readFile(join(folder, 'Unicorn.md'), 'utf8')).toContain(
      '- [ ] review PR [id:: ',
    );
    const again = await open();
    expect(again.listInfos().find((list) => list.id === 'uni1')?.recentRank).toBe(0);
  });

  it('Enter takes the close match; Tab (chooseNewList) creates the typed list', async () => {
    const workspace = await open();
    expect(await workspace.capture({ text: 'a ##unis', chooseNewList: false }, now)).toMatchObject({
      listName: 'Unicorn',
    });
    const created = await workspace.capture({ text: 'b ##unis', chooseNewList: true }, now);
    expect(created).toMatchObject({ listName: 'unis', createdList: { name: 'unis' } });
    const file = await readFile(join(folder, 'unis.md'), 'utf8');
    expect(file).toMatch(/^---\nflint: 1\nid: [a-z0-9]{4,6}\nmode: tasks\n---\n- \[ \] b \[id:: /);
  });

  it('a note target stays text and the task goes to Inbox', async () => {
    const workspace = await open();
    const outcome = await workspace.capture(
      { text: 'agenda ##meeting-notes', chooseNewList: false },
      now,
    );
    expect(outcome).toMatchObject({ listName: 'Inbox' });
    expect(await inbox()).toContain('- [ ] agenda ##meeting-notes [id:: ');
  });

  it('Undo of a created list moves the task to Inbox and removes the empty list', async () => {
    const workspace = await open();
    const outcome = await workspace.capture(
      { text: 'try this ##sandbox', chooseNewList: false },
      now,
    );
    if (outcome.kind !== 'saved' || !outcome.createdList) throw new Error('no list created');
    await workspace.undoCreatedList(outcome.createdList, now);
    await expect(readFile(join(folder, 'sandbox.md'), 'utf8')).rejects.toThrow();
    expect(await inbox()).toContain(`- [ ] try this [id:: ${outcome.taskId}]`);
    expect(workspace.listInfos().map((list) => list.name)).not.toContain('sandbox');
  });

  it('Undo keeps a created list that got other content since', async () => {
    const workspace = await open();
    const outcome = await workspace.capture({ text: 'first ##sandbox', chooseNewList: false }, now);
    await workspace.capture({ text: 'second ##sandbox', chooseNewList: false }, now);
    if (outcome.kind !== 'saved' || !outcome.createdList) throw new Error('no list created');
    await workspace.undoCreatedList(outcome.createdList, now);
    const list = await readFile(join(folder, 'sandbox.md'), 'utf8');
    expect(list).toContain('- [ ] second');
    expect(list).not.toContain('first');
  });
});

describe('changes made outside Flint (DATA-06)', () => {
  it('picks up new, edited and removed lists', async () => {
    const workspace = await open();
    await writeFile(join(folder, 'Infra.md'), '---\nflint: 1\nid: inf1\nmode: tasks\n---\n');
    await workspace.fileChanged(join(folder, 'Infra.md'));
    expect(
      await workspace.capture({ text: 'rotate certs ##infra', chooseNewList: false }, now),
    ).toMatchObject({
      listName: 'Infra',
      createdList: null,
    });
    await writeFile(
      join(folder, 'Inbox.md'),
      `${await inbox()}- [ ] added in VS Code [id:: vsc1]\n`,
    );
    await workspace.fileChanged(join(folder, 'Inbox.md'));
    await workspace.capture({ text: 'from Flint', chooseNewList: false }, now);
    expect(await inbox()).toContain('- [ ] added in VS Code [id:: vsc1]');
    // Several files at once (one watcher event each) must not add a list twice.
    await writeFile(join(folder, 'A.md'), '---\nflint: 1\nid: aaa1\nmode: tasks\n---\n');
    await writeFile(join(folder, 'B.md'), '---\nflint: 1\nid: bbb1\nmode: tasks\n---\n');
    await Promise.all([
      workspace.fileChanged(join(folder, 'A.md')),
      workspace.fileChanged(join(folder, 'B.md')),
    ]);
    expect(workspace.listInfos().map((list) => list.name)).toEqual(['Inbox', 'Infra', 'A', 'B']);
    await rm(join(folder, 'A.md'));
    await rm(join(folder, 'B.md'));
    await rm(join(folder, 'Infra.md'));
    await workspace.fileChanged(join(folder, 'Infra.md'));
    expect(workspace.listInfos().map((list) => list.name)).toEqual(['Inbox']);
  });
});

describe('drafts (CAP-08)', () => {
  const thought = { title: 'half a thought', blocks: [{ kind: 'note', text: 'more' }] } as const;
  const empty = { title: '', blocks: [] };

  it('survive a restart and are cleared only for the draft that was saved', async () => {
    const path = join(base, 'drafts.json');
    const drafts = new DraftFile(path);
    await drafts.set(thought);
    expect(await new DraftFile(path).load()).toEqual(thought);
    await drafts.clearIf({ title: 'something else', blocks: [] });
    expect(await new DraftFile(path).load()).toEqual(thought);
    await drafts.clearIf(thought);
    expect(await new DraftFile(path).load()).toEqual(empty);
  });

  it('read a draft saved as plain text before D-38', async () => {
    const path = join(base, 'drafts.json');
    await writeFile(path, JSON.stringify({ capture: 'title line\nbody one\nbody two' }));
    expect(await new DraftFile(path).load()).toEqual({
      title: 'title line',
      blocks: [{ kind: 'text', text: 'body one\nbody two' }],
    });
  });

  it('set a draft aside for Ctrl+Shift+X, restore it, and discard with Shift+Esc (D-39)', async () => {
    const path = join(base, 'drafts.json');
    const drafts = new DraftFile(path);
    await drafts.set(thought);
    await drafts.setAside();
    expect(drafts.draft).toEqual(empty);
    expect(drafts.hasPrevious).toBe(true);
    await drafts.set({ title: 'from Teams', blocks: [] });
    const restarted = new DraftFile(path);
    await restarted.load();
    await restarted.restorePrevious();
    // The two swap: nothing is lost.
    expect(restarted.draft).toEqual(thought);
    await restarted.restorePrevious();
    expect(restarted.draft).toEqual({ title: 'from Teams', blocks: [] });
    await restarted.dismissPrevious();
    expect(restarted.hasPrevious).toBe(false);
    await restarted.discard();
    expect(restarted.hasContent).toBe(false);
    expect(await new DraftFile(path).load()).toEqual(empty);
  });

  it('keep pasted images until they are saved with the capture (CAP-06)', async () => {
    const path = join(base, 'drafts.json');
    const drafts = new DraftFile(path);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await drafts.attach(png, 'application/zip')).toBeNull();
    const first = await drafts.attach(png, 'image/png');
    const second = await drafts.attach(png, 'image/jpeg');
    if (!first || !second) throw new Error('not attached');
    expect(first.name).toBe('screenshot.png');
    await drafts.detach(second.id);
    await expect(readFile(second.file)).rejects.toThrow();

    const restored = new DraftFile(path);
    await restored.load();
    expect(restored.attachments.map((item) => item.id)).toEqual([first.id]);

    const workspace = await open();
    const outcome = await workspace.capture(
      { text: '', chooseNewList: false, attachments: restored.attachments },
      now,
    );
    if (outcome.kind !== 'saved') throw new Error('not saved');
    const name = `2026-10-29-143000-${outcome.taskId}.png`;
    expect(await inbox()).toContain(
      `- [ ] [id:: ${outcome.taskId}]\n    ![](attachments/${name})\n`,
    );
    expect(new Uint8Array(await readFile(join(folder, 'attachments', name)))).toEqual(png);

    await restored.clearIf(restored.draft, restored.attachments);
    expect(restored.attachments).toEqual([]);
    await expect(readFile(first.file)).rejects.toThrow();
  });

  it('save an image pasted into the main window to attachments/ (D-79)', async () => {
    const workspace = await open();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);
    expect(await workspace.saveImage(png, 'text/html', now)).toBeNull();
    const link = await workspace.saveImage(png, 'image/png', now);
    expect(link).toMatch(/^attachments\/2026-10-29-143000-\w+\.png$/);
    expect(new Uint8Array(await readFile(join(folder, link ?? '')))).toEqual(png);
  });
});

describe('the main window: complete, undo, views (M4, TASK-06)', () => {
  it('completes into the Completed section, and Undo restores the file exactly', async () => {
    const original =
      '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] first [id:: aaa1]\n- [ ] second [id:: bbb2]\n';
    await writeFile(join(folder, 'Inbox.md'), original);
    const workspace = await open();
    const changes: number[] = [];
    workspace.onChange(() => changes.push(1));
    expect(await workspace.toggleDone('inbox', 'aaa1', now)).toBe('Completed');
    expect(await inbox()).toBe(
      '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] second [id:: bbb2]\n\n## Completed\n- [x] first [completion:: 2026-10-29T14:30] [id:: aaa1]\n',
    );
    expect(workspace.summaries(now).find((list) => list.inbox)?.open).toBe(1);
    expect(workspace.view('inbox', now)?.completed.map((task) => task.title)).toEqual(['first']);
    expect(await workspace.undoLast(now)).toBe('Completed');
    expect(await inbox()).toBe(original);
    expect(await workspace.undoLast(now)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it('reopening puts a task back after the one it followed', async () => {
    await writeFile(
      join(folder, 'Inbox.md'),
      '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] one [id:: aaa1]\n- [ ] two [id:: bbb2]\n- [ ] three [id:: ccc3]\n',
    );
    const workspace = await open();
    await workspace.toggleDone('inbox', 'bbb2', now);
    expect(await workspace.toggleDone('inbox', 'bbb2', now)).toBe('Reopened');
    expect(
      workspace
        .view('inbox', now)
        ?.items.map((item) => (item.kind === 'task' ? item.task.title : '')),
    ).toEqual(['one', 'two', 'three']);
  });
});

describe('the main window: Navigate/Edit keys and the composer (M4, TASK-02..04, docs/03 §2)', () => {
  const header = '---\nflint: 1\nid: inbox\nmode: tasks\n---\n';
  const titles = (workspace: Workspace): string[] =>
    workspace
      .view('inbox', now)
      ?.items.flatMap((item) =>
        item.kind === 'task'
          ? [item.task.title, ...item.task.subtasks.map((task) => `  ${task.title}`)]
          : [],
      ) ?? [];

  it('keeps sidebar groups and order in .flint/sidebar.json, undoably (LIST-05, LIST-06, D-73)', async () => {
    await writeFile(join(folder, 'Inbox.md'), `${header}- [ ] one [id:: aaa1]\n`);
    for (const [name, id] of [
      ['Alpha', 'al01'],
      ['Beta', 'be01'],
    ])
      await writeFile(join(folder, `${name}.md`), `---\nflint: 1\nid: ${id}\nmode: tasks\n---\n`);
    const workspace = await open();
    expect(workspace.sidebar().items).toEqual([
      { kind: 'list', id: 'al01' },
      { kind: 'list', id: 'be01' },
    ]);
    const made = await workspace.sidebarAction({ kind: 'newGroup', name: 'Work' }, now);
    expect(made).toMatchObject({ ok: true, label: 'Created group Work' });
    const group = made.ok ? (made.id ?? '') : '';
    expect(await workspace.sidebarAction({ kind: 'newGroup', name: 'work' }, now)).toMatchObject({
      ok: false,
    });
    await workspace.sidebarAction({ kind: 'move', id: 'be01', to: { group, index: 0 } }, now);
    // D-80: a new group goes to the top of Lists.
    expect(workspace.sidebar().items).toEqual([
      { kind: 'group', id: group, name: 'Work', lists: ['be01'] },
      { kind: 'list', id: 'al01' },
    ]);
    const saved = JSON.parse(await readFile(join(folder, '.flint', 'sidebar.json'), 'utf8')) as {
      items: unknown;
    };
    expect(saved.items).toEqual([{ group, name: 'Work', lists: ['be01'] }, { list: 'al01' }]);
    // A duplicate goes right below its original, in its group.
    await workspace.duplicateList('be01', now);
    const inGroup = workspace.sidebar().items[0];
    expect(inGroup?.kind === 'group' && inGroup.lists.length).toBe(2);
    await workspace.undoLast(now);
    // Under a sort, reordering is refused; folding is this machine's.
    await workspace.sidebarAction({ kind: 'sort', sort: 'created' }, now);
    expect(await workspace.sidebarAction({ kind: 'step', id: 'al01', direction: 1 }, now)).toEqual({
      ok: false,
      problem: 'Switch the sort to Manual to reorder',
    });
    await workspace.sidebarAction({ kind: 'collapse', id: group, collapsed: true }, now);
    expect(workspace.sidebar()).toMatchObject({ sort: 'created', collapsed: [group] });
    await workspace.sidebarAction({ kind: 'sort', sort: 'manual' }, now);
    await workspace.sidebarAction({ kind: 'deleteGroup', id: group }, now);
    expect(workspace.sidebar().items.map((item) => item.id)).toEqual(['be01', 'al01']);
    expect(await workspace.undoLast(now)).toBe('Deleted group Work');
    expect(workspace.sidebar().items[0]).toMatchObject({ kind: 'group', lists: ['be01'] });
  });

  it('runs several changes as one step, undone together (TASK-07, D-59)', async () => {
    const original = `${header}- [ ] one [id:: aaa1]\n- [ ] two [id:: bbb2]\n- [ ] three [id:: ccc3]\n`;
    await writeFile(join(folder, 'Inbox.md'), original);
    const workspace = await open();
    const outcome = await workspace.change(
      'inbox',
      {
        kind: 'many',
        label: '2 tasks: priority high',
        changes: [
          { kind: 'priority', key: 'aaa1', priority: 'high' },
          { kind: 'priority', key: 'ccc3', priority: 'high' },
          { kind: 'complete', key: 'bbb2', done: true },
          { kind: 'complete', key: 'bbb2', done: true },
        ],
      },
      now,
    );
    expect(outcome?.label).toBe('2 tasks: priority high');
    expect(await inbox()).toContain('- [ ] one [priority:: high] [id:: aaa1]');
    expect(await inbox()).toContain('- [x] two [completion:: ');
    expect(await workspace.undoLast(now)).toBe('2 tasks: priority high');
    expect(await inbox()).toBe(original);
    expect(await workspace.redoLast(now)).toBe('2 tasks: priority high');
    expect(await inbox()).toContain('- [ ] three [priority:: high] [id:: ccc3]');
  });

  it('duplicates a task below it without its reminder (TASK-16, D-74)', async () => {
    await writeFile(
      join(folder, 'Inbox.md'),
      `${header}- [ ] call [reminder:: 2026-10-30T09:00] [priority:: low] [id:: aaa1]\n- [ ] next [id:: bbb2]\n`,
    );
    const workspace = await open();
    const outcome = await workspace.change('inbox', { kind: 'duplicate', key: 'aaa1' }, now);
    expect(outcome?.label).toBe('Duplicated');
    expect(await inbox()).toMatch(
      new RegExp(
        `^${header.replace(/[-]/g, '\\-')}- \\[ \\] call \\[reminder:: 2026-10-30T09:00\\] \\[priority:: low\\] \\[id:: aaa1\\]\\n- \\[ \\] call \\[priority:: low\\] \\[id:: ${outcome?.key ?? 'x'}\\]\\n- \\[ \\] next`,
      ),
    );
  });

  it('duplicates and converts lists, undoably (LIST-01, LIST-04, D-72)', async () => {
    await writeFile(join(folder, 'Inbox.md'), `${header}- [ ] one [id:: aaa1]\n`);
    await writeFile(
      join(folder, 'Plan.md'),
      '---\nflint: 1\nid: pla1\nmode: note\n---\n# Plan\n- ship it\n- [ ] test it [id:: ttt1]\n',
    );
    const workspace = await open();
    const copy = await workspace.duplicateList('pla1', now);
    expect(copy).toMatchObject({ ok: true, label: 'Duplicated as Plan copy' });
    const copied = await readFile(join(folder, 'Plan copy.md'), 'utf8');
    expect(copied).toMatch(
      /^---\nflint: 1\nid: \w+\nmode: note\n---\n# Plan\n- ship it\n- \[ \] test it \[id:: \w+\]\n$/,
    );
    expect(copied).not.toContain('pla1');
    expect(copied).not.toContain('ttt1');
    expect((await workspace.duplicateList('pla1', now)).ok).toBe(true);
    expect(workspace.summaries(now).map((list) => list.name)).toContain('Plan copy 2');
    await workspace.undoLast(now);
    await workspace.undoLast(now);
    await expect(readFile(join(folder, 'Plan copy.md'), 'utf8')).rejects.toThrow();

    expect(await workspace.convertList('pla1', 'tasks', now)).toMatchObject({ ok: true });
    expect(workspace.view('pla1', now)?.mode).toBe('tasks');
    expect(await readFile(join(folder, 'Plan.md'), 'utf8')).toMatch(
      /mode: tasks\n---\n# Plan\n- \[ \] ship it/,
    );
    await workspace.undoLast(now);
    expect(workspace.view('pla1', now)?.mode).toBe('note');
    expect(await workspace.convertList('inbox', 'note', now)).toMatchObject({ ok: false });
  });

  it('saves a body under its task, before the subtasks; undo restores it (TASK-05, D-49)', async () => {
    const original = `${header}- [ ] one [id:: aaa1]\n    - [ ] sub [id:: bbb2]\n`;
    await writeFile(join(folder, 'Inbox.md'), original);
    const workspace = await open();
    const body = 'See the trace:\n\n```\nError: boom\n```';
    expect(await workspace.change('inbox', { kind: 'body', key: 'aaa1', body }, now)).toMatchObject(
      { label: 'Edited', key: 'aaa1' },
    );
    expect(await inbox()).toBe(
      `${header}- [ ] one [id:: aaa1]\n    See the trace:\n\n    \`\`\`\n    Error: boom\n    \`\`\`\n    - [ ] sub [id:: bbb2]\n`,
    );
    expect(await workspace.change('inbox', { kind: 'body', key: 'aaa1', body }, now)).toBeNull();
    await workspace.undoLast(now);
    expect(await inbox()).toBe(original);
  });

  it('the composer adds to the top with shorthand; Edit-state Enter adds below', async () => {
    await writeFile(join(folder, 'Inbox.md'), `${header}- [ ] one [id:: aaa1]\n`);
    const workspace = await open();
    const added = await workspace.change(
      'inbox',
      { kind: 'add', text: 'ship it !h @15:00', where: 'top' },
      now,
    );
    expect(added).toMatchObject({ label: 'Added', listId: 'inbox', listName: 'Inbox' });
    expect(await inbox()).toMatch(
      /^- \[ \] ship it \[reminder:: 2026-10-29T15:00\] \[priority:: high\] \[id:: [a-z0-9]{4,6}\]\n- \[ \] one/m,
    );
    await workspace.change(
      'inbox',
      { kind: 'add', text: 'after one', where: { after: 'aaa1' } },
      now,
    );
    expect(titles(workspace)).toEqual(['ship it', 'one', 'after one']);
    expect(
      await workspace.change('inbox', { kind: 'add', text: '  ', where: 'top' }, now),
    ).toBeNull();
  });

  it('a ##list in the composer sends the task to that list; undo removes a list it created', async () => {
    const workspace = await open();
    const outcome = await workspace.change(
      'inbox',
      { kind: 'add', text: 'rotate keys ##Infra', where: 'top' },
      now,
    );
    expect(outcome).toMatchObject({ label: 'Added to Infra', listName: 'Infra' });
    expect(await readFile(join(folder, 'Infra.md'), 'utf8')).toContain('- [ ] rotate keys');
    expect(await workspace.undoLast(now)).toBe('Added to Infra');
    await expect(readFile(join(folder, 'Infra.md'), 'utf8')).rejects.toThrow();
    expect(workspace.summaries(now).map((list) => list.name)).toEqual(['Inbox']);
    // Its list is gone, so there is nothing to redo into.
    expect(await workspace.redoLast(now)).toBeNull();
  });

  it('edits keep escaped (selected or pasted) shorthand as text and apply typed tokens', async () => {
    await writeFile(join(folder, 'Inbox.md'), `${header}- [ ] deploy [id:: aaa1]\n`);
    const workspace = await open();
    const outcome = await workspace.change(
      'inbox',
      { kind: 'edit', key: 'aaa1', text: 'deploy hotfix \\@15:00 !m' },
      now,
    );
    expect(outcome?.label).toBe('Edited');
    expect(await inbox()).toBe(
      `${header}- [ ] deploy hotfix @15:00 [priority:: medium] [id:: aaa1]\n`,
    );
    // The existing title is inert when edited again: unchanged, it changes nothing; nor does
    // emptying the title of a task without a body.
    expect(
      await workspace.change(
        'inbox',
        { kind: 'edit', key: 'aaa1', text: 'deploy hotfix \\@15:00' },
        now,
      ),
    ).toBeNull();
    expect(
      await workspace.change('inbox', { kind: 'edit', key: 'aaa1', text: '' }, now),
    ).toBeNull();
  });

  it('a drop places a task with its subtasks, undoably (TASK-01, D-54)', async () => {
    const original = `${header}- [ ] one [id:: aaa1]\n- [ ] two [id:: bbb2]\n    - [ ] two-a [id:: bb2a]\n    - [ ] two-b [id:: bb2b]\n- [ ] three [id:: ccc3]\n`;
    await writeFile(join(folder, 'Inbox.md'), original);
    const workspace = await open();
    await workspace.change(
      'inbox',
      { kind: 'place', key: 'ccc3', where: { at: 'before', key: 'aaa1' } },
      now,
    );
    expect(titles(workspace)).toEqual(['three', 'one', 'two', '  two-a', '  two-b']);
    await workspace.change(
      'inbox',
      { kind: 'place', key: 'bb2b', where: { at: 'before', key: 'bb2a' } },
      now,
    );
    expect(titles(workspace)).toEqual(['three', 'one', 'two', '  two-b', '  two-a']);
    expect(
      await workspace.change(
        'inbox',
        { kind: 'place', key: 'bb2b', where: { at: 'after', key: 'ccc3' } },
        now,
      ),
    ).toBeNull();
    await workspace.undoLast(now);
    await workspace.undoLast(now);
    expect(await inbox()).toBe(original);
  });

  it('priority, reorder, indent and outdent are undoable and redoable', async () => {
    const original = `${header}- [ ] one [id:: aaa1]\n- [ ] two [id:: bbb2]\n- [ ] three [id:: ccc3]\n`;
    await writeFile(join(folder, 'Inbox.md'), original);
    const workspace = await open();
    await workspace.change('inbox', { kind: 'priority', key: 'bbb2', priority: 'high' }, now);
    expect(workspace.view('inbox', now)?.items[1]).toMatchObject({
      task: { title: 'two', priority: 'high' },
    });
    expect(
      await workspace.change('inbox', { kind: 'move', key: 'aaa1', direction: 'up' }, now),
    ).toBeNull();
    await workspace.change('inbox', { kind: 'move', key: 'ccc3', direction: 'up' }, now);
    expect(titles(workspace)).toEqual(['one', 'three', 'two']);
    await workspace.change('inbox', { kind: 'indent', key: 'ccc3' }, now);
    expect(titles(workspace)).toEqual(['one', '  three', 'two']);
    await workspace.change('inbox', { kind: 'outdent', key: 'ccc3' }, now);
    expect(titles(workspace)).toEqual(['one', 'three', 'two']);

    for (const label of ['Outdented', 'Indented', 'Moved', 'Priority high'])
      expect(await workspace.undoLast(now)).toBe(label);
    expect(await inbox()).toBe(original);
    expect(await workspace.redoLast(now)).toBe('Priority high');
    expect(await workspace.redoLast(now)).toBe('Moved');
    expect(titles(workspace)).toEqual(['one', 'three', 'two']);
    // A new change clears what could be redone.
    await workspace.change('inbox', { kind: 'priority', key: 'aaa1', priority: null }, now);
    expect(await workspace.redoLast(now)).toBeNull();
  });
});

describe('reminders from the lists (REM-01, REM-05; D-64)', () => {
  const header = '---\nflint: 1\nid: inbox\nmode: tasks\n---\n';

  it('lists the tasks with reminders, labels untitled ones, skips notes', async () => {
    await writeFile(
      join(folder, 'Inbox.md'),
      `${header}- [ ] call Alex [reminder:: 2026-10-29T15:00] [id:: aaa1]\n- [x] old [reminder:: 2026-10-28T09:00] [completion:: 2026-10-28T10:00] [id:: bbb2]\n- [ ] no reminder [id:: ccc3]\n`,
    );
    await writeFile(join(folder, 'Notes.md'), '- [ ] inert [reminder:: 2026-10-29T15:00]\n');
    const workspace = await open();
    expect(
      workspace.reminderTasks().map((task) => [task.id, task.title, task.done, task.listName]),
    ).toEqual([
      ['aaa1', 'call Alex', false, 'Inbox'],
      ['bbb2', 'old', true, 'Inbox'],
    ]);
    expect(workspace.locate('aaa1')).toEqual({ listId: 'inbox', key: 'aaa1' });
    expect(workspace.locate('nope')).toBeNull();
  });

  it('Done completes an open task once; Snooze moves the reminder 10 minutes on, undoably', async () => {
    const original = `${header}- [ ] call Alex [reminder:: 2026-10-29T14:30] [id:: aaa1]\n`;
    await writeFile(join(folder, 'Inbox.md'), original);
    const workspace = await open();
    const at = new Date(2026, 9, 29, 14, 30, 20);
    expect(await workspace.snoozeById('aaa1', at)).toBe('Snoozed');
    expect(await inbox()).toBe(
      `${header}- [ ] call Alex [reminder:: 2026-10-29T14:41] [id:: aaa1]\n`,
    );
    expect(await workspace.undoLast(now)).toBe('Snoozed');
    expect(await inbox()).toBe(original);

    expect(await workspace.completeById('aaa1', now)).toBe('Completed');
    expect(await workspace.completeById('aaa1', now)).toBeNull();
    expect(await workspace.snoozeById('gone', now)).toBeNull();
  });
});

describe('delete, move and list actions (M4 step 4: TASK-11, TASK-12, LIST-01, D-50, D-64)', () => {
  const header = '---\nflint: 1\nid: inbox\nmode: tasks\n---\n';
  const trashFiles = async (): Promise<string[]> =>
    (await readdir(join(folder, '.flint', 'trash')).catch(() => [])).sort();

  it('delete moves a task with its subtasks to Trash storage; undo and redo', async () => {
    const original = `${header}- [ ] one [id:: aaa1]\n    - [ ] sub [id:: sub1]\n- [ ] two [id:: bbb2]\n`;
    await writeFile(join(folder, 'Inbox.md'), original);
    const workspace = await open();
    expect(await workspace.change('inbox', { kind: 'delete', key: 'aaa1' }, now)).toMatchObject({
      label: 'Deleted',
    });
    expect(await inbox()).toBe(`${header}- [ ] two [id:: bbb2]\n`);
    const [file] = await trashFiles();
    expect(file).toBe('2026-10-29-143000-task-aaa1.md');
    expect(await readFile(join(folder, '.flint', 'trash', file!), 'utf8')).toBe(
      '---\nflint: 1\ntrashed: 2026-10-29T14:30\nlist: inbox\nlistName: "Inbox"\n---\n- [ ] one [id:: aaa1]\n    - [ ] sub [id:: sub1]\n',
    );
    // Trashed IDs stay taken (D-29).
    expect(workspace.isTaken('sub1')).toBe(true);

    expect(await workspace.undoLast(now)).toBe('Deleted');
    expect(await inbox()).toBe(original);
    expect(await trashFiles()).toEqual([]);
    expect(await workspace.redoLast(now)).toBe('Deleted');
    expect(await trashFiles()).toHaveLength(1);
  });

  it('moves a task to the top of another list, or a new one; undo puts it back', async () => {
    const original = `${header}- [ ] one [id:: aaa1]\n- [ ] two [id:: bbb2]\n`;
    await writeFile(join(folder, 'Inbox.md'), original);
    await writeFile(
      join(folder, 'Infra.md'),
      '---\nflint: 1\nid: inf1\nmode: tasks\n---\n- [ ] old [id:: ccc3]\n',
    );
    const workspace = await open();
    expect(
      await workspace.change('inbox', { kind: 'moveTo', key: 'bbb2', to: { list: 'inf1' } }, now),
    ).toMatchObject({ label: 'Moved to Infra', listId: 'inf1', key: 'bbb2' });
    expect(await inbox()).toBe(`${header}- [ ] one [id:: aaa1]\n`);
    expect(await readFile(join(folder, 'Infra.md'), 'utf8')).toBe(
      '---\nflint: 1\nid: inf1\nmode: tasks\n---\n- [ ] two [id:: bbb2]\n- [ ] old [id:: ccc3]\n',
    );
    expect(await workspace.undoLast(now)).toBe('Moved to Infra');
    expect(await inbox()).toBe(original);

    await workspace.change('inbox', { kind: 'moveTo', key: 'aaa1', to: { newList: 'Ops' } }, now);
    expect(await readFile(join(folder, 'Ops.md'), 'utf8')).toContain('- [ ] one [id:: aaa1]');
    expect(await workspace.undoLast(now)).toBe('Moved to Ops');
    await expect(readFile(join(folder, 'Ops.md'))).rejects.toThrow();
    expect(await inbox()).toBe(original);
  });

  it('creates, renames and deletes lists and notes, all undoable; Inbox is protected', async () => {
    const workspace = await open();
    expect(await workspace.newList('  ', 'tasks', now)).toEqual({
      ok: false,
      problem: 'A list needs a name',
    });
    expect(await workspace.newList('a:b', 'tasks', now)).toMatchObject({ ok: false });
    expect(await workspace.newList('inbox', 'tasks', now)).toEqual({
      ok: false,
      problem: 'A list with that name exists',
    });
    const created = await workspace.newList('Ideas', 'note', now);
    expect(created).toMatchObject({ ok: true, label: 'Created note Ideas' });
    const id = created.ok ? created.listId : '';
    expect(await readFile(join(folder, 'Ideas.md'), 'utf8')).toBe(
      `---\nflint: 1\nid: ${id}\nmode: note\n---\n`,
    );

    expect(await workspace.renameList(id, 'Thoughts', now)).toMatchObject({ ok: true });
    expect(await readFile(join(folder, 'Thoughts.md'), 'utf8')).toContain(`id: ${id}`);
    await expect(readFile(join(folder, 'Ideas.md'))).rejects.toThrow();
    expect(await workspace.undoLast(now)).toBe('Renamed to Thoughts');
    expect(await readFile(join(folder, 'Ideas.md'), 'utf8')).toContain(`id: ${id}`);

    expect(await workspace.deleteList(id, now)).toMatchObject({ ok: true, label: 'Deleted Ideas' });
    await expect(readFile(join(folder, 'Ideas.md'))).rejects.toThrow();
    expect(await trashFiles()).toEqual(['2026-10-29-143000-Ideas.md']);
    expect(workspace.summaries(now).map((list) => list.name)).toEqual(['Inbox']);
    expect(await workspace.undoLast(now)).toBe('Deleted Ideas');
    expect(workspace.summaries(now).map((list) => list.name)).toEqual(['Inbox', 'Ideas']);

    expect(await workspace.deleteList('inbox', now)).toMatchObject({ ok: false });
    expect(await workspace.renameList('inbox', 'Other', now)).toMatchObject({ ok: false });
  });

  it('saves a note as plain text, adding the header to a file that had none (D-23, D-64)', async () => {
    await writeFile(join(folder, 'Standup.md'), '# Standup\n\n- Alex: DNS\n');
    const workspace = await open();
    const note = workspace.summaries(now).find((list) => list.name === 'Standup');
    expect(note?.mode).toBe('note');
    const saved = await workspace.saveNote(note!.id, '# Standup\n\n- Alex: DNS fixed\n', now);
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.listId : '';
    expect(id).not.toBe(note!.id);
    expect(await readFile(join(folder, 'Standup.md'), 'utf8')).toBe(
      `---\nflint: 1\nid: ${id}\nmode: note\n---\n# Standup\n\n- Alex: DNS fixed\n`,
    );
    expect(workspace.view(id, now)?.noteText).toBe('# Standup\n\n- Alex: DNS fixed\n');
    // Undo reverts the text; the header Flint added stays, so the open note keeps its ID.
    expect(await workspace.undoLast(now)).toBe('Edited note');
    expect(await readFile(join(folder, 'Standup.md'), 'utf8')).toBe(
      `---\nflint: 1\nid: ${id}\nmode: note\n---\n# Standup\n\n- Alex: DNS\n`,
    );
    expect(workspace.view(id, now)?.noteText).toBe('# Standup\n\n- Alex: DNS\n');
  });
});

describe('pins, captures and a task as a note (TODAY-01, TASK-17, D-85)', () => {
  const list = (body: string): Promise<void> =>
    writeFile(join(folder, 'Work.md'), `---\nflint: 1\nid: wrk1\nmode: tasks\n---\n${body}`);
  const work = (): Promise<string> => readFile(join(folder, 'Work.md'), 'utf8');

  it('pins and unpins undoably; an old `today` pin reads as a pin and is written as `pinned`', async () => {
    await list('- [ ] Plan [today:: true] [id:: aaaa]\n- [ ] Ship [id:: bbbb]\n');
    const workspace = await open();
    expect(workspace.panelTasks().pinned.map((task) => task.id)).toEqual(['aaaa']);
    expect(
      await workspace.change('wrk1', { kind: 'pin', key: 'bbbb', pinned: true }, now),
    ).toMatchObject({ label: 'Pinned' });
    expect(await work()).toContain('- [ ] Ship [pinned:: true] [id:: bbbb]\n');
    expect(
      await workspace.change('wrk1', { kind: 'pin', key: 'bbbb', pinned: true }, now),
    ).toBeNull();
    expect(await workspace.undoLast(now)).toBe('Pinned');
    expect(await work()).toContain('- [ ] Ship [id:: bbbb]\n');
    await workspace.change('wrk1', { kind: 'edit', key: 'aaaa', text: 'Plan the day' }, now);
    expect(await work()).toContain('- [ ] Plan the day [pinned:: true] [id:: aaaa]\n');
  });

  it('unpins tasks completed before today, keeps today’s done pins and open ones', async () => {
    await list(
      '- [ ] Open [pinned:: true] [id:: aaaa]\n- [x] Done today [pinned:: true] [completion:: 2026-10-29T09:00] [id:: bbbb]\n- [x] Done before [pinned:: true] [completion:: 2026-10-28T17:00] [id:: cccc]\n',
    );
    const workspace = await open();
    expect(await workspace.unpinDone(now)).toBe(1);
    const text = await work();
    expect(text).toContain('Open [pinned:: true]');
    expect(text).toContain('Done today [pinned:: true]');
    expect(text).toContain('- [x] Done before [completion:: 2026-10-28T17:00] [id:: cccc]');
    expect(await workspace.unpinDone(new Date(2026, 9, 30, 0, 5))).toBe(1);
  });

  it('remembers popup captures, newest first', async () => {
    const workspace = await open();
    await workspace.capture({ text: 'first', chooseNewList: false }, now);
    await workspace.capture(
      { text: 'second', chooseNewList: false },
      new Date(2026, 9, 29, 14, 31),
    );
    await workspace.change('inbox', { kind: 'add', text: 'from the composer', where: 'top' }, now);
    expect(workspace.panelTasks().captured.map((task) => task.title)).toEqual(['second', 'first']);
  });

  it('converts a task to a note and back with one undo', async () => {
    await list(
      '- [ ] Fix the resolver [priority:: high] [id:: aaaa]\n    Seen on staging.\n    - [x] Reproduce [id:: bbbb]\n- [ ] Ship [id:: cccc]\n',
    );
    const workspace = await open();
    const outcome = await workspace.change('wrk1', { kind: 'toNote', key: 'aaaa' }, now);
    expect(outcome).toMatchObject({
      label: 'Converted to note Fix the resolver',
      listName: 'Fix the resolver',
    });
    const note = await readFile(join(folder, 'Fix the resolver.md'), 'utf8');
    expect(note).toBe(
      `---\nflint: 1\nid: ${outcome?.listId}\nmode: note\n---\nSeen on staging.\n\n- [x] Reproduce\n`,
    );
    expect(await work()).toBe(
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Ship [id:: cccc]\n',
    );
    expect(await workspace.undoLast(now)).toBe('Converted to note Fix the resolver');
    expect(await work()).toContain('- [ ] Fix the resolver [priority:: high] [id:: aaaa]\n');
    await expect(readFile(join(folder, 'Fix the resolver.md'))).rejects.toThrow();
    expect(await workspace.redoLast(now)).toBe('Converted to note Fix the resolver');
    expect(await readFile(join(folder, 'Fix the resolver.md'), 'utf8')).toContain(
      '- [x] Reproduce\n',
    );
    expect(await work()).not.toContain('Fix the resolver');
  });
});

describe('auto-archive (TASK-06, Q-13, D-88)', () => {
  it('moves tasks completed before the cutoff, with their subtasks, to .flint/archive', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Open [id:: aaaa]\n- [x] Old [completion:: 2026-10-01T09:00] [id:: bbbb]\n    - [x] Old sub [id:: bbb2]\n- [x] Recent [completion:: 2026-10-28T09:00] [id:: cccc]\n',
    );
    const workspace = await open();
    expect(await workspace.archiveDone(now, 14)).toBe(1);
    const work = await readFile(join(folder, 'Work.md'), 'utf8');
    expect(work).not.toContain('Old');
    expect(work).toContain('Recent');
    const archived = await readFile(join(folder, '.flint', 'archive', 'wrk1.md'), 'utf8');
    expect(archived).toMatch(
      /- \[x\] Old \[completion:: 2026-10-01T09:00\] \[id:: bbbb\]\n {4}- \[x\] Old sub/,
    );
    // Nothing left to archive the second time.
    expect(await workspace.archiveDone(now, 14)).toBe(0);
  });
});

describe('Trash and Archived (DATA-02, TASK-06, MEDIA-04, D-97)', () => {
  const work = (): Promise<string> => readFile(join(folder, 'Work.md'), 'utf8');
  const trash = (): Promise<string[]> => readdir(join(folder, '.flint', 'trash')).catch(() => []);

  it('shows a deleted task with its list, restores it in one undo step', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Keep [id:: aaaa]\n- [ ] Delete me [id:: bbbb]\n    notes stay\n- [x] Old [completion:: 2026-10-01T09:00] [id:: cccc]\n',
    );
    const workspace = await open();
    await workspace.change('wrk1', { kind: 'delete', key: 'bbbb' }, now);
    const view = await workspace.trashView();
    expect(view.deleted).toEqual([
      expect.objectContaining({
        kind: 'task',
        title: 'Delete me',
        from: 'Work',
        deleted: '2026-10-29T14:30',
      }),
    ]);
    const name = view.deleted[0]?.id ?? '';
    // D-98: opened read-only: the title, the notes.
    expect(await workspace.trashPreview(name)).toMatchObject({
      title: 'Delete me',
      body: 'notes stay',
      tasks: [],
    });
    expect(await workspace.restoreFromTrash(name, now)).toEqual({
      label: 'Restored to Work',
      listId: 'wrk1',
      listName: 'Work',
      key: 'bbbb',
    });
    expect(await work()).toMatch(/- \[ \] Delete me \[id:: bbbb\]\n {4}notes stay/);
    expect(await trash()).toEqual([]);
    // Undo takes it out again and puts its trash file back.
    expect(await workspace.undoLast(now)).toBe('Restored to Work');
    expect(await work()).not.toContain('Delete me');
    expect(await trash()).toEqual([name]);
  });

  it('restores a deleted list under its name, or as "(restored)" when it is taken', async () => {
    await writeFile(join(folder, 'Notes.md'), '---\nflint: 1\nid: nte1\nmode: note\n---\nA note\n');
    const workspace = await open();
    await workspace.deleteList('nte1', now);
    const name = (await workspace.trashView()).deleted[0];
    expect(name).toMatchObject({ kind: 'note', title: 'Notes', from: null });
    await writeFile(join(folder, 'Notes.md'), 'someone else');
    expect((await workspace.restoreFromTrash(name?.id ?? '', now))?.label).toBe(
      'Restored Notes (restored)',
    );
    expect(await readFile(join(folder, 'Notes (restored).md'), 'utf8')).toContain('A note');
    expect(workspace.listInfos().map((info) => info.name)).toContain('Notes (restored)');
    await workspace.undoLast(now);
    expect(await trash()).toHaveLength(1);
  });

  it('Delete now, Empty Trash and the 30-day expiry remove for good', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Keep [id:: aaaa]\n- [ ] Delete me [id:: bbbb]\n    notes stay\n- [x] Old [completion:: 2026-10-01T09:00] [id:: cccc]\n',
    );
    const workspace = await open();
    await workspace.change('wrk1', { kind: 'delete', key: 'bbbb' }, now);
    await workspace.change('wrk1', { kind: 'delete', key: 'aaaa' }, new Date(2026, 9, 1, 9, 0));
    expect(await trash()).toHaveLength(2);
    expect((await workspace.expireTrash(now, false)).expired).toBe(0);
    expect((await workspace.expireTrash(new Date(2026, 10, 1, 9, 0), false)).expired).toBe(1);
    const left = await trash();
    expect(left).toHaveLength(1);
    expect(await workspace.deleteFromTrash(left[0] ?? '')).toBe(true);
    expect(await workspace.deleteFromTrash('../Work.md')).toBe(false);
    expect(await workspace.emptyTrash()).toBe(0);
    expect(await work()).toContain('Old');
  });

  it('cleans up attachments nothing mentions, at start-up, never young ones', async () => {
    await writeFile(
      join(folder, 'Inbox.md'),
      '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] With [id:: aaaa]\n    ![](attachments/used%20one.png)\n',
    );
    await mkdir(join(folder, 'attachments'), { recursive: true });
    const old = new Date(2026, 9, 1);
    for (const file of ['used one.png', 'orphan.png', 'young.png']) {
      await writeFile(join(folder, 'attachments', file), 'x');
      if (file !== 'young.png') await utimes(join(folder, 'attachments', file), old, old);
    }
    const workspace = await open();
    expect((await workspace.expireTrash(new Date(), true)).orphans).toEqual(['orphan.png']);
    expect((await readdir(join(folder, 'attachments'))).sort()).toEqual([
      'used one.png',
      'young.png',
    ]);
  });

  it('lists archived tasks by list and restores one, still completed, undoable', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Keep [id:: aaaa]\n- [ ] Delete me [id:: bbbb]\n    notes stay\n- [x] Old [completion:: 2026-10-01T09:00] [id:: cccc]\n',
    );
    const workspace = await open();
    await workspace.archiveDone(now, 14);
    expect((await workspace.trashView()).archived).toEqual([
      {
        listId: 'wrk1',
        listName: 'Work',
        tasks: [{ key: 'cccc', title: 'Old', completed: '2026-10-01' }],
      },
    ]);
    expect(await workspace.restoreArchived('wrk1', 'cccc', now)).toBe('Restored to Work');
    expect(await work()).toContain('- [x] Old [completion:: 2026-10-01T09:00] [id:: cccc]');
    expect((await workspace.trashView()).archived).toEqual([]);
    await workspace.undoLast(now);
    expect(await work()).not.toContain('Old');
    expect((await workspace.trashView()).archived[0]?.tasks).toHaveLength(1);
  });
});

describe('restoring snapshots (DATA-04, D-97)', () => {
  const work = (): Promise<string> => readFile(join(folder, 'Work.md'), 'utf8');

  it('restores one list (a fresh snapshot first), one undo step; a note with its picture', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] First version [id:: aaaa]\n',
    );
    await mkdir(join(folder, 'attachments'), { recursive: true });
    await writeFile(join(folder, 'attachments', 'shot.png'), 'png');
    await writeFile(
      join(folder, 'Notes.md'),
      '---\nflint: 1\nid: nte1\nmode: note\n---\nPicture ![](attachments/shot.png)\n',
    );
    const store = new SnapshotStore(folder, join(base, 'snapshots'));
    const workspace = await open();
    const old = await store.take(new Date(2026, 9, 29, 9, 0));
    await workspace.change('wrk1', { kind: 'edit', key: 'aaaa', text: 'Second version' }, now);
    await rm(join(folder, 'Notes.md'));
    await rm(join(folder, 'attachments', 'shot.png'));
    await workspace.fileChanged(join(folder, 'Notes.md'));
    expect(await workspace.snapshotFiles(store, old?.id ?? '')).toEqual([
      { path: 'Work.md', name: 'Work', kind: 'list', state: 'changed' },
      { path: 'Notes.md', name: 'Notes', kind: 'note', state: 'deleted' },
      { path: 'Inbox.md', name: 'Inbox', kind: 'list', state: 'same' },
    ]);
    expect((await workspace.snapshots(store))[0]?.differs).toBe(2);
    expect(await workspace.restoreSnapshot(store, old?.id ?? '', 'Work.md', now)).toBe(
      'Restored Work',
    );
    expect(await work()).toContain('First version');
    expect(workspace.view('wrk1', now)?.items[0]).toMatchObject({
      task: { title: 'First version' },
    });
    // The undo goes back to how it was just before.
    expect(await workspace.undoLast(now)).toBe('Restored Work');
    expect(await work()).toContain('Second version');
    // A deleted note comes back with its picture.
    await workspace.restoreSnapshot(store, old?.id ?? '', 'Notes.md', now);
    expect(await readFile(join(folder, 'Notes.md'), 'utf8')).toContain('Picture');
    expect(await readFile(join(folder, 'attachments', 'shot.png'), 'utf8')).toBe('png');
    expect(workspace.listInfos().map((info) => info.name)).toContain('Notes');
  });

  it('restores everything (files added since go, they are in the fresh snapshot), undoable', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] First version [id:: aaaa]\n',
    );
    const store = new SnapshotStore(folder, join(base, 'snapshots'));
    const workspace = await open();
    const old = await store.take(new Date(2026, 9, 29, 9, 0));
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Second version [id:: aaaa]\n',
    );
    await writeFile(join(folder, 'Later.md'), '---\nflint: 1\nid: ltr1\nmode: note\n---\nlater\n');
    await workspace.fileChanged(join(folder, 'Later.md'));
    expect(await workspace.restoreSnapshot(store, old?.id ?? '', null, now)).toBe(
      'Restored the whole Flint folder',
    );
    expect(await work()).toContain('First version');
    expect(workspace.listInfos().map((info) => info.name)).not.toContain('Later');
    await workspace.undoLast(now);
    expect(await work()).toContain('Second version');
    expect(workspace.listInfos().map((info) => info.name)).toContain('Later');
  });
});

describe('quick notes (NOTE-08, D-99)', () => {
  it('an untitled note under Inbox, labelled by its first line; a title makes it a normal note', async () => {
    const workspace = await open();
    const id = (await workspace.newQuickNote(now)) ?? '';
    const file = join(folder, 'Quick note 2026-10-29 1430.md');
    expect(await readFile(file, 'utf8')).toBe(
      `---\nflint: 1\nid: ${id}\nmode: note\nquick: true\n---\n`,
    );
    const quick = (): { label: string } | undefined =>
      workspace.summaries(now).find((list) => list.id === id)?.quick;
    expect(quick()?.label).toMatch(/^Quick note · \d\d:\d\d$/);
    // Not among the sidebar's lists until it gets a title.
    expect(JSON.stringify(workspace.sidebar().items)).not.toContain(id);
    await workspace.saveNote(id, '# Call **Alex** back\nabout the quote\n', now);
    expect(quick()?.label).toBe('Call Alex back');
    expect(await workspace.keepQuickNote(id, 'Alex', now)).toMatchObject({ ok: true });
    expect(await readFile(join(folder, 'Alex.md'), 'utf8')).not.toContain('quick: true');
    expect(quick()).toBeUndefined();
    expect(JSON.stringify(workspace.sidebar().items)).toContain(id);
    // One undo step: its old name and its flag again.
    await workspace.undoLast(now);
    expect(await readFile(file, 'utf8')).toContain('quick: true');
    expect(quick()).toBeDefined();
  });

  it('an empty one left behind goes; one with text stays', async () => {
    const workspace = await open();
    const empty = (await workspace.newQuickNote(now)) ?? '';
    const kept = (await workspace.newQuickNote(now)) ?? '';
    await workspace.saveNote(kept, 'keep me\n', now);
    expect(await workspace.discardQuickNote(empty)).toBe(true);
    expect(await workspace.discardQuickNote(kept)).toBe(false);
    const names = workspace.listInfos().map((info) => info.name);
    expect(names).toContain('Quick note 2026-10-29 1430 (2)');
    expect(names).not.toContain('Quick note 2026-10-29 1430');
  });
});

describe('a snapshot compared with now (DATA-04, D-99)', () => {
  it('a task list by task ID; chosen tasks restored in place, one undo step', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Alpha [id:: aaaa]\n- [ ] Bravo [priority:: high] [id:: bbbb]\n- [ ] Charlie [id:: cccc]\n',
    );
    const store = new SnapshotStore(folder, join(base, 'snapshots'));
    const workspace = await open();
    const old = await store.take(new Date(2026, 9, 29, 9, 0));
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Alpha edited [id:: aaaa]\n- [ ] Charlie [id:: cccc]\n- [ ] Delta [id:: dddd]\n',
    );
    await workspace.fileChanged(join(folder, 'Work.md'));
    expect(await workspace.snapshotDiff(store, old?.id ?? '', 'Work.md')).toEqual({
      kind: 'list',
      name: 'Work',
      tasks: [
        { key: 'aaaa', state: 'changed', title: 'Alpha', changes: ['title'] },
        { key: 'bbbb', state: 'deleted', title: 'Bravo', changes: [] },
        { key: 'dddd', state: 'added', title: 'Delta', changes: [] },
      ],
    });
    expect(
      await workspace.restoreSnapshotTasks(
        store,
        old?.id ?? '',
        'Work.md',
        ['aaaa', 'bbbb', 'dddd'],
        now,
      ),
    ).toBe('Restored 3 tasks in Work');
    const text = await readFile(join(folder, 'Work.md'), 'utf8');
    expect(text).toMatch(
      /- \[ \] Alpha \[id:: aaaa\]\n- \[ \] Bravo \[priority:: high\] \[id:: bbbb\]\n- \[ \] Charlie \[id:: cccc\]\n$/,
    );
    await workspace.undoLast(now);
    expect(await readFile(join(folder, 'Work.md'), 'utf8')).toContain('Delta');
  });

  it('a note line by line', async () => {
    await writeFile(
      join(folder, 'Notes.md'),
      '---\nflint: 1\nid: nte1\nmode: note\n---\none\ntwo\nthree\n',
    );
    const store = new SnapshotStore(folder, join(base, 'snapshots'));
    const workspace = await open();
    const old = await store.take(new Date(2026, 9, 29, 9, 0));
    await writeFile(
      join(folder, 'Notes.md'),
      '---\nflint: 1\nid: nte1\nmode: note\n---\none\nTWO\nthree\nfour\n',
    );
    await workspace.fileChanged(join(folder, 'Notes.md'));
    expect(await workspace.snapshotDiff(store, old?.id ?? '', 'Notes.md')).toEqual({
      kind: 'note',
      name: 'Notes',
      lines: [
        { kind: 'same', text: 'one' },
        { kind: 'removed', text: 'two' },
        { kind: 'added', text: 'TWO' },
        { kind: 'same', text: 'three' },
        { kind: 'added', text: 'four' },
      ],
    });
  });
});

describe('Today (TODAY-01, TODAY-02, TODAY-03, M6, D-89, D-92)', () => {
  const work = (): Promise<string> => readFile(join(folder, 'Work.md'), 'utf8');
  const all = (workspace: Workspace, at = now): string[] =>
    (workspace.view(TODAY_ID, at)?.items ?? []).flatMap((item) =>
      item.kind === 'task' ? [item.task.key] : [],
    );
  /** The open pinned tasks: Today's order. */
  const keys = (workspace: Workspace, at = now): string[] =>
    all(workspace, at).slice(0, workspace.view(TODAY_ID, at)?.open ?? 0);
  beforeEach(async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Plan [pinned:: true] [id:: aaaa]\n- [ ] Ship [reminder:: 2026-10-29T16:00] [id:: bbbb]\n    - [ ] Test [pinned:: true] [id:: cccc]\n- [x] Done [pinned:: true] [completion:: 2026-10-29T09:00] [id:: dddd]\n',
    );
  });

  it("shows the pinned tasks of every list with their home list; Flint's new pins first", async () => {
    const workspace = await open();
    const view = workspace.view(TODAY_ID, now);
    expect(view).toMatchObject({ name: 'Today', mode: 'tasks', open: 2 });
    expect(keys(workspace)).toEqual(['aaaa', 'cccc']);
    // D-92: a done pin stays in Focus, after the open ones, with its time, until the day changes.
    expect(all(workspace)).toEqual(['aaaa', 'cccc', 'dddd']);
    expect(view?.items[2]).toMatchObject({ task: { done: true, completed: 'done 09:00' } });
    expect(view?.completed).toEqual([]);
    expect(view?.items[0]).toMatchObject({ task: { home: { listId: 'wrk1', listName: 'Work' } } });
    expect(view?.today?.reminders).toEqual([
      expect.objectContaining({ key: 'bbbb', time: '16:00', listName: 'Work', done: false }),
    ]);
    await workspace.change('wrk1', { kind: 'pin', key: 'bbbb', pinned: true }, now);
    expect(keys(workspace)).toEqual(['bbbb', 'aaaa']);
    expect(workspace.sidebar().today).toBe(2);
  });

  it('routes changes to the home list; adds pinned to Inbox; orders itself, undoably', async () => {
    const workspace = await open();
    await workspace.change(TODAY_ID, { kind: 'priority', key: 'aaaa', priority: 'high' }, now);
    expect(await work()).toContain('- [ ] Plan [pinned:: true] [priority:: high] [id:: aaaa]');
    const added = await workspace.change(
      TODAY_ID,
      { kind: 'add', text: 'Call the vendor', where: 'top' },
      now,
    );
    expect(added).toMatchObject({ listId: TODAY_ID });
    expect(await inbox()).toContain('- [ ] Call the vendor [pinned:: true] [id:: ');
    expect(keys(workspace)[0]).toBe(added?.key);
    await workspace.change(TODAY_ID, { kind: 'move', key: 'cccc', direction: 'up' }, now);
    expect(keys(workspace)).toEqual([added?.key, 'cccc', 'aaaa']);
    expect(await workspace.undoLast(now)).toBe('Moved');
    expect(keys(workspace)).toEqual([added?.key, 'aaaa', 'cccc']);
    expect(await workspace.change(TODAY_ID, { kind: 'indent', key: 'cccc' }, now)).toBeNull();
    expect(await workspace.toggleDone(TODAY_ID, 'aaaa', now)).toBe('Completed');
    expect(await work()).toMatch(/- \[x\] Plan/);
  });

  it('D-92: high priority not pinned, done today, captured today, the timeline and progress', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Plan [pinned:: true] [id:: aaaa]\n- [ ] Urgent [priority:: high] [id:: eeee]\n    - [ ] Urgent child [priority:: high] [id:: eeef]\n- [ ] Ship [reminder:: 2026-10-29T16:00] [id:: bbbb]\n- [x] Morning call [reminder:: 2026-10-29T08:00] [completion:: 2026-10-29T08:30] [id:: gggg]\n- [ ] Stand-up [reminder:: 2026-10-29T10:00] [id:: hhhh]\n- [ ] Muted [reminder:: 2026-10-29T11:00] [muted:: true] [id:: iiii]\n- [x] Old [completion:: 2026-10-28T17:00] [id:: jjjj]\n',
    );
    await writeFile(
      join(folder, 'Inbox.md'),
      '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] Inbox urgent [priority:: high] [id:: ffff]\n',
    );
    const workspace = await open();
    await workspace.capture({ text: 'from the popup', chooseNewList: false }, now);
    const view = workspace.view(TODAY_ID, now);
    const today = view?.today;
    // Inbox before the sidebar's lists; a high subtask under its high parent, not on its own.
    expect(today?.high).toEqual(['ffff', 'eeee']);
    expect(all(workspace)).toEqual(['aaaa', 'ffff', 'eeee']);
    expect(today?.reminders.map((each) => [each.key, each.done])).toEqual([
      ['gggg', true],
      ['hhhh', false],
      ['bbbb', false],
    ]);
    expect(today?.done).toEqual([
      { key: 'gggg', listId: 'wrk1', listName: 'Work', title: 'Morning call', time: '08:30' },
    ]);
    expect(today?.captured).toEqual([
      expect.objectContaining({ title: 'from the popup', listName: 'Inbox', time: '14:30' }),
    ]);
    expect(today?.inbox).toEqual({ id: 'inbox', open: 2 });
    // Today's pinned (aaaa) and reminder tasks (gggg, hhhh, bbbb): one of four done today.
    expect(today?.progress).toEqual({ done: 1, total: 4 });
    // Only the pinned tasks have an order; a high one nudges (null), P brings it to the top.
    expect(
      await workspace.change(TODAY_ID, { kind: 'move', key: 'ffff', direction: 'up' }, now),
    ).toBeNull();
    await workspace.change(TODAY_ID, { kind: 'pin', key: 'ffff', pinned: true }, now);
    expect(keys(workspace)).toEqual(['ffff', 'aaaa']);
    expect(workspace.view(TODAY_ID, now)?.today?.high).toEqual(['eeee']);
    expect(workspace.view(TODAY_ID, now)?.today?.progress).toEqual({ done: 1, total: 5 });
  });

  it('REM-07, REM-11, D-94: overdue reminders of any day, oldest first, until done, snoozed or off', async () => {
    await writeFile(
      join(folder, 'Work.md'),
      '---\nflint: 1\nid: wrk1\nmode: tasks\n---\n- [ ] Ship [reminder:: 2026-10-29T16:00] [id:: bbbb]\n- [x] Morning call [reminder:: 2026-10-29T08:00] [completion:: 2026-10-29T08:30] [id:: gggg]\n- [ ] Stand-up [reminder:: 2026-10-29T10:00] [id:: hhhh]\n- [ ] Muted [reminder:: 2026-10-29T11:00] [muted:: true] [id:: iiii]\n- [ ] Missed yesterday [reminder:: 2026-10-28T17:00] [id:: kkkk]\n    - [ ] A subtask too [reminder:: 2026-10-29T09:00] [id:: kkkl]\n',
    );
    const workspace = await open();
    const overdue = (): string[] =>
      workspace.view(TODAY_ID, now)?.today?.overdue.map((each) => each.key) ?? [];
    expect(overdue()).toEqual(['kkkk', 'kkkl', 'hhhh']);
    expect(workspace.view(TODAY_ID, now)?.today?.overdue[0]).toEqual({
      key: 'kkkk',
      listId: 'wrk1',
      listName: 'Work',
      title: 'Missed yesterday',
      time: '17:00',
      at: '2026-10-28T17:00',
      done: false,
    });
    // Snoozed (a new time), done, or turned off: it leaves.
    await workspace.change(
      'wrk1',
      {
        kind: 'reminder',
        key: 'kkkk',
        at: { year: 2026, month: 10, day: 29, hour: 15, minute: 30, second: 0 },
      },
      now,
    );
    await workspace.toggleDone('wrk1', 'hhhh', now);
    await workspace.change('wrk1', { kind: 'mute', key: 'kkkl', muted: true }, now);
    expect(overdue()).toEqual([]);
    // As the clock passes a reminder, it is overdue.
    expect(
      workspace
        .view(TODAY_ID, new Date(2026, 9, 29, 16, 1))
        ?.today?.overdue.map((each) => each.key),
    ).toEqual(['kkkk', 'bbbb']);
  });

  it('asks about unfinished pins from before today once a day: Roll over or Clear', async () => {
    const workspace = await open();
    expect(workspace.view(TODAY_ID, now)?.today?.rollover).toEqual([]);
    const tomorrow = new Date(2026, 9, 30, 9, 0);
    expect(workspace.view(TODAY_ID, tomorrow)?.today?.rollover.map((task) => task.key)).toEqual([
      'aaaa',
      'cccc',
    ]);
    expect(await workspace.todayAnswer(true, tomorrow)).toBe('Unpinned 2 tasks');
    expect(keys(workspace, tomorrow)).toEqual([]);
    expect(await work()).toContain('- [ ] Plan [id:: aaaa]');
    expect(workspace.view(TODAY_ID, tomorrow)?.today?.rollover).toEqual([]);
    expect(await workspace.undoLast(tomorrow)).toBe('Unpinned 2 tasks');
    expect(keys(workspace, tomorrow)).toEqual(['aaaa', 'cccc']);
    const later = new Date(2026, 9, 31, 9, 0);
    expect(workspace.view(TODAY_ID, later)?.today?.rollover).toHaveLength(2);
    expect(await workspace.todayAnswer(false, later)).toBeNull();
    expect(workspace.view(TODAY_ID, later)?.today?.rollover).toEqual([]);
    expect(keys(workspace, later)).toEqual(['aaaa', 'cccc']);
  });
});
