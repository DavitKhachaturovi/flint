import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareFlintFolder } from '../storage/flint-folder.js';
import { Workspace } from './workspace.js';

/** AGENT-01, AGENT-07 (D-185 Q4, Q5): agent runs and their undo, through the workspace. */

let base: string;
let folder: string;
const now = new Date(2026, 2, 10, 10, 0);
const later = new Date(2026, 2, 10, 10, 5);
const opened: Workspace[] = [];

const BACKEND =
  '---\nflint: 1\nid: backend\nmode: tasks\n---\n- [ ] Fix the login loop [id:: cccc]\n- [ ] Write docs [id:: dddd]\n';
const NOTE = '---\nflint: 1\nid: plan\nmode: note\n---\n# Plan\n\nStep one\n';

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-agents-'));
  folder = join(base, 'Flint');
  await prepareFlintFolder(folder, {});
  await writeFile(join(folder, 'Inbox.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
  await writeFile(join(folder, 'Backend.md'), BACKEND);
  await writeFile(join(folder, 'Plan.md'), NOTE);
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
const file = (name: string): Promise<string> => readFile(join(folder, name), 'utf8');

describe('an agent run (AGENT-01)', () => {
  it('records who made and changed a task, and never touches the window’s undo', async () => {
    const workspace = await open();
    const id = workspace.reserveId();
    const outcome = await workspace.agentRun('Claude', async () => {
      await workspace.change('backend', { kind: 'add', text: 'Ship it', where: 'top', id }, now);
      await workspace.change('backend', { kind: 'priority', key: 'cccc', priority: 'high' }, now);
    });
    expect(outcome.error).toBeUndefined();
    expect(workspace.meta.get(id)).toMatchObject({ createdBy: 'Claude', touchedBy: 'Claude' });
    expect(workspace.meta.get('cccc')).toMatchObject({ touchedBy: 'Claude' });
    expect(workspace.meta.get('cccc')?.createdBy).toBeUndefined();
    expect(outcome.keys).toEqual(expect.arrayContaining([id, 'cccc']));
    // Ctrl+Z in the window has nothing of the agent's to undo.
    expect(await workspace.undoLast(now)).toBeNull();
    // The user's own edit clears touchedBy.
    await workspace.change('backend', { kind: 'edit', key: 'cccc', text: 'Fix it' }, later);
    expect(workspace.meta.get('cccc')?.touchedBy).toBeUndefined();
  });

  it('holds the queue: a user change waits until the agent run is done', async () => {
    const workspace = await open();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = workspace.agentRun('Claude', async () => {
      await workspace.change('backend', { kind: 'priority', key: 'cccc', priority: 'low' }, now);
      await gate;
      order.push('agent done');
    });
    const user = workspace
      .change('backend', { kind: 'priority', key: 'dddd', priority: 'high' }, now)
      .then(() => order.push('user'));
    release();
    await Promise.all([run, user]);
    expect(order).toEqual(['agent done', 'user']);
    expect(workspace.meta.get('dddd')?.touchedBy).toBeUndefined();
  });
});

describe('undoing an agent change (AGENT-07)', () => {
  it('undoes out of order and skips a task changed since', async () => {
    const workspace = await open();
    const first = await workspace.agentRun('Claude', () =>
      workspace.change('backend', { kind: 'priority', key: 'cccc', priority: 'high' }, now),
    );
    const second = await workspace.agentRun('Cursor', () =>
      workspace.change('backend', { kind: 'priority', key: 'dddd', priority: 'low' }, now),
    );
    // The user changes cccc after the first agent change.
    await workspace.change('backend', { kind: 'edit', key: 'cccc', text: 'Fix it now' }, later);
    // Undo the older change first: cccc changed since, so it is skipped.
    expect(await workspace.undoAgentSteps(first.steps, 'Priority high', later)).toEqual({
      undone: 0,
      skipped: 1,
    });
    expect(await workspace.undoAgentSteps(second.steps, 'Priority low', later)).toEqual({
      undone: 1,
      skipped: 0,
    });
    const text = await file('Backend.md');
    expect(text).toContain('- [ ] Fix it now [priority:: high] [id:: cccc]');
    expect(text).toContain('- [ ] Write docs [id:: dddd]');
    // Undoing is the user's action: Ctrl+Z brings the agent's change back.
    expect(await workspace.undoLast(later)).toBe('Undid Priority low');
    expect(await file('Backend.md')).toContain('[priority:: low] [id:: dddd]');
  });

  it('undoes a note edit by merging, keeping the user’s later typing', async () => {
    const workspace = await open();
    const change = await workspace.agentRun('Claude', () =>
      workspace.saveNote('plan', '# Plan\n\nStep one\nStep two from Claude\n', now),
    );
    await workspace.saveNote('plan', '# Plan, revised\n\nStep one\nStep two from Claude\n', later);
    expect(await workspace.undoAgentSteps(change.steps, 'Edited note', later)).toEqual({
      undone: 1,
      skipped: 0,
    });
    expect(await file('Plan.md')).toBe(
      '---\nflint: 1\nid: plan\nmode: note\n---\n# Plan, revised\n\nStep one\n',
    );
  });

  it('trashes a list it made only while unchanged, and brings a deleted list back', async () => {
    const workspace = await open();
    const made = await workspace.agentRun('Claude', () => workspace.newList('Ideas', 'tasks', now));
    expect(made.steps).toEqual([expect.objectContaining({ kind: 'created' })]);
    expect(await workspace.undoAgentSteps(made.steps, 'Created list Ideas', later)).toEqual({
      undone: 1,
      skipped: 0,
    });
    expect(workspace.listInfos().some((info) => info.name === 'Ideas')).toBe(false);

    const deleted = await workspace.agentRun('Claude', () => workspace.deleteList('backend', now));
    expect(deleted.steps).toEqual([expect.objectContaining({ kind: 'deletedList' })]);
    await workspace.undoAgentSteps(deleted.steps, 'Deleted Backend', later);
    expect(await file('Backend.md')).toBe(BACKEND);
  });

  it('brings a deleted task back and removes its Trash file', async () => {
    const workspace = await open();
    const deleted = await workspace.agentRun('Claude', () =>
      workspace.change('backend', { kind: 'delete', key: 'dddd' }, now),
    );
    expect(deleted.steps.map((step) => step.kind).sort()).toEqual(['ops', 'taskTrash']);
    await workspace.undoAgentSteps(deleted.steps, 'Deleted', later);
    expect(await file('Backend.md')).toBe(BACKEND);
    expect((await workspace.trashView()).deleted).toEqual([]);
  });
});

describe('##list while editing a task (D-111; the 1.8.0 preview)', () => {
  it('moves the task to the list on save, one undo step with the edit', async () => {
    const workspace = await open();
    await workspace.change(
      'backend',
      { kind: 'edit', key: 'dddd', text: 'Write the docs ##inbox' },
      now,
    );
    expect(await file('Inbox.md')).toContain('- [ ] Write the docs [id:: dddd]');
    expect(await file('Backend.md')).not.toContain('dddd');
    expect(await workspace.undoLast(later)).not.toBeNull();
    expect(await file('Backend.md')).toBe(BACKEND);
  });

  it('makes a new list and moves the task there', async () => {
    const workspace = await open();
    await workspace.change(
      'backend',
      { kind: 'edit', key: 'cccc', text: 'Fix the login loop ##Security' },
      now,
    );
    expect(await file('Security.md')).toContain('Fix the login loop [id:: cccc]');
    expect(await file('Backend.md')).not.toContain('cccc');
  });
});
