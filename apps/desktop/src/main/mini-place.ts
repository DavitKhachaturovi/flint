import type { Rect } from './window-state.js';

/**
 * MINI-01, D-109: where the mini window goes. It opens first at the top right of the screen the
 * mouse is on; dragged and let go within 48 px of a screen corner, it snaps into that corner and
 * stays anchored there when it is resized or the screens change. Pure, so it is unit-tested.
 */

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Mockup 05's size. */
export const MINI_SIZE = { width: 440, height: 500 } as const;
export const MINI_MIN = { width: 320, height: 260 } as const;
export const MINI_MAX = { width: 720, height: 900 } as const;
/** The gap to the screen's edges in a corner. */
export const MINI_MARGIN = 24;
/** How near a corner a drag must end to snap. */
export const SNAP_DISTANCE = 48;

/** The bounds of a window of `size` in `corner` of the work area. */
export function inCorner(
  corner: Corner,
  area: Rect,
  size: { width: number; height: number },
): Rect {
  const width = Math.min(size.width, area.width - 2 * MINI_MARGIN);
  const height = Math.min(size.height, area.height - 2 * MINI_MARGIN);
  const left = corner.endsWith('left');
  const top = corner.startsWith('top');
  return {
    x: Math.round(left ? area.x + MINI_MARGIN : area.x + area.width - MINI_MARGIN - width),
    y: Math.round(top ? area.y + MINI_MARGIN : area.y + area.height - MINI_MARGIN - height),
    width,
    height,
  };
}

/** The first place: the top-right corner of the work area under the mouse. */
export function firstMiniBounds(area: Rect): Rect {
  return inCorner('top-right', area, MINI_SIZE);
}

/** The corner a window let go at `bounds` snaps to, or null when it is near none. */
export function snapCorner(bounds: Rect, area: Rect): Corner | null {
  const gaps = {
    left: bounds.x - area.x,
    right: area.x + area.width - (bounds.x + bounds.width),
    top: bounds.y - area.y,
    bottom: area.y + area.height - (bounds.y + bounds.height),
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
