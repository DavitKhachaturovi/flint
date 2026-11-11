import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import flintIcon from '../../../../../assets/icon/flint-icon-512.svg';
import type { MiniEdgeView, MiniTabLayout } from '../../shared/ipc.js';
import { durationMs, reducedMotion } from '../ui/motion.js';

/**
 * MINI-04, D-177 (mockup 16): mini collapsed to the app icon, cut in half by the screen's edge
 * (the window ends there). Resting on it peeks (main decides, from the cursor); a click opens; a
 * drag moves it along its edge (the corner spots show, it snaps within their reach) or, past the
 * screen's middle, to the other edge. A reminder waiting puts a white dot on it, with one pulse
 * when it comes; a running Focus session a thin line round its visible half.
 */

/** A press that moves this far is a drag, not a click. */
const DRAG_START = 4;

/** Focus's line: round the icon's visible half, 4 px outside it (a right edge; mirrored on a left). */
const LINE = 'M28,4 H17 A13,13 0 0 0 4,17 V39 A13,13 0 0 0 17,52 H28';

export interface EdgeFocus {
  /** 0 to 1. */
  readonly progress: number;
  readonly tone: 'focus' | 'break';
}

export function EdgeTab(props: {
  readonly tab: MiniTabLayout;
  readonly view: MiniEdgeView;
  readonly hover: boolean;
  /** The window is moving (another side): hidden until it is there. */
  readonly moving: boolean;
  readonly alerts: number;
  readonly focus: EdgeFocus | null;
}): ReactElement {
  const { tab, view, hover, moving, alerts, focus } = props;
  const element = useRef<HTMLDivElement>(null);
  // While dragged: where it is (page pixels), and the side it is on.
  const [drag, setDrag] = useState<{ top: number; side: 'left' | 'right' } | null>(null);
  // Let go: where it was let go, until main's layout has it.
  const [placed, setPlaced] = useState<number | null>(null);
  useEffect(() => setPlaced(null), [tab.top, tab.side]);
  const press = useRef<{ x: number; y: number; top: number; dragging: boolean } | null>(null);
  const sideRef = useRef(tab.side);
  sideRef.current = drag?.side ?? tab.side;

  // A reminder coming: one pulse (a new one each time the count grows).
  const [pulse, setPulse] = useState(0);
  const lastAlerts = useRef(alerts);
  useEffect(() => {
    if (alerts > lastAlerts.current) setPulse((n) => n + 1);
    lastAlerts.current = alerts;
  }, [alerts]);
  // A Focus phase ending (focus to break, or back): one pulse too.
  const lastTone = useRef(focus?.tone ?? null);
  useEffect(() => {
    const tone = focus?.tone ?? null;
    if (tone && lastTone.current && tone !== lastTone.current) setPulse((n) => n + 1);
    lastTone.current = tone;
  }, [focus?.tone]);

  // Shown (Flint starting), or the window moved to the strip (a card collapsing, the other side):
  // the tab slides out of the edge. Hidden (×): it fades with the card (D-111).
  const slideIn = (): void => {
    const node = element.current;
    if (!node || reducedMotion()) return;
    const out = sideRef.current === 'right' ? '26px' : '-26px';
    node.animate(
      [
        { translate: `${out} 0`, opacity: 0 },
        { translate: '0 0', opacity: 1 },
      ],
      {
        duration: durationMs('--fl-dur-base', 200),
        easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
      },
    );
  };
  const slideInRef = useRef(slideIn);
  slideInRef.current = slideIn;
  const wasMoving = useRef(moving);
  useEffect(() => {
    if (wasMoving.current && !moving && view === 'collapsed') slideInRef.current();
    wasMoving.current = moving;
  }, [moving, view]);
  useEffect(() => {
    let fading: Animation | null = null;
    window.flintMini.onShown(() => {
      fading?.cancel();
      fading = null;
      slideInRef.current();
    });
    window.flintMini.onHiding(() => {
      const node = element.current;
      if (!node || reducedMotion()) return;
      fading = node.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: durationMs('--fl-dur-base', 200) * 0.9,
        easing: 'ease-in',
        fill: 'forwards',
      });
    });
    window.flintMini.onHidden(() => {
      fading?.cancel();
      fading = null;
    });
  }, []);

  const top = drag?.top ?? placed ?? tab.top;
  const side = drag?.side ?? tab.side;
  const maxTop = window.innerHeight - tab.size;
  const near = (y: number): number | null =>
    tab.spots.find((spot) => Math.abs(y - spot) <= tab.snap) ?? null;

  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, y: event.clientY, top, dragging: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const start = press.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.dragging && Math.abs(dx) + Math.abs(dy) <= DRAG_START) return;
    start.dragging = true;
    const nextTop = Math.max(0, Math.min(maxTop, start.top + dy));
    // Past the work area's middle: the other edge (the window moves there).
    const nextSide: 'left' | 'right' = event.clientX < tab.middle ? 'left' : 'right';
    if (nextSide !== sideRef.current)
      window.flintMini.tabMoved({ side: nextSide, top: nextTop, done: false });
    setDrag({ top: nextTop, side: nextSide });
  };
  const up = (): void => {
    const start = press.current;
    press.current = null;
    if (!start) return;
    if (!start.dragging) {
      window.flintMini.edgeAction('open');
      return;
    }
    const at = drag?.top ?? start.top;
    const snapped = near(at) ?? at;
    setPlaced(snapped);
    setDrag(null);
    window.flintMini.tabMoved({ side: sideRef.current, top: snapped, done: true });
  };

  const dragging = drag !== null;
  const nearSpot = dragging ? near(top) : null;
  const tucked = view !== 'collapsed';
  return (
    <>
      {dragging &&
        tab.spots.map((spot) => (
          <span
            key={spot}
            className={`mini-edge-spot ${side}${spot === nearSpot ? ' near' : ''}`}
            style={{ top: spot, width: tab.size, height: tab.size }}
            aria-hidden="true"
          />
        ))}
      <div
        ref={element}
        className={[
          'mini-edge-tab',
          side,
          tucked ? 'tucked' : '',
          hover && !dragging ? 'hover' : '',
          dragging ? 'dragging' : '',
          moving ? 'moving' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ top, width: tab.size, height: tab.size }}
        role="button"
        aria-label="Mini mode"
        title="Mini mode · hover to peek, click to open"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          press.current = null;
          setDrag(null);
        }}
      >
        <img className="mini-edge-icon" src={flintIcon} alt="" draggable={false} />
        {focus && (
          <svg className="mini-edge-line" viewBox="0 0 56 56" aria-hidden="true">
            <path className="track" d={LINE} />
            <path
              className={`fill ${focus.tone}`}
              d={LINE}
              pathLength={100}
              strokeDasharray={`${(focus.progress * 100).toFixed(2)} 100`}
            />
          </svg>
        )}
        {alerts > 0 && <span className="mini-edge-dot" aria-hidden="true" />}
        {pulse > 0 && <span key={pulse} className="mini-edge-pulse" aria-hidden="true" />}
      </div>
    </>
  );
}
