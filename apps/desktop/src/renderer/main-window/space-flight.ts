/**
 * SPACE-07 (09 §8, D-89): Move to space's flight. A copy of the list's sidebar row lifts (rising
 * 6 px and growing to 1.02 in its first 15 %) and travels to the switcher's tile, shrinking to 0.4
 * and fading (440 ms at normal speed, `cubic-bezier(.2,.9,.3,1.05)`); the row itself is hidden at
 * once, so the sidebar's departing copy of it (sidebar-motion.ts) stays invisible and only the rows
 * below close up. The move is already under way: motion never delays it (D-75). Off under
 * reduce-motion. `land` flashes the row where it arrived, when it is on screen.
 */
import { durationMs, reducedMotion } from '../ui/motion.js';

const row = (listId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.sidebar .nav[data-key="${CSS.escape(listId)}"]`);

export interface Flight {
  /** Resolves when the copy reaches the tile (at once without motion). */
  readonly landed: Promise<void>;
  /** The move was refused: the copy goes and the row is back at once. */
  readonly cancel: () => void;
}

const NONE: Flight = { landed: Promise.resolve(), cancel: () => undefined };

/** Starts the flight of the list's row to the switcher's tile. */
export function flyToSwitcher(listId: string): Flight {
  const from = row(listId);
  const tile = document.querySelector<HTMLElement>('.space-btn .stile');
  if (reducedMotion() || !from || !tile) return NONE;
  const start = from.getBoundingClientRect();
  const end = tile.getBoundingClientRect();
  const copy = from.cloneNode(true) as HTMLElement;
  copy.classList.add('space-flight');
  copy.classList.remove('active');
  copy.removeAttribute('data-flip');
  copy.removeAttribute('data-key');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  Object.assign(copy.style, {
    left: `${start.left}px`,
    top: `${start.top}px`,
    width: `${start.width}px`,
    height: `${start.height}px`,
  });
  document.body.append(copy);
  from.style.visibility = 'hidden';
  const dx = end.left + end.width / 2 - (start.left + start.width / 2);
  const dy = end.top + end.height / 2 - (start.top + start.height / 2);
  // The animation-speed setting (APP-11) scales it as it does every duration token.
  const duration = 440 * (durationMs('--fl-dur-page', 320) / 320);
  const flight = copy.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: 'translate(0, -6px) scale(1.02)', opacity: 1, offset: 0.15 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0 },
    ],
    { duration, easing: 'cubic-bezier(.2, .9, .3, 1.05)', fill: 'forwards' },
  );
  const landed = new Promise<void>((resolve) => {
    const done = (): void => {
      copy.remove();
      // The row, if React kept the element (the move refused): seen again.
      from.style.visibility = '';
      resolve();
    };
    flight.onfinish = done;
    flight.oncancel = done;
  });
  return { landed, cancel: () => flight.cancel() };
}

/** The arrived row lights up once (`fl-flash`), when its space is the one showing. */
export function land(listId: string): void {
  if (reducedMotion()) return;
  const arrived = row(listId);
  if (!arrived) return;
  arrived.classList.remove('fl-flash');
  void arrived.offsetWidth;
  arrived.classList.add('fl-flash');
  arrived.addEventListener('animationend', () => arrived.classList.remove('fl-flash'), {
    once: true,
  });
}
