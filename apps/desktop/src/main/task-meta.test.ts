import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agoLabel, dayLabel, TaskMetaFile } from './task-meta.js';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'flint-meta-'));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('task bookkeeping in .flint/meta.json (docs/04 §3, NAV-07)', () => {
  it('records first sight and the last change, keeping what it doesn’t know', async () => {
    await mkdir(join(folder, '.flint'), { recursive: true });
    await writeFile(
      join(folder, '.flint', 'meta.json'),
      JSON.stringify({ other: 'kept', tasks: { old1: { created: '2026-10-29T09:00' } } }),
    );
    const meta = new TaskMetaFile(folder);
    await meta.load();
    meta.seen(['old1', 'new1', '~provisional'], new Date(2026, 10, 2, 15, 30));
    meta.touch(['old1'], new Date(2026, 10, 2, 16, 0));
    await meta.flush();
    const saved = JSON.parse(await readFile(join(folder, '.flint', 'meta.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(saved).toEqual({
      other: 'kept',
      flint: 1,
      tasks: {
        new1: { created: '2026-11-02T15:30', lastTouched: '2026-11-02T15:30' },
        old1: { created: '2026-10-29T09:00', lastTouched: '2026-11-02T16:00' },
      },
    });
  });

  it('says when, as the panel shows it', () => {
    const now = new Date(2026, 10, 2, 16, 0);
    expect(dayLabel('2026-10-29T09:00', now)).toBe('29 Oct');
    expect(dayLabel('2025-12-31T09:00', now)).toBe('31 Dec 2025');
    expect(agoLabel('2026-11-02T16:00', now)).toBe('just now');
    expect(agoLabel('2026-11-02T15:52', now)).toBe('8 min ago');
    expect(agoLabel('2026-11-02T13:30', now)).toBe('2 h ago');
    expect(agoLabel('2026-11-01T22:00', now)).toBe('yesterday');
    expect(agoLabel('2026-10-20T08:00', now)).toBe('20 Oct');
  });
});
