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

/** `window-state.json` (docs/04 §2): bounds per window per monitor setup. */
export type WindowStates = Record<string, Record<string, Rect>>;

export function rememberBounds(
  states: WindowStates,
  window: string,
  setup: string,
  bounds: Rect,
): WindowStates {
  return { ...states, [window]: { ...(states[window] ?? {}), [setup]: bounds } };
}
