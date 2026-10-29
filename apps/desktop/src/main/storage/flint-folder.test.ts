import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverLists, isInsideOneDrive, prepareFlintFolder } from './flint-folder.js';

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-folder-'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('prepareFlintFolder (DATA-07, LIST-03, D-23)', () => {
  it('creates the folder and a new Inbox', async () => {
    const folder = join(base, 'Flint');
    const report = await prepareFlintFolder(folder, {});
    expect(report.inboxCreated).toBe(true);
    expect(report.inbox).toBe(join(folder, 'Inbox.md'));
    expect(await readFile(report.inbox, 'utf8')).toBe(
      '---\nflint: 1\nid: inbox\nmode: tasks\n---\n',
    );
    expect(report.lists.map((list) => [list.name, list.id, list.mode])).toEqual([
      ['Inbox', 'inbox', 'tasks'],
    ]);
  });

  it('finds Inbox by id: inbox, whatever the file is called', async () => {
    await writeFile(join(base, 'Capture.md'), '---\nflint: 1\nid: inbox\nmode: tasks\n---\n');
    await writeFile(join(base, 'Inbox.md'), '- [ ] not the inbox\n');
    const report = await prepareFlintFolder(base, {});
    expect(report.inbox).toBe(join(base, 'Capture.md'));
    expect(report.inboxCreated).toBe(false);
  });

  it('adopts an Inbox.md without a header, and does not rewrite it', async () => {
    await writeFile(join(base, 'inbox.md'), '- [ ] typed in VS Code\n');
    const report = await prepareFlintFolder(base, {});
    expect(report.inbox).toBe(join(base, 'inbox.md'));
    expect(await readFile(report.inbox, 'utf8')).toBe('- [ ] typed in VS Code\n');
  });

  it('lists only top-level markdown files; unheadered files are notes', async () => {
    await mkdir(join(base, 'sub'));
    await mkdir(join(base, '.obsidian'));
    await writeFile(join(base, 'sub', 'Deep.md'), '- [ ] x\n');
    await writeFile(join(base, 'Groceries.md'), '- milk\n');
    await writeFile(join(base, 'readme.txt'), 'x');
    const lists = await discoverLists(base);
    expect(lists.map((list) => [list.name, list.mode])).toEqual([['Groceries', 'note']]);
    expect((await prepareFlintFolder(base, {})).obsidianVaultRoot).toBe(true);
  });
});

describe('isInsideOneDrive (D-24)', () => {
  // Windows paths, written with forward slashes here and turned into backslashes.
  const win = (path: string): string => path.replaceAll('/', String.fromCharCode(92));
  const env = { OneDriveCommercial: win('C:/Users/davit/OneDrive - Contoso') };
  it.each([
    [win('C:/Users/davit/OneDrive - Contoso/Documents/Flint'), true],
    [win('c:/users/DAVIT/onedrive - CONTOSO'), true],
    [win('C:/Users/davit/Flint'), false],
    [win('C:/Users/davit/OneDrive - Contoso-old/Flint'), false],
    [win('D:/OneDrive - Contoso/Flint'), false],
  ])('%s → %s', (folder, inside) => {
    expect(isInsideOneDrive(folder, env)).toBe(inside);
  });
});
