/** Motion helpers shared by the main window and mini mode (09 §9, D-75). */

/** A duration token in ms (09 §9), so JS timings follow the motion tokens (and the M8 speed). */
export function durationMs(token: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
