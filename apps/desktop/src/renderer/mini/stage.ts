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
import { durationMs, reducedMotion } from '../ui/motion.js';

/**
 * D-110: mini mode's card on its transparent stage (`main/mini-place.ts`). The window is the
 * largest card's area from the corner the card hangs from; the card is placed in it here, at its
 * width, and as tall as its content up to its height limit (then its body scrolls), easing as rows
 * come and go. It is resized from the edges facing away from that corner (the window never moves
 * for it). Main is told the card's size and where clicks must reach the page (the card with its
 * handles, open menus, anything held); elsewhere clicks pass through to the apps below.
 */

/** The smallest card (main's CARD_WIDTH.min, CARD_LIMIT.min). */
const MIN_WIDTH = 300;
const MIN_LIMIT = 180;
/** The handles' reach outside the card. */
export const HANDLE = 8;

type Edge = 'x' | 'y' | 'xy';

export interface Stage {
  readonly style: CSSProperties;
  readonly className: string;
  /** The handles, on the edges facing away from the hang corner. */
  readonly handles: readonly { readonly edge: Edge; readonly className: string }[];
  readonly startResize: (edge: Edge, event: ReactPointerEvent<HTMLElement>) => void;
  /** The corner the card hangs from (a bottom corner: menus and new rows grow it upward). */
  readonly corner: MiniLayout['corner'];
}

export function useStage(refs: {
  readonly card: RefObject<HTMLElement | null>;
  /** Changes when the content changes at once (another tab, another note): the height eases. */
  readonly version: unknown;
}): Stage {
  const { card, version } = refs;
  const [layout, setLayout] = useState<MiniLayout | null>(null);
  const [size, setSize] = useState({ width: 364, limit: 460 });
  const [resizing, setResizing] = useState(false);
  // Snapping into another corner: hidden until the window has moved, then it settles in.
  const [hidden, setHidden] = useState(false);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    void window.flintMini.layout().then((current) => {
      if (!current || layoutRef.current) return;
      setLayout(current);
      setSize({ width: current.width, limit: current.limit });
    });
    window.flintMini.onLayout((next) => {
      setLayout(next);
      setSize({ width: next.width, limit: next.limit });
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

  const room = layout?.room ?? { width: 520, height: 760 };
  const width = Math.max(MIN_WIDTH, Math.min(size.width, room.width));
  const limitMax = Math.min(size.limit, room.height);

  // The card is as tall as its content up to the limit (max-height; its body scrolls past it), so
  // it follows rows easing in and out, the reminder card folding, as they animate. A sudden change
  // (another tab, another note) eases from the old height to the new (09 §9's page switch).
  const lastHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const before = lastHeight.current;
    const after = element.offsetHeight;
    if (before === null || before === after || reducedMotion()) return;
    element.animate([{ height: `${before}px` }, { height: `${after}px` }], {
      duration: durationMs('--fl-dur-page', 320),
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    });
  }, [card, version]);
  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      lastHeight.current = element.offsetHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [card]);

  // Where clicks must reach the page: the card and its handles, open menus. Told to main a frame
  // after anything moves (and while a button is held, wherever the pointer goes).
  const held = useRef(false);
  const frame = useRef(0);
  const report = useCallback((): void => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const element = card.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const rects = [
        {
          x: box.x - HANDLE,
          y: box.y - HANDLE,
          width: box.width + 2 * HANDLE,
          height: box.height + 2 * HANDLE,
        },
        ...[...document.querySelectorAll('.fl-menu')].map((menu) => {
          const rect = menu.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
      ];
      window.flintMini.surface({
        card: { width: box.width, height: box.height },
        rects,
        held: held.current,
      });
    });
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
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
    };
  }, [card, report]);
  useEffect(report, [report, layout, width, size.limit]);

  const corner = layout?.corner ?? 'top-right';
  const left = corner.endsWith('left');
  const top = corner.startsWith('top');

  const startResize = (edge: Edge, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const from = { width, height: card.current?.offsetHeight ?? limitMax };
    lastHeight.current = null;
    const roomNow = layoutRef.current?.room ?? room;
    let next = { ...sizeRef.current };
    setResizing(true);
    const move = (moved: PointerEvent): void => {
      const dx = moved.clientX - start.x;
      const dy = moved.clientY - start.y;
      if (edge !== 'y')
        next = {
          ...next,
          width: Math.round(
            Math.max(MIN_WIDTH, Math.min(roomNow.width, from.width + (left ? dx : -dx))),
          ),
        };
      if (edge !== 'x')
        next = {
          ...next,
          limit: Math.round(
            Math.max(MIN_LIMIT, Math.min(roomNow.height, from.height + (top ? dy : -dy))),
          ),
        };
      setSize(next);
    };
    const end = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setResizing(false);
      lastHeight.current = card.current?.offsetHeight ?? null;
      window.flintMini.resized(next);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const style: CSSProperties = {
    width,
    maxHeight: Math.max(MIN_LIMIT, limitMax),
    [left ? 'left' : 'right']: layout?.horizontal ?? 72,
    [top ? 'top' : 'bottom']: layout?.vertical ?? 36,
    ...(hidden && { opacity: 0 }),
  };
  const side = left ? 'right' : 'left';
  const end = top ? 'bottom' : 'top';
  return {
    style,
    className: [
      'mini-card fl-compact',
      layout === null ? 'unplaced' : '',
      resizing ? 'resizing' : '',
      hidden ? 'moving' : '',
    ]
      .filter(Boolean)
      .join(' '),
    handles: [
      { edge: 'x', className: `mini-handle edge-${side}` },
      { edge: 'y', className: `mini-handle edge-${end}` },
      { edge: 'xy', className: `mini-handle corner-${end}-${side}` },
    ],
    startResize,
    corner,
  };
}
