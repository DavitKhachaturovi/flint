import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTipId, TIPS, tipParts } from '../shared/tips.js';
import { TipsFile } from './tips.js';

describe('the tips (APP-14, D-113, D-118)', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'flint-tips-'));
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('counts a pattern until its tip is seen, then never again', () => {
    const tips = new TipsFile(join(directory, 'tips.json'));
    expect([tips.bump('paletteKey'), tips.bump('paletteKey'), tips.bump('paletteKey')]).toEqual([
      1, 2, 3,
    ]);
    expect(TIPS.paletteKey.after).toBe(3);
    tips.markShown('paletteKey');
    expect(tips.shown('paletteKey')).toBe(true);
    expect(tips.bump('paletteKey')).toBe(0);
  });

  it('Reset tips: every tip and the earlier counted hints again (D-119)', () => {
    const tips = new TipsFile(join(directory, 'tips.json'));
    expect(tips.due('emptyQuickNote', 1)).toBe(true);
    expect(tips.due('emptyQuickNote', 1)).toBe(false);
    tips.markShown('trash');
    tips.reset();
    expect(tips.shown('trash')).toBe(false);
    expect(tips.due('emptyQuickNote', 1)).toBe(true);
  });

  it('keeps its counts across starts', async () => {
    const path = join(directory, 'tips.json');
    const tips = new TipsFile(path);
    tips.bump('keyboardComplete');
    tips.markShown('slash');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const again = new TipsFile(path);
    await again.load();
    expect(again.shown('slash')).toBe(true);
    expect(again.bump('keyboardComplete')).toBe(2);
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
