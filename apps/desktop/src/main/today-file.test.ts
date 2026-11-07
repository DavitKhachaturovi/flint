import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TodayFile } from './today-file.js';

describe('TodayFile.settled (D-138: a quit waits for it)', () => {
  let folder = '';
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('writes a change that is still waiting its moment, before it resolves', async () => {
    folder = await mkdtemp(join(tmpdir(), 'flint-today-'));
    const today = new TodayFile(folder);
    await today.load();
    today.setOrder(['a1', 'b2']);
    // Written 400 ms after the last change by itself; settled() does it now.
    await today.settled();
    const written = JSON.parse(await readFile(today.path, 'utf8')) as { order: string[] };
    expect(written.order).toEqual(['a1', 'b2']);
  });

  it('resolves at once with nothing waiting', async () => {
    folder = await mkdtemp(join(tmpdir(), 'flint-today-'));
    const today = new TodayFile(folder);
    await today.load();
    await expect(today.settled()).resolves.toBeUndefined();
  });
});
