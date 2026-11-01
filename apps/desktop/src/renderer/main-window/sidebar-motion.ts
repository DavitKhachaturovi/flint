/**
 * LIST-05, LIST-06, D-80 (09 §8): the sidebar's rows move to their new places instead of jumping:
 * a new sort, Move to group and Remove from group, a new group pushing the lists down, a deleted
 * group's lists sliding out. Every list and group carries `data-flip`; `capture` measures them just
 * before the sidebar changes and `play`, right after React has committed the change, animates each
 * from where it was (FLIP). Rows that are new ease in; rows that went away fade out as ghosts. The
 * change itself is already made: motion never delays input (D-75). Off with reduce-motion.
 */

interface Snapshot {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly clone: HTMLElement;
}

const reduceMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const duration = (): number => parseFloat(token('--fl-dur-state', '260')) || 260;

export interface SidebarMotion {
  /** Measures the rows before a change (also keeps a copy of each, for the ones that go away). */
  readonly capture: () => void;
  /** After the change is on screen: plays the moves, arrivals and departures. */
  readonly play: () => void;
}

export function sidebarMotion(aside: () => HTMLElement | null): SidebarMotion {
  let before: Map<string, Snapshot> | null = null;

  const measure = (element: HTMLElement, box: DOMRect, scroll: number): Omit<Snapshot, 'clone'> => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top - box.top + scroll,
      left: rect.left - box.left,
      width: rect.width,
      height: rect.height,
    };
  };

  const capture = (): void => {
    const root = aside();
    // A drag moves the rows itself and lands them (drag.ts); its transforms aren't positions.
    if (!root || document.body.classList.contains('fl-dragging')) {
      before = null;
      return;
    }
    const box = root.getBoundingClientRect();
    const shots = new Map<string, Snapshot>();
    for (const element of root.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = element.dataset['flip'];
      if (!key || shots.has(key)) continue;
      shots.set(key, {
        ...measure(element, box, root.scrollTop),
        clone: element.cloneNode(true) as HTMLElement,
      });
    }
    before = shots;
  };

  const play = (): void => {
    const root = aside();
    const was = before;
    before = null;
    if (!root || !was || reduceMotion() || document.body.classList.contains('fl-dragging')) return;
    const box = root.getBoundingClientRect();
    const timing = { duration: duration(), easing: token('--fl-ease-spring', 'ease-out') };
    const moved = new Map<HTMLElement, { x: number; y: number }>();
    const seen = new Set<string>();
    for (const element of root.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = element.dataset['flip'] ?? '';
      seen.add(key);
      const old = was.get(key);
      const now = measure(element, box, root.scrollTop);
      if (!old) {
        element.animate(
          [
            { opacity: 0, transform: 'translateY(-4px) scale(0.97)' },
            { opacity: 1, transform: 'none' },
          ],
          timing,
        );
        continue;
      }
      // A row inside a group that moves too only plays its own part of the move.
      const parent = element.parentElement?.closest<HTMLElement>('[data-flip]');
      const carried = (parent && moved.get(parent)) ?? { x: 0, y: 0 };
      const total = { x: old.left - now.left, y: old.top - now.top };
      moved.set(element, total);
      const x = total.x - carried.x;
      const y = total.y - carried.y;
      const resized = Math.abs(old.height - now.height) > 0.5 && element.matches('.nav-group');
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && !resized) continue;
      element.animate(
        [
          {
            transform: `translate(${x}px, ${y}px)`,
            ...(resized && { height: `${old.height}px`, overflow: 'hidden' }),
          },
          { transform: 'none', ...(resized && { height: `${now.height}px`, overflow: 'hidden' }) },
        ],
        timing,
      );
      // The open list's highlight is drawn apart from its row (UI-04): it travels along.
      if (element.matches('.nav.on'))
        root
          .querySelector<HTMLElement>(':scope > .nav-glide')
          ?.animate(
            [{ transform: `translate(${total.x}px, ${total.y}px)` }, { transform: 'none' }],
            {
              ...timing,
              composite: 'add',
            },
          );
    }
    // Rows that went away fade out where they were; a group's lists aren't in its ghost (they
    // slide out on their own).
    for (const [key, shot] of was) {
      if (seen.has(key)) continue;
      const parentGone = [...was.entries()].some(
        ([other, outer]) =>
          other !== key &&
          !seen.has(other) &&
          outer.clone.querySelector(`[data-flip="${CSS.escape(key)}"]`),
      );
      if (parentGone) continue;
      const ghost = shot.clone;
      ghost.querySelector('.group-lists')?.remove();
      // Nothing finds a ghost: not the motion, the highlight or a drag.
      for (const inner of [
        ghost,
        ...ghost.querySelectorAll<HTMLElement>('[data-flip], [data-key], [data-group]'),
      ])
        for (const name of ['data-flip', 'data-key', 'data-group']) inner.removeAttribute(name);
      ghost.classList.add('flip-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, {
        position: 'absolute',
        top: `${shot.top}px`,
        left: `${shot.left}px`,
        width: `${shot.width}px`,
        margin: '0',
        pointerEvents: 'none',
      });
      root.append(ghost);
      ghost
        .animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], {
          ...timing,
          fill: 'forwards',
        })
        .finished.then(
          () => ghost.remove(),
          () => ghost.remove(),
        );
    }
  };

  return { capture, play };
}
