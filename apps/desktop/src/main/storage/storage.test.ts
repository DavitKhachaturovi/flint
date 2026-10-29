import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteTask, serializeDocument, setPriority } from '@flint/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readListFile, writeFileAtomic } from './atomic.js';
import { ListFile, tempDirectoryFor } from './list-file.js';
import { watchListFolder } from './watcher.js';

const NOW = { year: 2026, month: 10, day: 29, hour: 14, minute: 30, second: 0 };
const save = { now: NOW, isTaken: () => false };
const LIST =
  '---\nflint: 1\nid: l7c2\nmode: tasks\n---\n- [ ] A [id:: aaaa]\n- [ ] B [id:: bbbb]\n';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'flint-storage-'));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('writeFileAtomic (DATA-01)', () => {
  it('writes the file and leaves no temporary files', async () => {
    const path = join(folder, 'Inbox.md');
    await writeFileAtomic(path, 'hello\r\n', { tempDirectory: tempDirectoryFor(path) });
    expect(await readFile(path, 'utf8')).toBe('hello\r\n');
    expect(await readdir(tempDirectoryFor(path))).toEqual([]);
  });

  it('retries while another process holds the file, then succeeds', async () => {
    const path = join(folder, 'Inbox.md');
    let attempts = 0;
    const waits: number[] = [];
    await writeFileAtomic(path, 'x', {
      tempDirectory: tempDirectoryFor(path),
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      renameFile: async (from, to) => {
        if (++attempts < 4) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        const { rename } = await import('node:fs/promises');
        await rename(from, to);
      },
    });
    expect(await readFile(path, 'utf8')).toBe('x');
    expect(waits).toEqual([10, 25, 50]);
  });

  it('gives up on other errors, keeps the old file and removes the temporary file', async () => {
    const path = join(folder, 'Inbox.md');
    await writeFile(path, 'old');
    await expect(
      writeFileAtomic(path, 'new', {
        tempDirectory: tempDirectoryFor(path),
        renameFile: () => Promise.reject(Object.assign(new Error('disk full'), { code: 'ENOSPC' })),
      }),
    ).rejects.toThrow('disk full');
    expect(await readFile(path, 'utf8')).toBe('old');
    expect(await readdir(tempDirectoryFor(path))).toEqual([]);
  });
});

describe('readListFile', () => {
  it('keeps a BOM and refuses invalid UTF-8', async () => {
    const path = join(folder, 'a.md');
    await writeFile(path, Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
    expect(await readListFile(path)).toEqual({
      kind: 'text',
      text: `${String.fromCharCode(0xfeff)}a`,
    });
    await writeFile(path, Buffer.from([0x61, 0xff, 0x62]));
    expect(await readListFile(path)).toEqual({ kind: 'not-utf8' });
    expect(await readListFile(join(folder, 'missing.md'))).toEqual({ kind: 'missing' });
  });
});

describe('ListFile save and reload (docs/04 §6)', () => {
  it('saves only what changed, byte-for-byte elsewhere', async () => {
    const path = join(folder, 'Inbox.md');
    await writeFile(path, LIST);
    const file = await ListFile.open(path);
    file.apply(setPriority(path, 'bbbb', 'high'));
    expect(file.dirty).toBe(true);
    const outcome = await file.save(save);
    expect(outcome).toMatchObject({ written: true, rebased: false });
    expect(await readFile(path, 'utf8')).toBe(
      LIST.replace('B [id:: bbbb]', 'B [priority:: high] [id:: bbbb]'),
    );
    expect(file.dirty).toBe(false);
  });

  it("never overwrites another program's change: pending changes are re-applied on top", async () => {
    const path = join(folder, 'Inbox.md');
    await writeFile(path, LIST);
    const file = await ListFile.open(path);
    file.apply(setPriority(path, 'aaaa', 'low'));
    file.apply(deleteTask(path, 'bbbb'));
    // The CLI (or Claude) adds a task meanwhile.
    await writeFile(path, LIST.replace('- [ ] B', '- [ ] From the CLI [id:: cli1]\n- [ ] B'));
    const outcome = await file.save(save);
    expect(outcome.rebased).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(
      '---\nflint: 1\nid: l7c2\nmode: tasks\n---\n- [ ] A [priority:: low] [id:: aaaa]\n- [ ] From the CLI [id:: cli1]\n',
    );
  });

  it('gives tasks added by hand an ID on save and reports the new keys', async () => {
    const path = join(folder, 'Inbox.md');
    await writeFile(path, `${LIST}- [ ] typed in an editor\n`);
    const file = await ListFile.open(path);
    file.apply(setPriority(path, 'aaaa', 'high'));
    const outcome = await file.save(save);
    expect(outcome.renamed.size).toBe(1);
    expect(await readFile(path, 'utf8')).toMatch(
      /- \[ \] typed in an editor \[id:: [a-z0-9]{4}\]\n$/,
    );
  });

  it("ignores its own write on reload, and picks up another program's", async () => {
    const path = join(folder, 'Inbox.md');
    await writeFile(path, LIST);
    const file = await ListFile.open(path);
    file.apply(setPriority(path, 'aaaa', 'high'));
    await file.save(save);
    expect(await file.reload()).toBe('unchanged');
    await writeFile(path, LIST.replace('A [id:: aaaa]', 'A edited elsewhere [id:: aaaa]'));
    expect(await file.reload()).toBe('reloaded');
    expect(serializeDocument(file.document)).toContain('A edited elsewhere [id:: aaaa]');
  });

  it('opens files it must not edit read-only', async () => {
    const newer = join(folder, 'newer.md');
    await writeFile(newer, '---\nflint: 2\nmode: tasks\n---\n- [ ] x\n');
    expect((await ListFile.open(newer)).readOnly).toBe('newer-format');
    const binary = join(folder, 'latin1.md');
    await writeFile(binary, Buffer.from([0x2d, 0x20, 0xe9]));
    const file = await ListFile.open(binary);
    expect(file.readOnly).toBe('not-utf8');
    expect(file.apply(setPriority(binary, 'x', 'high'))).toBeNull();
  });
});

describe('watchListFolder (DATA-06)', () => {
  it('reports changed top-level markdown files once per burst', async () => {
    const seen: string[] = [];
    const watcher = watchListFolder(folder, (path) => seen.push(path), 50);
    try {
      const path = join(folder, 'Inbox.md');
      await writeFile(path, 'a');
      await writeFile(path, 'ab');
      await writeFile(join(folder, 'notes.txt'), 'ignored');
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(seen).toEqual([path]);
    } finally {
      watcher.close();
    }
  });
});
