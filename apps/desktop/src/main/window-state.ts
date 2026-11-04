/**
 * Window positions per monitor setup (APP-05, docs/05 §5): a laptop alone and the same laptop docked
 * to two screens each remember their own layout. A saved position that is no longer on any screen
 * falls back to the active display.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayInfo {
  readonly id: number;
  readonly bounds: Rect;
  readonly workArea: Rect;
  readonly scaleFactor: number;
}

/** Identifies a monitor setup: the set of displays with their positions, sizes and scaling. */
export function monitorSetupKey(displays: readonly DisplayInfo[]): string {
  return displays
    .map(({ bounds: b, scaleFactor }) => `${b.x},${b.y},${b.width}x${b.height}@${scaleFactor}`)
    .sort()
    .join('|');
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The bounds to restore: the saved ones if at least half of the window's title strip (where it is
 * grabbed to move it) is on a current display, otherwise the same size centred on `active`, shrunk
 * to fit.
 */
export function restoreBounds(
  saved: Rect | undefined,
  displays: readonly DisplayInfo[],
  active: DisplayInfo,
  fallback: Rect,
): Rect {
  if (saved) {
    const strip: Rect = {
      x: saved.x,
      y: saved.y,
      width: saved.width,
      height: Math.min(40, saved.height),
    };
    const visible = displays.reduce((sum, display) => sum + overlap(strip, display.workArea), 0);
    if (visible >= (strip.width * strip.height) / 2) return saved;
  }
  const size = saved ?? fallback;
  const area = active.workArea;
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

/**
 * A window as it was left (D-96): its normal (not maximized) bounds, and whether it was maximized.
 * Files from before D-96 have the bounds only (not maximized).
 */
export interface SavedWindow extends Rect {
  readonly maximized?: boolean;
}

/** `window-state.json` (docs/04 §2): each window's state per monitor setup. */
export type WindowStates = Record<string, Record<string, SavedWindow>>;

export function rememberBounds(
  states: WindowStates,
  window: string,
  setup: string,
  bounds: SavedWindow,
): WindowStates {
  const saved: SavedWindow = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    ...(bounds.maximized && { maximized: true }),
  };
  return { ...states, [window]: { ...(states[window] ?? {}), [setup]: saved } };
}

/** The parts of a window that showing it as it was left needs (a BrowserWindow has them). */
export interface ShowableWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  maximize(): void;
  focus(): void;
}

/**
 * APP-05, D-96: shows a window in the state it was left in, from every entry point (a reminder,
 * the tray, the Start menu, a second launch): maximized again if it was (maximizing a hidden
 * window shows it, so it never appears at its normal size first), un-minimized, in front.
 */
export function showAsLeft(window: ShowableWindow, maximized: boolean, focus = true): void {
  // A minimized window comes back as it was (maximized too).
  if (window.isMinimized()) window.restore();
  if (maximized) window.maximize();
  else window.show();
  if (focus) window.focus();
}
