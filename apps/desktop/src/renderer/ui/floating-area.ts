/**
 * D-115: where menus and pickers may open: the window's visible part. The main window is all of
 * it; mini mode's window is a transparent stage that reaches past the screen's edge beside its
 * card (room to resize into), so mini says which part of it is on the screen, and a menu opened
 * near that edge flips left or up instead of being cut off.
 */
export interface FloatingArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

let visible: FloatingArea | null = null;

/** Mini mode: the part of its window on the screen (page pixels); null: the whole window. */
export function setFloatingArea(next: FloatingArea | null): void {
  visible = next;
}

/** The area a floating panel must stay within: the window, cut to its visible part. */
export function floatingArea(): FloatingArea {
  const whole = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  if (!visible) return whole;
  return {
    left: Math.max(whole.left, visible.left),
    top: Math.max(whole.top, visible.top),
    right: Math.min(whole.right, visible.right),
    bottom: Math.min(whole.bottom, visible.bottom),
  };
}
