import { MINI_LIMIT, MINI_SHADOW, MINI_WIDTH } from '../shared/mini-size.js';
import type { Rect } from './window-state.js';

/**
 * MINI-01, D-109, D-110: where mini mode's card goes. The window is a transparent stage (like the
 * capture popup, D-42): the largest card's area, measured from the corner the card hangs from, with
 * the floating shadow's margin around it. The card hangs from a corner: it grows away from it (a
 * card in a bottom corner grows upward), and its size and height changes are the page's own (CSS),
 * so the window never moves while the card resizes. It opens first in the top-right corner of the
 * screen the mouse is on; let go within 48 px of a screen corner, it snaps into that corner (24 px
 * from the edges) and hangs from it. Pure, so it is unit-tested.
 */

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Mockup 05: the card is 364 px wide; its height fits its content up to a limit (D-110). */
export const CARD_WIDTH = MINI_WIDTH;
export const CARD_LIMIT = MINI_LIMIT;
/** The floating shadow's room around the card (`--fl-shadow-desktop`, D-111). */
export const SHADOW = MINI_SHADOW;
/**
 * D-111: how far the card's edge on its hang side can move out when it is resized from that side
 * (from the smallest card to the largest), so both sides resize without the window moving.
 */
const REACH_OUT = CARD_WIDTH.max - CARD_WIDTH.min;
/** The gap to the screen's edges in a corner. */
export const MINI_MARGIN = 24;
/** How near a corner a drag must end to snap. */
export const SNAP_DISTANCE = 48;

/** The point the card hangs from: its `corner`, at (x, y) on screen. */
export interface Hang {
  readonly corner: Corner;
  readonly x: number;
  readonly y: number;
}

const isLeft = (corner: Corner): boolean => corner.endsWith('left');
const isTop = (corner: Corner): boolean => corner.startsWith('top');

/** The card's box on screen when it hangs from `hang` at `size`. */
export function cardBox(hang: Hang, size: { width: number; height: number }): Rect {
  return {
    x: isLeft(hang.corner) ? hang.x : hang.x - size.width,
    y: isTop(hang.corner) ? hang.y : hang.y - size.height,
    width: size.width,
    height: size.height,
  };
}

/**
 * The window: the largest card hanging from `hang` (at the page's zoom), plus room for its hang-side
 * edge to move out (D-111: resized from either side), with the shadow's margin. A function of the
 * hang alone, so a window dragged by its card is still its stage.
 */
export function stageFor(hang: Hang, zoom = 1): Rect {
  const width = Math.round(CARD_WIDTH.max * zoom);
  const out = Math.round(REACH_OUT * zoom);
  const height = Math.round(CARD_LIMIT.max * zoom);
  const frame = cardBox(hang, { width, height });
  const left = isLeft(hang.corner);
  return {
    x: (left ? frame.x - out : frame.x) - SHADOW.side,
    y: frame.y - SHADOW.top,
    width: width + out + 2 * SHADOW.side,
    height: height + SHADOW.top + SHADOW.bottom,
  };
}

/** Where the card is placed in its window: its distance from the window's edges on its hang side. */
export interface Inset {
  readonly corner: Corner;
  /** From the left edge (a left corner) or the right edge (a right corner). */
  readonly horizontal: number;
  /** From the top edge (a top corner) or the bottom edge (a bottom corner). */
  readonly vertical: number;
}

export function insetIn(hang: Hang, stage: Rect): Inset {
  return {
    corner: hang.corner,
    horizontal: isLeft(hang.corner) ? hang.x - stage.x : stage.x + stage.width - hang.x,
    vertical: isTop(hang.corner) ? hang.y - stage.y : stage.y + stage.height - hang.y,
  };
}

/** Hanging from a corner of the work area, 24 px from its edges. */
export function hangInCorner(corner: Corner, area: Rect): Hang {
  return {
    corner,
    x: isLeft(corner) ? area.x + MINI_MARGIN : area.x + area.width - MINI_MARGIN,
    y: isTop(corner) ? area.y + MINI_MARGIN : area.y + area.height - MINI_MARGIN,
  };
}

/** The first place: the top-right corner of the work area under the mouse. */
export function firstHang(area: Rect): Hang {
  return hangInCorner('top-right', area);
}

/** The room the card has from its hang point to the work area's far edges (less the margin). */
export function roomFor(hang: Hang, area: Rect): { width: number; height: number } {
  const width = isLeft(hang.corner)
    ? area.x + area.width - MINI_MARGIN - hang.x
    : hang.x - area.x - MINI_MARGIN;
  const height = isTop(hang.corner)
    ? area.y + area.height - MINI_MARGIN - hang.y
    : hang.y - area.y - MINI_MARGIN;
  return {
    width: Math.max(CARD_WIDTH.min, Math.min(CARD_WIDTH.max, Math.round(width))),
    height: Math.max(CARD_LIMIT.min, Math.min(CARD_LIMIT.max, Math.round(height))),
  };
}

/** The corner a card let go at `box` snaps to, or null when it is near none. */
export function snapCorner(box: Rect, area: Rect): Corner | null {
  const gaps = {
    left: box.x - area.x,
    right: area.x + area.width - (box.x + box.width),
    top: box.y - area.y,
    bottom: area.y + area.height - (box.y + box.height),
  };
  const near = (gap: number): boolean => gap <= SNAP_DISTANCE;
  const vertical =
    near(gaps.top) && (!near(gaps.bottom) || gaps.top <= gaps.bottom)
      ? 'top'
      : near(gaps.bottom)
        ? 'bottom'
        : null;
  const horizontal =
    near(gaps.left) && (!near(gaps.right) || gaps.left <= gaps.right)
      ? 'left'
      : near(gaps.right)
        ? 'right'
        : null;
  return vertical && horizontal ? `${vertical}-${horizontal}` : null;
}

/**
 * Where a card let go at `box` (hanging from `corner`) goes: into a corner within 48 px of one,
 * hanging from it; elsewhere it stays where it is, still hanging from the same corner.
 */
export function settle(
  box: Rect,
  area: Rect,
  corner: Corner,
): { readonly hang: Hang; readonly snapped: boolean } {
  const snap = snapCorner(box, area);
  if (snap) return { hang: hangInCorner(snap, area), snapped: true };
  return {
    hang: {
      corner,
      x: isLeft(corner) ? box.x : box.x + box.width,
      y: isTop(corner) ? box.y : box.y + box.height,
    },
    snapped: false,
  };
}

/**
 * MINI-04, D-177: the edge tab. Mini collapses to the app icon cut in half by a side edge of the
 * screen; the card comes out of it, level with it, 24 px from the edge. The tab is dragged along
 * its edge (snapping to the corner spots) or across to the other one. Sizes here are DIP: the tab's
 * 48 page pixels times the page's zoom.
 */
export type Side = 'left' | 'right';

/** The tab's place: its side, the work area's edge there (x) and its top (y). */
export interface TabPlace {
  readonly side: Side;
  readonly x: number;
  readonly y: number;
}

/** The tab: 48 page pixels square, centred on the edge (only its inner half shows). */
export const TAB_SIZE = 48;
/** The corner spots (Proposed): the tab's top 120 px below the work area's top, its bottom 48 px above its bottom. */
export const TAB_SPOT_TOP = 120;
export const TAB_SPOT_BOTTOM = 48;
/** Let go this near a corner spot, the tab snaps to it (mini's snap distance). */
export const TAB_SNAP = SNAP_DISTANCE;

const edgeOf = (side: Side, area: Rect): number => (side === 'left' ? area.x : area.x + area.width);

/** The tab's highest and lowest tops on a work area. */
function tabRange(area: Rect, size: number): { readonly min: number; readonly max: number } {
  return { min: area.y, max: Math.max(area.y, area.y + area.height - size) };
}

/** The corner spots' tops (on both edges). */
export function tabSpots(
  area: Rect,
  size = TAB_SIZE,
): { readonly top: number; readonly bottom: number } {
  const range = tabRange(area, size);
  const clamp = (y: number): number => Math.max(range.min, Math.min(range.max, Math.round(y)));
  return {
    top: clamp(area.y + TAB_SPOT_TOP),
    bottom: clamp(area.y + area.height - TAB_SPOT_BOTTOM - size),
  };
}

/** A tab's top let go at `y`: on the work area, and at a corner spot when within 48 px of one. */
export function snapTabY(y: number, area: Rect, size = TAB_SIZE): number {
  const range = tabRange(area, size);
  const spots = tabSpots(area, size);
  const near = [spots.top, spots.bottom]
    .map((spot) => ({ spot, gap: Math.abs(y - spot) }))
    .filter((each) => each.gap <= TAB_SNAP)
    .sort((a, b) => a.gap - b.gap)[0];
  if (near) return near.spot;
  return Math.max(range.min, Math.min(range.max, Math.round(y)));
}

/** The tab on `side` of a work area, its top at `y` (kept on the area, not snapped). */
export function tabAt(side: Side, y: number, area: Rect, size = TAB_SIZE): TabPlace {
  const range = tabRange(area, size);
  return {
    side,
    x: edgeOf(side, area),
    y: Math.max(range.min, Math.min(range.max, Math.round(y))),
  };
}

/** The first place: the top-right corner spot. */
export function firstTab(area: Rect, size = TAB_SIZE): TabPlace {
  return tabAt('right', tabSpots(area, size).top, area, size);
}

/**
 * D-177 Q3: the card comes out of the tab, 24 px from the edge: in the upper half of the screen its
 * top is level with the tab's (it grows down), in the lower half its bottom (it grows up).
 */
export function hangForTab(tab: TabPlace, area: Rect, size = TAB_SIZE): Hang {
  const upper = tab.y + size / 2 < area.y + area.height / 2;
  return {
    corner: `${upper ? 'top' : 'bottom'}-${tab.side}`,
    x: tab.side === 'left' ? area.x + MINI_MARGIN : area.x + area.width - MINI_MARGIN,
    y: upper ? tab.y : tab.y + size,
  };
}

/**
 * Collapsing a card at `box`: the tab goes to its nearer side edge, level with its top (upper half)
 * or bottom (lower half), snapping as a drag does; a card snapped into a corner goes to that
 * corner's spot (level with it would put the tab beside other apps' caption buttons).
 */
export function tabForCard(
  box: Rect,
  snapped: Corner | null,
  area: Rect,
  size = TAB_SIZE,
): TabPlace {
  if (snapped) {
    const spots = tabSpots(area, size);
    return tabAt(
      isLeft(snapped) ? 'left' : 'right',
      isTop(snapped) ? spots.top : spots.bottom,
      area,
      size,
    );
  }
  const side: Side = box.x + box.width / 2 < area.x + area.width / 2 ? 'left' : 'right';
  const upper = box.y + box.height / 2 < area.y + area.height / 2;
  return tabAt(side, snapTabY(upper ? box.y : box.y + box.height - size, area, size), area, size);
}

/**
 * The window while mini is at the edge: a strip along the tab's edge, the work area's full height,
 * as wide as the largest card with its margin and shadow. It ends exactly at the edge, so the tab's
 * outer half is cut off there (never shown on a monitor beside). The tab moves up and down and the
 * card comes out inside it, so the window only moves to change sides.
 */
export function tabStage(tab: TabPlace, area: Rect, zoom = 1): Rect {
  const width = Math.round(MINI_MARGIN + CARD_WIDTH.max * zoom + SHADOW.side);
  return {
    x: tab.side === 'left' ? area.x : area.x + area.width - width,
    y: area.y,
    width,
    height: area.height,
  };
}

/** A remembered size, kept in its ranges. */
export function clampSize(size: { width?: unknown; limit?: unknown }): {
  width: number;
  limit: number;
} {
  const pick = (value: unknown, range: { min: number; initial: number; max: number }): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(range.min, Math.min(range.max, Math.round(value)))
      : range.initial;
  return { width: pick(size.width, CARD_WIDTH), limit: pick(size.limit, CARD_LIMIT) };
}
