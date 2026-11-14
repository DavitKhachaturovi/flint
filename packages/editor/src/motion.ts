/** Motion helpers shared by the main window and mini mode (09 §9, D-75). */

/** A duration token in ms (09 §9), so JS timings follow the motion tokens (and the M8 speed). */
export function durationMs(token: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
  return Number.isFinite(value) ? value : fallback;
}

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** D-87: a move that can't happen (the first task's indent, say): the row nudges that way. */
export function nudge(key: string, direction: 'left' | 'right' | 'up' | 'down'): void {
  const row = document.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`);
  if (row) nudgeElement(row, direction);
}

/** D-87, NOTE-10: the same nudge for any element (a table cell that can't take a line break). */
export function nudgeElement(row: HTMLElement, direction: 'left' | 'right' | 'up' | 'down'): void {
  if (reducedMotion()) return;
  const moves: Record<typeof direction, readonly [number, number]> = {
    left: [-6, 0],
    right: [6, 0],
    up: [0, -4],
    down: [0, 4],
  };
  const [x, y] = moves[direction];
  row.animate(
    [
      { translate: '0 0' },
      { translate: `${x}px ${y}px` },
      { translate: `${-x / 3}px ${-y / 3}px` },
      { translate: '0 0' },
    ],
    { duration: 260, easing: 'ease-out' },
  );
}

/** APP-11, D-67, D-75: the animation-speed setting scales every duration token (both windows, D-110). */
const SPEEDS = { relaxed: 1.35, normal: 1, quick: 0.7 } as const;
const DURATIONS = [
  '--fl-dur-fast',
  '--fl-dur-base',
  '--fl-dur-page',
  '--fl-dur-state',
  '--fl-dur-complete',
];
const baseDurations = new Map<string, number>();
export function applySpeed(speed: keyof typeof SPEEDS): void {
  const root = document.documentElement;
  for (const name of DURATIONS) {
    if (!baseDurations.has(name)) {
      root.style.removeProperty(name);
      baseDurations.set(name, parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0);
    }
    const base = baseDurations.get(name) ?? 0;
    if (speed === 'normal') root.style.removeProperty(name);
    else root.style.setProperty(name, `${Math.round(base * SPEEDS[speed])}ms`);
  }
}
