import { describe, expect, it } from 'vitest';
import {
  cardBox,
  clampSize,
  firstHang,
  firstTab,
  hangForTab,
  hangInCorner,
  insetIn,
  roomFor,
  settle,
  snapCorner,
  snapTabY,
  stageFor,
  tabAt,
  tabForCard,
  tabSpots,
  tabStage,
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

describe('the edge tab (MINI-04, D-177)', () => {
  it('starts at the top-right spot: 120 px below the top of the work area', () => {
    expect(firstTab(area)).toEqual({ side: 'right', x: 1920, y: 120 });
    expect(firstTab({ x: -1280, y: 200, width: 1280, height: 984 })).toEqual({
      side: 'right',
      x: 0,
      y: 320,
    });
  });

  it('the corner spots: 120 px from the top, the bottom 48 px above the work area bottom', () => {
    expect(tabSpots(area)).toEqual({ top: 120, bottom: 1040 - 48 - 48 });
    // At a larger zoom the tab is taller; the bottom spot keeps its gap.
    expect(tabSpots(area, 72).bottom).toBe(1040 - 48 - 72);
  });

  it('snaps within 48 px of a spot, and not farther; it stays on the work area', () => {
    expect(snapTabY(150, area)).toBe(120);
    expect(snapTabY(168, area)).toBe(120);
    expect(snapTabY(169, area)).toBe(169);
    expect(snapTabY(930, area)).toBe(944);
    expect(snapTabY(500.4, area)).toBe(500);
    expect(snapTabY(-200, area)).toBe(0);
    expect(snapTabY(5000, area)).toBe(1040 - 48);
  });

  it('the card comes out of the tab: level with its top in the upper half, its bottom in the lower', () => {
    expect(hangForTab(tabAt('right', 120, area), area)).toEqual({
      corner: 'top-right',
      x: 1896,
      y: 120,
    });
    expect(hangForTab(tabAt('left', 944, area), area)).toEqual({
      corner: 'bottom-left',
      x: 24,
      y: 992,
    });
    // The middle: the tab's centre decides.
    expect(hangForTab(tabAt('right', 495, area), area).corner).toBe('top-right');
    expect(hangForTab(tabAt('right', 497, area), area).corner).toBe('bottom-right');
  });

  it('collapsing: the nearer edge, level with the card; a corner-snapped card to its spot', () => {
    const box = { x: 1300, y: 300, width: 364, height: 400 };
    // Its centre (500) is in the upper half: level with its top.
    expect(tabForCard(box, null, area)).toEqual({ side: 'right', x: 1920, y: 300 });
    // In the lower half: level with its bottom (less the tab).
    expect(tabForCard({ ...box, x: 200, y: 500 }, null, area)).toEqual({
      side: 'left',
      x: 0,
      y: 500 + 400 - 48,
    });
    // Near a spot: it snaps.
    expect(tabForCard({ ...box, y: 150 }, null, area).y).toBe(120);
    // Snapped into the top-right corner (24 px from the top): the top spot, not beside the buttons.
    expect(tabForCard({ ...box, x: 1532, y: 24 }, 'top-right', area)).toEqual({
      side: 'right',
      x: 1920,
      y: 120,
    });
    expect(tabForCard(box, 'bottom-left', area)).toEqual({ side: 'left', x: 0, y: 944 });
  });

  it('the strip: the work area height along the edge, ending exactly at it', () => {
    const right = tabStage(tabAt('right', 300, area), area);
    expect(right).toEqual({ x: 1920 - (24 + 520 + 32), y: 0, width: 24 + 520 + 32, height: 1040 });
    expect(right.x + right.width).toBe(1920);
    const left = tabStage(tabAt('left', 300, area), area, 1.25);
    expect(left).toEqual({ x: 0, y: 0, width: 24 + 650 + 32, height: 1040 });
    // The card hanging from the tab is inside it.
    const hang = hangForTab(tabAt('right', 300, area), area);
    expect(insetIn(hang, right)).toEqual({ corner: 'top-right', horizontal: 24, vertical: 300 });
  });
});
