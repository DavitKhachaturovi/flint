import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFolder, clashes, copyFlintFolder, isWithin } from './folder-change.js';

let base: string;
let flint: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-move-'));
  flint = join(base, 'Flint');
  await mkdir(join(flint, '.flint', 'tmp'), { recursive: true });
  await mkdir(join(flint, 'attachments'), { recursive: true });
  await writeFile(
    join(flint, 'Inbox.md'),
    '---\nflint: 1\nid: inbox\nmode: tasks\n---\n- [ ] One [id:: a1]\n',
  );
  await writeFile(join(flint, 'Work.md'), '- [ ] Two\n');
  await writeFile(join(flint, 'attachments', 'shot.png'), Buffer.from([1, 2, 3, 4]));
  await writeFile(join(flint, '.flint', 'meta.json'), '{}');
  await writeFile(join(flint, '.flint', 'tmp', 'half.tmp'), 'scratch');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('DATA-07, D-104: a chosen folder', () => {
  it('is empty, has Flint lists, or holds other things', async () => {
    await mkdir(join(base, 'Empty'));
    await writeFile(join(base, 'Empty', 'desktop.ini'), '');
    await mkdir(join(base, 'Vault', '.obsidian'), { recursive: true });
    await writeFile(join(base, 'Vault', 'Ideas.md'), '# Ideas\n');
    const env = {};
    expect((await checkFolder(join(base, 'Empty'), flint, env)).state).toBe('empty');
    expect((await checkFolder(flint, join(base, 'Other'), env)).state).toBe('flint');
    const vault = await checkFolder(join(base, 'Vault'), flint, env);
    expect(vault.state).toBe('other');
    expect(vault.subfolder.state).toBe('missing');
    expect(vault.refused).toBeNull();
  });

  it('is refused when it is the Flint folder, inside it, or holds it', async () => {
    expect((await checkFolder(flint, flint, {})).refused).toBe(
      'That is already your Flint folder.',
    );
    expect((await checkFolder(join(flint, 'attachments'), flint, {})).refused).toBe(
      'That folder is inside your Flint folder.',
    );
    const parent = await checkFolder(base, flint, {});
    expect(parent.refused).toBe('Your Flint folder is inside that folder.');
    // Its Flint subfolder is the Flint folder itself.
    expect(parent.subfolder.refused).toBe('That is already your Flint folder.');
    expect(isWithin('C:\\A\\b', 'c:\\a')).toBe(true);
  });
});

describe('DATA-07, D-104: moving the Flint folder', () => {
  it('copies everything but the scratch, checked; the old folder untouched', async () => {
    const target = join(base, 'New', 'Flint');
    const outcome = await copyFlintFolder(flint, target);
    expect(outcome).toEqual({ ok: true, files: 4 });
    expect(await readFile(join(target, 'Inbox.md'), 'utf8')).toContain('id: inbox');
    expect([...(await readFile(join(target, 'attachments', 'shot.png')))]).toEqual([1, 2, 3, 4]);
    expect(await readdir(join(target, '.flint'))).toEqual(['meta.json']);
    expect((await readdir(flint)).sort()).toEqual(['.flint', 'Inbox.md', 'Work.md', 'attachments']);
  });

  it('stops at a file already there, leaving nothing behind', async () => {
    const target = join(base, 'Busy');
    await mkdir(target);
    await writeFile(join(target, 'Work.md'), 'mine');
    expect(await clashes(flint, target)).toBe('Work.md');
    const outcome = await copyFlintFolder(flint, target);
    expect(outcome.ok).toBe(false);
    expect(outcome.problem).toContain('Work.md');
    expect(await readdir(target)).toEqual(['Work.md']);
    expect(await readFile(join(target, 'Work.md'), 'utf8')).toBe('mine');
  });
});
