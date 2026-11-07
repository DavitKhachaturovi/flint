import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClipboardGuard } from './clipboard-guard.js';
import type { ClipboardHistoryRead } from './clipboard-history.js';

describe('the clipboard history guard (NAV-08, D-127)', () => {
  let directory: string;
  let marker: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'flint-clipboard-'));
    marker = join(directory, 'clipboard-reading');
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  const items: ClipboardHistoryRead = { kind: 'ok', items: [{ id: 'a', at: 1, text: 'hello' }] };

  it('the marker is there during a read and gone after it, also when the read fails', async () => {
    let seen = false;
    const guard = new ClipboardGuard(marker, () => {
      seen = existsSync(marker);
      return Promise.resolve(items);
    });
    expect(await guard.read(5)).toEqual(items);
    expect(seen).toBe(true);
    expect(existsSync(marker)).toBe(false);
    const failing = new ClipboardGuard(marker, () => Promise.reject(new Error('boom')));
    await expect(failing.read(5)).rejects.toThrow('boom');
    expect(existsSync(marker)).toBe(false);
  });

  it('a marker left by a crash: reads stay off until a retry, which reads and clears it', async () => {
    await writeFile(marker, 'then\n');
    let reads = 0;
    const guard = new ClipboardGuard(marker, () => {
      reads++;
      return Promise.resolve(items);
    });
    expect(guard.crashed).toBe(true);
    expect(await guard.read(5)).toEqual({ kind: 'crashed' });
    expect(reads).toBe(0);
    expect(await guard.read(5, true)).toEqual(items);
    expect(reads).toBe(1);
    expect(guard.crashed).toBe(false);
  });

  it('a quit during a read is not a crash', async () => {
    let finish: (value: ClipboardHistoryRead) => void = () => undefined;
    const guard = new ClipboardGuard(
      marker,
      () => new Promise<ClipboardHistoryRead>((resolve) => (finish = resolve)),
    );
    const reading = guard.read(5);
    expect(existsSync(marker)).toBe(true);
    guard.quitting();
    expect(existsSync(marker)).toBe(false);
    finish(items);
    await reading;
  });
});
