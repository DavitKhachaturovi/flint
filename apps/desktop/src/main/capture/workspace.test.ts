import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareFlintFolder } from '../storage/flint-folder.js';
import { DraftFile } from './drafts.js';
import { Workspace } from './workspace.js';

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
    await rm(join(folder, 'Infra.md'));
    await workspace.fileChanged(join(folder, 'Infra.md'));
    expect(workspace.listInfos().map((list) => list.name)).toEqual(['Inbox']);
  });
});

describe('drafts (CAP-08)', () => {
  it('survive a restart and are cleared only for the text that was saved', async () => {
    const path = join(base, 'drafts.json');
    const drafts = new DraftFile(path);
    await drafts.set('half a thought');
    expect(await new DraftFile(path).load()).toBe('half a thought');
    await drafts.clearIf('something else');
    expect(await new DraftFile(path).load()).toBe('half a thought');
    await drafts.clearIf('half a thought');
    expect(await new DraftFile(path).load()).toBe('');
  });
});
