import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TourFile } from './onboarding.js';

describe('the walkthrough across starts (APP-10, D-117, D-119)', () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'flint-tour-'));
    path = join(directory, 'tour.json');
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  const restart = async (): Promise<{ from: number | null; interrupted: boolean }> => {
    const file = new TourFile(path);
    await file.load();
    return file.atStart();
  };

  it('no file: no tour', async () => {
    expect(await restart()).toEqual({ from: null, interrupted: false });
  });

  it('a fresh install: due from step 1 until it starts, even across starts', async () => {
    const file = new TourFile(path);
    await file.due();
    expect(file.running).toBe(false);
    expect(await restart()).toEqual({ from: 0, interrupted: false });
    expect(await restart()).toEqual({ from: 0, interrupted: false });
  });

  it('a running tour cut short (a quit or a crash) ends, said once', async () => {
    const file = new TourFile(path);
    await file.start({ lists: ['inbox'], tasks: ['a1'] });
    await file.step(3);
    expect(await restart()).toEqual({ from: null, interrupted: true });
    expect(await restart()).toEqual({ from: null, interrupted: false });
  });

  it("step 1's folder change: goes on at step 2 after the restart, with its baseline", async () => {
    const file = new TourFile(path);
    await file.start({ lists: ['inbox'], tasks: ['a1'] });
    await file.restartAt(1);
    const after = new TourFile(path);
    await after.load();
    expect(await after.atStart()).toEqual({ from: 1, interrupted: false });
    expect(after.running).toBe(true);
    expect(after.currentStep).toBe(1);
    expect(after.baseline).toEqual({ lists: ['inbox'], tasks: ['a1'] });
    // Going on now: a quit after this is a cut-short tour.
    expect(await restart()).toEqual({ from: null, interrupted: true });
  });

  it('an ended tour leaves nothing; a broken file is no tour', async () => {
    const file = new TourFile(path);
    await file.start({ lists: [], tasks: [] });
    await file.end();
    await expect(readFile(path, 'utf8')).rejects.toThrow();
    await writeFile(path, '{"step": "two"}');
    expect(await restart()).toEqual({ from: null, interrupted: false });
  });
});
