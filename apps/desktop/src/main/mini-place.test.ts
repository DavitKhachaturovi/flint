import { describe, expect, it } from 'vitest';
import { firstMiniBounds, inCorner, snapCorner } from './mini-place.js';

const area = { x: 0, y: 0, width: 1920, height: 1040 };

describe('mini mode placement (MINI-01, D-109)', () => {
  it('opens first at the top right, 24 px from the edges, at mockup 05 size', () => {
    expect(firstMiniBounds(area)).toEqual({ x: 1456, y: 24, width: 440, height: 500 });
    expect(firstMiniBounds({ x: -1280, y: 200, width: 1280, height: 984 })).toEqual({
      x: -464,
      y: 224,
      width: 440,
      height: 500,
    });
  });

  it('snaps within 48 px of a corner, and not farther', () => {
    const at = (x: number, y: number) => ({ x, y, width: 440, height: 500 });
    expect(snapCorner(at(1440, 40), area)).toBe('top-right');
    expect(snapCorner(at(10, 10), area)).toBe('top-left');
    expect(snapCorner(at(30, 520), area)).toBe('bottom-left');
    expect(snapCorner(at(1475, 530), area)).toBe('bottom-right');
    // Past the screen's edge counts as near.
    expect(snapCorner(at(1500, -20), area)).toBe('top-right');
    expect(snapCorner(at(1400, 40), area)).toBeNull();
    expect(snapCorner(at(700, 20), area)).toBeNull();
  });

  it('keeps a corner when the size changes, and fits a small screen', () => {
    expect(inCorner('bottom-right', area, { width: 600, height: 700 })).toEqual({
      x: 1296,
      y: 316,
      width: 600,
      height: 700,
    });
    expect(
      inCorner('top-left', { x: 0, y: 0, width: 400, height: 300 }, { width: 440, height: 500 }),
    ).toEqual({
      x: 24,
      y: 24,
      width: 352,
      height: 252,
    });
  });
});
