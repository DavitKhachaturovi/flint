/** UI-04, D-56: the gliding selection highlight, shared by the main window and mini mode (D-110). */
import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { durationMs, reducedMotion } from './motion.js';

/**
 * The selection highlight (UI-04, D-56): one element per card that moves to the selected row with
 * the spring curve, instead of the highlight jumping from row to row. Off with reduce-motion, like
 * all motion (the move is then instant).
 */
export function Glide(props: {
  readonly card: RefObject<HTMLElement | null>;
  readonly target: string | null;
  /** Re-measure when the rows change. */
  readonly version: unknown;
  /** `sel-glide` for rows, `nav-glide` for the sidebar (D-65). */
  readonly className?: string;
  /** D-76: the target is being edited: the highlight is the dark editing field. */
  readonly editing?: boolean;
}): ReactElement | null {
  const { card, target, version, className = 'sel-glide', editing = false } = props;
  const [box, setBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    /** D-78: the same target, moved by the layout (a body folding above it): follow at once. */
    follow: boolean;
  } | null>(null);
  const measured = useRef<{ target: string | null; at: number }>({ target: null, at: 0 });
  const node = useRef<HTMLDivElement>(null);
  // D-76: editing that starts on another row appears there (fading in) instead of gliding over;
  // from one editing row to the next it glides.
  const jump = useRef(false);
  const last = useRef({ target, editing });
  if (last.current.target !== target || last.current.editing !== editing) {
    if (editing && !last.current.editing && target !== last.current.target) jump.current = true;
    last.current = { target, editing };
  }
  useLayoutEffect(() => {
    const element = node.current;
    if (!element || !jump.current) return;
    jump.current = false;
    element.style.transition = 'none';
    void element.offsetWidth;
    element.style.transition = '';
    // D-77: a fuller, still subtle, arrival: it fades in and settles from a slightly smaller size.
    if (!reducedMotion()) {
      const at = element.style.transform;
      element.animate(
        [
          { opacity: 0, transform: `${at} scale(0.97)` },
          { opacity: 1, transform: at },
        ],
        { duration: durationMs('--fl-dur-state', 260), easing: 'cubic-bezier(.2, .9, .3, 1)' },
      );
    }
  }, [box]);
  useLayoutEffect(() => {
    // D-99: while the row (or the group card around it) slides in a FLIP or an easing, the
    // highlight follows where it is on screen, frame by frame, instead of jumping to where it ends
    // (it flashed over the row's neighbours, as when a name field opened in a group).
    let frame = 0;
    // Anything in the card that moves rows: a FLIP, a group card easing its height, a fold.
    const sliding = (): boolean =>
      (card.current?.getAnimations({ subtree: true }) ?? []).some(
        (animation) =>
          animation.playState === 'running' &&
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target !== node.current &&
          !(
            animation instanceof CSSTransition &&
            !['transform', 'height', 'top', 'grid-template-rows'].includes(
              animation.transitionProperty,
            )
          ),
      );
    const track = (row: HTMLElement): void => {
      frame = 0;
      const element = card.current;
      if (!element || !row.isConnected) return;
      if (!sliding()) {
        measure(false);
        return;
      }
      const outer = element.getBoundingClientRect();
      const inner = row.getBoundingClientRect();
      const at = {
        x: inner.left - outer.left - element.clientLeft + element.scrollLeft,
        y: inner.top - outer.top - element.clientTop + element.scrollTop,
        w: inner.width,
        h: inner.height,
        follow: true,
      };
      // Written at once (this frame), and to the state (which renders a frame later).
      const glide = node.current;
      if (glide) {
        // As React writes it while following (so it takes this back over when it renders).
        glide.style.transition =
          'background-color var(--fl-dur-state) ease, box-shadow var(--fl-dur-state) ease';
        glide.style.transform = `translate(${at.x}px, ${at.y}px)`;
        glide.style.width = `${at.w}px`;
        glide.style.height = `${at.h}px`;
      }
      setBox(at);
      frame = requestAnimationFrame(() => track(row));
    };
    const measure = (watch = true): void => {
      const found = target
        ? card.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(target)}"]`)
        : null;
      // D-77: an expanded task is one card with its body; the highlight covers all of it.
      const grouped = found?.parentElement?.classList.contains('row-group')
        ? found.parentElement
        : found;
      // LIST-05: a list in a folded group has no highlight.
      const row = grouped?.closest('.group-lists:not(.open)') ? null : grouped;
      // D-79: following the layout at once must never cut short a glide to a new target (that
      // made list switching lose its motion): within a glide's time, keep gliding.
      const now = performance.now();
      const settled = now - measured.current.at > durationMs('--fl-dur-base', 200);
      const follow = measured.current.target === target && settled;
      if (measured.current.target !== target) measured.current = { target, at: now };
      // D-80: a list inside a group card is placed within the card: offsets add up to ours.
      // D-131: without a group card's own offset while it slides (D-102 moves it by `top` and
      // `left`): where the row will rest, not where it is mid-slide (the highlight stayed there).
      let x = 0;
      let y = 0;
      for (
        let node: HTMLElement | null = row ?? null;
        node && node !== card.current;
        node = node.offsetParent as HTMLElement | null
      ) {
        x += node.offsetLeft;
        y += node.offsetTop;
        const style = getComputedStyle(node);
        if (style.position === 'relative') {
          x -= parseFloat(style.left) || 0;
          y -= parseFloat(style.top) || 0;
        }
      }
      setBox(
        row
          ? {
              x,
              y,
              w: row.offsetWidth,
              h: row.offsetHeight,
              follow,
            }
          : null,
      );
      // The same row moved by the layout: if it slides there (the animations start after this
      // render), the highlight goes with it.
      // Checked before the frame is painted: the animations start later in this same commit.
      if (watch && row && follow && frame === 0)
        queueMicrotask(() => {
          if (frame === 0 && sliding()) track(row);
        });
    };
    measure();
    const onResize = (): void => measure();
    window.addEventListener('resize', onResize);
    // Rows collapsing or easing in (D-67) move the selected row: follow it.
    const observer = new ResizeObserver(() => measure());
    if (card.current) observer.observe(card.current);
    // LIST-05: and sidebar groups folding above it.
    for (const group of card.current?.querySelectorAll('.group-inner') ?? [])
      observer.observe(group);
    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [card, target, version]);
  if (!box) return null;
  return (
    <div
      ref={node}
      className={editing ? `${className} editing` : className}
      aria-hidden="true"
      style={{
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: box.w,
        height: box.h,
        // Following the layout: no lag in place or size; the look (editing ↔ selected) still eases.
        ...(box.follow && {
          transition:
            'background-color var(--fl-dur-state) ease, box-shadow var(--fl-dur-state) ease',
        }),
      }}
    />
  );
}
