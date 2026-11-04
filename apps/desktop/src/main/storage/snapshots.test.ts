import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotStore } from './snapshots.js';

let base: string;
let folder: string;
let store: SnapshotStore;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'flint-snapshots-'));
  folder = join(base, 'Flint');
  await mkdir(join(folder, 'attachments'), { recursive: true });
  store = new SnapshotStore(folder, join(base, 'snapshots'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const blobs = async (): Promise<number> => {
  let count = 0;
  for (const shard of await readdir(join(base, 'snapshots', 'blobs')).catch(() => []))
    count += (await readdir(join(base, 'snapshots', 'blobs', shard))).length;
  return count;
};

describe('snapshots (DATA-04, D-84, D-97)', () => {
  it('only when something changed; each content stored once', async () => {
    await writeFile(join(folder, 'Inbox.md'), 'one');
    await writeFile(join(folder, 'attachments', 'big.png'), 'picture');
    await mkdir(join(folder, '.git'), { recursive: true });
    await writeFile(join(folder, '.git', 'HEAD'), 'ref');
    const first = await store.take(new Date(2026, 10, 4, 9, 0));
    expect(Object.keys(first?.files ?? {}).sort()).toEqual(['Inbox.md', 'attachments/big.png']);
    expect(await store.take(new Date(2026, 10, 4, 10, 0))).toBeNull();
    await writeFile(join(folder, 'Inbox.md'), 'two');
    const second = await store.take(new Date(2026, 10, 4, 11, 0));
    expect(second?.files['attachments/big.png']).toBe(first?.files['attachments/big.png']);
    // The picture is stored once; Inbox twice (two versions).
    expect(await blobs()).toBe(3);
    expect((await store.content(first?.files['Inbox.md'] ?? ''))?.toString()).toBe('one');
    expect((await store.list()).map((each) => each.id)).toEqual([
      '2026-11-04-110000',
      '2026-11-04-090000',
    ]);
  });

  it('D-100: keeps as Settings says, and Clear old snapshots keeps only the newest', async () => {
    const now = new Date(2026, 10, 30, 12, 0);
    for (const [index, at] of [
      new Date(2026, 10, 25, 9, 0),
      new Date(2026, 10, 29, 9, 0),
      new Date(2026, 10, 30, 11, 50),
    ].entries()) {
      await writeFile(join(folder, 'Inbox.md'), `version ${index}`);
      await store.take(at);
    }
    // Daily ones kept 3 days only: the one from the 25th goes.
    expect(await store.prune(now, { hourlyHours: 24, dailyDays: 3 })).toBe(1);
    expect(await store.size()).toBeGreaterThan(0);
    expect(await store.clearOld()).toBe(1);
    expect((await store.list()).map((each) => each.id)).toEqual(['2026-11-30-115000']);
  });

  it('keeps the last hour, one an hour for 48 hours, one a day for 30 days', async () => {
    const now = new Date(2026, 10, 30, 12, 0);
    const times = [
      new Date(2026, 10, 30, 11, 50), // last hour: kept
      new Date(2026, 10, 30, 11, 20), // last hour: kept
      new Date(2026, 10, 30, 9, 40), // the 9 o'clock hour's newest: kept
      new Date(2026, 10, 30, 9, 10), // the same hour, older: goes
      new Date(2026, 10, 20, 18, 0), // that day's newest: kept
      new Date(2026, 10, 20, 8, 0), // the same day, older: goes
      new Date(2026, 9, 20, 8, 0), // over 30 days: goes
    ];
    for (const [index, at] of [...times].reverse().entries()) {
      await writeFile(join(folder, 'Inbox.md'), `version ${index}`);
      await store.take(at);
    }
    expect(await store.prune(now)).toBe(3);
    expect((await store.list()).map((each) => each.id)).toEqual([
      '2026-11-30-115000',
      '2026-11-30-112000',
      '2026-11-30-094000',
      '2026-11-20-180000',
    ]);
    // Contents no snapshot (or the folder) uses go too.
    expect(await blobs()).toBe(4);
    expect(await readFile(join(folder, 'Inbox.md'), 'utf8')).toBe('version 6');
  });
});
