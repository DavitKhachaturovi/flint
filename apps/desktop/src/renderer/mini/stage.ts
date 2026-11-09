import { setFloatingArea } from '../ui/floating-area.js';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { MiniLayout } from '../../shared/ipc.js';
import { MINI_LIMIT, MINI_SHADOW, MINI_SNAP, MINI_WIDTH } from '../../shared/mini-size.js';
import { durationMs, reducedMotion } from '../ui/motion.js';

/**
 * D-110, D-111: mini mode's card on its transparent stage (`main/mini-place.ts`). The window is
 * the largest card's area from the corner the card hangs from, with room on its hang side; the card
 * is placed in it here. One size for every tab: a width and a height limit; Today and Inbox are as
 * tall as their content up to the limit (then the body scrolls), the Note tab always takes it. It
 * is resized from its left and right edges and from the edge facing away from its corner (a top
 * corner: the bottom edge; a bottom corner: a thin top edge), never moving the window; let go near
 * the default size it snaps to it, and a reset button brings it back (eased). Main is told the
 * card's size and where clicks must reach the page: the card, its handles, open menus, anything
 * held; nothing above a card in a top corner. Elsewhere clicks pass through to the apps below.
 */

/** The handles' reach outside the card; the top one is thin (other windows' buttons sit there). */
export const HANDLE = 8;
const TOP_HANDLE = 3;

/** A handle: which horizontal edge it moves (-1 left, 1 right) and whether it moves the height. */
interface Handle {
  readonly id: string;
  readonly x: -1 | 0 | 1;
  readonly y: boolean;
  readonly className: string;
}

export interface Stage {
  readonly style: CSSProperties;
  readonly className: string;
  readonly handles: readonly Handle[];
  readonly startResize: (handle: Handle, event: ReactPointerEvent<HTMLElement>) => void;
  /** The corner the card hangs from (a bottom corner: it grows upward). */
  readonly corner: MiniLayout['corner'];
  /** D-111: the size differs from the default: the reset button shows. */
  readonly resized: boolean;
  readonly reset: () => void;
}

const DEFAULT = { width: MINI_WIDTH.initial, limit: MINI_LIMIT.initial };

export function useStage(refs: {
  readonly card: RefObject<HTMLElement | null>;
  /** Changes when the content changes at once (another tab, another note): the height eases. */
  readonly version: unknown;
  /** The Note tab: the card always takes its full height. */
  readonly full: boolean;
}): Stage {
  const { card, version, full } = refs;
  const [layout, setLayout] = useState<MiniLayout | null>(null);
  const [size, setSize] = useState<{ width: number; limit: number }>(DEFAULT);
  // Where the hang-side edge is (`MiniLayout.horizontal`); a resize from that side moves it.
  const [horizontal, setHorizontal] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [easing, setEasing] = useState(false);
  // Snapping into another corner: hidden until the window has moved, then it settles in.
  const [hidden, setHidden] = useState(false);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const take = (next: MiniLayout): void => {
      // D-115: menus and pickers open within the part of the window on the screen.
      setFloatingArea(next.visible ?? null);
      setLayout(next);
      setSize({ width: next.width, limit: next.limit });
      setHorizontal(next.horizontal);
    };
    void window.flintMini.layout().then((current) => {
      if (current && !layoutRef.current) take(current);
    });
    window.flintMini.onLayout((next) => {
      take(next);
      if (next.moving !== undefined) {
        const id = next.moving;
        setHidden(true);
        // Hidden and in its new place for a frame before the window moves.
        requestAnimationFrame(() => requestAnimationFrame(() => window.flintMini.layoutReady(id)));
      }
    });
    window.flintMini.onSettled(() => {
      setHidden(false);
      const element = card.current;
      if (!element || reducedMotion()) return;
      element.animate(
        [
          { opacity: 0, transform: 'scale(0.97)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: durationMs('--fl-dur-base', 200), easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
      );
    });
  }, [card]);

  const room = layout?.room ?? { width: MINI_WIDTH.max, height: MINI_LIMIT.max };
  const width = Math.max(MINI_WIDTH.min, Math.min(size.width, room.width));
  const limit = Math.max(MINI_LIMIT.min, Math.min(size.limit, room.height));

  // Today and Inbox are as tall as their content up to the limit (max-height; the body scrolls
  // past it), following rows as they ease in and out. A sudden change (another tab, another note)
  // eases from the old height to the new (09 §9's page switch).
  const lastHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const before = lastHeight.current;
    const after = element.offsetHeight;
    if (before === null || before === after || reducedMotion()) return;
    // D-112: no scrollbar while the height eases (the new tab may be taller than the card yet).
    element.classList.add('sizing');
    const easing = element.animate([{ height: `${before}px` }, { height: `${after}px` }], {
      duration: durationMs('--fl-dur-page', 320),
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    });
    const done = (): void => {
      if (element.getAnimations().every((each) => each === easing || each.playState !== 'running'))
        element.classList.remove('sizing');
    };
    easing.addEventListener('finish', done);
    easing.addEventListener('cancel', done);
  }, [card, version]);
  // D-160: the reset button shows only when the card's visible size differs from the default. On
  // Today and the list tab the card is as tall as its content up to the limit, so a limit dragged
  // taller than short content changes nothing visible: it doesn't count. The height the card would
  // have at the default limit is known from what it has now: not reaching its limit, it is its
  // content's height (taller than the default limit only if the limit lets it); at its limit, the
  // content is at least that tall (at a smaller limit than the default, the default would show
  // more of it).
  const [heightDiffers, setHeightDiffers] = useState(false);
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const fullRef = useRef(full);
  fullRef.current = full;
  const judgeHeight = useCallback((): void => {
    const element = card.current;
    if (!element) return;
    const height = element.offsetHeight;
    const current = limitRef.current;
    setHeightDiffers(
      fullRef.current
        ? current !== DEFAULT.limit
        : height > DEFAULT.limit || (height >= current && current < DEFAULT.limit),
    );
  }, [card]);
  useEffect(judgeHeight, [judgeHeight, limit, full, version]);
  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      lastHeight.current = element.offsetHeight;
      judgeHeight();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [card, judgeHeight]);

  const corner = layout?.corner ?? 'top-right';
  const left = corner.endsWith('left');
  const top = corner.startsWith('top');

  // Where clicks must reach the page: the card and its handles, and everything open outside the
  // card (D-159: menus and pickers, which are children of the body beside the app's root, and the
  // editor's tooltips such as the slash menu). Told to main a frame after anything moves (and
  // while a button is held, wherever the pointer goes); while anything is open outside the card
  // it is measured again every frame, since menus and pickers place themselves, grow with their
  // rows and fade out, and only a change is sent.
  const held = useRef(false);
  const frame = useRef(0);
  const sent = useRef('');
  const report = useCallback((): void => {
    cancelAnimationFrame(frame.current);
    const tick = (): void => {
      const element = card.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const topCorner = (layoutRef.current?.corner ?? 'top-right').startsWith('top');
      const root = document.getElementById('root');
      const overlays = [
        ...[...document.body.children].filter((each) => each !== root),
        ...document.querySelectorAll('.cm-tooltip'),
      ];
      const rects = [
        {
          // The side handles and the one away from the corner; above a card in a top corner,
          // nothing (D-111).
          x: box.x - HANDLE,
          y: topCorner ? box.y : box.y - TOP_HANDLE,
          width: box.width + 2 * HANDLE,
          height: box.height + (topCorner ? HANDLE : TOP_HANDLE),
        },
        ...overlays
          .map((overlay) => {
            const rect = overlay.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          })
          .filter((rect) => rect.width > 0 && rect.height > 0),
      ];
      const surface = {
        card: { width: box.width, height: box.height },
        rects,
        held: held.current,
      };
      const key = JSON.stringify(surface);
      if (key !== sent.current) {
        sent.current = key;
        window.flintMini.surface(surface);
      }
      if (overlays.length > 0) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [card]);
  useEffect(() => {
    const observer = new ResizeObserver(report);
    if (card.current) observer.observe(card.current);
    // Menus come and go in the body.
    const menus = new MutationObserver(report);
    menus.observe(document.body, { childList: true });
    const down = (): void => {
      held.current = true;
      report();
    };
    const up = (): void => {
      held.current = false;
      report();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    return () => {
      observer.disconnect();
      menus.disconnect();
      cancelAnimationFrame(frame.current);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
    };
  }, [card, report]);
  useEffect(report, [report, layout, width, limit, horizontal, full]);

  const startResize = (handle: Handle, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const from = {
      width,
      height: card.current?.offsetHeight ?? limit,
      horizontal: horizontal ?? layoutRef.current?.horizontal ?? 0,
    };
    lastHeight.current = null;
    const roomNow = layoutRef.current?.room ?? room;
    // The hang-side edge: left for a left corner. Moving it moves the card's hang point.
    const hangSide = handle.x !== 0 && handle.x === (left ? -1 : 1);
    let next = { ...sizeRef.current, horizontal: from.horizontal };
    setResizing(true);
    const snap = (value: number, to: number): number =>
      Math.abs(value - to) <= MINI_SNAP ? to : value;
    const move = (moved: PointerEvent): void => {
      const dx = moved.clientX - start.x;
      const dy = moved.clientY - start.y;
      if (handle.x !== 0) {
        let wanted = snap(from.width + handle.x * dx, DEFAULT.width);
        // The card stays inside its window (the stage keeps room for this, D-111).
        const most = hangSide
          ? from.width + from.horizontal - MINI_SHADOW.side
          : window.innerWidth - from.horizontal - MINI_SHADOW.side;
        wanted = Math.max(MINI_WIDTH.min, Math.min(MINI_WIDTH.max, roomNow.width, most, wanted));
        next = {
          ...next,
          width: Math.round(wanted),
          horizontal: hangSide
            ? from.horizontal - (Math.round(wanted) - from.width)
            : from.horizontal,
        };
      }
      if (handle.y) {
        const wanted = snap(from.height + (top ? dy : -dy), DEFAULT.limit);
        next = {
          ...next,
          limit: Math.round(Math.max(MINI_LIMIT.min, Math.min(roomNow.height, wanted))),
        };
      }
      setSize({ width: next.width, limit: next.limit });
      setHorizontal(next.horizontal);
    };
    const end = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      setResizing(false);
      lastHeight.current = card.current?.offsetHeight ?? null;
      window.flintMini.resized(next);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  /** D-111: back to the default size, eased; the hang-side edge stays where it is. */
  const reset = (): void => {
    if (!reducedMotion()) {
      setEasing(true);
      window.setTimeout(() => setEasing(false), durationMs('--fl-dur-page', 320) + 40);
    }
    setSize(DEFAULT);
    window.flintMini.resized({
      ...DEFAULT,
      horizontal: horizontal ?? layoutRef.current?.horizontal ?? 0,
    });
  };

  const style: CSSProperties = {
    width,
    // Today and Inbox fit their content up to the limit; the Note tab takes all of it.
    ...(full ? { height: limit } : { maxHeight: limit }),
    [left ? 'left' : 'right']: horizontal ?? layout?.horizontal ?? 0,
    [top ? 'top' : 'bottom']: layout?.vertical ?? MINI_SHADOW.top,
    ...(hidden && { opacity: 0 }),
  };
  const away = top ? 'bottom' : 'top';
  return {
    style,
    className: [
      'mini-card fl-compact',
      layout === null ? 'unplaced' : '',
      resizing ? 'resizing' : '',
      easing ? 'easing' : '',
      hidden ? 'moving' : '',
    ]
      .filter(Boolean)
      .join(' '),
    handles: [
      { id: 'left', x: -1, y: false, className: 'mini-handle edge-left' },
      { id: 'right', x: 1, y: false, className: 'mini-handle edge-right' },
      { id: away, x: 0, y: true, className: `mini-handle edge-${away}` },
      { id: `${away}-left`, x: -1, y: true, className: `mini-handle corner-${away}-left` },
      { id: `${away}-right`, x: 1, y: true, className: `mini-handle corner-${away}-right` },
    ],
    startResize,
    corner,
    // D-160: by what is visible: the width, and the height only where the limit shows.
    resized: size.width !== DEFAULT.width || heightDiffers,
    reset,
  };
}

/**
 * D-111: the card rises in when mini is shown and fades out when it is hidden (main waits for the
 * fade before hiding the window, the focus already given back). Between the two it waits, unseen,
 * ready to rise in. Off with reduce-motion.
 */
export function useShowMotion(card: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const curve = 'cubic-bezier(0.2, 0.9, 0.3, 1)';
    let out: Animation | null = null;
    window.flintMini.onShown(() => {
      const element = card.current;
      out?.cancel();
      out = null;
      if (!element) return;
      element.style.removeProperty('opacity');
      if (reducedMotion()) return;
      element.animate(
        [
          { opacity: 0, transform: 'translateY(6px) scale(0.97)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: durationMs('--fl-dur-base', 200), easing: curve },
      );
    });
    window.flintMini.onHiding(() => {
      const element = card.current;
      if (!element || reducedMotion()) return;
      out = element.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translateY(4px) scale(0.975)' },
        ],
        { duration: durationMs('--fl-dur-base', 200) * 0.9, easing: 'ease-in', fill: 'forwards' },
      );
    });
    window.flintMini.onHidden(() => {
      const element = card.current;
      out?.cancel();
      out = null;
      // Unseen until it rises in again.
      element?.style.setProperty('opacity', '0');
    });
  }, [card]);
}
