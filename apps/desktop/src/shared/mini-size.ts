/**
 * MINI-01, D-110, D-111: mini mode's card size, shared by the window (main) and the page: one
 * width and one height limit for every tab (Today and Inbox fit their content up to the limit, the
 * Note tab always takes it). Mockup 05's card is the default.
 */
// D-160: the minimum fits the header at its shortest: Today, the list tab reduced to an ellipsis
// and its chevron, Note, and the reset, pin and × buttons.
export const MINI_WIDTH = { min: 320, initial: 364, max: 520 } as const;
export const MINI_LIMIT = { min: 180, initial: 460, max: 760 } as const;

/**
 * The card's floating shadow over other apps (`--fl-shadow-desktop`) reaches this far past it; the
 * window keeps that much room around the card. D-111: tighter below than the popup's, so it stays
 * soft on a white desktop.
 */
export const MINI_SHADOW = { top: 16, side: 32, bottom: 48 } as const;

/** D-111: a resize let go this near the default size snaps to it. */
export const MINI_SNAP = 8;
