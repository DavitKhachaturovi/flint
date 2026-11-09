import { describe, expect, it } from 'vitest';
import {
  cardBox,
  clampSize,
  firstHang,
  hangInCorner,
  insetIn,
  roomFor,
  settle,
  snapCorner,
  stageFor,
} from './mini-place.js';

const area = { x: 0, y: 0, width: 1920, height: 1040 };

describe('mini mode placement (MINI-01, D-109, D-110)', () => {
  it('opens first hanging from the top-right corner, 24 px from the edges', () => {
    expect(firstHang(area)).toEqual({ corner: 'top-right', x: 1896, y: 24 });
    expect(firstHang({ x: -1280, y: 200, width: 1280, height: 984 })).toEqual({
      corner: 'top-right',
      x: -24,
      y: 224,
    });
  });

  it('the card grows away from the corner it hangs from', () => {
    const size = { width: 364, height: 300 };
    expect(cardBox({ corner: 'top-left', x: 24, y: 24 }, size)).toEqual({
      x: 24,
      y: 24,
      width: 364,
      height: 300,
    });
    expect(cardBox({ corner: 'bottom-right', x: 1896, y: 1016 }, size)).toEqual({
      x: 1532,
      y: 716,
      width: 364,
      height: 300,
    });
  });

  it('the window is the largest card from the hang point, with the shadow around it', () => {
    const hang = hangInCorner('bottom-right', area);
    const stage = stageFor(hang);
    // 520 × 760 at most, 200 more on the hang side (resized from there, D-111; max − min, the
    // minimum 320 since D-160), the shadow's room (32 px at the sides, 16 above, 48 below).
    expect(stage).toEqual({ x: 1896 - 520 - 32, y: 1016 - 760 - 16, width: 784, height: 824 });
    expect(insetIn(hang, stage)).toEqual({
      corner: 'bottom-right',
      horizontal: 200 + 32,
      vertical: 48,
    });
    const topLeft = hangInCorner('top-left', area);
    expect(insetIn(topLeft, stageFor(topLeft))).toEqual({
      corner: 'top-left',
      horizontal: 200 + 32,
      vertical: 16,
    });
    // At 125 % the card can be larger, so the window is.
    expect(stageFor(topLeft, 1.25)).toEqual({
      x: 24 - 250 - 32,
      y: 24 - 16,
      width: 650 + 250 + 64,
      height: 950 + 64,
    });
  });

  it('snaps within 48 px of a corner, and not farther', () => {
    const at = (x: number, y: number) => ({ x, y, width: 364, height: 300 });
    expect(snapCorner(at(1520, 40), area)).toBe('top-right');
    expect(snapCorner(at(10, 10), area)).toBe('top-left');
    expect(snapCorner(at(30, 720), area)).toBe('bottom-left');
    expect(snapCorner(at(1550, 730), area)).toBe('bottom-right');
    // Past the screen's edge counts as near.
    expect(snapCorner(at(1580, -20), area)).toBe('top-right');
    expect(snapCorner(at(1480, 40), area)).toBeNull();
    expect(snapCorner(at(700, 20), area)).toBeNull();
  });

  it('let go near a corner it hangs from that corner; elsewhere it stays, hanging as before', () => {
    expect(settle({ x: 1550, y: 730, width: 364, height: 300 }, area, 'top-right')).toEqual({
      hang: { corner: 'bottom-right', x: 1896, y: 1016 },
      snapped: true,
    });
    expect(settle({ x: 700, y: 300, width: 364, height: 280 }, area, 'bottom-right')).toEqual({
      hang: { corner: 'bottom-right', x: 1064, y: 580 },
      snapped: false,
    });
  });

  it('the card fits the room it has on the screen', () => {
    expect(roomFor(hangInCorner('top-right', area), area)).toEqual({ width: 520, height: 760 });
    // Low on the screen, hanging from the top: little room below.
    expect(roomFor({ corner: 'top-left', x: 100, y: 800 }, area)).toEqual({
      width: 520,
      height: 216,
    });
    // Never below the smallest card.
    expect(roomFor({ corner: 'top-left', x: 100, y: 1000 }, area).height).toBe(180);
  });

  it('a remembered size stays in its ranges', () => {
    expect(clampSize({})).toEqual({ width: 364, limit: 460 });
    expect(clampSize({ width: 9999, limit: 10 })).toEqual({ width: 520, limit: 180 });
    expect(clampSize({ width: 'wide', limit: 500.4 })).toEqual({ width: 364, limit: 500 });
  });
});
