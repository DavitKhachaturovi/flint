import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTipId, tipAllowed, TIPS, tipParts } from '../shared/tips.js';
import { TipsFile } from './tips.js';

describe('the tips (APP-14, D-113, D-118)', () => {
  let directory: string;
  const opened: TipsFile[] = [];
  const open = (path: string): TipsFile => {
    const tips = new TipsFile(path);
    opened.push(tips);
    return tips;
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'flint-tips-'));
  });
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((tips) => tips.settled()));
    await rm(directory, { recursive: true, force: true });
  });

  it('counts a pattern until its tip is seen, then never again', () => {
    const tips = open(join(directory, 'tips.json'));
    expect([tips.bump('paletteKey'), tips.bump('paletteKey'), tips.bump('paletteKey')]).toEqual([
      1, 2, 3,
    ]);
    expect(TIPS.paletteKey.after).toBe(3);
    tips.markShown('paletteKey');
    expect(tips.shown('paletteKey')).toBe(true);
    expect(tips.bump('paletteKey')).toBe(0);
  });

  it('Reset tips: every tip and the earlier counted hints again (D-119)', () => {
    const tips = open(join(directory, 'tips.json'));
    expect(tips.due('emptyQuickNote', 1)).toBe(true);
    expect(tips.due('emptyQuickNote', 1)).toBe(false);
    tips.markShown('trash');
    tips.reset();
    expect(tips.shown('trash')).toBe(false);
    expect(tips.due('emptyQuickNote', 1)).toBe(true);
  });

  it('keeps its counts across starts', async () => {
    const path = join(directory, 'tips.json');
    const tips = open(path);
    tips.bump('keyboardComplete');
    tips.markShown('slash');
    await tips.settled();
    const again = open(path);
    await again.load();
    expect(again.shown('slash')).toBe(true);
    expect(again.bump('keyboardComplete')).toBe(2);
  });

  it('D-125: two tips a session at most, ten minutes apart', () => {
    const minute = 60_000;
    expect(tipAllowed([], 0)).toBe(true);
    expect(tipAllowed([0], 9 * minute)).toBe(false);
    expect(tipAllowed([0], 10 * minute)).toBe(true);
    expect(tipAllowed([0, 10 * minute], 60 * minute)).toBe(false);
  });

  it('every tip has its words; keys between backticks become keycaps', () => {
    expect(Object.keys(TIPS)).toHaveLength(9);
    expect(isTipId('trash')).toBe(true);
    expect(isTipId('toString')).toBe(false);
    expect(tipParts('Press `Ctrl+K` now.')).toEqual([
      { key: false, text: 'Press ' },
      { key: true, text: 'Ctrl+K' },
      { key: false, text: ' now.' },
    ]);
  });
});
